/**
 * Unit tests for the pure switcher helpers: title projection, relative
 * time, turn count, the sidebar-faithful ordering/grouping, the archived
 * list, the cycle anchor, and the cycle-gesture target.
 * @module tests/utils.spec
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archivedSessions,
  cycleAnchor,
  cycleAnchorId,
  offsetTarget,
  paletteItems,
  relTime,
  rowIndexOf,
  sidebarOrder,
  titleOf,
  turnCountOf,
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
