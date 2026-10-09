import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { artifactManager } from './artifact-store.ts'

export function ArtifactSidebarTitle({ useTabInfo }: any): ReactNode {
  const [, setTick] = useState(0)
  useEffect(() => {
    return artifactManager.subscribe(() => setTick(t => t + 1))
  }, [])

  const info = typeof useTabInfo === 'function' ? useTabInfo() : null
  const title = info?.tab?.title ?? artifactManager.active?.title ?? 'Artifact'

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span>📦</span>
      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </span>
    </span>
  )
}

export function ArtifactSidebarTab(): ReactNode {
  const [, setTick] = useState(0)
  useEffect(() => {
    return artifactManager.subscribe(() => setTick(t => t + 1))
  }, [])

  const active = artifactManager.active
  const refreshKey = artifactManager.refreshKey

  if (!active) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--dsw-alias-label-caption, #94a3b8)', fontSize: 13 }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>📦</div>
        <div style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e2e8f0)', marginBottom: 4 }}>当前暂无活动的 Artifact</div>
        <div style={{ fontSize: 12 }}>在对话中运行包含可视化/交互界面的工具时，将自动在此展示。</div>
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dsw-alias-bg-layer-1, #0f172a)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* 顶部工具栏 */}
      <div
        style={{
          height: 38,
          minHeight: 38,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12))',
          background: 'var(--dsw-alias-bg-base, rgba(15, 23, 42, 0.75))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          <span style={{ fontSize: 13 }}>📦</span>
          <span
            style={{
              color: 'var(--dsw-alias-label-primary, #f8fafc)',
              fontWeight: 600,
              fontSize: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {active.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => artifactManager.reload()} style={btnStyle} title="刷新页面状态">
            ⟳ 刷新
          </button>
          <button onClick={() => artifactManager.toggleFullScreen()} style={btnStyle} title="全屏查看">
            ⛶ 全屏
          </button>
          <button onClick={() => artifactManager.openExternal()} style={btnStyle} title="在新标签页独立打开">
            ↗ 新窗口
          </button>
        </div>
      </div>

      {/* 沙箱 iframe 区域 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--dsw-alias-bg-base, #0a0f1d)' }}>
        <iframe
          key={`${active.callId}_${refreshKey}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={active.title}
          srcDoc={active.doc}
          style={{
            width: '100%',
            height: '100%',
            border: 0,
            background: 'transparent',
            display: 'block',
          }}
        />
      </div>
    </div>
  )
}

const btnStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.08)',
  color: '#e2e8f0',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  padding: '4px 8px',
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
}
