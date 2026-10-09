declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'note-ledger': {
      kind: 'note-ledger'
      plugin?: string
      form?: 'snapshot' | 'notice'
      summary?: string
      sections?: readonly { name: string; text: string }[]
    }
  }
}

/**
 * One owner for session-bound note selection, model delivery and change notices.
 *
 * The loop claims input, assembles the system prompt, awaits agent/pre-step,
 * commits accepted messages, then calls the model. Enqueueing during assembly
 * therefore arrives one model step late. Snapshot delivery belongs in the
 * awaited pre-step decision, never in the next-step inbox or a turn/start emit.
 */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { readBoundedFile } from './read.ts'
import { fingerprintPathFor, readFingerprints, rememberFingerprint } from './fingerprints.ts'
import { smellOfSection } from './hygiene.ts'
import { resolveLedger, type LedgerDeps, type LedgerRef } from './ledgers.ts'
import { DEFAULT_RUN_LOG_SECTIONS, knowledgeIndex, matchesSection, sectionsOf, selectNote } from '../sections.ts'

export const S_LEDGER = 'note-ledger'
export const INJECTION_PLUGIN = 'note-ledger'
const DELTA_SUMMARY_MAX = 120
const OFF_PREFIX = '[FROZEN LEDGER] 本会话的笔记注入**已关闭**。'
const UNAVAILABLE_PREFIX = '[FROZEN LEDGER] 本会话的知识库当前不可用。'

export interface InjectDeps extends LedgerDeps {
  /** Exact ids or trailing-star prefixes. Logs always win over pinning. */
  pinnedSections: readonly string[]
  runLogSections?: readonly string[]
  /** Soft budget for resident knowledge, not a storage cap. */
  injectBudget: number
  /** Independent bounded-file-read safety cap, in UTF-16 code units. */
  readBudget: number
  placement?: 'first' | 'last'
  /** Section changes replace system context; snapshots append at pre-step. */
  delivery?: 'section' | 'snapshot'
}

interface LoadedLedger { ref: LedgerRef, text: string, truncated: boolean }
interface BaselineCommit { id: string, path: string, sections: Map<string, string> }

function snapshotTextOf(message: unknown): string | null {
  const record = message as {
    source?: { kind?: unknown, plugin?: unknown, form?: unknown }
    content?: readonly { type?: unknown, text?: unknown }[]
  } | null
  const isMatch = record?.source?.kind === INJECTION_PLUGIN || (record?.source?.kind === 'plugin' && record.source.plugin === INJECTION_PLUGIN)
  if (!isMatch || record?.source?.form !== 'snapshot') return null
  if (!Array.isArray(record.content)) return null
  return record.content.map(part => part.type === 'text' && typeof part.text === 'string' ? part.text : '').join('')
}

function isRevocation(message: UserMessage): boolean {
  const source = message.source
  const isMatch = source?.kind === INJECTION_PLUGIN || (source?.kind === 'plugin' && source.plugin === INJECTION_PLUGIN)
  return isMatch && source?.form === 'notice'
    && message.content.some(part => part.type === 'text' && (part.text.startsWith(OFF_PREFIX) || part.text.startsWith(UNAVAILABLE_PREFIX)))
}

function unavailableNotice(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: [
      UNAVAILABLE_PREFIX,
      '可能是未绑定、已关闭，或源文件暂时无法读取。此前注入的知识库副本**已作废**，不要继续据旧副本给出确定结论。',
      '请说明当前知识缺口；恢复绑定或文件后，以重新提供的最新正文为准。',
    ].join('\n') }],
    source: { kind: INJECTION_PLUGIN, plugin: INJECTION_PLUGIN, form: 'notice', summary: '笔记当前不可用（旧副本作废）' },
  })
}

/** Compare only the latest retained version: A → B → A must deliver the new A. */
function latestRetainedSnapshot(agent: Agent): string | null {
  const nodes = agent.session.surface.nodes
  for (let i = nodes.length - 1; i >= 0; i--) {
    const event = agent.session.eventAt(nodes[i])
    if (event?.type !== 'user/message') continue
    const text = snapshotTextOf(event.data)
    if (text !== null) return text
    // Turning off or losing the binding revokes older snapshots; recovery must
    // deliver again, even if the recovered body equals the old retained text.
    if (isRevocation(event.data)) return null
  }
  return null
}

function snapshotMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: INJECTION_PLUGIN, plugin: INJECTION_PLUGIN, form: 'snapshot', sections: [{ name: S_LEDGER, text }] },
  })
}

/**
 * Persist body hashes, never note contents. Run logs never create a delta.
 *
 * Exported because the board's budget view must answer "which section has been
 * changing" with the **same** hashes the delta notice compares: a second
 * implementation that normalised whitespace differently would tell the human a
 * section is stable while the model is being told it changed.
 * @param text - the whole note.
 * @param logs - the run-log patterns, whose sections never participate.
 * @returns section id → short hash of its normalised body.
 */
export function sectionFingerprints(text: string, logs: readonly string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const section of sectionsOf(text).sections) {
    if (matchesSection(section.id, logs)) continue
    const body = section.text.split('\n').slice(1).join('\n').replace(/\s+/g, ' ').trim()
    map.set(section.id, createHash('sha1').update(body).digest('hex').slice(0, 16))
  }
  return map
}

function delta(previous: Map<string, string> | null, next: Map<string, string>) {
  if (previous === null) return null
  const added: string[] = [], changed: string[] = [], removed: string[] = []
  for (const [id, body] of next) {
    if (!previous.has(id)) added.push(id)
    else if (previous.get(id) !== body) changed.push(id)
  }
  for (const id of previous.keys()) if (!next.has(id)) removed.push(id)
  return added.length + changed.length + removed.length === 0 ? null : { added, changed, removed }
}

/** Ids of changed sections whose body reads like a run record rather than a definition. */
function episodicAmong(text: string, ids: readonly string[], logs: readonly string[]): string[] {
  const wanted = new Set(ids)
  const flagged: string[] = []
  for (const section of sectionsOf(text).sections) {
    if (!wanted.has(section.id)) continue
    if (matchesSection(section.id, logs)) continue
    if (smellOfSection(section.id, section.text) !== null) flagged.push(section.id)
  }
  return flagged
}

function changeNotice(
  change: NonNullable<ReturnType<typeof delta>>,
  path: string,
  text: string,
  logs: readonly string[],
): UserMessage {
  const lines: string[] = []
  if (change.added.length) lines.push(`- 新增：${change.added.join('、')}`)
  if (change.changed.length) lines.push(`- 被替换：${change.changed.join('、')}`)
  if (change.removed.length) lines.push(`- 被删除：${change.removed.join('、')}`)
  // Speaking to the writer at the moment of writing, which is the only moment
  // the advice is actionable: a record of one run becomes a constraint on every
  // later turn, so it belongs in a run log or in session memory, not in a
  // knowledge entry. The board and `/note-board status` flag the same thing for
  // the human; this line is the one the model sees.
  const suspected = episodicAmong(text, [...change.added, ...change.changed], logs)
  return createUserMessage({
    content: [{ type: 'text', text: [
      '[LEDGER DELTA] 笔记在你上次读到它之后发生了变化——可能来自另一个会话，也可能来自你自己本轮的写入。',
      ...lines, '',
      ...(suspected.length === 0 ? [] : [
        `[内容边界] ${suspected.join('、')} 的正文读起来像**一次运行的记录**（设备/环境故障、走不通的算法、失败的作业），而不是框架级定义。`,
        '这类内容每轮都会被当作知识注入，于是当初那个有时效、可能低质量的结论会长期约束后来的发散工作：',
        '请把它移到 `## RUN-LOG …` 节，或交给会话记忆工具（deja / memsearch），只在知识条目里留下仍然成立的决定性结论。',
        '',
      ]),
      `本通知只报告知识变更，不携带新正文。涉及这些条目时，先使用 note_board_read 读取完整最新内容。源文件：${path}`,
      '常驻正文与按需目录由 [FROZEN LEDGER] 提供；目录不代表条目已读。工具不可用时再按节读取文件，不要为读取知识而读取运行日志。',
      '你上下文里这些条目的旧副本**已经作废**：不要引用它、不要沿用它的写法或约定；',
      '若你前面的结论依赖旧版本，先按新版本把那一步重做，而不是在旧结论上继续叠加。',
    ].join('\n') }],
    source: {
      kind: INJECTION_PLUGIN, plugin: INJECTION_PLUGIN, form: 'notice',
      summary: `笔记已更新：${lines.map(line => line.replace(/^[-\s]+/, '')).join('；')}`.slice(0, DELTA_SUMMARY_MAX),
    },
  })
}

export function registerLedgerInjection(ctx: Context, deps: InjectDeps): () => void {
  const storePath = fingerprintPathFor(deps.registryPath)
  const runLogs = deps.runLogSections ?? DEFAULT_RUN_LOG_SECTIONS
  let writing: Promise<void> = Promise.resolve()
  const remember = (sessionId: string, pending: BaselineCommit): Promise<void> => {
    writing = writing.then(() => rememberFingerprint(storePath, sessionId, {
      path: pending.path, sections: Object.fromEntries(pending.sections), at: Date.now(),
    })).catch((error: unknown) => {
      console.error('[dsh-note-board] could not persist a ledger fingerprint:', error instanceof Error ? error.message : String(error))
    })
    return writing
  }

  // A candidate is not proof of delivery. Reuse it in an accepted decision;
  // never suppress delivery merely because a prior, uncommitted candidate exists.
  const inFlight = new Map<string, { text: string, message: UserMessage }>()
  const baselineOnCommit = new Map<string, BaselineCommit>()
  const sectionReads = new Map<string, LoadedLedger | null>()

  const loadLedger = async (agent: Agent): Promise<LoadedLedger | null> => {
    const session = agent.session
    const ref = await resolveLedger({
      ...deps,
      cwdOf: id => id === session.id ? (session.header?.cwd ?? deps.cwdOf(id)) : deps.cwdOf(id),
    }, session.id)
    if (ref.source === 'none' || ref.source === 'off') return null
    try {
      const read = await readBoundedFile(ref.path, deps.readBudget)
      return { ref, text: read.text, truncated: read.truncated }
    } catch { return null }
  }

  const disposeAssemble = ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined || deps.delivery === 'snapshot') return assembled
    const loaded = await loadLedger(agent)
    sectionReads.set(agent.session.id, loaded)
    if (loaded === null) return assembled
    const text = ledgerBody(loaded.ref, loaded.text, deps.injectBudget, deps.pinnedSections, runLogs, loaded.truncated)
    if (text === null) return assembled
    const injected: PromptAssembly['sections'] = [{ name: S_LEDGER, text }]
    const rest = assembled.sections.filter(section => section.name !== S_LEDGER)
    return deps.placement === 'first'
      ? { ...assembled, sections: [...injected, ...rest] }
      : { ...assembled, sections: [...rest, ...injected] }
  })

  const disposePreStep = ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
    const decision = await next()
    // Respect downstream rejection, cancellation and intentional empty admission.
    // This is the same no-resurrection guard used by native model-selection.
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision
    const id = agent.session.id
    await writing
    const loaded = deps.delivery === 'snapshot' ? await loadLedger(agent) : sectionReads.get(id)
    if (signal.aborted) return decision
    // Old-generation queued snapshots may survive hot reload. Replace only our
    // own snapshots; preserve human messages and every other producer verbatim.
    let rest = deps.delivery === 'snapshot'
      ? decision.messages.filter(message => snapshotTextOf(message) === null)
      : decision.messages
    if (loaded === null || loaded === undefined) {
      baselineOnCommit.delete(id)
      const revoke = latestRetainedSnapshot(agent) !== null && !rest.some(isRevocation)
        ? [unavailableNotice()] : []
      return { ...decision, messages: [...revoke, ...rest] }
    }
    // Off → on may happen before the queued OFF notice is claimed. A newly
    // enabled snapshot must follow that notice, not be revoked by it. Section
    // mode already supplies fresh system context, so discard its obsolete
    // uncommitted revokers instead. Other producers keep their original order.
    const revocations = rest.filter(isRevocation)
    rest = rest.filter(message => !isRevocation(message))
    const { ref, text, truncated } = loaded
    const current = sectionFingerprints(text, runLogs)
    const persisted = (await readFingerprints(storePath))[id]
    if (signal.aborted) return decision
    const previous = persisted !== undefined && persisted.path === ref.path
      ? new Map(Object.entries(persisted.sections).filter(([key]) => !matchesSection(key, runLogs)))
      : null
    const change = truncated ? null : delta(previous, current)
    const supplied: UserMessage[] = deps.delivery === 'snapshot' ? [...revocations] : []
    if (deps.delivery === 'snapshot') {
      const body = ledgerBody(ref, text, deps.injectBudget, deps.pinnedSections, runLogs, truncated)
      if (body !== null && (latestRetainedSnapshot(agent) !== body || revocations.length > 0)) {
        const claimed = decision.messages.find(message => snapshotTextOf(message) === body)
        const candidate = inFlight.get(id)
        const message = claimed ?? (candidate?.text === body ? candidate.message : snapshotMessage(body))
        inFlight.set(id, { text: body, message })
        supplied.push(message)
      }
    }
    if (change !== null) supplied.push(changeNotice(change, ref.path, text, runLogs))
    // Context precedes the human's question rather than becoming the latest
    // user-role message. No inbox enqueue means no artificial extra model step.
    const entered = [...supplied, ...rest]
    if (!truncated && (previous === null || change !== null)) {
      const witness = supplied.at(-1) ?? rest[0]
      if (witness !== undefined) baselineOnCommit.set(id, { id: witness.id, path: ref.path, sections: current })
    }
    return { ...decision, messages: entered }
  })

  // Commit is the delivery fact. Persisting during assembly/pre-step would
  // swallow a delta if another hook rejected the step or cancellation won.
  const forgetCommitted = ctx.on('session/event', (subject: { id?: string }, event: unknown) => {
    const record = event as { type?: unknown, data?: { id?: unknown } } | null
    const id = subject.id
    if (id === undefined) return
    if (record?.type === 'turn/end') {
      // These candidates were abandoned, not delivered; no baseline is saved.
      inFlight.delete(id)
      baselineOnCommit.delete(id)
      sectionReads.delete(id)
      return
    }
    if (record?.type !== 'user/message' || typeof record.data?.id !== 'string') return
    const messageId = record.data.id
    if (inFlight.get(id)?.message.id === messageId) inFlight.delete(id)
    const baseline = baselineOnCommit.get(id)
    if (baseline?.id === messageId) {
      baselineOnCommit.delete(id)
      return remember(id, baseline)
    }
  })
  const forgetOnDispose = ctx.on('agent/disposed', ({ agent }) => {
    inFlight.delete(agent.session.id)
    baselineOnCommit.delete(agent.session.id)
    sectionReads.delete(agent.session.id)
  })
  return () => {
    disposeAssemble(); disposePreStep(); forgetOnDispose(); forgetCommitted()
    inFlight.clear(); baselineOnCommit.clear(); sectionReads.clear()
  }
}

/** History is append-only: switching off revokes prior snapshots explicitly. */
export function injectionOffNotice(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: [
      OFF_PREFIX,
      '此前注入的笔记副本**已作废**：不要再引用它、不要沿用它的写法或约定；',
      '若你前面的结论依赖它，先说明这一限制，而不是继续按它推进。',
      '需要继续使用时，请重新开启注入。',
    ].join('\n') }],
    source: { kind: INJECTION_PLUGIN, plugin: INJECTION_PLUGIN, form: 'notice', summary: '笔记注入已关闭（旧副本作废）' },
  })

}

/** Same model-visible text for both delivery channels and the board preview. */
export function ledgerBody(
  ref: LedgerRef, text: string, budget: number, pinned: readonly string[],
  logs: readonly string[] = DEFAULT_RUN_LOG_SECTIONS, truncated = false,
): string | null {
  if (truncated) return [
    '[FROZEN LEDGER] 知识库超出文件读取上限，本轮不提供不完整的权威正文。',
    `请用文件读取工具分段读取所需完整条目：${ref.path}`,
    '此前的笔记快照不能据此视为已核对；未读齐相关条目与依赖前，不得沿用旧副本给出确定结论。',
  ].join('\n')
  if (text.trim() === '') return null
  const selection = selectNote(text, pinned, logs)
  const head = [
    '[FROZEN LEDGER] 以下是知识库的常驻内容与按需目录，不是新的用户提问；继续回答真人当前的问题。',
    '知识条目应区分已确认、待验证、已否决及已被替代；目录或收录本身不表示已证实。',
    '对于明确冻结的定义，**不得**在未显式声明 `[SYMBOL MUTATION]` 的情况下改写，',
    '也不得在推理中悄悄换用别的写法；引用时直接沿用这里的定义与约定。',
    '本消息实际提供正文的条目即最新版本：若你上下文里的副本与它们不一致，**以本消息为准**；仅列于目录的条目必须另读。',
    // Presence is not use; citation is not transcription. Keep the measured
    // formula-use obligation even as the delivery mechanism changes.
    '本轮讨论若涉及下列已冻结的对象，**先逐字抄录**相关条目的表达式与分量定义，再在其基础上推进；',
    '只贴条目编号不算完成这一步。若你要给出的式子与条目不逐项一致',
    '（前置系数、实部还是模方、相位、求和变量与上下界都要逐项比），**先停下来说明冲突**，',
    '而不是另给一个式子、或改用你自己的推导与仓库代码里的另一种写法。',
    `知识库文件：${ref.path}`,
  ]
  if (ref.source === 'discovered') head.push('（本会话的笔记按其工作目录自动发现。）')
  head.push(
    '写作纪律：知识库保存结论、适用条件、关键依据与开放问题；运行进度、命令和逐轮输出写运行日志，不因完成一个阶段就新增知识。',
    '运行日志只在复现、查证或排错时读取；可在本文件的运行日志节中记录代码版本、配置、结果与原始日志路径。日志不自动注入，也不自动升级为知识。',
    // The role boundary, stated to the reader because the reader is also the
    // writer. Measured failure this answers: one session's device fault or dead
    // end gets written down as knowledge, and every later session then treats a
    // time-bound, low-quality observation as a framework constraint — which is
    // exactly what blocks divergent work.
    '本笔记只保存**框架级、决定性**的内容（适用于 Z3 这类课题时：冻结定义、符号约定、已判决结论、未决问题）。',
    '一次尝试中的观察——设备或环境的毛病、某个算法/脚本走不通、某次作业为什么失败——**不属于本笔记，也不构成后续推导的约束**：',
    '要么写进运行日志节，要么交给会话记忆工具（deja / memsearch）。不要把它写成知识条目：那会让一个当时的、可能低质量的结论长期限制后来的发散工作。',
  )
  const parts = [...head, '', selection.residentText, '', knowledgeIndex(selection)]
  if (selection.residentText.length > budget) parts.push('',
    `[!] 常驻知识合计 ${selection.residentText.length} 字符，已超出注入预算 ${budget}：这是软预算，仍完整提供，不截断公式或条目。`,
  )
  return parts.join('\n').trim()
}
