/**
 * The board's two languages, and how a string reaches the screen.
 *
 * ## Why the toggle switches the whole app, not just this board
 *
 * The obvious implementation — a board-local language — is subtly broken here.
 * The board's tab label in 对话 | 轨迹 | 笔记看板 is not rendered by this plugin:
 * `conversation.view` takes a `label` **thunk**, and the conversation owner
 * (ui-conversation `apply.ts`) resolves it while projecting its own tab strip.
 * It re-projects on `ctx.locale.subscribe(refreshViews)` — i.e. on a *locale
 * change* — and on nothing else this plugin can reach. A board-local override
 * therefore leaves the tab in one language and the pane in the other, with no
 * way to reconcile them.
 *
 * So the toggle goes through the platform's own preference, which the service
 * documents as the only write entry (`locale.setLocale`), and the board reads
 * the active locale. One source of truth, and the tab, the pane and the rest of
 * DSH agree — whether the switch came from this button or from Settings.
 *
 * ## Why the dictionaries live here rather than in the platform catalog
 *
 * The service also offers `register(ns, …)` + `bind(ns)`, which first-party
 * plugins use. That path is typed against `LocaleNamespaceMap`, which a plugin
 * outside the DSH repository cannot augment, and its only added value over these
 * dictionaries would be a future language pack translating ~50 strings. The
 * interface below buys the property that actually matters instead: **both
 * dictionaries implement the same type**, so a missing English string is a
 * compile error rather than a Chinese string surfacing in an English UI.
 *
 * @module @suxeca/dsh-note-board/client/i18n
 */
import { useSyncExternalStore } from 'react'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locales this board ships. Exactly the platform's built-ins. */
export const BOARD_LOCALES = ['zh', 'en'] as const

/** One of {@link BOARD_LOCALES}. */
export type BoardLocale = (typeof BOARD_LOCALES)[number]

/**
 * Every string the board renders.
 *
 * Interpolated strings are functions, not `{placeholder}` templates: the
 * compiler then checks that each language supplies the same shape and the same
 * parameters, and there is no formatter to get wrong. `zh` is the original
 * wording; `en` is a translation of it, not a redesign.
 */
export interface BoardStrings {
  /** The tab label in 对话 | 轨迹 | … */
  readonly view: string
  /** Toolbar segments. */
  readonly segmentCatalog: string
  readonly segmentLedger: string
  readonly segmentAudit: string
  readonly segmentLogs: string
  readonly logsHint: string
  readonly logsEmpty: string
  readonly knowledgeHint: string
  readonly injectionPreview: string
  readonly injectionUnknown: string
  readonly readTruncated: string
  readonly injectionScope: (pinned: number, demand: number, logs: number) => string
  readonly refresh: string
  readonly loading: string
  /** Where the toggle is going, shown as its own label — "EN" / "中". */
  readonly languageToggle: string
  readonly switchToEnglish: string
  readonly switchToChinese: string
  /** How the session's note was decided. */
  readonly sourceAttached: string
  readonly sourceDiscovered: string
  readonly sourceNone: string
  /** The note is there, but this session was told not to inject it. */
  readonly sourceOff: string
  /** `'off'` chip that names the binding the switch overrides. */
  readonly sourceOffUnder: (under: string) => string
  readonly unboundTitle: string
  /** The hint under an unbound session, split around the inline 笔记目录 link. */
  readonly unboundHintLead: string
  readonly unboundHintTail: string
  /** A bound note whose file does not exist yet. */
  readonly noteMissing: string
  readonly discoveryOrigin: (root: string) => string
  readonly changeNote: string
  readonly changeNoteTitle: string
  readonly detach: string
  readonly detachTitle: string
  readonly injectOff: string
  readonly injectOffTitle: string
  readonly injectOn: string
  readonly injectOnTitle: string
  /** Stands in for the note title while injection is switched off. */
  readonly injectOffState: string
  /** The composer entry: a short lead-in before the note's title. */
  readonly dockNote: string
  readonly dockOn: string
  readonly dockOff: string
  /** The bound file is gone, so the entry reports that rather than a title. */
  readonly dockMissing: string
  /** Says the switch hides nothing from the human, only from the model. */
  readonly offStillReadable: string
  readonly readFailed: (detail: string) => string
  readonly noSessionId: string
  readonly refreshedAt: (time: string) => string
  /** Injection-budget line. */
  readonly absorbOver: (chars: number, budget: number) => string
  readonly absorbOk: (chars: number, budget: number) => string
  readonly absorbOverHint: string
  readonly absorbOkHint: string
  /** Per-section budget view: what costs the budget and what has been moving. */
  readonly budgetTitle: string
  readonly budgetChanged: string
  readonly budgetChars: (chars: number) => string
  readonly budgetNoBaseline: string
  readonly budgetHint: string
  /** Sections whose body reads like a run record rather than a definition. */
  readonly hygieneSmell: string
  readonly hygieneSmellHint: string
  readonly classResident: string
  readonly classOnDemand: string
  readonly classLog: string
  /** Audit verdicts. */
  readonly consumed: string
  readonly awaitingFeedback: string
  readonly auditUnbound: string
  readonly auditEmpty: string
  readonly auditPending: (count: number) => string
  /** Note index. */
  readonly catalogTitle: string
  readonly scanning: string
  readonly catalogCount: (count: number, roots: string) => string
  readonly noScanRoots: string
  readonly rescan: string
  readonly attachExplain: string
  readonly attachExplainTail: string
  readonly emptyTitle: string
  readonly emptyHintLead: string
  readonly emptyHintOr: string
  readonly emptyHintTail: string
  readonly currentSession: string
  readonly pendingAuditsBadge: (count: number) => string
  readonly fileGone: string
  readonly attach: string
  readonly attachPathLabel: string
  readonly attachPathPlaceholder: string
  readonly attachPathEmpty: string
  readonly sections: (count: number) => string
  /** Ledger-composition legend. */
  readonly frozen: string
  readonly verdictsCount: string
  readonly openCount: string
  readonly otherCount: string
  readonly compositionLegend: (label: string, count: number) => string
  /** Relative times, and the BCP 47 tag used for absolute ones. */
  readonly justNow: string
  readonly minutesAgo: (count: number) => string
  readonly hoursAgo: (count: number) => string
  readonly dateLocale: string
  /** Rendered-Markdown chrome. */
  readonly markdownCopy: string
  readonly markdownCopied: string
  readonly markdownFootnotes: string
  /** The error boundary's heading. */
  readonly renderFailed: (detail: string) => string
  /** The collapsed stack under the degraded view. */
  readonly renderFailedDetail: string
  /** Heading of the plain-text note the boundary falls back to. */
  readonly plainFallbackNote: (title: string) => string
  /** The fallback itself could not read the note. */
  readonly plainFallbackFailed: (detail: string) => string
}

/** The language the board was written in. */
export const ZH: BoardStrings = {
  view: '笔记看板',
  segmentCatalog: '笔记目录',
  segmentLedger: '知识库',
  segmentAudit: '审计判决',
  segmentLogs: '运行日志',
  logsHint: '运行日志仅供追溯，不自动注入。这里只显示已分类的日志节及其中的文件路径；不会扫描或复制原始日志。',
  logsEmpty: '暂无运行日志入口。在笔记中添加 ## RUN-LOG · 运行日志，记录目的、代码版本、配置、结果及日志路径即可；原文件不必搬动。',
  knowledgeHint: '保存定义、结论、适用条件、关键依据与开放问题，并标明确认状态。运行进度与逐轮输出放到「运行日志」。',
  injectionPreview: '查看下一次装配预览（非已送达或已使用证明）',
  injectionUnknown: '当前服务未提供注入范围，请更新服务后查看；不能仅凭全文字数判断。',
  readTruncated: '文件读取已达安全上限：当前视图不完整，自动注入只提供缺口提示，不发送部分知识正文。请用文件工具分段读取。',
  injectionScope: (pinned, demand, logs) => `常驻 ${pinned} 节 + 前言 · 按需知识 ${demand} 节 · 运行日志 ${logs} 节（不自动注入）`,
  refresh: '刷新',
  loading: '读取中…',
  languageToggle: 'EN',
  switchToEnglish: '切换为英文',
  switchToChinese: '切换为中文',
  sourceAttached: '已附加',
  sourceDiscovered: '按项目自动发现',
  sourceNone: '未绑定',
  sourceOff: '本会话已关闭注入',
  sourceOffUnder: under => `本会话已关闭注入（原本：${under}）`,
  unboundTitle: '本会话未绑定笔记',
  unboundHintLead: '本会话还没有附加笔记。去',
  unboundHintTail: '挑一个。',
  noteMissing: '笔记文件还不存在。等第一条定义被写入后，这里就会出现。',
  discoveryOrigin: root => `（发现自 ${root}）`,
  changeNote: '更换笔记',
  changeNoteTitle: '回到笔记目录',
  detach: '取消附加',
  detachTitle: '取消手动附加，回到按项目自动发现；该项目里能找到笔记时会立刻重新绑上。要让本会话完全不用它，请用「本会话不注入」。',
  injectOff: '本会话不注入',
  injectOffTitle: '停止把这份笔记注入本会话；其它会话不受影响，看板里仍可查看。',
  injectOn: '恢复注入',
  injectOnTitle: '恢复把这份笔记注入本会话',
  injectOffState: '注入已关闭',
  dockNote: '笔记',
  dockOn: '注入开',
  dockOff: '注入已关',
  dockMissing: '文件缺失',
  offStillReadable: '注入已关闭：本会话不会注入这份笔记；下面的内容只供查看，不会进入模型上下文。',
  readFailed: detail => `读取失败：${detail}`,
  noSessionId: '这个视图没有拿到 sessionId，无法解析笔记。',
  refreshedAt: time => `刷新 ${time}`,
  absorbOver: (chars, budget) => `常驻正文 ${chars} 字符，超过软预算 ${budget}，仍完整提供。`,
  absorbOk: (chars, budget) => `常驻正文 ${chars} 字符，软预算 ${budget}；这不是知识库存储上限。`,
  absorbOverHint: '不截断条目；另含目录与说明开销',
  absorbOkHint: '按需知识须读完整条目',
  budgetTitle: '内容边界（按节）',
  budgetChanged: '已变更',
  budgetChars: chars => `${chars} 字符`,
  budgetNoBaseline: '本会话尚未提交过注入，因此没有基线：哪些节在变，要等第一次注入提交后才看得出来。',
  budgetHint: '「已变更」＝这一节与上次**已注入**的内容不同（与 [LEDGER DELTA] 用同一份哈希）。反复出现的节通常就是被当成日志在写的那些。',
  hygieneSmell: '疑似过程记录',
  hygieneSmellHint: '这一节的正文里混着过程叙述（设备/环境的毛病、走不通的算法、某次作业为什么失败、实测数字）。它只是提醒你「读这一节时，有一部分其实是过程」，**不等于要把它移走**：如果这些实测是某条判决/结论的证据，保留是对的；要让常驻更干净，可以把数字移进按需的证据节（如 STAGE1-EVIDENCE），判决留在原处。纯过程记录则应该去 `## RUN-LOG …` 或 deja / memsearch。这里只标出来，不会自动改你的笔记。',
  classResident: '常驻',
  classOnDemand: '按需',
  classLog: '日志',
  consumed: '已回注',
  awaitingFeedback: '待回注',
  auditUnbound: '本会话还没有附加笔记，没有可看的审计判决。',
  auditEmpty: '这个笔记还没有审计判决。判决文件落进笔记同级的收件箱目录后，就会出现在这里。',
  auditPending: count => `${count} 份判决尚未回注到父会话，将在其下一轮自动注入。`,
  catalogTitle: '笔记目录',
  scanning: '扫描中…',
  catalogCount: (count, roots) => `本机找到 ${count} 个笔记 · 扫描 ${roots}`,
  noScanRoots: '（未配置扫描根）',
  rescan: '重新扫描',
  attachExplain: '附加知识库后，当前对话会自动携带**常驻知识与按需目录**；运行日志不自动注入。',
  attachExplainTail: '不附加时，看板按本会话的工作目录自动发现。',
  emptyTitle: '扫描根下没有找到笔记。',
  emptyHintLead: '笔记可以放在项目的 ',
  emptyHintOr: '、',
  emptyHintTail: '。也可以直接在下面填一个绝对路径。',
  currentSession: '当前会话',
  pendingAuditsBadge: count => `${count} 待回注`,
  fileGone: '文件已不存在',
  attach: '附加',
  attachPathLabel: '或直接指定路径：',
  attachPathPlaceholder: '/绝对/路径/notes/ledger.md',
  attachPathEmpty: '请输入笔记路径',
  sections: count => `${count} 段`,
  frozen: '冻结',
  verdictsCount: '判决',
  openCount: '开放',
  otherCount: '其它',
  compositionLegend: (label, count) => `${label}${count}`,
  justNow: '刚刚',
  minutesAgo: count => `${count} 分钟前`,
  hoursAgo: count => `${count} 小时前`,
  dateLocale: 'zh-CN',
  markdownCopy: '复制',
  markdownCopied: '已复制',
  markdownFootnotes: '脚注',
  renderFailed: detail => `笔记看板渲染失败：\n${detail}`,
  renderFailedDetail: '技术细节（堆栈）',
  plainFallbackNote: title => `以下为「${title}」的原始 Markdown（渲染器出错时的降级显示）：`,
  plainFallbackFailed: detail => `降级读取也失败了，笔记内容无法显示：${detail}`,
}

/** {@link ZH} in English. */
export const EN: BoardStrings = {
  view: 'Note board',
  segmentCatalog: 'Note index',
  segmentLedger: 'Knowledge base',
  segmentAudit: 'Audit verdicts',
  segmentLogs: 'Run logs',
  logsHint: 'Run logs are for traceability, not automatic injection. This view shows classified log sections and their file references; it does not scan or copy raw logs.',
  logsEmpty: 'No run-log entry yet. Add ## RUN-LOG to the note with the purpose, code revision, configuration, result and log paths. Existing files need not move.',
  knowledgeHint: 'Keep definitions, conclusions, conditions, key evidence and open questions here, with explicit confirmation status. Put progress and per-run output in Run logs.',
  injectionPreview: 'Preview next assembly (not proof of delivery or use)',
  injectionUnknown: 'This server did not report injection scope. Update it before checking; file size alone cannot determine scope.',
  readTruncated: 'File read safety cap reached: this view is incomplete. Automatic injection carries a warning, not partial knowledge. Read the file in chunks with a file tool.',
  injectionScope: (pinned, demand, logs) => `${pinned} resident sections + preamble · ${demand} on-demand sections · ${logs} run-log sections (not auto-injected)`,
  refresh: 'Refresh',
  loading: 'Loading…',
  languageToggle: '中',
  switchToEnglish: 'Switch to English',
  switchToChinese: 'Switch to Chinese',
  sourceAttached: 'Attached',
  sourceDiscovered: 'Found by project',
  sourceNone: 'Unbound',
  sourceOff: 'Injection off for this session',
  sourceOffUnder: under => `Injection off here (would be: ${under})`,
  unboundTitle: 'No note bound to this session',
  unboundHintLead: 'No note is attached to this session. Open the',
  unboundHintTail: 'and pick one.',
  noteMissing: 'The note file does not exist yet. It appears here once a first definition has been written to it.',
  discoveryOrigin: root => `(found under ${root})`,
  changeNote: 'Change note',
  changeNoteTitle: 'Back to the note index',
  detach: 'Remove attachment',
  detachTitle: 'Remove the manual attachment and fall back to project discovery — a note found in the project is bound again at once. To keep this session off it entirely, use "No injection here".',
  injectOff: 'No injection here',
  injectOffTitle: 'Stop injecting this note into the current session; other sessions are unaffected and the board stays readable',
  injectOn: 'Resume injection',
  injectOnTitle: 'Resume injecting this note into the current session',
  injectOffState: 'Injection off',
  dockNote: 'Note',
  dockOn: 'injected',
  dockOff: 'injection off',
  dockMissing: 'file missing',
  offStillReadable: 'Injection is off: this session sends nothing, and the note below is shown for review only.',
  readFailed: detail => `Read failed: ${detail}`,
  noSessionId: 'This view received no sessionId, so it cannot resolve a note.',
  refreshedAt: time => `Refreshed ${time}`,
  absorbOver: (chars, budget) => `Resident body: ${chars} characters, over the soft budget of ${budget}; still provided whole.`,
  absorbOk: (chars, budget) => `Resident body: ${chars} characters; soft budget ${budget}, not a knowledge storage cap.`,
  absorbOverHint: 'Whole entries; index and instructions add overhead',
  absorbOkHint: 'Read on-demand entries in full before use',
  budgetTitle: 'Content boundary by section',
  budgetChanged: 'changed',
  budgetChars: chars => `${chars} chars`,
  budgetNoBaseline: 'Nothing has been injected into this session yet, so there is no baseline: which sections are moving becomes visible only after the first delivery commits.',
  budgetHint: '"changed" means this section differs from the last **injected** content (same hashes as [LEDGER DELTA]). A section that keeps showing up here is usually the one being written as a log.',
  hygieneSmell: 'looks like a run record',
  hygieneSmellHint: 'This body mixes process narrative (device or environment faults, a dead-end algorithm, why a job failed, measurement numbers) into the note. It is a reminder that part of this section is history, **not an instruction to move it**: when those measurements are the evidence for a verdict, keeping them is correct. To keep the resident set cleaner, move the numbers into an on-demand evidence section (STAGE1-EVIDENCE) and leave the verdict in place. A pure run record belongs in a `## RUN-LOG …` section, or in deja / memsearch. This view only marks it; it never edits your note.',
  classResident: 'resident',
  classOnDemand: 'on demand',
  classLog: 'log',
  consumed: 'Fed back',
  awaitingFeedback: 'Awaiting',
  auditUnbound: 'No note is attached to this session, so there are no audit verdicts to show.',
  auditEmpty: 'This note has no audit verdicts yet. A verdict appears here once it lands in the inbox '
    + 'directory beside the note.',
  auditPending: count => `${count} verdict(s) have not been fed back to the parent session yet; they are injected on its next turn.`,
  catalogTitle: 'Note index',
  scanning: 'Scanning…',
  catalogCount: (count, roots) => `${count} note(s) found on this machine · scanned ${roots}`,
  noScanRoots: '(no scan root configured)',
  rescan: 'Rescan',
  attachExplain: 'Attach a knowledge base to supply **resident knowledge and an on-demand index** to this conversation. Run logs are not auto-injected.',
  attachExplainTail: 'With nothing attached, the board discovers a note from this session’s working directory.',
  emptyTitle: 'No note found under the scan roots.',
  emptyHintLead: 'A note can live in a project at ',
  emptyHintOr: ', ',
  emptyHintTail: '. You can also type an absolute path below.',
  currentSession: 'This session',
  pendingAuditsBadge: count => `${count} awaiting`,
  fileGone: 'File is gone',
  attach: 'Attach',
  attachPathLabel: 'Or give an absolute path:',
  attachPathPlaceholder: '/absolute/path/notes/ledger.md',
  attachPathEmpty: 'Enter a note path',
  sections: count => `${count} sections`,
  frozen: 'frozen',
  verdictsCount: 'verdicts',
  openCount: 'open',
  otherCount: 'other',
  compositionLegend: (label, count) => `${label} ${count}`,
  justNow: 'just now',
  minutesAgo: count => `${count} min ago`,
  hoursAgo: count => `${count} h ago`,
  dateLocale: 'en-US',
  markdownCopy: 'Copy',
  markdownCopied: 'Copied',
  markdownFootnotes: 'Footnotes',
  renderFailed: detail => `Note board render failed:\n${detail}`,
  renderFailedDetail: 'Technical detail (stack)',
  plainFallbackNote: title => `Raw Markdown of "${title}" (plain fallback while the renderer is broken):`,
  plainFallbackFailed: detail => `The fallback read failed too, so the note cannot be shown: ${detail}`,
}

/** The slice of the platform's `locale` service this board uses. */
export interface ClientLocaleService {
  getSnapshot(): { readonly active: string }
  subscribe(listener: () => void): () => void
  setLocale(id: string): void
}

let service: ClientLocaleService | undefined
/** Used only when no platform service is mounted; the board still has to render. */
let fallback: BoardLocale = 'zh'
let serviceOff: (() => void) | undefined
const listeners = new Set<() => void>()

/** Re-render every mounted board. */
function notify(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * Attach the platform's locale service, if this deployment has one.
 *
 * Called from the plugin body inside `ctx.effect`, so unloading the plugin
 * detaches it. Absence is not an error: the board falls back to {@link ZH} and
 * its own toggle, rather than refusing to render.
 * @param candidate - `ctx.get('locale')`, or undefined when unmounted.
 * @returns disposer detaching the service.
 */
export function installBoardLocale(candidate: unknown): () => void {
  if (candidate === undefined || candidate === null) return () => {}
  const installed = candidate as ClientLocaleService
  service = installed
  notify()
  return () => {
    if (service !== installed) return
    service = undefined
    notify()
  }
}

/**
 * The locale the board should render in.
 *
 * A locale the board has no dictionary for resolves to English, matching the
 * platform's own fallback chain (which terminates at English). With no service
 * at all it stays at the board's own default.
 * @returns the locale to render.
 */
export function boardLocale(): BoardLocale {
  if (service === undefined) return fallback
  const active = service.getSnapshot().active
  return active === 'zh' ? 'zh' : 'en'
}

/**
 * Subscribe one listener, multiplexing a single platform subscription.
 *
 * Stable identity is required: it is passed to `useSyncExternalStore`, which
 * re-subscribes whenever the function changes. One shared platform subscription
 * serves every mounted board, and it is dropped with the last listener.
 * @param listener - change callback.
 * @returns unsubscribe.
 */
export function subscribeBoardLocale(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1 && service !== undefined) serviceOff = service.subscribe(notify)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      serviceOff?.()
      serviceOff = undefined
    }
  }
}

/**
 * Switch the language.
 *
 * Goes through the platform's preference so the change is durable and every
 * surface — including this board's tab label, which this plugin does not render
 * — agrees. See the module doc.
 */
export function toggleBoardLocale(): void {
  const next: BoardLocale = boardLocale() === 'zh' ? 'en' : 'zh'
  if (service !== undefined) {
    service.setLocale(next)
    return
  }
  fallback = next
  notify()
}

/**
 * The current dictionaries.
 *
 * A plain function, not a hook, for the slot's `label` thunk: the conversation
 * owner calls it during its own render, outside any React tree of ours.
 * @returns the active locale's strings.
 */
export function boardStrings(): BoardStrings {
  return boardLocale() === 'en' ? EN : ZH
}

/**
 * The board's strings, re-rendered when the locale changes.
 *
 * Must go through {@link useBoardLocale}: reading the locale without
 * subscribing renders the *previous* language until something else happens to
 * re-render the pane.
 * @returns the active locale's strings.
 */
export function useBoardStrings(): BoardStrings {
  const locale = useBoardLocale()
  return locale === 'en' ? EN : ZH
}

/**
 * The active locale, re-rendered when it changes.
 *
 * Separate from {@link useBoardStrings} for the caller that needs to *branch* on
 * the language rather than just render it — picking the right tooltip for the
 * toggle, for instance.
 * @returns the locale in effect.
 */
export function useBoardLocale(): BoardLocale {
  return useSyncExternalStore(subscribeBoardLocale, boardLocale, boardLocale)
}

/**
 * Markdown chrome for the active locale.
 * @param strings - the active locale's strings.
 * @returns labels for `MarkdownText`.
 */
export function markdownLabels(strings: BoardStrings): MarkdownLabels {
  return {
    code: { copyLabel: strings.markdownCopy, copiedLabel: strings.markdownCopied },
    footnotes: strings.markdownFootnotes,
  }
}
