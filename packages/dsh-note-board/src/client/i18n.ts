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
  readonly readFailed: (detail: string) => string
  readonly noSessionId: string
  readonly refreshedAt: (time: string) => string
  /** Injection-budget line. */
  readonly absorbOver: (chars: number, budget: number) => string
  readonly absorbOk: (chars: number, budget: number) => string
  readonly absorbOverHint: string
  readonly absorbOkHint: string
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
}

/** The language the board was written in. */
export const ZH: BoardStrings = {
  view: '笔记看板',
  segmentCatalog: '笔记目录',
  segmentLedger: '笔记正文',
  segmentAudit: '审计判决',
  refresh: '刷新',
  loading: '读取中…',
  languageToggle: 'EN',
  switchToEnglish: '切换为英文',
  switchToChinese: '切换为中文',
  sourceAttached: '已附加',
  sourceDiscovered: '按项目自动发现',
  sourceNone: '未绑定',
  unboundTitle: '本会话未绑定笔记',
  unboundHintLead: '本会话还没有附加笔记。去',
  unboundHintTail: '挑一个。',
  noteMissing: '笔记文件还不存在。等第一条定义被写入后，这里就会出现。',
  discoveryOrigin: root => `（发现自 ${root}）`,
  changeNote: '更换笔记',
  changeNoteTitle: '回到笔记目录',
  detach: '解附',
  detachTitle: '解除显式附加，回到按项目自动发现',
  readFailed: detail => `读取失败：${detail}`,
  noSessionId: '这个视图没有拿到 sessionId，无法解析笔记。',
  refreshedAt: time => `刷新 ${time}`,
  absorbOver: (chars, budget) => `笔记 ${chars} 字符，超过每轮注入上限 ${budget}；超出的尾部不会进入对话。`,
  absorbOk: (chars, budget) => `全部 ${chars} 字符每轮自动注入对话（上限 ${budget}）。`,
  absorbOverHint: '需要精简或拆分笔记',
  absorbOkHint: '已与对话同步',
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
  attachExplain: '附加一个笔记，它的正文就会**每轮自动注入**当前对话（同时看板显示它）。',
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
}

/** {@link ZH} in English. */
export const EN: BoardStrings = {
  view: 'Note board',
  segmentCatalog: 'Note index',
  segmentLedger: 'Note',
  segmentAudit: 'Audit verdicts',
  refresh: 'Refresh',
  loading: 'Loading…',
  languageToggle: '中',
  switchToEnglish: 'Switch to English',
  switchToChinese: 'Switch to Chinese',
  sourceAttached: 'Attached',
  sourceDiscovered: 'Found by project',
  sourceNone: 'Unbound',
  unboundTitle: 'No note bound to this session',
  unboundHintLead: 'No note is attached to this session. Open the',
  unboundHintTail: 'and pick one.',
  noteMissing: 'The note file does not exist yet. It appears here once a first definition has been written to it.',
  discoveryOrigin: root => `(found under ${root})`,
  changeNote: 'Change note',
  changeNoteTitle: 'Back to the note index',
  detach: 'Detach',
  detachTitle: 'Remove the explicit attachment and fall back to project discovery',
  readFailed: detail => `Read failed: ${detail}`,
  noSessionId: 'This view received no sessionId, so it cannot resolve a note.',
  refreshedAt: time => `Refreshed ${time}`,
  absorbOver: (chars, budget) => `This note is ${chars} characters — past the ${budget}-character per-turn injection limit, so its tail never reaches the conversation.`,
  absorbOk: (chars, budget) => `All ${chars} characters are injected into the conversation every turn (limit ${budget}).`,
  absorbOverHint: 'Trim or split this note',
  absorbOkHint: 'In sync with the conversation',
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
  attachExplain: 'Attaching a note injects its **body into every turn** of this conversation (and this board shows it).',
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
