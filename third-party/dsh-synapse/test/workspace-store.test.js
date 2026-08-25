import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspaceStore } from '../index.js'

test('persists a workspace, a DSH-linked thread, and a message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-'))
  const dataFile = join(directory, 'state.json')
  const store = new WorkspaceStore(dataFile)
  const workspace = await store.create('调研 DSH 插件')
  const thread = await store.createThread(workspace.id, { title: 'DSH 会话', dshSessionId: 'session-1' })
  await store.addMessage(thread.id, '确定使用已有 Web Server')

  const saved = await new WorkspaceStore(dataFile).get(workspace.id)
  assert.equal(saved.title, '调研 DSH 插件')
  assert.equal(saved.threads[0].dshSessionId, 'session-1')
  assert.equal(saved.threads[0].messages[0].text, '确定使用已有 Web Server')
  assert.match(await readFile(dataFile, 'utf8'), /"version": 4/)
})

test('projects committed DSH events once, folds tool process into the assistant card, and keeps fork lineage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-projection-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const parent = {
    id: 'session-parent', header: {}, firstLiveSeq: 0,
    events: [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '分析登录异常' }] } },
      { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '我来检查。' }] } } },
      { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"cmd":"pnpm test"}' } },
      { type: 'tool/result', seq: 3, time: 4, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
    ],
  }
  await store.projectSession(parent)
  await store.projectEvent(parent, parent.events[2])
  const child = { id: 'session-child', header: { parentSession: 'session-parent' }, firstLiveSeq: 4, events: [] }
  await store.projectSession(child, child.firstLiveSeq)

  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const parentThread = graph.threads.find(thread => thread.dshSessionId === 'session-parent')
  const childThread = graph.threads.find(thread => thread.dshSessionId === 'session-child')
  assert.equal(workspace.title, 'DSH 任务')
  assert.equal(parentThread.messages.length, 2)
  assert.equal(parentThread.messages[0].kind, 'user')
  assert.equal(parentThread.messages[1].kind, 'assistant')
  assert.equal(parentThread.messages[1].process.length, 1)
  assert.equal(parentThread.messages[1].process[0].name, 'bash')
  assert.equal(parentThread.messages[1].process[0].result, 'ok')
  assert.equal(parentThread.messages[1].process[0].error, null)
  assert.equal(childThread.parentId, parentThread.id)
})

test('projects a batch of session events in a single write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-batch-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const session = {
    id: 'session-batch', header: { meta: { cwd: 'C:\\work\\batch' } }, firstLiveSeq: 0,
    events: [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '批量问题' }] } },
      { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '批量回答' }] } } },
      { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } },
      { type: 'tool/result', seq: 3, time: 4, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
    ],
  }
  await store.projectEvents(session, session.events)
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const thread = graph.threads[0]
  assert.equal(thread.messages.length, 2)
  assert.equal(thread.messages[0].text, '批量问题')
  assert.equal(thread.messages[1].process.length, 1)
  assert.equal(thread.messages[1].process[0].result, 'ok')
  assert.match(await readFile(join(directory, 'state.json'), 'utf8'), /"version": 4/)
})

test('migrates v3 tool cards into the assistant process records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-migrate-'))
  const dataFile = join(directory, 'state.json')
  await writeFile(dataFile, JSON.stringify({
    version: 3,
    hiddenSessionIds: [],
    workspaces: [{
      id: 'w-1', kind: 'dsh', cwd: 'C:\\work\\migrate', title: 'migrate',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      threads: [{
        id: 't-1', title: '会话', parentId: null, dshSessionId: 's-1', dshSessionTitle: null,
        color: '#0f766e', position: { x: 86, y: 82 }, sourceSeedLength: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [
          { id: 'm-1', kind: 'user', text: '帮我检查', at: '2026-01-01T00:00:00.000Z' },
          { id: 'm-2', kind: 'assistant', text: '好的。', at: '2026-01-01T00:00:00.100Z' },
          { id: 'm-3', kind: 'tool', text: 'read\n{"file_path":"a.js"}', at: '2026-01-01T00:00:00.200Z' },
          { id: 'm-4', kind: 'tool-result', text: 'file content', at: '2026-01-01T00:00:00.300Z' },
          { id: 'm-5', kind: 'tool', text: 'bash\n{"cmd":"pwd"}', at: '2026-01-01T00:00:00.400Z' },
        ],
      }],
    }],
  }, null, 2))
  const store = new WorkspaceStore(dataFile)
  const graph = await store.get('w-1')
  const thread = graph.threads[0]
  assert.equal(thread.messages.length, 2)
  assert.equal(thread.messages[1].process.length, 2)
  assert.equal(thread.messages[1].process[0].name, 'read')
  assert.equal(thread.messages[1].process[0].arguments, '{"file_path":"a.js"}')
  assert.equal(thread.messages[1].process[0].result, 'file content')
  assert.equal(thread.messages[1].process[1].name, 'bash')
  assert.equal(thread.messages[1].process[1].result, null)
  assert.match(await readFile(dataFile, 'utf8'), /"version": 4/)
})

test('does not persist the DSH runtime context as a user conversation turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-runtime-context-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.projectSession({
    id: 'runtime-context', header: { meta: { cwd: 'C:\\work\\canvas' } }, firstLiveSeq: 0,
    events: [
      { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '你好' }] } },
      { type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\\nPolicy.' }] } },
      { type: 'assistant/message', seq: 3, time: 3, data: { message: { content: [{ type: 'text', text: '你好，我是助手。' }] } } },
    ],
  })

  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  assert.deepEqual(graph.threads[0].messages.map(message => message.text), ['你好', '你好，我是助手。'])
})

test('merges a browser fork callback with an already projected DSH fork', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-fork-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const parent = { id: 'parent', header: {}, firstLiveSeq: 0, events: [] }
  const child = { id: 'child', header: { parentSession: 'parent' }, firstLiveSeq: 0, events: [] }
  const parentThread = await store.projectSession(parent)
  await store.projectSession(child, child.firstLiveSeq)
  const merged = await store.branch(parentThread.id, { title: '替代方案', dshSessionId: 'child', dshSessionTitle: '替代方案' })
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  assert.equal(graph.threads.length, 2)
  assert.equal(merged.dshSessionId, 'child')
  assert.equal(merged.parentId, parentThread.id)
})

test('groups DSH sessions by their working directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-cwd-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.projectSession({ id: 'alpha', header: { meta: { cwd: 'C:\\work\\alpha' } }, firstLiveSeq: 0, events: [] })
  await store.projectSession({ id: 'beta', header: { meta: { cwd: 'C:\\work\\beta' } }, firstLiveSeq: 0, events: [] })
  const workspaces = await store.list()
  assert.equal(workspaces.length, 2)
  assert.deepEqual(new Set(workspaces.map(workspace => workspace.cwd)), new Set(['C:\\work\\alpha', 'C:\\work\\beta']))
})

test('syncs non-blank DSH sessions into the matching canvas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-sync-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.syncSessions([
    { id: 'blank', title: '空会话', cwd: 'C:\\work\\canvas', blank: true },
    { id: 'parent', title: '主问题', cwd: 'C:\\work\\canvas', blank: false },
    { id: 'child', title: '替代路线', cwd: 'C:\\work\\canvas', parentId: 'parent', blank: false },
  ])
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  const parent = graph.threads.find(thread => thread.dshSessionId === 'parent')
  const child = graph.threads.find(thread => thread.dshSessionId === 'child')
  assert.equal(graph.threads.length, 2)
  assert.equal(parent.title, '主问题')
  assert.equal(child.parentId, parent.id)
})

test('keeps DSH projection coordinates neutral instead of stacking by historical session count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-neutral-position-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.syncSessions([
    { id: 'first', title: '第一条', cwd: 'C:\\work\\canvas', blank: false },
    { id: 'second', title: '第二条', cwd: 'C:\\work\\canvas', blank: false },
  ])
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)

  assert.deepEqual(graph.threads.map(thread => thread.position), [{ x: 86, y: 82 }, { x: 86, y: 82 }])
})

test('removes the canvas node when DSH removes the session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-removed-session-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.syncSessions([{ id: 'removed', title: '将被归档', cwd: 'C:\\work\\canvas', blank: false }])
  await store.syncSessions([], ['removed'])
  assert.equal((await store.list()).length, 0)
})

test('removing a DSH node prevents replay from restoring it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-remove-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const session = { id: 'remove-me', header: { meta: { cwd: 'C:\\work\\remove' } }, firstLiveSeq: 0, events: [] }
  const thread = await store.projectSession(session)
  await store.removeThread(thread.id)
  await store.projectSession(session)
  assert.equal((await store.list()).length, 0)
})

test('archived canvas nodes stay hidden during a later DSH session sync', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-archive-sync-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const session = { id: 'archived', title: '已归档', cwd: 'C:\\work\\archive', blank: false }
  await store.syncSessions([session])
  const [workspace] = await store.list()
  const graph = await store.get(workspace.id)
  await store.removeThread(graph.threads[0].id)
  await store.syncSessions([session])
  assert.equal((await store.list()).length, 0)
})

test('DSH-archived sessions never become canvas nodes and are pruned when already present', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-dsh-archive-sync-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  const session = { id: 'dsh-archived', title: '原生归档', cwd: 'C:\\work\\dsh-archive', blank: false }
  // First sync without the archive set: the session becomes a node.
  await store.syncSessions([session])
  assert.equal((await store.list()).length, 1)
  // A later DSH archive reports the id; the node must be pruned and not re-created.
  await store.syncSessions([session], [], ['dsh-archived'])
  assert.equal((await store.list()).length, 0)
  // The archive mirror is persisted: even a fresh sync that still lists the
  // session must keep it off the canvas.
  await store.syncSessions([session], [], ['dsh-archived'])
  assert.equal((await store.list()).length, 0)
})

test('projection skips sessions archived natively in DSH', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-dsh-archive-proj-'))
  const store = new WorkspaceStore(join(directory, 'state.json'))
  await store.syncSessions([], [], ['proj-archived'])
  const session = { id: 'proj-archived', header: { meta: { cwd: 'C:\\work\\proj' } }, firstLiveSeq: 0, events: [] }
  await store.projectSession(session)
  assert.equal((await store.list()).length, 0)
})

test('drag-only mode never creates server projection threads and cleans legacy DSH workspaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-dragonly-'))
  const store = new WorkspaceStore(join(directory, 'state.json'), false)
  const session = { id: 'drag-only', title: '只拖入', cwd: 'C:\\work\\drag', blank: false }
  // syncSessions must not create any thread in drag-only mode.
  await store.syncSessions([session])
  assert.equal((await store.list()).length, 0)
  // Legacy auto-projected DSH workspaces are cleaned up on the next sync.
  const legacy = new WorkspaceStore(join(directory, 'state.json'))
  await legacy.syncSessions([{ id: 'legacy', title: '旧', cwd: 'C:\\work\\legacy', blank: false }])
  assert.equal((await legacy.list()).length, 1)
  const dragOnly = new WorkspaceStore(join(directory, 'state.json'), false)
  await dragOnly.syncSessions([{ id: 'legacy', title: '旧', cwd: 'C:\\work\\legacy', blank: false }])
  assert.equal((await dragOnly.list()).length, 0)
})

test('drag-only sync with no actual change does not rewrite the data file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-nosave-'))
  const dataFile = join(directory, 'state.json')
  const store = new WorkspaceStore(dataFile, false)
  // First sync writes the file (archive mirror empty -> empty, no dsh workspaces -> no change,
  // so even the first call may skip write; force a real change first via archive mirror).
  await store.syncSessions([], [], [])
  const first = await stat(dataFile)
  await new Promise(resolve => setTimeout(resolve, 20))
  // Same payload again: nothing changed -> must NOT write.
  await store.syncSessions([], [], [])
  const second = await stat(dataFile)
  assert.equal(second.mtimeMs, first.mtimeMs)
  // Changing the archive set DOES write.
  await store.syncSessions([], [], ['new-archived'])
  const third = await stat(dataFile)
  assert.notEqual(third.mtimeMs, second.mtimeMs)
})

test('server map state persists and round-trips across store instances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-map-'))
  const dataFile = join(directory, 'state.json')
  const store = new WorkspaceStore(dataFile, false)
  const map = {
    'session-a': { messages: [{ kind: 'user', text: 'hi', at: '2026-01-01T00:00:00.000Z', sourceSeq: 1 }], cachedAt: 123, title: 'A' },
    'session-b': { messages: [], cachedAt: 456, title: 'B', parentId: 'loaded:session-a', sourceSeedLength: 3 },
  }
  await store.setMap(map)
  assert.deepEqual(await store.getMap(), map)
  // Card notes also persist and round-trip across store instances for remote sync.
  const notes = { 'loaded:session-a:turn:1': '这是第一条核心架构决策' }
  await store.setNotes(notes)
  assert.deepEqual(await store.getNotes(), notes)
  // A fresh store instance reads the same server map and notes (shared across devices).
  const reloaded = new WorkspaceStore(dataFile, false)
  assert.deepEqual(await reloaded.getMap(), map)
  assert.deepEqual(await reloaded.getNotes(), notes)
})
