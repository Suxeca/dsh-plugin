/**
 * Lab-kit surface copy: minimal zh/en dictionaries with a locale-aware t().
 *
 * This template keeps the copy layer dependency-free (no locale service) so
 * the first plugin boots with zero service injects. To graduate to the full
 * locale system (per-user language switching, settings-driven), register a
 * namespace through `ctx.locale.register` from @deepseek-ai/dsh-client-locale
 * and merge `LocaleNamespaceMap` — see dsh-task-board's locales.ts for the
 * complete pattern.
 * @module dsh-lab-kit/client/locales
 */

const zh = {
  entry: '研究台',
  title: '科研台 · Lab Cockpit',
  subtitle: '工作区研究项目',
  refresh: '刷新',
  loading: '扫描中…',
  empty: '未发现研究项目（目录需包含 .git 或 .summary.md）',
  error: '加载失败，请刷新重试',
  git: 'git 仓库',
  summary: '含 .summary.md',
  updated: '最近修改',
  close: '收起',
} as const

const en: Record<keyof typeof zh, string> = {
  entry: 'Lab Cockpit',
  title: 'Lab Cockpit',
  subtitle: 'Research projects in workspace',
  refresh: 'Refresh',
  loading: 'Scanning…',
  empty: 'No research projects found (a dir needs .git or .summary.md)',
  error: 'Failed to load — refresh to retry',
  git: 'git repo',
  summary: 'has .summary.md',
  updated: 'updated',
  close: 'Close',
}

type CopyKey = keyof typeof zh

const dict: Record<CopyKey, string> = navigator.language?.toLowerCase().startsWith('zh')
  ? zh
  : en

/** Translate one copy key using the browser language. */
export function t(key: CopyKey): string {
  return dict[key]
}
