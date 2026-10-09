/**
 * Unit tests for the pure switcher helpers: title projection, relative
 * time, turn count, the sidebar-faithful ordering/grouping, the archived
 * list, the cycle anchor, and the cycle-gesture target.
 * @module tests/utils.spec
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archivedSessions,
  currentSessionId,
  cycleAnchor,
  cycleAnchorId,
  getWorkspaceHue,
  isStaleSession,
  offsetTarget,
  paletteItems,
  pinnedSessions,
  recencyOrder,
  relTime,
  rowIndexOf,
  sidebarOrder,
  timeRecencyLevel,
  titleOf,
  turnCountOf,
  workspaceColorIndex,
  workspaceIdOwning,
} from '../src/client/utils.ts'
import type {
  DecoratedSession,
  SessionListStateLike,
  SessionSummaryLike,
  WorkspaceListStateLike,
  WorkspaceViewLike,
} from '../src/client/port.ts'

function session(overrides: Partial<SessionSummaryLike> & { id: string }): SessionSummaryLike {
  return {
    displayTitle: overrides.id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
  }
}

function workspace(id: string, title: string, sessionIds: string[]): WorkspaceViewLike {
  return { workspaceId: id, title, sessionIds }
}

function sessionsSnap(entries: SessionSummaryLike[], current?: string): SessionListStateLike {
  return {
    ids: entries.map((s) => s.id),
    byId: Object.fromEntries(entries.map((s) => [s.id, s])),
    current,
    phase: 'ready',
  }
}

function workspacesSnap(items: WorkspaceViewLike[], extra: Partial<WorkspaceListStateLike> = {}): WorkspaceListStateLike {
  return { items, archivedSessionIds: [], phase: 'ready', ...extra }
}

describe('titleOf', () => {
  it('prefers the durable title projection', () => {
    expect(titleOf(session({ id: 'a', title: '物理讨论', displayTitle: 'fallback' }))).toBe('物理讨论')
  })

  it('falls back to displayTitle', () => {
    expect(titleOf(session({ id: 'a', displayTitle: '只显示标题' }))).toBe('只显示标题')
  })

  it('returns the placeholder when everything is blank', () => {
    expect(titleOf(session({ id: 'a', title: '', displayTitle: '' }))).toBe('未命名对话')
  })
})

describe('relTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T12:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const minutesAgo = (m: number): number => Date.now() - m * 60000

  it('labels sub-minute deltas 刚刚', () => {
    expect(relTime(minutesAgo(0.5))).toBe('刚刚')
  })
  it('labels minutes', () => {
    expect(relTime(minutesAgo(5))).toBe('5 分钟前')
  })
  it('labels hours', () => {
    expect(relTime(minutesAgo(60 * 3))).toBe('3 小时前')
  })
  it('labels days', () => {
    expect(relTime(minutesAgo(60 * 24 * 2))).toBe('2 天前')
  })
  it('falls back to a compact date beyond a week', () => {
    expect(relTime(minutesAgo(60 * 24 * 8))).toBe('2026/8/5')
  })
  it('returns empty for non-numbers', () => {
    expect(relTime(undefined)).toBe('')
    expect(relTime(Number.NaN)).toBe('')
  })
})

describe('turnCountOf', () => {
  it('reads the sessionStats projection', () => {
    expect(turnCountOf(session({ id: 'a', projectionValues: { sessionStats: { turns: 12 } } }))).toBe(12)
  })
  it('hides absent, zero, and malformed counts', () => {
    expect(turnCountOf(session({ id: 'a' }))).toBeUndefined()
    expect(turnCountOf(session({ id: 'a', projectionValues: { sessionStats: { turns: 0 } } }))).toBeUndefined()
    expect(turnCountOf(session({ id: 'a', projectionValues: { sessionStats: { turns: Number.NaN } } }))).toBeUndefined()
  })
})

describe('workspaceIdOwning', () => {
  it('finds the owning workspace', () => {
    expect(workspaceIdOwning([workspace('w1', '工作区', ['s1', 's2'])], 's2')).toBe('w1')
  })
  it('returns undefined for unaccounted sessions', () => {
    expect(workspaceIdOwning([workspace('w1', '工作区', ['s1'])], 's9')).toBeUndefined()
  })
})

describe('sidebarOrder', () => {
  it('mirrors the sidebar: workspace display order, recency inside, ungrouped trailing', () => {
    const entries = [
      session({ id: 's1', updatedAt: 100 }), // workspace b, older
      session({ id: 's2', updatedAt: 300 }), // workspace a
      session({ id: 's3', updatedAt: 200 }), // workspace a, newer id order tiebreak target
      session({ id: 's4', updatedAt: 400 }), // unaccounted
      session({ id: 's5', updatedAt: 500 }), // workspace b, newer
    ]
    const snaps = sessionsSnap(entries, 's2')
    const ws = workspacesSnap([workspace('a', 'A', ['s2', 's3']), workspace('b', 'B', ['s1', 's5'])])
    const ids = sidebarOrder(snaps, ws).map((d) => d.session.id)
    // workspaces in Host order a→b, each by recency desc, ungrouped last.
    expect(ids).toEqual(['s2', 's3', 's5', 's1', 's4'])
  })

  it('breaks recency ties by session id', () => {
    const entries = [session({ id: 'b', updatedAt: 100 }), session({ id: 'a', updatedAt: 100 })]
    const ids = sidebarOrder(sessionsSnap(entries), workspacesSnap([])).map((d) => d.session.id)
    expect(ids).toEqual(['a', 'b'])
  })

  it('includes forked/branch conversations (parentId set) as ordinary rows', () => {
    const entries = [
      session({ id: 'root', updatedAt: 100 }),
      session({ id: 'branch1', parentId: 'root', updatedAt: 300 }),
      session({ id: 'branch2', parentId: 'root', updatedAt: 200 }),
    ]
    const ws = workspacesSnap([workspace('a', 'A', ['root', 'branch1', 'branch2'])])
    const ids = sidebarOrder(sessionsSnap(entries, 'branch1'), ws).map((d) => d.session.id)
    // recency desc within the workspace, branches included.
    expect(ids).toEqual(['branch1', 'branch2', 'root'])
  })

  it('excludes subagent-origin, archived, and non-current blank sessions', () => {
    const entries = [
      session({ id: 'root' }),
      session({ id: 'agent', origin: 'subagent' }),
      session({ id: 'blank', blank: true }),
      session({ id: 'blankCurrent', blank: true }),
    ]
    const ws = workspacesSnap([], { archivedSessionIds: ['root'] })
    const ids = sidebarOrder(sessionsSnap(entries, 'blankCurrent'), ws).map((d) => d.session.id)
    expect(ids).toEqual(['blankCurrent'])
  })

  it('orders unaccounted sessions by recency after all workspaces', () => {
    const entries = [
      session({ id: 'u1', updatedAt: 100 }),
      session({ id: 'u2', updatedAt: 300 }),
    ]
    const ws = workspacesSnap([workspace('a', 'A', [])])
    const ids = sidebarOrder(sessionsSnap(entries), ws).map((d) => d.session.id)
    expect(ids).toEqual(['u2', 'u1'])
  })

  it('tolerates undefined ids/byId/items (baseline not landed yet)', () => {
    const snap = { phase: 'idle' } as unknown as SessionListStateLike
    const ws = { phase: 'idle' } as unknown as WorkspaceListStateLike
    expect(sidebarOrder(snap, ws)).toEqual([])
  })
})

describe('paletteItems', () => {
  const entries = [
    session({ id: 's1', updatedAt: 100 }),
    session({ id: 's2', updatedAt: 300 }),
    session({ id: 's3', updatedAt: 200 }),
  ]
  const ws = workspacesSnap([workspace('a', '工作区A', ['s2', 's3']), workspace('b', '工作区B', ['s1'])])

  it('groups sessions under workspace headers in sidebar order', () => {
    const items = paletteItems(sessionsSnap(entries), ws, 'grouped')
    expect(items.map((i) => (i.kind === 'header' ? `H:${i.label}` : i.session.id))).toEqual([
      'H:工作区A', 's2', 's3',
      'H:工作区B', 's1',
    ])
    const header = items[0]
    if (header.kind !== 'header') throw new Error('expected header')
    expect(header.count).toBe(2)
    expect(header.key).toBe('a')
  })

  it('trails an ungrouped section after the workspaces', () => {
    const entriesPlusStray = [...entries, session({ id: 's9', updatedAt: 500 })]
    const items = paletteItems(sessionsSnap(entriesPlusStray), ws, 'grouped')
    const last = items[items.length - 2]
    expect(last).toMatchObject({ kind: 'header', label: '未分组', count: 1 })
    expect(items[items.length - 1]).toMatchObject({ kind: 'row', session: { id: 's9' } })
  })

  it('skips empty workspace sections', () => {
    const items = paletteItems(
      sessionsSnap([session({ id: 's1' })]),
      workspacesSnap([workspace('a', '空区', []), workspace('b', '工作区B', ['s1'])]),
      'grouped',
    )
    expect(items.some((i) => i.kind === 'header' && i.label === '空区')).toBe(false)
  })

  it('renders the flat form without headers', () => {
    const items = paletteItems(sessionsSnap(entries), ws, 'flat')
    expect(items.every((i) => i.kind === 'row')).toBe(true)
    expect(items.map((i) => (i.kind === 'row' ? i.session.id : ''))).toEqual(['s2', 's3', 's1'])
  })
})

describe('archivedSessions', () => {
  it('lists root archived sessions by recency', () => {
    const entries = [
      session({ id: 'a1', updatedAt: 100 }),
      session({ id: 'a2', updatedAt: 300 }),
      session({ id: 'live', updatedAt: 400 }),
    ]
    const ws = workspacesSnap([], { archivedSessionIds: ['a1', 'a2'] })
    expect(archivedSessions(sessionsSnap(entries), ws).map((d) => d.session.id)).toEqual(['a2', 'a1'])
  })

  it('includes archived branch sessions, excludes subagent-origin rows', () => {
    const entries = [
      session({ id: 'a1', parentId: 'root' }),
      session({ id: 'a2', origin: 'subagent' }),
      session({ id: 'a3' }),
    ]
    const ws = workspacesSnap([], { archivedSessionIds: ['a1', 'a2', 'a3'] })
    expect(archivedSessions(sessionsSnap(entries), ws).map((d) => d.session.id)).toEqual(['a1', 'a3'])
  })

  it('decorates archived rows with their pre-archive workspace (archive keeps the sessionIds slot)', () => {
    const entries = [
      session({ id: 'a1' }),
      session({ id: 'a2' }),
    ]
    const ws = workspacesSnap(
      [workspace('w1', '物理备课', ['a1', 'live']), workspace('w2', '开发', ['a2'])],
      { archivedSessionIds: ['a1', 'a2'] },
    )
    const rows = archivedSessions(sessionsSnap(entries), ws)
    expect(rows.find((r) => r.session.id === 'a1')?.workspace).toMatchObject({
      workspaceId: 'w1', title: '物理备课',
    })
    expect(rows.find((r) => r.session.id === 'a2')?.workspace).toMatchObject({
      workspaceId: 'w2', title: '开发',
    })
  })

  it('leaves rows no workspace ever claimed ungrouped', () => {
    const entries = [session({ id: 'a1' })]
    const ws = workspacesSnap([workspace('w1', '工作区', ['live'])], { archivedSessionIds: ['a1'] })
    const rows = archivedSessions(sessionsSnap(entries), ws)
    expect(rows[0]?.workspace).toBeUndefined()
  })
})

describe('rowIndexOf', () => {
  const entries = [
    session({ id: 's1', updatedAt: 100 }),
    session({ id: 's2', updatedAt: 300 }),
    session({ id: 's3', updatedAt: 200 }),
  ]
  const ws = workspacesSnap([workspace('a', '工作区A', ['s2', 's3']), workspace('b', '工作区B', ['s1'])])

  it('counts rows only, skipping section headers', () => {
    const items = paletteItems(sessionsSnap(entries), ws, 'grouped')
    // [H:A, s2, s3, H:B, s1] → row indices: s2=0, s3=1, s1=2
    expect(rowIndexOf(items, 's2')).toBe(0)
    expect(rowIndexOf(items, 's3')).toBe(1)
    expect(rowIndexOf(items, 's1')).toBe(2)
  })

  it('returns -1 for absent or missing session ids', () => {
    const items = paletteItems(sessionsSnap(entries), ws, 'grouped')
    expect(rowIndexOf(items, 'ghost')).toBe(-1)
    expect(rowIndexOf(items, undefined)).toBe(-1)
  })

  it('matches the flat form directly', () => {
    const items = paletteItems(sessionsSnap(entries), ws, 'flat')
    expect(rowIndexOf(items, 's3')).toBe(1)
  })
})

describe('cycleAnchor', () => {
  const entries: DecoratedSession[] = ['a', 'b', 'c'].map((id) => ({ session: session({ id }) }))
  const byId = {
    a: session({ id: 'a' }),
    b: session({ id: 'b' }),
    c: session({ id: 'c' }),
    child: session({ id: 'child', parentId: 'a' }),
  }

  it('uses the current id when it is a list row (forked branches included)', () => {
    expect(cycleAnchor(entries, 'b', byId)).toBe('b')
  })
  it('walks subagent children up to the nearest listed ancestor', () => {
    expect(cycleAnchor(entries, 'child', byId)).toBe('a')
  })
  it('returns undefined for unknown or missing ids', () => {
    expect(cycleAnchor(entries, 'ghost', byId)).toBeUndefined()
    expect(cycleAnchor(entries, undefined, byId)).toBeUndefined()
  })
})

describe('cycleAnchorId', () => {
  const byId = {
    root: session({ id: 'root' }),
    child: session({ id: 'child', parentId: 'root' }),
    grandchild: session({ id: 'grandchild', parentId: 'child' }),
  }

  it('passes a root session id through', () => {
    expect(cycleAnchorId('root', byId)).toBe('root')
  })
  it('walks subagent children up to the root ancestor', () => {
    expect(cycleAnchorId('grandchild', byId)).toBe('root')
  })
  it('returns undefined for unknown or missing ids', () => {
    expect(cycleAnchorId(undefined, byId)).toBeUndefined()
    expect(cycleAnchorId('ghost', byId)).toBeUndefined()
  })
})

describe('offsetTarget', () => {
  const entries: DecoratedSession[] = ['a', 'b', 'c'].map((id) => ({ session: session({ id }) }))

  it('steps forward with wrapping', () => {
    expect(offsetTarget(entries, 'b', 1)?.session.id).toBe('c')
    expect(offsetTarget(entries, 'c', 1)?.session.id).toBe('a')
  })
  it('steps backward with wrapping', () => {
    expect(offsetTarget(entries, 'b', -1)?.session.id).toBe('a')
    expect(offsetTarget(entries, 'a', -1)?.session.id).toBe('c')
  })
  it('lands on the first/last entry when the anchor is unknown', () => {
    expect(offsetTarget(entries, undefined, 1)?.session.id).toBe('a')
    expect(offsetTarget(entries, undefined, -1)?.session.id).toBe('c')
  })
  it('returns undefined for an empty list', () => {
    expect(offsetTarget([], 'a', 1)).toBeUndefined()
  })
})

describe('recencyOrder', () => {
  it('orders sessions globally newest first across workspaces', () => {
    const s1 = session({ id: 's1', updatedAt: 100 })
    const s2 = session({ id: 's2', updatedAt: 500 })
    const s3 = session({ id: 's3', updatedAt: 300 })
    const ws = workspacesSnap([
      workspace('w1', '工作区1', ['s1']),
      workspace('w2', '工作区2', ['s2', 's3']),
    ])
    const order = recencyOrder(sessionsSnap([s1, s2, s3]), ws)
    expect(order.map((e) => e.session.id)).toEqual(['s2', 's3', 's1'])
    expect(order[0].workspace?.workspaceId).toBe('w2')
    expect(order[2].workspace?.workspaceId).toBe('w1')
  })
})

describe('isStaleSession', () => {
  const now = 1000000000
  const staleThreshold = 7 * 24 * 60 * 60 * 1000

  it('marks older sessions as stale', () => {
    const oldSession = session({ id: 'old', updatedAt: now - staleThreshold - 1000 })
    expect(isStaleSession(oldSession, { now, staleMs: staleThreshold })).toBe(true)
  })

  it('marks recent sessions as active', () => {
    const recent = session({ id: 'recent', updatedAt: now - 1000 })
    expect(isStaleSession(recent, { now, staleMs: staleThreshold })).toBe(false)
  })

  it('never marks the current session as stale', () => {
    const oldSession = session({ id: 'cur', updatedAt: now - staleThreshold - 10000 })
    expect(isStaleSession(oldSession, { now, staleMs: staleThreshold, currentId: 'cur' })).toBe(false)
  })

  it('never marks a running session as stale', () => {
    const running = session({ id: 'run', running: true, updatedAt: now - staleThreshold - 10000 })
    expect(isStaleSession(running, { now, staleMs: staleThreshold })).toBe(false)
  })
})

describe('paletteItems with hideStale', () => {
  const now = 1000000000
  const staleThreshold = 7 * 24 * 60 * 60 * 1000

  const active = session({ id: 'active', updatedAt: now - 1000 })
  const old1 = session({ id: 'old1', updatedAt: now - staleThreshold - 1000 })
  const old2 = session({ id: 'old2', updatedAt: now - staleThreshold - 2000 })

  const ws = workspacesSnap([workspace('w1', '工作区', ['active', 'old1', 'old2'])])

  it('folds stale sessions in grouped view when collapsed', () => {
    const items = paletteItems(sessionsSnap([active, old1, old2]), ws, 'grouped', {
      hideStale: true,
      now,
      staleMs: staleThreshold,
    })
    expect(items.some((i) => i.kind === 'header')).toBe(true)
    const rows = items.filter((i) => i.kind === 'row')
    expect(rows.length).toBe(1)
    expect(rows[0].session.id).toBe('active')
    const folded = items.find((i) => i.kind === 'folded')
    expect(folded).toBeDefined()
    if (folded && folded.kind === 'folded') {
      expect(folded.count).toBe(2)
      expect(folded.expanded).toBe(false)
    }
  })

  it('unfolds stale sessions in grouped view when group is expanded', () => {
    const items = paletteItems(sessionsSnap([active, old1, old2]), ws, 'grouped', {
      hideStale: true,
      now,
      staleMs: staleThreshold,
      expandedGroups: new Set(['w1']),
    })
    const rows = items.filter((i) => i.kind === 'row')
    expect(rows.length).toBe(3)
    const folded = items.find((i) => i.kind === 'folded')
    expect(folded).toBeDefined()
    if (folded && folded.kind === 'folded') {
      expect(folded.expanded).toBe(true)
    }
  })

  it('supports recency sort and flat stale folding', () => {
    const items = paletteItems(sessionsSnap([active, old1, old2]), ws, 'flat', {
      sort: 'recency',
      hideStale: true,
      now,
      staleMs: staleThreshold,
    })
    const rows = items.filter((i) => i.kind === 'row')
    expect(rows.length).toBe(1)
    expect(rows[0].session.id).toBe('active')
    const folded = items.find((i) => i.kind === 'folded')
    expect(folded?.kind).toBe('folded')
  })
})

describe('workspaceColorIndex', () => {
  it('returns -1 for undefined or empty workspaceId', () => {
    expect(workspaceColorIndex(undefined)).toBe(-1)
    expect(workspaceColorIndex('')).toBe(-1)
  })

  it('deterministically returns an index between 0 and 7', () => {
    const idx1 = workspaceColorIndex('z3model')
    const idx2 = workspaceColorIndex('z3model')
    expect(idx1).toBe(idx2)
    expect(idx1).toBeGreaterThanOrEqual(0)
    expect(idx1).toBeLessThan(8)

    const other = workspaceColorIndex('dsh-plugin')
    expect(other).toBeGreaterThanOrEqual(0)
    expect(other).toBeLessThan(8)
  })
})

describe('timeRecencyLevel', () => {
  const now = 1000000000
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  it('categorizes recency levels accurately', () => {
    expect(timeRecencyLevel(now - 5 * minute, now)).toBe(0) // < 15m
    expect(timeRecencyLevel(now - 30 * minute, now)).toBe(1) // < 1h
    expect(timeRecencyLevel(now - 3 * hour, now)).toBe(2) // < 6h
    expect(timeRecencyLevel(now - 12 * hour, now)).toBe(3) // < 24h
    expect(timeRecencyLevel(now - 2 * day, now)).toBe(4) // < 3d
    expect(timeRecencyLevel(now - 5 * day, now)).toBe(5) // >= 3d
    expect(timeRecencyLevel(undefined, now)).toBe(5)
  })
})

describe('getWorkspaceHue', () => {
  it('returns null for undefined or blank workspaceId', () => {
    expect(getWorkspaceHue(undefined)).toBeNull()
    expect(getWorkspaceHue('')).toBeNull()
  })

  it('guarantees unique hues across different workspaces in colorMap', () => {
    const colorMap = new Map([
      ['ws_ref', 0],
      ['ws_physics', 1],
      ['ws_suxeca', 2],
      ['ws_z3', 3],
      ['ws_plugin', 4],
    ])
    const hues = Array.from(colorMap.keys()).map((id) => getWorkspaceHue(id, colorMap))
    expect(new Set(hues).size).toBe(5)
    // Adjacent workspaces have large hue distances due to golden angle
    const diff = Math.abs((hues[0] ?? 0) - (hues[1] ?? 0))
    expect(diff).toBeGreaterThan(60)
  })
})

describe('sidebarOrder with pinned sessions', () => {
  it('places pinned sessions first in each workspace regardless of updatedAt', () => {
    const s1 = session({ id: 's1', updatedAt: 500 })
    const s2 = session({ id: 's2', updatedAt: 100 }) // pinned
    const ws = workspacesSnap(
      [workspace('w1', '工作区1', ['s1', 's2'])],
      { pinnedSessionIds: ['s2'] },
    )
    const order = sidebarOrder(sessionsSnap([s1, s2]), ws)
    expect(order.map((e) => e.session.id)).toEqual(['s2', 's1'])
  })
})

describe('pinnedSessions', () => {
  it('returns all visible pinned sessions across workspaces', () => {
    const p1 = session({ id: 'p1', updatedAt: 200 })
    const p2 = session({ id: 'p2', updatedAt: 300 })
    const norm = session({ id: 'norm', updatedAt: 500 })
    const ws = workspacesSnap(
      [workspace('w1', 'W1', ['p1', 'norm']), workspace('w2', 'W2', ['p2'])],
      { pinnedSessionIds: ['p2', 'p1'] },
    )
    const pinned = pinnedSessions(sessionsSnap([p1, p2, norm]), ws)
    expect(pinned.map((e) => e.session.id)).toEqual(['p2', 'p1'])
  })
})

describe('currentSessionId', () => {
  it('prefers hintId when supplied', () => {
    const snap = sessionsSnap([session({ id: 's1' })])
    expect(currentSessionId(snap, 'hint_id')).toBe('hint_id')
  })

  it('prefers explicit list.current when set', () => {
    const snap = sessionsSnap([session({ id: 's1' })], 'explicit_current')
    expect(currentSessionId(snap)).toBe('explicit_current')
  })

  it('identifies the active session via retainedBy.mainView > 0', () => {
    const s1 = session({ id: 's1', retainedBy: {} })
    const s2 = session({ id: 's2', retainedBy: { mainView: 1 } })
    const snap = sessionsSnap([s1, s2])
    expect(currentSessionId(snap)).toBe('s2')
  })

  it('returns undefined when no session is retained by mainView', () => {
    const s1 = session({ id: 's1' })
    const snap = sessionsSnap([s1])
    expect(currentSessionId(snap)).toBeUndefined()
  })
})
