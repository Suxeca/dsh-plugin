/**
 * Reactive store for active DSH visualization artifacts.
 * Integrates with DSH native right sidebar (sidebarRight).
 */

export interface ArtifactData {
  callId: string
  title: string
  path: string
  doc: string
  mode: 'inline' | 'wide'
  updatedAt: number
}

class ArtifactManager {
  private current: ArtifactData | null = null
  private isFullScreen: boolean = false
  private reloadKey: number = 0
  private ctx: any = null
  private listeners = new Set<() => void>()

  setContext(ctx: any): void {
    this.ctx = ctx
  }

  get active(): ArtifactData | null {
    return this.current
  }

  get fullScreen(): boolean {
    return this.isFullScreen
  }

  get refreshKey(): number {
    return this.reloadKey
  }

  setArtifact(artifact: ArtifactData, autoOpen = true): void {
    const isNew = this.current?.callId !== artifact.callId
    this.current = artifact
    this.notify()
    // Restoring historical cards must not open a modal over mobile file links.
    // Mobile fullscreen remains an explicit action on the card's open button.
    if (isNew && autoOpen && (typeof window === 'undefined' || window.innerWidth >= 768)) {
      this.openRightSidebar()
    }
  }

  openRightSidebar(): void {
    // 移动端或小屏（< 768px）：无右侧并排侧栏空间，直接呼出全屏独立工作台
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      this.isFullScreen = true
      this.notify()
      return
    }

    const sb = this.ctx?.get?.('sidebarRight')
    if (sb && typeof sb.openTab === 'function') {
      try {
        sb.openTab('artifact')
        return
      } catch (e) {
        console.warn('[dsh-visualize] native sidebarRight.openTab failed, falling back to fullscreen', e)
        this.isFullScreen = true
        this.notify()
        return
      }
    }
    // 桌面端降级：若侧栏暂不可用，直接全屏打开
    this.isFullScreen = true
    this.notify()
  }

  toggleFullScreen(): void {
    this.isFullScreen = !this.isFullScreen
    this.notify()
  }

  reload(): void {
    this.reloadKey += 1
    this.notify()
  }

  openExternal(): void {
    if (!this.current) return
    try {
      const blob = new Blob([this.current.doc], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch (e) {
      console.error('[dsh-visualize] Failed to open external blob window', e)
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (e) {
        console.error('[dsh-visualize] Listener notification error', e)
      }
    }
  }
}

export const artifactManager = new ArtifactManager()
