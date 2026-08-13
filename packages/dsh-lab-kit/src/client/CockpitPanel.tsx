/**
 * The cockpit panel: fetches /lab-kit/projects from the host and renders the
 * research-project list. Failure policy mirrors the family convention:
 * network errors render an inline error state, never a throw.
 * @module dsh-lab-kit/client/CockpitPanel
 */

import { useCallback, useEffect, useState } from 'react'
import type { LabKitEnvelope, ProjectsValue } from '../host/routes.ts'
import type { ProjectSummary } from '../host/projects-service.ts'
import { t } from './locales.ts'
import css from './cockpit.module.css'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; roots: string[]; projects: ProjectSummary[] }

/** Format an epoch-ms timestamp as a compact relative time. */
function formatRelativeTime(mtimeMs: number): string {
  const delta = Date.now() - mtimeMs
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚 / just now'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前 / min ago`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前 / h ago`
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前 / d ago`
  return new Date(mtimeMs).toLocaleDateString()
}

/** The cockpit panel component. */
export function CockpitPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' })
    try {
      const response = await fetch('/lab-kit/projects', { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const envelope = await response.json() as LabKitEnvelope<ProjectsValue>
      if (!envelope.ok) throw new Error(envelope.error.message)
      setState({ kind: 'ready', roots: envelope.value.roots, projects: envelope.value.projects })
    } catch (error: unknown) {
      setState({ kind: 'error', message: String(error) })
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.subtitle}>{t('subtitle')}</p>
        </div>
        <div className={css.headerActions}>
          <button type="button" className={css.button} onClick={() => void load()}>{t('refresh')}</button>
          <button type="button" className={css.button} onClick={onClose}>{t('close')}</button>
        </div>
      </header>

      {state.kind === 'loading' && <p className={css.status}>{t('loading')}</p>}
      {state.kind === 'error' && <p className={`${css.status} ${css.error}`}>{t('error')}</p>}
      {state.kind === 'ready' && state.projects.length === 0 && <p className={css.status}>{t('empty')}</p>}

      {state.kind === 'ready' && state.projects.length > 0 && (
        <ul className={css.list}>
          {state.projects.map((project) => (
            <li key={project.path} className={css.card}>
              <div className={css.cardMain}>
                <span className={css.cardName}>{project.name}</span>
                <span className={css.cardMeta}>
                  {project.isGit && <span className={css.badge}>{t('git')}</span>}
                  {project.hasSummary && <span className={css.badge}>{t('summary')}</span>}
                </span>
              </div>
              <div className={css.cardFoot}>
                <span className={css.cardPath}>{project.path}</span>
                <span className={css.cardTime}>{t('updated')} {formatRelativeTime(project.mtimeMs)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
