/**
 * The `external-dirs` tab body: a lazy directory tree over absolute paths that
 * live outside the session workspace.
 *
 * Files are opened through `tab.actions.openResource` with a
 * `dsh-resource://file/<absolute path>` address, so the official preview tabs
 * render them — this component draws only the tree. That works because the
 * workspace-path helper preserves absolute paths that fall outside the
 * workspace root, and the official workspace-files reader accepts them; only
 * *listing* is workspace-scoped, which is why the tree talks to this plugin's
 * own host route instead (see `src/host/routes.ts`).
 *
 * @module @suxeca/dsh-external-dirs/client/Body
 */
import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { Envelope, ExternalDirEntry, ExternalDirListing, ExternalRootsState } from '../shared.ts'
import { ROUTE_PREFIX } from '../shared-routes.ts'

/** Props handed to a right-Sidebar tab body. */
export interface ExternalDirsBodyProps {
  /** Framework-bound tab reader; supplies the navigation actions used to open files. */
  readonly useTabInfo: UseSidebarRightTabInfo
}

/** Loaded state of one directory level, keyed by absolute path. */
type Levels = Record<string, ExternalDirListing | 'loading' | { error: string }>

/** Narrow an unknown JSON payload to the shared envelope. */
function asEnvelope<T>(value: unknown): Envelope<T> {
  return value as Envelope<T>
}

/** GET one host route and unwrap the envelope. */
async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${ROUTE_PREFIX}${path}`, { signal })
  const body = asEnvelope<T>(await response.json())
  if (!body.ok) throw new Error(body.error ?? `request failed (${response.status})`)
  return body.data as T
}

/** POST one host route and unwrap the envelope. */
async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${ROUTE_PREFIX}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = asEnvelope<T>(await response.json())
  if (!body.ok) throw new Error(body.error ?? `request failed (${response.status})`)
  return body.data as T
}

/** Build the resource address the official file viewers claim. */
function fileAddress(absolutePath: string): string {
  return `dsh-resource://file/${absolutePath.replace(/\\/g, '/')}`
}

/** Last path segment, for row labels. */
function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] === '' ? path : parts[parts.length - 1]
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  borderRadius: 4,
  fontSize: 12,
}

const buttonStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid var(--dsw-alias-border, #3a3f47)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  font: 'inherit',
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid var(--dsw-alias-border, #3a3f47)',
  background: 'transparent',
  color: 'inherit',
}

/**
 * Render the external-directory browser.
 * @param props - the tab body props.
 * @returns the tree view.
 */
export function ExternalDirsBody({ useTabInfo }: ExternalDirsBodyProps) {
  const { tab } = useTabInfo()
  const signal = tab.signal
  const openResource = tab.actions.openResource

  const [roots, setRoots] = useState<readonly string[]>([])
  const [home, setHome] = useState<string>('')
  const [levels, setLevels] = useState<Levels>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Refresh the configured roots. */
  const loadRoots = useCallback(async () => {
    try {
      const state = await getJson<ExternalRootsState>('/roots', signal)
      setRoots(state.roots)
      setHome(state.home)
      setError(null)
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [signal])

  useEffect(() => { void loadRoots() }, [loadRoots])

  /** Load one directory level, caching the result. */
  const loadLevel = useCallback(async (path: string) => {
    setLevels(previous => ({ ...previous, [path]: 'loading' }))
    try {
      const listing = await getJson<ExternalDirListing>(`/list?path=${encodeURIComponent(path)}`, signal)
      setLevels(previous => ({ ...previous, [path]: listing }))
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return
      const message = cause instanceof Error ? cause.message : String(cause)
      setLevels(previous => ({ ...previous, [path]: { error: message } }))
    }
  }, [signal])

  /** Expand or collapse one directory. */
  const toggle = useCallback((path: string) => {
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else {
        next.add(path)
        // Load on first expand only; a collapsed level keeps its snapshot.
        void loadLevel(path)
      }
      return next
    })
  }, [loadLevel])

  /** Add one root from the input box. */
  const addRoot = useCallback(async (path: string) => {
    const target = path.trim()
    if (target === '') return
    setBusy(true)
    try {
      const state = await postJson<ExternalRootsState>('/roots', { op: 'add', path: target })
      setRoots(state.roots)
      setDraft('')
      setError(null)
      void loadLevel(target)
      setExpanded(previous => new Set(previous).add(target))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [loadLevel])

  /** Remove one root. */
  const removeRoot = useCallback(async (path: string) => {
    setBusy(true)
    try {
      const state = await postJson<ExternalRootsState>('/roots', { op: 'remove', path })
      setRoots(state.roots)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  /** Render one directory level, recursively. */
  const renderLevel = useCallback((path: string, depth: number): React.ReactNode[] => {
    const level = levels[path]
    if (level === undefined || level === 'loading') {
      return [h('div', { key: `${path}::loading`, style: { ...rowStyle, paddingLeft: 6 + depth * 12, opacity: 0.6 } }, '载入中…')]
    }
    if ('error' in level) {
      return [h('div', { key: `${path}::error`, style: { ...rowStyle, paddingLeft: 6 + depth * 12, color: '#f87171' } }, level.error)]
    }
    if (level.entries.length === 0) {
      return [h('div', { key: `${path}::empty`, style: { ...rowStyle, paddingLeft: 6 + depth * 12, opacity: 0.5 } }, '（空目录）')]
    }
    const rows: React.ReactNode[] = []
    for (const entry of level.entries as readonly ExternalDirEntry[]) {
      const isOpen = expanded.has(entry.path)
      rows.push(h('div', {
        key: entry.path,
        style: { ...rowStyle, paddingLeft: 6 + depth * 12 },
        title: entry.path,
        onClick: () => {
          if (entry.directory) toggle(entry.path)
          else void openResource(fileAddress(entry.path))
        },
      },
      h('span', { style: { width: 10, opacity: 0.7, flex: '0 0 auto' } }, entry.directory ? (isOpen ? '▾' : '▸') : ''),
      h('span', { style: { flex: '0 0 auto', opacity: 0.8 } }, entry.directory ? '📁' : '📄'),
      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, entry.name)))
      if (entry.directory && isOpen) rows.push(...renderLevel(entry.path, depth + 1))
    }
    if (level.truncated) {
      rows.push(h('div', { key: `${path}::truncated`, style: { ...rowStyle, paddingLeft: 6 + depth * 12, opacity: 0.5 } }, '（条目过多，已截断）'))
    }
    return rows
  }, [levels, expanded, toggle, openResource])

  const tree = useMemo(() => {
    const nodes: React.ReactNode[] = []
    for (const root of roots) {
      const isOpen = expanded.has(root)
      nodes.push(h('div', {
        key: root,
        style: { ...rowStyle, paddingLeft: 6 },
        title: root,
        onClick: () => toggle(root),
      },
      h('span', { style: { width: 10, opacity: 0.7, flex: '0 0 auto' } }, isOpen ? '▾' : '▸'),
      h('span', { style: { flex: '0 0 auto' } }, '📁'),
      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, baseName(root)),
      h('button', {
        type: 'button',
        style: { ...buttonStyle, marginLeft: 'auto', padding: '0 6px' },
        title: '移除此目录',
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          void removeRoot(root)
        },
      }, '×')))
      if (isOpen) nodes.push(...renderLevel(root, 1))
    }
    return nodes
  }, [roots, expanded, toggle, renderLevel, removeRoot])

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h('div', { style: { display: 'flex', gap: 4, padding: '6px 8px', alignItems: 'center', borderBottom: '1px solid var(--dsw-alias-border, #2b2f37)' } },
      h('input', {
        style: inputStyle,
        placeholder: '输入外部目录绝对路径，Enter 添加',
        value: draft,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') void addRoot(draft)
        },
      }),
      h('button', {
        type: 'button',
        style: buttonStyle,
        disabled: busy,
        title: home === '' ? '添加' : `添加（主目录：${home}）`,
        onClick: () => void addRoot(draft),
      }, '添加'),
      home === ''
        ? null
        : h('button', {
          type: 'button',
          style: buttonStyle,
          disabled: busy,
          title: `把主目录加入列表：${home}`,
          onClick: () => void addRoot(home),
        }, '主目录'),
    ),
    error === null
      ? null
      : h('div', { style: { padding: '6px 8px', color: '#f87171', fontSize: 11 } }, error),
    h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 0' } },
      roots.length === 0
        ? h('div', { style: { padding: '12px 10px', opacity: 0.6, fontSize: 12, lineHeight: 1.6 } },
          '还没有外部目录。',
          h('br'),
          '在上方输入一个绝对路径（例如 ',
          h('code', null, '/mnt/data'),
          '）后按 Enter 添加。')
        : tree),
  )
}
