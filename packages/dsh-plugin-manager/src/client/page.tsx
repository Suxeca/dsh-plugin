/**
 * The 插件管理 settings page: installed bundle list with per-row uninstall,
 * an install input (name + optional version), and a status line showing the
 * profile path the host actually reads.
 *
 * Data flows over the /plugin-manager/* JSON routes (GET list, POST
 * install/uninstall); results follow the { ok, value | error } envelope.
 * @module @suxeca/dsh-plugin-manager/client/page
 */

import { useCallback, useEffect, useReducer, useState } from 'react'

/** One installed bundle row as served by /plugin-manager/list. */
export interface BundleRow {
  name: string
  version?: string
}

/** The list payload. */
export interface ListValue {
  path: string
  bundles: BundleRow[]
}

/** Envelope shared by all plugin-manager routes. */
type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 0',
  borderBottom: '1px solid #2d3748',
  fontSize: '13px',
}
const btnStyle: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: '6px',
  border: '1px solid #d29922',
  background: 'transparent',
  color: '#d29922',
  cursor: 'pointer',
  fontSize: '12px',
}
const dangerStyle: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: '6px',
  border: '1px solid #f85149',
  background: 'transparent',
  color: '#f85149',
  cursor: 'pointer',
  fontSize: '12px',
}
const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '6px',
  border: '1px solid #2d3748',
  background: '#0d1117',
  color: '#e6edf3',
  fontSize: '12px',
  width: '100%',
}
const mono: React.CSSProperties = { fontFamily: 'Consolas, monospace', fontSize: '12px' }

/** Fetch one plugin-manager route with a JSON body. */
async function call<T>(path: string, body?: Record<string, unknown>): Promise<Envelope<T>> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return (await response.json()) as Envelope<T>
}

interface PageState {
  loading: boolean
  data: ListValue | null
  error: string | null
}

type PageAction =
  | { type: 'load-start' }
  | { type: 'load-ok'; data: ListValue }
  | { type: 'load-error'; message: string }

function reducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case 'load-start':
      return { loading: true, data: state.data, error: null }
    case 'load-ok':
      return { loading: false, data: action.data, error: null }
    case 'load-error':
      return { loading: false, data: state.data, error: action.message }
  }
}

/** The settings page body. */
export function PluginManagerPage(): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, { loading: true, data: null, error: null })
  const [pkg, setPkg] = useState('')
  const [ver, setVer] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [rev, setRev] = useState(0)

  useEffect(() => {
    let alive = true
    dispatch({ type: 'load-start' })
    void call<ListValue>('/plugin-manager/list')
      .then((envelope) => {
        if (!alive) return
        if (envelope.ok) dispatch({ type: 'load-ok', data: envelope.value })
        else dispatch({ type: 'load-error', message: envelope.error.message })
      })
      .catch((error: unknown) => {
        if (alive) dispatch({ type: 'load-error', message: String(error) })
      })
    return () => {
      alive = false
    }
  }, [rev])

  const act = useCallback((method: '/plugin-manager/install' | '/plugin-manager/uninstall', args: Record<string, unknown>) => {
    void call<{ message: string }>(method, args)
      .then((envelope) => {
        if (envelope.ok) {
          setMsg({ kind: 'ok', text: envelope.value.message })
          setRev((n) => n + 1)
        } else {
          setMsg({ kind: 'err', text: envelope.error.message })
        }
      })
      .catch((error: unknown) => setMsg({ kind: 'err', text: String(error) }))
  }, [])

  const rows = (state.data?.bundles ?? []).map((bundle) => (
    <div key={bundle.name} style={rowStyle}>
      <span style={{ flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...mono }}>
        {bundle.name}
      </span>
      <span style={{ color: '#8b98a9', fontSize: '11px' }}>{bundle.version ?? ''}</span>
      <button style={dangerStyle} onClick={() => act('/plugin-manager/uninstall', { name: bundle.name })}>
        卸载
      </button>
    </div>
  ))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600 }}>已安装 bundle</span>
        <button style={btnStyle} onClick={() => setRev((n) => n + 1)}>
          刷新
        </button>
      </div>
      {state.loading ? <div style={{ color: '#8b98a9', fontSize: '12px' }}>加载中…</div> : null}
      {state.error ? <div style={{ color: '#f85149', fontSize: '12px' }}>错误: {state.error}</div> : null}
      {rows.length > 0 ? (
        <div>{rows}</div>
      ) : !state.loading && !state.error ? (
        <div style={{ color: '#8b98a9', fontSize: '12px' }}>(无 bundle)</div>
      ) : null}
      {state.data ? (
        <div style={{ color: '#8b98a9', fontSize: '11px', ...mono }}>profile: {state.data.path}</div>
      ) : null}
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          style={{ ...inputStyle, flex: '2' }}
          placeholder="包名，如 @suxeca/dsh-xxx"
          value={pkg}
          onChange={(event) => setPkg(event.target.value)}
        />
        <input
          style={{ ...inputStyle, flex: '1' }}
          placeholder="版本(可选)"
          value={ver}
          onChange={(event) => setVer(event.target.value)}
        />
        <button
          style={btnStyle}
          onClick={() => {
            if (pkg.trim()) {
              act('/plugin-manager/install', { name: pkg.trim(), version: ver.trim() || undefined })
              setPkg('')
              setVer('')
            }
          }}
        >
          安装
        </button>
      </div>
      {msg ? (
        <div
          style={{ fontSize: '12px', color: msg.kind === 'ok' ? '#3fb950' : '#f85149', whiteSpace: 'pre-wrap' }}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  )
}
