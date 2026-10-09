/**
 * The `visualize` toolview: upgrades the visualization card into a full Artifact
 * interactive application system (Claude Artifacts & Antigravity paradigm).
 *
 * Provides:
 * 1. In-chat Artifact Capsule: compact, non-intrusive preview card that avoids
 *    cluttering and squeezing the conversation layout;
 * 2. Unconstrained Right Sidebar Drawer: side-by-side workspace with full viewport
 *    height and width (58vw - 100vw), independent scrolling and theme toggle;
 * 3. Persistent Floating Quick-Launch Pill: docked at bottom-right, allowing
 *    the user to reopen the active artifact anytime without hunting through chat history.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { visualizeMetaFrom, visualizeMetaFromArgs, type VisualizeMeta } from '../fragment.ts'
import { buildFrameDoc, HEIGHT_MESSAGE_TYPE } from '../shell.ts'
import { resolveTheme } from './theme.ts'
import { artifactManager } from './artifact-store.ts'
import { ArtifactDrawerOverlay } from './ArtifactDrawer.tsx'

/** Iframe height bounds for inline collapsible view. */
const MIN_HEIGHT = 48
const HEIGHT_CAP: Record<'inline' | 'wide', number> = { inline: 800, wide: 1200 }

const capsuleContainerStyle: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-1, rgba(30, 41, 59, 0.75))',
  border: '1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12))',
  borderRadius: 10,
  padding: '12px 16px',
  margin: '8px 0',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
}

const frameStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  border: 0,
  background: 'transparent',
  colorScheme: 'normal',
  marginTop: 12,
  borderRadius: 8,
}

/** First text line of the durable result content, for the error row. */
function firstResultLine(content: readonly { type: string; text?: string }[]): string {
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      const newline = block.text.indexOf('\n')
      return newline === -1 ? block.text : block.text.slice(0, newline)
    }
  }
  return 'visualization failed'
}

/** The settled Artifact component: capsule in chat + right drawer + floating pill */
function Frame({ meta, callId }: { meta: VisualizeMeta; callId: string }) {
  const [themeTick, setThemeTick] = useState(0)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [inlineExpanded, setInlineExpanded] = useState(false)

  useEffect(() => {
    const bump = () => setThemeTick(tick => tick + 1)
    const observer = new MutationObserver(bump)
    observer.observe(document.documentElement, { attributes: true })
    observer.observe(document.body, { attributes: true })
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', bump)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', bump)
    }
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const report = data as { type?: unknown; token?: unknown; height?: unknown }
      if (report.type !== HEIGHT_MESSAGE_TYPE || report.token !== callId) return
      if (typeof report.height !== 'number' || !Number.isFinite(report.height)) return
      setHeight(Math.max(MIN_HEIGHT, Math.min(Math.ceil(report.height), HEIGHT_CAP[meta.mode])))
    }
    addEventListener('message', onMessage)
    return () => removeEventListener('message', onMessage)
  }, [callId, meta.mode])

  const doc = useMemo(() => {
    const { themeVars, colorScheme } = resolveTheme()
    return buildFrameDoc({
      fragment: meta.fragment,
      title: meta.title,
      themeVars,
      colorScheme,
      reportToken: callId,
    })
  }, [meta, callId, themeTick])

  // 当生成新 Artifact 时，同步到全局管理器，并自动激活工作台
  useEffect(() => {
    artifactManager.setArtifact({
      callId,
      title: meta.title,
      path: meta.path,
      doc,
      mode: meta.mode,
      updatedAt: Date.now(),
    }, true)
  }, [callId, meta.title, meta.path, meta.mode, doc])

  return (
    <div style={capsuleContainerStyle}>
      {/* 顶部标题与元数据 */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 240, flex: 1 }}>
          <span style={{ fontSize: 18 }}>📦</span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#38bdf8' }}>
                ARTIFACT
              </span>
              <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--dsw-alias-label-primary, #f8fafc)' }}>
                {meta.title}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-caption, #94a3b8)', marginTop: 2 }}>
              {meta.path ? (
                <code>{meta.path}</code>
              ) : (
                '独立交互应用'
              )}
              {' · '}
              <span style={{ color: '#10b981' }}>就绪</span>
            </div>
          </div>
        </div>

        {/* 交互控制按钮群 (原生右侧栏 & 独立应用体验) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => artifactManager.openRightSidebar()}
            style={{
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: '0 2px 8px rgba(2, 132, 199, 0.4)',
            }}
            title="在右侧栏展开工作台，不影响左侧对话"
          >
            ◨ 在右侧栏打开
          </button>
          <button
            onClick={() => artifactManager.toggleFullScreen()}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#e2e8f0',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
            title="全屏独立应用窗口"
          >
            ⛶ 全屏
          </button>
          <button
            onClick={() => setInlineExpanded(e => !e)}
            style={{
              background: 'transparent',
              color: '#94a3b8',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
            }}
            title="切换对话内嵌视图"
          >
            {inlineExpanded ? '▴ 收起内嵌' : '▾ 内嵌预览'}
          </button>
        </div>
      </div>

      {/* 可折叠内嵌预览区 */}
      {inlineExpanded && (
        <iframe
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={meta.title}
          srcDoc={doc}
          style={{ ...frameStyle, height }}
        />
      )}

      {/* 全局挂载右侧抽屉与右下角常驻胶囊 */}
      <ArtifactDrawerOverlay />
    </div>
  )
}

/**
 * Keyed toolview for the `visualize` tool. Running calls and malformed or
 * failed results stay quiet single lines; a well-formed persisted meta — or
 * the fragment in the call's own arguments for nested dispatches — mounts
 * the Artifact component.
 */
export function VisualizeCard({ callId, block }: ToolCallViewProps) {
  const argsRaw = 'kind' in block ? block.call?.argsRaw : block.argsRaw
  if (!('kind' in block)) {
    const live = visualizeMetaFromArgs(argsRaw)
    if (live !== undefined) return <Frame meta={live} callId={callId} />
    return <div style={{ fontSize: 12, opacity: 0.65, padding: '4px 0' }}>Artifact · 正在构建交互应用…</div>
  }
  if (block.isError) {
    return <div style={{ fontSize: 12, color: '#f87171', padding: '4px 0' }}>Artifact 错误 · {firstResultLine(block.content)}</div>
  }
  const meta = visualizeMetaFrom(block.meta) ?? visualizeMetaFromArgs(argsRaw)
  if (meta === undefined) {
    return <div style={{ fontSize: 12, opacity: 0.65, padding: '4px 0' }}>{firstResultLine(block.content)}</div>
  }
  return <Frame meta={meta} callId={callId} />
}
