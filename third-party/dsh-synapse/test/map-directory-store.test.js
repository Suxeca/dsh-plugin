import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MapDirectoryStore } from '../map-store.js'

const legacy = (mapState = {}, cardNotes = {}) => ({ ready: Promise.resolve(), state: { mapState, cardNotes } })

test('migrates legacy map state once into a default named map without modifying legacy data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-maps-'))
  const old = { alpha: { title: 'old' } }
  const store = new MapDirectoryStore(directory, legacy(old, { note: 'keep' }))
  assert.deepEqual(await store.getState(), { map: old, notes: { note: 'keep' }, activeMap: { id: 'default', title: '默认地图', createdAt: (await store.list())[0].createdAt, updatedAt: (await store.list())[0].updatedAt, active: true } })
  assert.deepEqual(old, { alpha: { title: 'old' } })
  assert.equal((await readFile(join(directory, 'index.json'), 'utf8')).includes('default'), true)
})

test('creates, selects, and persists isolated named maps across store instances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-maps-'))
  const first = new MapDirectoryStore(directory, legacy({ legacy: {} }))
  await first.ready
  const created = await first.create('研究分支')
  await first.select(created.id)
  await first.setState({ branch: { title: 'B' } }, { card: 'note' })
  const reloaded = new MapDirectoryStore(directory, legacy({ shouldNot: 'replace' }))
  const maps = await reloaded.list()
  assert.equal(maps.find(map => map.id === created.id).active, true)
  assert.deepEqual((await reloaded.getState()).map, { branch: { title: 'B' } })
  await reloaded.select('default')
  assert.deepEqual((await reloaded.getState()).map, { legacy: {} })
})

test('renames and deletes named maps while updating active selection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-maps-'))
  const store = new MapDirectoryStore(directory, legacy())
  await store.ready
  const created = await store.create('待重命名地图')
  const renamed = await store.rename(created.id, '新名称地图')
  assert.equal(renamed.title, '新名称地图')
  assert.equal((await store.list()).find(m => m.id === created.id).title, '新名称地图')

  await store.select(created.id)
  const delResult = await store.delete(created.id)
  assert.equal(delResult.deleted, true)
  assert.equal(delResult.activeMapId, 'default')
  assert.equal((await store.list()).length, 1)

  // Cannot delete the only remaining map
  await assert.rejects(store.delete('default'), /不能删除唯一的地图/)
})

test('rejects unsafe ids and titles and leaves its index readable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-maps-'))
  const store = new MapDirectoryStore(directory, legacy())
  await assert.rejects(store.select('../escape'), /id 无效/)
  await assert.rejects(store.create('   '), /不能为空/)
  await assert.rejects(store.create('x'.repeat(121)), /不能超过/)
  const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))
  assert.equal(index.activeMapId, 'default')
})

test('fails safely when an existing index is malformed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-synapse-maps-'))
  await writeFile(join(directory, 'index.json'), '{"version":1,"maps":[]}')
  const store = new MapDirectoryStore(directory, legacy())
  await assert.rejects(store.list(), /地图索引/)
})
