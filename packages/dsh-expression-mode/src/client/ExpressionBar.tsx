import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { ExpressionPatch, ExpressionState } from '../shared.ts'
import { isExpressionLanguage, usableSessionId } from '../shared.ts'
import { readExpressionState, writeExpressionSettings } from './transport.ts'

const POLL_MS = 6000
const T = {
  text: 'var(--dsw-alias-label-primary, #e6e6ea)',
  dim: 'var(--dsw-alias-label-secondary, #9a9aa4)',
  accent: 'var(--dsw-alias-brand-primary, #38bdf8)',
  error: 'var(--dsw-alias-state-error-primary, #d05a5a)',
  border: 'var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12))',
  cardBg: 'var(--dsw-specific-input-major, #1e293b)',
}

export interface ExpressionBarProps { readonly sessionId?: string }
type Failure = { kind: 'load'; message: string } | { kind: 'write'; message: string; patch: ExpressionPatch }

/** Keyed child ensures per-session state isolation */
export function ExpressionBar({ sessionId }: ExpressionBarProps) {
  if (!usableSessionId(sessionId)) return null
  return h(SessionExpressionCompact, { key: sessionId, sessionId })
}

function SessionExpressionCompact({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<ExpressionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [open, setOpen] = useState(false)

  const mounted = useRef(false)
  const confirmed = useRef<ExpressionState | null>(null)
  const writing = useRef(false)
  const readController = useRef<AbortController | null>(null)
  const writeController = useRef<AbortController | null>(null)
  const readGeneration = useRef(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    if (!mounted.current || writing.current || readController.current !== null || document.visibilityState !== 'visible') return
    const controller = new AbortController()
    const generation = ++readGeneration.current
    readController.current = controller
    setLoading(true)
    try {
      const result = await readExpressionState(sessionId, controller.signal)
      if (!mounted.current || controller.signal.aborted || generation !== readGeneration.current || writing.current) return
      if (confirmed.current === null || result.revision >= confirmed.current.revision) {
        confirmed.current = result
        setState(result)
      }
      setFailure(prev => prev?.kind === 'write' ? prev : null)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && generation === readGeneration.current) {
        setFailure(prev => prev?.kind === 'write' ? prev : {
          kind: 'load', message: error instanceof Error ? error.message : '读取失败',
        })
      }
    } finally {
      if (readController.current === controller) {
        readController.current = null
        if (mounted.current) setLoading(false)
      }
    }
  }, [sessionId])

  useEffect(() => {
    mounted.current = true
    void load()
    const timer = setInterval(() => { void load() }, POLL_MS)
    const visibility = (): void => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      mounted.current = false
      ++readGeneration.current
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visibility)
      readController.current?.abort()
      writeController.current?.abort()
      readController.current = null
      writeController.current = null
      writing.current = false
    }
  }, [load])

  // 点击外部关闭弹层
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [open])

  const save = useCallback(async (patch: ExpressionPatch) => {
    if (!mounted.current || confirmed.current === null || writing.current) return
    writing.current = true
    ++readGeneration.current
    readController.current?.abort()
    readController.current = null
    setLoading(false)
    const controller = new AbortController()
    writeController.current = controller
    setPending(true)
    setFailure(null)
    try {
      const result = await writeExpressionSettings(sessionId, patch, controller.signal)
      if (!mounted.current || controller.signal.aborted || writeController.current !== controller) return
      if ((patch.mode !== undefined && result.mode !== patch.mode)
        || (patch.language !== undefined && result.language !== patch.language)
        || result.revision < (confirmed.current?.revision ?? 0)) {
        throw new Error('未确认变更，请重试')
      }
      confirmed.current = result
      setState(result)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && writeController.current === controller) {
        setFailure({ kind: 'write', patch: { ...patch }, message: error instanceof Error ? error.message : '保存失败' })
      }
    } finally {
      if (writeController.current === controller) {
        writeController.current = null
        writing.current = false
        if (mounted.current) setPending(false)
      }
    }
  }, [sessionId])

  const unknown = state === null
  const enabled = state?.mode === 'ste'
  const currentLang = state?.language ?? 'auto'

  const langLabel = currentLang === 'zh' ? '中文' : currentLang === 'en' ? 'EN' : '跟随'
  const buttonTitle = `表达方式与语言设置 (当前: ${enabled ? '简明 STE' : '原有'}, ${langLabel})`

  return h('div', {
    ref: containerRef,
    style: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
    'data-expression-session': sessionId,
  },
    // 底部输入框右侧的常驻紧凑图标按钮（纯图标，不占文字宽度）
    h('button', {
      type: 'button',
      onClick: () => setOpen(o => !o),
      title: buttonTitle,
      'aria-label': buttonTitle,
      style: {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        borderRadius: 7,
        border: enabled ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid transparent',
        background: enabled ? 'rgba(56, 189, 248, 0.16)' : 'transparent',
        color: enabled ? '#38bdf8' : 'var(--dsw-alias-label-secondary, #94a3b8)',
        cursor: 'pointer',
        touchAction: 'manipulation',
        userSelect: 'none',
        transition: 'all 0.15s ease',
      },
    },
      h('svg', {
        viewBox: '0 0 24 24',
        width: 16,
        height: 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M12 20h9' }),
        h('path', { d: 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' }),
      ),
      // 开启 STE 模式时的微型指示光点
      enabled ? h('span', {
        style: {
          position: 'absolute',
          top: 3,
          right: 3,
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: '#38bdf8',
          boxShadow: '0 0 4px #38bdf8',
        },
      }) : null,
    ),

    // 展开的气泡弹窗菜单
    open ? h('div', {
      role: 'dialog',
      'aria-label': '表达方式与语言设置',
      style: {
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        right: 0,
        zIndex: 100,
        width: 260,
        background: T.cardBg,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: '12px 14px',
        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontSize: 12,
        color: T.text,
      },
    },
      // 标题栏
      h('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: 8,
        },
      },
        h('span', { style: { fontWeight: 600, fontSize: 13, color: T.text } }, '表达方式与语言'),
        h('button', {
          type: 'button',
          onClick: () => setOpen(false),
          style: {
            background: 'transparent',
            border: 0,
            color: T.dim,
            fontSize: 14,
            cursor: 'pointer',
            padding: '0 4px',
          },
          title: '关闭',
        }, '×'),
      ),

      // 简明表达开关
      h('label', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: unknown || pending ? 'not-allowed' : 'pointer',
        },
      },
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          h('span', { style: { fontWeight: 500, color: enabled ? T.accent : T.text } }, '简明表达 (STE)'),
          h('span', { style: { fontSize: 10, color: T.dim, marginTop: 2 } }, '简洁直接，突出公式与关键判决'),
        ),
        h('input', {
          type: 'checkbox',
          role: 'switch',
          checked: enabled,
          disabled: unknown || pending,
          style: { accentColor: T.accent, width: 16, height: 16, cursor: 'pointer' },
          onChange: () => { void save({ mode: enabled ? 'default' : 'ste' }) },
        }),
      ),

      // 语言下拉选择
      h('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
      },
        h('span', { style: { fontWeight: 500 } }, '输出语言'),
        h('select', {
          value: currentLang,
          disabled: unknown || pending,
          style: {
            color: T.text,
            background: 'rgba(0, 0, 0, 0.35)',
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            padding: '3px 8px',
            fontSize: 12,
            outline: 'none',
          },
          onChange: (event: { target: { value: string } }) => {
            const language = event.target.value
            if (isExpressionLanguage(language)) void save({ language })
          },
        },
          h('option', { value: 'auto' }, '跟随原有策略'),
          h('option', { value: 'zh' }, '中文 (Chinese)'),
          h('option', { value: 'en' }, 'English'),
        ),
      ),

      // 状态反馈与科学保真提示
      h('div', {
        style: {
          fontSize: 10,
          color: T.dim,
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          paddingTop: 8,
          lineHeight: 1.4,
        },
      },
        h('div', { style: { color: pending ? T.accent : T.dim, marginBottom: 2 } },
          unknown ? (loading ? '正在读取会话配置…' : '状态未知')
            : pending ? '正在保存…' : '下次模型步骤生效'),
        h('div', null, '严格保真：不改数学推导/证据，不自动翻译笔记'),
      ),

      // 错误与重试
      failure ? h('div', {
        style: {
          color: T.error,
          fontSize: 11,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        },
      },
        h('span', null, `${failure.kind === 'write' ? '保存未确认' : '读取失败'}`),
        h('button', {
          type: 'button',
          onClick: () => {
            if (failure.kind === 'write') void save(failure.patch)
            else void load()
          },
          style: {
            fontSize: 11,
            color: T.text,
            background: 'transparent',
            border: `1px solid ${T.border}`,
            borderRadius: 4,
            padding: '2px 6px',
            cursor: 'pointer',
          },
        }, '重试'),
      ) : null,
    ) : null,
  )
}
