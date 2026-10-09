import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { artifactManager } from './artifact-store.ts'

export function ArtifactDrawerOverlay() {
  const [, setTick] = useState(0)

  useEffect(() => {
    return artifactManager.subscribe(() => setTick(t => t + 1))
  }, [])

  const active = artifactManager.active
  const isFullScreen = artifactManager.fullScreen
  const refreshKey = artifactManager.refreshKey

  // 彻底移除右下角悬浮胶囊：完全融合进入 DSH 右侧栏。仅在点击全屏时提供全屏视窗
  if (!active || !isFullScreen) return null

  const fullscreenModal = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'var(--dsw-alias-bg-base, #0a0f1d)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* 顶部工具栏 */}
      <div
        style={{
          height: 48,
          minHeight: 48,
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
          background: 'var(--dsw-alias-bg-base, rgba(15, 23, 42, 0.95))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>📦</span>
          <span style={{ color: 'var(--dsw-alias-label-primary, #f8fafc)', fontWeight: 700, fontSize: 14 }}>
            {active.title}
          </span>
          <span style={{ color: '#38bdf8', fontSize: 12, background: 'rgba(56, 189, 248, 0.15)', padding: '2px 8px', borderRadius: 12 }}>
            全屏模式
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => artifactManager.reload()}
            style={actionBtnStyle}
            title="刷新"
          >
            ⟳ 刷新
          </button>
          <button
            onClick={() => artifactManager.openExternal()}
            style={actionBtnStyle}
            title="在新标签页独立打开"
          >
            ↗ 新窗口
          </button>
          <button
            onClick={() => artifactManager.toggleFullScreen()}
            style={{ ...actionBtnStyle, background: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
            title="退出全屏并回到侧边栏"
          >
            ✕ 退出全屏
          </button>
        </div>
      </div>

      {/* 核心内容沙箱 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
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

  return createPortal(fullscreenModal, document.body)
}

const actionBtnStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.08)',
  color: '#e2e8f0',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}
