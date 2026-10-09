import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8')

/** Pull a top-level function declaration out of app.js by name. */
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `app.js must declare ${name}()`)
  let depth = 0
  const open = source.indexOf('{', start)
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}()`)
}

const helpers = new Function(
  'state',
  `${extractFunction('sessionIdFromCardId')}
   ${extractFunction('ownedNoteEntries')}
   ${extractFunction('ownedNotePayload')}
   return { sessionIdFromCardId, ownedNoteEntries, ownedNotePayload }`,
)

const session = suffix => `session-00000000-0000-4000-8000-${suffix.padStart(12, '0')}`

function fakeState(loadedSessionIds, notes, foreign = {}) {
  return {
    loadedSessions: new Map(loadedSessionIds.map(id => [id, { messages: [] }])),
    cardNotes: new Map(Object.entries(notes)),
    cardNotesForeign: foreign,
  }
}

test('reads the session id out of every card id shape', () => {
  const { sessionIdFromCardId } = helpers(fakeState([], {}))
  const id = session('1')

  assert.equal(sessionIdFromCardId(`loaded:${id}:turn:42`), id)
  assert.equal(sessionIdFromCardId(`${id}:turn:7`), id)
  assert.equal(sessionIdFromCardId(`loaded:${id}:turn:0`), id)
})

test('reports no session for card ids that name something else', () => {
  const { sessionIdFromCardId } = helpers(fakeState([], {}))

  assert.equal(sessionIdFromCardId('draft:new'), null)
  assert.equal(sessionIdFromCardId(''), null)
  assert.equal(sessionIdFromCardId(null), null)
  assert.equal(sessionIdFromCardId(undefined), null)
  assert.equal(sessionIdFromCardId(42), null)
})

test('a note only travels with a map that holds its session', () => {
  const mine = session('1')
  const other = session('2')
  const state = fakeState([mine], {
    [`loaded:${mine}:turn:1`]: '傅里叶的误差',
    [`loaded:${other}:turn:1`]: 'Q8 gauge',
  })

  const payload = helpers(state).ownedNotePayload()

  assert.deepEqual(Object.keys(payload), [`loaded:${mine}:turn:1`])
  assert.equal(payload[`loaded:${mine}:turn:1`], '傅里叶的误差')
})

test('a note written for a session on the map appears in every map holding it', () => {
  const shared = session('3')
  const { ownedNoteEntries } = helpers(fakeState([shared], { [`loaded:${shared}:turn:9`]: '忠实表示' }))

  assert.deepEqual(ownedNoteEntries(), [[`loaded:${shared}:turn:9`, '忠实表示']])
})

test('notes already stored in this map are echoed back instead of dropped', () => {
  const mine = session('1')
  const orphan = session('9')
  const orphanCard = `loaded:${orphan}:turn:3`
  const state = fakeState(
    [mine],
    { [`loaded:${mine}:turn:1`]: 'mine' },
    { [orphanCard]: '一维和二维的忠实表示的群论定义' },
  )

  const payload = helpers(state).ownedNotePayload()

  // The orphan belongs to a session this map does not hold, yet it survives the
  // write verbatim: no existing note may be dropped by the scoping fix.
  assert.equal(payload[orphanCard], '一维和二维的忠实表示的群论定义')
  assert.equal(payload[`loaded:${mine}:turn:1`], 'mine')
  assert.equal(Object.keys(payload).length, 2)
})

test('an unattributable card id is kept rather than silently discarded', () => {
  const { ownedNotePayload } = helpers(fakeState([], { 'draft:new': '随手记' }))

  assert.equal(ownedNotePayload()['draft:new'], '随手记')
})

test('a map with no notes writes an empty notes object, not a stale one', () => {
  const { ownedNotePayload } = helpers(fakeState([session('1')], {}))

  assert.deepEqual(ownedNotePayload(), {})
})

test('notes are never written before this map has been read from the server', () => {
  const sync = source.slice(source.indexOf('function triggerServerMapSync()'), source.indexOf('/** Pull the server-authoritative map state'))

  // An unguarded write would replace the map file's notes with whatever the
  // client happens to hold, destroying notes it has not read yet.
  assert.match(sync, /state\.cardNotesHydrated/)
  assert.match(sync, /\{ map: mapPayload \}/)
  assert.match(sync, /notes: ownedNotePayload\(\)/)
})

test('the server merge keeps foreign notes out of the editable set', () => {
  const merge = source.slice(source.indexOf('state.cardNotesHydrated = true'), source.indexOf('const changed = JSON.stringify'))

  assert.match(merge, /state\.cardNotesForeign = foreign/)
  assert.match(merge, /!state\.loadedSessions\.has\(sessionId\)/)
  // A note belonging to another map must not count as "unpushed" here, or every
  // map switch would re-broadcast it.
  assert.match(merge, /if \(sessionId !== null && !state\.loadedSessions\.has\(sessionId\)\) continue/)
})

test('switching maps forgets the previous map\'s note bookkeeping', () => {
  const switcher = source.slice(source.indexOf('async function switchMap(id)'), source.indexOf('async function createMap()'))

  assert.match(switcher, /state\.cardNotesForeign = \{\}/)
  assert.match(switcher, /state\.cardNotesHydrated = false/)
})

test('admin surfaces count and export only the notes this map owns', () => {
  assert.match(source, /const noteCount = ownedNoteEntries\(\)\.length/)
  assert.match(source, /cardNotes: ownedNoteEntries\(\),/)
  assert.doesNotMatch(source, /const noteCount = state\.cardNotes\.size/)
  assert.doesNotMatch(source, /cardNotes: \[\.\.\.state\.cardNotes\.entries\(\)\],/)
})
