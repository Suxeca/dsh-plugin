/**
 * Localization for the session-switcher palette.
 *
 * ## Why the palette follows the platform locale
 *
 * The switcher ships Chinese (`zh`) and English (`en`) dictionaries and reads
 * the platform's `locale` service when it is mounted, so the palette, its
 * settings and the official-shortcut labels agree with the rest of DSH — a
 * switch in Settings → General switches the palette too, instead of leaving
 * it in one language while the rest of the app is in another.
 *
 * ## Why the dictionaries live here rather than in the platform catalog
 *
 * The service also offers `register(ns, …)` + `bind(ns)`, which first-party
 * plugins use. That path is typed against `LocaleNamespaceMap`, which a plugin
 * outside the DSH repository cannot augment. The interface below buys the
 * property that actually matters instead: **both dictionaries implement the
 * same type**, so a missing English string is a compile error rather than a
 * Chinese string surfacing in an English UI.
 *
 * @module @suxeca/dsh-client-ui-session-switcher/client/i18n
 */
import { useSyncExternalStore } from 'react'
import type { ActionId } from './keymap.ts'
import type { SkinName } from './skins.ts'

/** Locales this switcher ships. */
export const SWITCHER_LOCALES = ['zh', 'en'] as const
export type SwitcherLocale = (typeof SWITCHER_LOCALES)[number]

export interface SwitcherStrings {
  readonly actionLabels: Record<ActionId, string>
  readonly skinLabels: Record<SkinName, string>

  readonly toastReady: string
  readonly readyMessage: string

  readonly untitled: string
  readonly justNow: string
  readonly minutesBefore: (count: number) => string
  readonly hoursBefore: (count: number) => string
  readonly daysBefore: (count: number) => string

  readonly noNewSession: string
  readonly newSessionFailed: (detail: string) => string
  readonly archiveFailed: (detail: string) => string
  readonly unarchiveFailed: (detail: string) => string
  readonly renameFailed: (detail: string) => string
  readonly renameRejected: string
  readonly renameOffline: string

  readonly noMatches: string
  readonly noArchived: string
  readonly noWorkspaces: string
  readonly noConversations: string
  readonly loading: string

  readonly renamePlaceholder: string
  readonly save: string
  readonly cancel: string
  readonly searchPlaceholder: string
  readonly searchStrip: string

  readonly title: string
  readonly modeArchived: string
  readonly modeSearch: string
  readonly modeRename: string
  readonly modeShortcuts: string

  readonly hideOldRecent: string
  readonly hideOldAll: string
  readonly hideOldTitleRecent: string
  readonly hideOldTitleAll: string
  readonly settingsTitle: string
  readonly newConversation: string
  readonly skinTitle: string

  readonly ungrouped: string
  readonly turns: (count: number) => string
  readonly current: string
  readonly pinned: string
  readonly archived: string
  readonly rowRename: string
  readonly rowUnarchive: string
  readonly rowArchive: string
  readonly renameTitle: string

  readonly collapseOlderTitle: string
  readonly expandOlderTitle: string
  readonly collapseShownOlder: (count: number) => string
  readonly hiddenOlder: (count: number) => string

  readonly officialShortcutsBtn: string
  readonly settingsHint: string
  readonly captureHint: string
  readonly changeKey: string

  // Footer words
  readonly select: string
  readonly newShort: string
  readonly renameShort: string
  readonly archiveShort: string
  readonly pinnedShort: string
  readonly showAll: string
  readonly recentOnly: string
  readonly clear: string
  readonly manageMode: string
  readonly preview: string
  readonly search: string
  readonly backToList: string
  readonly archivedView: string
  readonly shortcuts: string
  readonly close: string
  readonly open: string
  readonly toggle: string
  readonly space: string

  readonly officialToggleLabel: string
  readonly officialNextLabel: string
  readonly officialPrevLabel: string
  readonly officialPinnedLabel: string
  readonly aliasesToggle: readonly string[]
  readonly aliasesNext: readonly string[]
  readonly aliasesPrev: readonly string[]
  readonly aliasesPinned: readonly string[]
}

export const ZH: SwitcherStrings = {
  actionLabels: {
    toggle: '打开面板',
    next: '下一个对话',
    prev: '上一个对话',
    jumpToPinned: '切换至置顶对话',
    toggleLeftSidebar: '折叠/展开左侧栏',
    toggleRightSidebar: '折叠/展开右侧栏',
    toggleSessionMap: '切换 对话/会话地图',
  },
  skinLabels: { dark: '深色', light: '浅色', highcontrast: '高对比' },

  toastReady: '会话切换器已就绪 — Ctrl+Shift+K（Ctrl+K / Alt+K）打开面板',
  readyMessage: '[session-switcher] 已就绪 — 快捷键可在面板内自定义（⚙ 快捷键）',

  untitled: '未命名对话',
  justNow: '刚刚',
  minutesBefore: (count) => `${count} 分钟前`,
  hoursBefore: (count) => `${count} 小时前`,
  daysBefore: (count) => `${count} 天前`,

  noNewSession: '未提供新建会话功能',
  newSessionFailed: (detail) => `新建会话失败：${detail}`,
  archiveFailed: (detail) => `归档失败：${detail}`,
  unarchiveFailed: (detail) => `取消归档失败：${detail}`,
  renameFailed: (detail) => `重命名失败：${detail}`,
  renameRejected: '重命名被拒绝',
  renameOffline: '会话不在线，无法重命名',

  noMatches: '没有匹配的对话',
  noArchived: '没有已归档的对话',
  noWorkspaces: '还没有工作区 — 按 N 新建，或在侧边栏添加工作区',
  noConversations: '还没有对话 — 按 N 新建',
  loading: '加载中…',

  renamePlaceholder: '输入新标题…',
  save: '保存',
  cancel: '取消',
  searchPlaceholder: '输入标题过滤对话…（支持快捷键：Ctrl+N新建 / Ctrl+R重命名 / Alt+H切换近期）',
  searchStrip: '按 S 搜索会话…',

  title: '切换对话',
  modeArchived: '已归档',
  modeSearch: '搜索',
  modeRename: '重命名',
  modeShortcuts: '快捷键',

  hideOldRecent: '🕒 近期对话',
  hideOldAll: '🕒 全部对话',
  hideOldTitleRecent: '当前已隐藏 7 天前较早对话（点击查看全部）',
  hideOldTitleAll: '当前显示全部对话（点击隐藏 7 天前较早对话）',
  settingsTitle: '自定义快捷键',
  newConversation: '+ 新建对话',
  skinTitle: '切换皮肤（深色/浅色/高对比）',

  ungrouped: '未分组',
  turns: (count) => `${count} 轮`,
  current: '当前',
  pinned: '📌 置顶',
  archived: '已归档',
  rowRename: '重命名',
  rowUnarchive: '取消归档',
  rowArchive: '归档',
  renameTitle: '重命名对话',

  collapseOlderTitle: '点击收起较早对话',
  expandOlderTitle: '点击展开较早对话',
  collapseShownOlder: (count) => `收起已显示的 ${count} 个较早对话`,
  hiddenOlder: (count) => `已自动隐藏 ${count} 个较早对话 (点击展开)`,

  officialShortcutsBtn: '⚡ 打开系统快捷键设置中心 (Ctrl+/)',
  settingsHint: '会话面板快捷键已接入 DSH 官方命令系统，可点击上方按钮前往系统中心统一修改并检测冲突；亦可在下方快速覆盖面板本地按键，Esc 取消。',
  captureHint: '按下新组合键…（Esc 取消）',
  changeKey: '改键',

  select: '选择',
  newShort: '新建',
  renameShort: '重命名',
  archiveShort: '归档',
  pinnedShort: '置顶',
  showAll: '显示全部',
  recentOnly: '只看近期',
  clear: '清空',
  manageMode: '管理模式',
  preview: '预览',
  search: '搜索',
  backToList: '返回列表',
  archivedView: '归档视图',
  shortcuts: '快捷键',
  close: '关闭',
  open: '打开',
  toggle: '开关',
  space: '空格',

  officialToggleLabel: '会话切换：打开/关闭面板',
  officialNextLabel: '会话切换：下一个会话',
  officialPrevLabel: '会话切换：上一个会话',
  officialPinnedLabel: '会话切换：切换至置顶对话',
  aliasesToggle: ['session switcher', 'quick switch', 'ctrl k panel', '切换对话'],
  aliasesNext: ['next session', '下一个对话'],
  aliasesPrev: ['previous session', '上一个对话'],
  aliasesPinned: ['jump to pinned', 'pinned session', '置顶对话'],
}

export const EN: SwitcherStrings = {
  actionLabels: {
    toggle: 'Open panel',
    next: 'Next conversation',
    prev: 'Previous conversation',
    jumpToPinned: 'Jump to pinned',
    toggleLeftSidebar: 'Toggle left sidebar',
    toggleRightSidebar: 'Toggle right sidebar',
    toggleSessionMap: 'Toggle session map',
  },
  skinLabels: { dark: 'Dark', light: 'Light', highcontrast: 'High contrast' },

  toastReady: 'Session switcher ready — Ctrl+Shift+K (Ctrl+K / Alt+K) to open',
  readyMessage: '[session-switcher] ready — shortcuts are customizable from the palette (⚙ Shortcuts)',

  untitled: 'Untitled conversation',
  justNow: 'just now',
  minutesBefore: (count) => `${count} min ago`,
  hoursBefore: (count) => `${count} h ago`,
  daysBefore: (count) => `${count} d ago`,

  noNewSession: 'New-session action not available',
  newSessionFailed: (detail) => `Failed to create session: ${detail}`,
  archiveFailed: (detail) => `Archive failed: ${detail}`,
  unarchiveFailed: (detail) => `Unarchive failed: ${detail}`,
  renameFailed: (detail) => `Rename failed: ${detail}`,
  renameRejected: 'Rename rejected',
  renameOffline: 'Session is offline, cannot rename',

  noMatches: 'No matching conversations',
  noArchived: 'No archived conversations',
  noWorkspaces: 'No workspaces yet — press N to create one, or add a workspace in the sidebar',
  noConversations: 'No conversations yet — press N to create one',
  loading: 'Loading…',

  renamePlaceholder: 'New title…',
  save: 'Save',
  cancel: 'Cancel',
  searchPlaceholder: 'Filter conversations by title… (shortcuts: Ctrl+N new / Ctrl+R rename / Alt+H recent)',
  searchStrip: 'Press S to search sessions…',

  title: 'Switch conversation',
  modeArchived: 'Archived',
  modeSearch: 'Search',
  modeRename: 'Rename',
  modeShortcuts: 'Shortcuts',

  hideOldRecent: '🕒 Recent',
  hideOldAll: '🕒 All',
  hideOldTitleRecent: 'Hiding conversations older than 7 days (click to show all)',
  hideOldTitleAll: 'Showing all conversations (click to hide older ones)',
  settingsTitle: 'Customize shortcuts',
  newConversation: '+ New conversation',
  skinTitle: 'Switch skin (dark / light / high contrast)',

  ungrouped: 'Ungrouped',
  turns: (count) => `${count} turns`,
  current: 'Current',
  pinned: '📌 Pinned',
  archived: 'Archived',
  rowRename: 'Rename',
  rowUnarchive: 'Unarchive',
  rowArchive: 'Archive',
  renameTitle: 'Rename conversation',

  collapseOlderTitle: 'Click to collapse older conversations',
  expandOlderTitle: 'Click to expand older conversations',
  collapseShownOlder: (count) => `Collapse ${count} older conversations already shown`,
  hiddenOlder: (count) => `${count} older conversations hidden automatically (click to expand)`,

  officialShortcutsBtn: '⚡ Open system shortcut settings (Ctrl+/)',
  settingsHint: 'The panel shortcuts are wired into DSH’s official command system. Use the button above to manage them centrally and detect conflicts; override keys below, Esc to cancel.',
  captureHint: 'Press a new chord… (Esc to cancel)',
  changeKey: 'Rebind',

  select: 'select',
  newShort: 'new',
  renameShort: 'rename',
  archiveShort: 'archive',
  pinnedShort: 'pinned',
  showAll: 'show all',
  recentOnly: 'recent only',
  clear: 'clear',
  manageMode: 'manage mode',
  preview: 'preview',
  search: 'search',
  backToList: 'back to list',
  archivedView: 'archived view',
  shortcuts: 'shortcuts',
  close: 'close',
  open: 'open',
  toggle: 'toggle',
  space: 'space',

  officialToggleLabel: 'Session switcher: open/close panel',
  officialNextLabel: 'Session switcher: next session',
  officialPrevLabel: 'Session switcher: previous session',
  officialPinnedLabel: 'Session switcher: jump to pinned',
  aliasesToggle: ['session switcher', 'quick switch', 'ctrl k panel'],
  aliasesNext: ['next session'],
  aliasesPrev: ['previous session'],
  aliasesPinned: ['jump to pinned', 'pinned session'],
}

/** Client locale service slice. */
export interface ClientLocaleService {
  getSnapshot(): { readonly active: string }
  subscribe(listener: () => void): () => void
  setLocale(id: string): void
}

let service: ClientLocaleService | undefined
let fallback: SwitcherLocale = 'zh'
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

export function installSwitcherLocale(candidate: unknown): () => void {
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

export function switcherLocale(): SwitcherLocale {
  if (service === undefined) return fallback
  const active = service.getSnapshot().active
  return active === 'zh' ? 'zh' : 'en'
}

let serviceOff: (() => void) | undefined

export function subscribeSwitcherLocale(listener: () => void): () => void {
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

export function toggleSwitcherLocale(): void {
  const next: SwitcherLocale = switcherLocale() === 'zh' ? 'en' : 'zh'
  if (service !== undefined) {
    service.setLocale(next)
    return
  }
  fallback = next
  notify()
}

export function switcherStrings(): SwitcherStrings {
  return switcherLocale() === 'en' ? EN : ZH
}

export function useSwitcherStrings(): SwitcherStrings {
  useSyncExternalStore(subscribeSwitcherLocale, switcherLocale, switcherLocale)
  return switcherStrings()
}

export function useSwitcherLocale(): SwitcherLocale {
  return useSyncExternalStore(subscribeSwitcherLocale, switcherLocale, switcherLocale)
}
