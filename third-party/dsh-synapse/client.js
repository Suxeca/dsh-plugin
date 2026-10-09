window.__ModuleLoader__.load({
  id: 'dsh-synapse',
  factory: () => {
    const module = { exports: {} }
    const currentSession = ctx => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const id = snapshot.current
      if (id === undefined) return null
      const session = snapshot.byId[id]
      return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null }
    }
    const sessionSnapshot = ctx => {
      const snapshot = ctx.sessions.list.getSnapshot()
      return snapshot.ids.map(id => {
        const session = snapshot.byId[id]
        return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null, parentId: session.parentId ?? null, blank: session.blank }
      }).filter(Boolean)
    }
    const workspaceSnapshot = ctx => {
      const sessions = ctx.sessions.list.getSnapshot()
      const snapshot = ctx.workspaces.list.getSnapshot()
      const byId = sessions.byId
      const accounted = new Set(snapshot.items.flatMap(workspace => workspace.sessionIds))
      const toSession = id => {
        const summary = byId[id]
        // Subagent/team sessions and blank "new session" placeholders are not
        // part of DSH's native conversation sidebar; keep them out of Synapse's
        // left library too so the counts match.
        if (summary === undefined || summary.origin === 'subagent' || summary.blank === true) return null
        return { id, title: summary.displayTitle ?? summary.title ?? null, cwd: summary.cwd ?? null, blank: summary.blank ?? false, parentId: summary.parentId ?? null, updatedAt: summary.updatedAt ?? 0 }
      }
      return [
        ...snapshot.items.map(workspace => ({ id: workspace.workspaceId, title: workspace.title, path: workspace.path, sessionIds: workspace.sessionIds, sessions: workspace.sessionIds.map(toSession).filter(Boolean) })),
        { id: 'dsh-ungrouped', title: '未分组', path: null, sessionIds: sessions.ids.filter(id => !accounted.has(id)), sessions: sessions.ids.filter(id => !accounted.has(id)).map(toSession).filter(Boolean) },
      ]
    }

    module.exports.inject = ['sessions', 'workspaces', 'uiConversation']
    module.exports.apply = ctx => {
      const prompt = async (sessionId, text) => {
        const scope = ctx.sessions.scope(sessionId)
        const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
        if (session === undefined) throw new Error('关联的 DSH 会话已不可用')
        const result = await session.prompt([{ type: 'text', text }], 'queue')
        if (!result.ok) throw new Error(result.error?.message ?? 'DSH 未接受这条消息')
      }
      const historyText = blocks => {
        if (!Array.isArray(blocks)) return ''
        return blocks
          .filter(block => (block?.type === 'text' || block?.kind === 'text') && typeof block.text === 'string')
          .map(block => block.text)
          .filter(Boolean)
          .join('\n')
      }
      const assistantText = blocks => {
        if (!Array.isArray(blocks)) return ''
        return blocks
          .filter(block => (block?.kind === 'text' || block?.type === 'text') && typeof block.text === 'string')
          .map(block => block.text)
          .filter(Boolean)
          .join('\n')
      }
      const messagesFromNodes = (nodes, atSeq = undefined) => {
        if (!Array.isArray(nodes)) return []
        const cut = Number.isInteger(atSeq) ? atSeq : undefined
        return nodes.flatMap(node => {
          // For a fork, only the part at/after the cut belongs to the branch:
          // the inherited prefix is already drawn by the parent chain, so
          // repeating it here would create a duplicate left-to-right row. The
          // cut is the FIRST event owned by the branch, so keep >= cut.
          if (cut !== undefined && Number.isInteger(node?.seq) && node.seq < cut) return []
          if (node?.kind === 'user' || node?.type === 'user/message') {
            const content = node.content ?? node.data?.message?.content ?? node.data?.content
            const text = historyText(content)
            if (text.trimStart().startsWith('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.')) return []
            return text.trim() === '' ? [] : [{ kind: 'user', text: text.slice(0, 10_000), at: node.time, sourceSeq: node.seq }]
          }
          if (node?.kind === 'assistant' || node?.type === 'assistant/message') {
            const blocks = node.blocks ?? node.data?.message?.content ?? node.data?.content
            const text = assistantText(blocks)
            return text.trim() === '' ? [] : [{ kind: 'assistant', text: text.slice(0, 10_000), at: node.time, sourceSeq: node.seq }]
          }
          if (node?.kind === 'turn-error') {
            return [{ kind: 'error', text: String(node.message ?? '').slice(0, 10_000), at: node.time, sourceSeq: node.seq }]
          }
          return []
        })
      }
      const loadHistory = async (sessionId, atSeq = undefined) => {
        // Resolve the Session instance without staging it as current: the
        // concrete object exposes open() (the SessionFace type hides it), so
        // bulk history loading never changes DSH's current selection.
        const scope = ctx.sessions.scope(sessionId)
        const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
        if (session === undefined) throw new Error('DSH 会话历史暂不可用')
        if (typeof session.open === 'function') await session.open()
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline) {
          const snapshot = session.getSnapshot()
          if (snapshot.openState === 'open') break
          if (snapshot.openState === 'error') throw new Error(snapshot.openError?.message ?? 'DSH 会话历史加载失败')
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        let snapshot = session.getSnapshot()
        if (snapshot.openState !== 'open') throw new Error('DSH 会话历史打开超时')
        // Page backward through the full log (PAGE_MESSAGES=50 per page).
        let pages = 0
        while (snapshot.hasMore && pages < 100) {
          await session.loadOlder()
          snapshot = session.getSnapshot()
          pages++
        }

        let nodes = snapshot.nodes
        if (!Array.isArray(nodes) || nodes.length === 0) {
          if (ctx.uiConversation) {
            try {
              const conversation = ctx.uiConversation.binding(sessionId)
              const chatTarget = conversation?.target('chat')
              const chatSnap = chatTarget?.getSnapshot()
              nodes = chatSnap?.legacy?.nodes ?? chatSnap?.nodes?.values?.() ?? []
            } catch {
              // fall back
            }
          }
          if (!Array.isArray(nodes) || nodes.length === 0) {
            const eventEntries = session.eventSource?.getSnapshot?.()?.entries ?? []
            nodes = eventEntries.map(e => e.event ?? e)
          }
        }
        snapshot = { ...snapshot, nodes: Array.isArray(nodes) && nodes.length > 0 ? nodes : snapshot.nodes }
        return messagesFromNodes(snapshot.nodes, atSeq)
      }
      const style = document.createElement('style')
      style.textContent = '.dsh-synapse-switch{position:fixed;z-index:95;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;box-sizing:border-box;padding:1px;border:1px solid rgba(255,255,255,.18);border-radius:50%;background:rgba(15,23,42,.88);box-shadow:0 2px 10px rgba(0,0,0,.35);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);overflow:hidden;gap:0;touch-action:manipulation;user-select:none}.dsh-synapse-switch button{width:15px;height:30px;min-width:0;border:0;background:transparent;padding:0;display:inline-flex;align-items:center;justify-content:center;color:#94a3b8;cursor:pointer;transition:all .2s cubic-bezier(0.4,0,0.2,1)}.dsh-synapse-switch button[data-view="dialog"]{border-radius:15px 0 0 15px;padding-left:2px}.dsh-synapse-switch button[data-view="map"]{border-radius:0 15px 15px 0;padding-right:2px}.dsh-synapse-switch button[data-view="dialog"].active{background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;box-shadow:0 0 8px rgba(245,158,11,.6)}.dsh-synapse-switch button[data-view="map"].active{background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;box-shadow:0 0 8px rgba(99,102,241,.6)}.dsh-synapse-switch button:hover:not(.active){color:#f1f5f9;background:rgba(255,255,255,.08)}.dsh-synapse-overlay{position:fixed;z-index:100;inset:0;background:#0f172a}.dsh-synapse-overlay.is-opening{visibility:hidden}.dsh-synapse-overlay[hidden]{display:none}.dsh-synapse-overlay iframe{display:block;width:100%;height:100%;border:0}'
      document.head.append(style)
      const host = document.createElement('div')
      host.className = 'dsh-synapse-host'
      host.innerHTML = '<div class="dsh-synapse-switch" role="group" aria-label="日月灯视图切换"><button type="button" data-view="dialog" class="active" aria-pressed="true" title="对话 (日灯)"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg></button><button type="button" data-view="map" aria-pressed="false" title="会话地图 (月灯)"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button></div><section class="dsh-synapse-overlay" hidden><iframe title="会话地图" src="/synapse/"></iframe></section>'
      document.body.append(host)
      const dialogButton = host.querySelector('[data-view="dialog"]')
      const mapButton = host.querySelector('[data-view="map"]')
      const overlay = host.querySelector('.dsh-synapse-overlay')
      const frame = host.querySelector('iframe')

      const setView = view => {
        const showingMap = view === 'map'
        dialogButton.classList.toggle('active', !showingMap)
        dialogButton.setAttribute('aria-pressed', String(!showingMap))
        mapButton.classList.toggle('active', showingMap)
        mapButton.setAttribute('aria-pressed', String(showingMap))
      }
      const unsubscribeLiveSessions = () => {
        for (const [id, unsubscribe] of liveUnsubscribers) {
          unsubscribe()
          liveUnsubscribers.delete(id)
        }
      }
      const close = () => {
        window.clearTimeout(mapOpenFallback)
        mapOpening = false
        document.body.classList.remove('dsh-synapse-map-open')
        overlay.classList.remove('is-opening')
        overlay.hidden = true
        setView('dialog')
        // Tell the hidden map to pause polling/rendering so switching back to
        // the native dialog does not fight the main page for CPU/network.
        send('synapse:map-closed')
        // Drop per-session live subscriptions while the map is hidden; they
        // are re-created on the next open via syncCurrentSession -> syncLiveSessions.
        unsubscribeLiveSessions()
      }
      const send = (type, payload) => { frame.contentWindow?.postMessage({ source: 'dsh-synapse', type, ...payload }, location.origin) }
      let knownSessionIds = new Set()
      const liveUnsubscribers = new Map()
      const syncLiveSessions = () => {
        const snapshot = ctx.sessions.list.getSnapshot()
        for (const id of snapshot.ids) {
          if (liveUnsubscribers.has(id)) continue
          const scope = ctx.sessions.scope(id)
          const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
          if (session === undefined) continue
          const publish = () => {
            if (overlay.hidden) return
            const state = session.getSnapshot()
            let text = ''
            if (ctx.uiConversation) {
              try {
                const conversation = ctx.uiConversation.binding(id)
                const chatTarget = conversation?.target('chat')
                const chatSnap = chatTarget?.getSnapshot()
                text = chatSnap?.legacy?.partial?.blocks?.filter(block => block.kind === 'text').map(block => block.text).join('\n') ?? ''
              } catch {
                // fall through
              }
            }
            if (!text && state.partial?.blocks) {
              text = state.partial.blocks.filter(block => block?.kind === 'text').map(block => block.text).join('\n') ?? ''
            }
            send('synapse:live-reply', { sessionId: id, running: state.running, text })
          }
          liveUnsubscribers.set(id, session.subscribe(publish))
          publish()
        }
        for (const [id, unsubscribe] of liveUnsubscribers) if (!snapshot.ids.includes(id)) { unsubscribe(); liveUnsubscribers.delete(id) }
      }
      // The session snapshot carries one record per session in the profile, so
      // it is by far the largest request this bridge makes (~120 KB on a few
      // hundred sessions). It must not be re-sent for every list notification:
      // a streaming turn mutates the list continuously, and a rejected request
      // parks a socket from the browser's small per-origin pool until it is
      // reaped, which starves unrelated requests of connections.
      const SESSIONS_SYNC_MIN_INTERVAL_MS = 5_000
      let sessionsSyncTimer = 0
      let lastSessionsSyncAt = 0
      let lastSessionsSignature = ''
      const sendSessionsSync = () => {
        const sessions = sessionSnapshot(ctx)
        const sessionIds = new Set(sessions.map(session => session.id))
        const removedSessionIds = [...knownSessionIds].filter(id => !sessionIds.has(id))
        knownSessionIds = sessionIds
        // DSH-native archive set: the workspace registry hides these sessions
        // from grouping; mirror it server-side so archived conversations
        // never become (or remain) canvas nodes.
        const archivedSessionIds = ctx.workspaces.list.getSnapshot().archivedSessionIds ?? []
        const body = JSON.stringify({ sessions, removedSessionIds, archivedSessionIds })
        // Nothing changed since the last accepted snapshot: skip the round trip.
        if (body === lastSessionsSignature) return
        lastSessionsSignature = body
        lastSessionsSyncAt = Date.now()
        void fetch('/synapse/api/sessions/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => {})
      }
      const syncSessions = () => {
        if (sessionsSyncTimer !== 0) return
        const elapsed = Date.now() - lastSessionsSyncAt
        if (elapsed >= SESSIONS_SYNC_MIN_INTERVAL_MS) {
          sendSessionsSync()
          return
        }
        // Coalesce the burst; the timer reads the list again when it fires, so
        // the final state is never dropped.
        sessionsSyncTimer = window.setTimeout(() => {
          sessionsSyncTimer = 0
          sendSessionsSync()
        }, SESSIONS_SYNC_MIN_INTERVAL_MS - elapsed)
      }
      const syncCurrentSession = () => {
        syncSessions()
        if (!overlay.hidden) {
          syncLiveSessions()
          const archivedSessionIds = ctx.workspaces.list.getSnapshot().archivedSessionIds ?? []
          send('synapse:workspaces', { workspaces: workspaceSnapshot(ctx), archivedSessionIds })
          send('synapse:current-session', { session: currentSession(ctx) })
        }
      }
      let mapOpenFallback = 0
      let mapOpening = false
      const showMapOverlay = () => {
        window.clearTimeout(mapOpenFallback)
        mapOpening = false
        overlay.hidden = false
        overlay.classList.remove('is-opening')
        syncCurrentSession()
      }
      const open = () => {
        window.clearTimeout(mapOpenFallback)
        mapOpening = true
        document.body.classList.add('dsh-synapse-map-open')
        setView('map')
        // Keep the iframe laid out while hidden so its canvas can receive a
        // real scroll offset. display:none would clamp scrollTop back to zero.
        overlay.hidden = false
        overlay.classList.add('is-opening')
        window.requestAnimationFrame(() => {
          send('synapse:map-opened')
          syncCurrentSession()
        })
        mapOpenFallback = window.setTimeout(showMapOverlay, 300)
      }
      const onFrameLoad = () => {
        syncCurrentSession()
        if (mapOpening) send('synapse:map-opened')
      }
      const onMessage = event => {
        if (event.origin !== location.origin || event.data?.source !== 'dsh-synapse') return
        if (event.data.type === 'synapse:close') return close()
        if (event.data.type === 'synapse:map-ready') return showMapOverlay()
        if (event.data.type === 'synapse:request-current') {
          const archivedSessionIds = ctx.workspaces.list.getSnapshot().archivedSessionIds ?? []
          send('synapse:workspaces', { workspaces: workspaceSnapshot(ctx), archivedSessionIds })
          return send('synapse:current-session', { session: currentSession(ctx) })
        }
        if (event.data.type === 'synapse:open-session') {
          try { ctx.sessions.open(event.data.sessionId); close() } catch { send('synapse:bridge-error', { message: '关联的 DSH 会话已不可用' }) }
          return
        }
        if (event.data.type === 'synapse:activate-session') {
          // Bidirectional current-session sync: switch DSH's current session
          // without closing the map; the sessions-list subscription re-sends
          // synapse:current-session so the map follows the new highlight.
          try { ctx.sessions.open(event.data.sessionId) } catch { send('synapse:bridge-error', { message: '关联的 DSH 会话已不可用' }) }
          return
        }
        if (event.data.type === 'synapse:fork-session') {
          const atSeq = Number.isInteger(event.data.atSeq) ? event.data.atSeq : undefined
          ctx.sessions.fork({ sessionId: event.data.sessionId, atSeq, increaseTitle: true }).then(id => {
            const snapshot = ctx.sessions.list.getSnapshot()
            send('synapse:forked-session', { requestId: event.data.requestId, session: { id, title: snapshot.byId[id]?.displayTitle ?? 'DSH 分支' } })
          }).catch(() => { send('synapse:bridge-error', { message: 'DSH 分支创建失败，请确认源会话已经完成当前轮次' }) })
          return
        }
        if (event.data.type === 'synapse:send-message') {
          const text = typeof event.data.text === 'string' ? event.data.text.trim() : ''
          if (text === '') return send('synapse:bridge-error', { requestId: event.data.requestId, message: '消息不能为空' })
          prompt(event.data.sessionId, text).then(() => {
            send('synapse:message-sent', { requestId: event.data.requestId, sessionId: event.data.sessionId })
          }).catch(error => {
            const message = error instanceof Error ? error.message : String(error ?? '')
            // Model/adapter errors are common on freshly forked sessions: tell the
            // user to pick a model in DSH instead of showing a raw engine message.
            if (/no adapter serves provider|select a model|no model|provider.*not.*available|adapter.*missing/i.test(message)) {
              send('synapse:bridge-error', { requestId: event.data.requestId, message: '这个会话还没有可用的模型（原会话的模型适配器当前不可用）。请先在 DSH 原生对话中为这个分支会话选择一个模型，再回来发送。' })
            } else {
              send('synapse:bridge-error', { requestId: event.data.requestId, message: 'DSH 消息发送失败：' + message })
            }
          })
          return
        }
        if (event.data.type === 'synapse:create-session') {
          const workspaceId = typeof event.data.workspaceId === 'string' && event.data.workspaceId !== '' && event.data.workspaceId !== 'dsh-ungrouped' ? event.data.workspaceId : undefined
          const cwd = typeof event.data.cwd === 'string' && event.data.cwd !== '' ? event.data.cwd : undefined
          const create = workspaceId === undefined ? ctx.sessions.create(cwd === undefined ? {} : { cwd }) : ctx.sessions.create({ workspaceId })
          create.then(id => {
            const snapshot = ctx.sessions.list.getSnapshot()
            send('synapse:created-session', { requestId: event.data.requestId, session: { id, title: snapshot.byId[id]?.displayTitle ?? '新会话', cwd: snapshot.byId[id]?.cwd ?? cwd ?? null } })
          }).catch(() => { send('synapse:bridge-error', { requestId: event.data.requestId, message: 'DSH 会话创建失败，请先在 DSH 选择工作目录' }) })
        }
        if (event.data.type === 'synapse:load-history') {
          const sessionId = typeof event.data.sessionId === 'string' ? event.data.sessionId : ''
          if (sessionId === '') return send('synapse:bridge-error', { requestId: event.data.requestId, message: '会话 id 无效' })
          const atSeq = Number.isInteger(event.data.atSeq) ? event.data.atSeq : undefined
          loadHistory(sessionId, atSeq).then(messages => {
            send('synapse:history-loaded', { requestId: event.data.requestId, sessionId, atSeq, messages })
          }).catch(error => {
            send('synapse:bridge-error', { requestId: event.data.requestId, message: error instanceof Error ? error.message : 'DSH 会话历史加载失败' })
          })
          return
        }
      }
      const onKeyDown = event => { if (event.key === 'Escape' && !overlay.hidden) close() }
      const unsubscribeSessions = ctx.sessions.list.subscribe(syncCurrentSession)
      const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(syncCurrentSession)
      dialogButton.addEventListener('click', close)
      mapButton.addEventListener('click', open)
      frame.addEventListener('load', onFrameLoad)
      window.addEventListener('message', onMessage)
      window.addEventListener('keydown', onKeyDown)
      ctx.effect(() => () => {
        dialogButton.removeEventListener('click', close)
        mapButton.removeEventListener('click', open)
        frame.removeEventListener('load', onFrameLoad)
        window.removeEventListener('message', onMessage)
        window.removeEventListener('keydown', onKeyDown)
        unsubscribeSessions()
        unsubscribeWorkspaces()
        for (const unsubscribe of liveUnsubscribers.values()) unsubscribe()
        host.remove()
        style.remove()
      }, 'synapse: web workspace switch')
    }
    return module.exports
  },
})
