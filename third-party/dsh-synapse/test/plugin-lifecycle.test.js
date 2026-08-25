import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, name, Config } from '../index.js'

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'synapse-lifecycle-test-'))
  try {
    return await fn(dir)
  } finally {
    // Wait for any pending async store IO to settle before removing temp directory
    await new Promise(resolve => setTimeout(resolve, 50))
    await rm(dir, { recursive: true, force: true })
  }
}

test('plugin export contract adheres to dsh-std / cordis standard', () => {
  assert.equal(name, 'synapse')
  assert.ok(Config, 'Config schema should be exported')
  assert.equal(typeof apply, 'function', 'apply function should be exported')
})

test('plugin boots safely with empty context and empty config (soft degradation / #183 principle)', async () => {
  await withTempDir(async dir => {
    const dataFile = join(dir, 'workspaces.json')
    const mockCtx = {
      get(service, _track) {
        return undefined
      },
      logger: {
        warn() {},
        error() {},
      },
      effect(fn) {
        return fn()
      },
    }

    // Must not throw when webServer / sessions are missing
    assert.doesNotThrow(() => {
      apply(mockCtx, { dataFile })
    })
  })
})

test('plugin registers routes when webServer is present', async () => {
  await withTempDir(async dir => {
    const dataFile = join(dir, 'workspaces.json')
    const registered = []
    const mockWebServer = {
      register(route) {
        registered.push(route)
        return () => {
          const index = registered.indexOf(route)
          if (index !== -1) registered.splice(index, 1)
        }
      }
    }

    const effects = []
    const mockCtx = {
      get(service) {
        if (service === 'webServer') return mockWebServer
        return undefined
      },
      logger: { warn() {}, error() {} },
      effect(fn, label) {
        effects.push(label)
        return fn()
      }
    }

    apply(mockCtx, { dataFile })

    const paths = registered.map(r => r.path)
    assert.ok(paths.includes('/synapse'))
    assert.ok(paths.includes('/synapse/'))
    assert.ok(paths.includes('/synapse/app.js'))
    assert.ok(paths.includes('/synapse/styles.css'))
    assert.ok(paths.includes('/synapse/deepseek-mark.svg'))
    assert.ok(paths.includes('/synapse/api'))
  })
})

test('plugin integrates with tuiStatus seam when running under dsh-TUI', async () => {
  await withTempDir(async dir => {
    const dataFile = join(dir, 'workspaces.json')
    let statusKey = null
    let statusVal = null
    let disposed = false

    const mockTuiStatus = {
      set(key, val) {
        statusKey = key
        statusVal = val
        return () => { disposed = true }
      }
    }

    const disposers = []
    const mockCtx = {
      get(service) {
        if (service === 'tuiStatus') return mockTuiStatus
        return undefined
      },
      logger: { warn() {}, error() {} },
      effect(fn) {
        const res = fn()
        if (typeof res === 'function') disposers.push(res)
      }
    }

    apply(mockCtx, { dataFile })

    assert.equal(statusKey, 'synapse')
    assert.equal(statusVal, '会话地图:就绪')
    assert.equal(disposed, false)

    // Trigger effect cleanup
    for (const d of disposers) d()
    assert.equal(disposed, true)
  })
})

test('dsh-plugin.json manifest exists and is valid Community Draft v0.15 shape', async () => {
  const raw = await readFile(new URL('../dsh-plugin.json', import.meta.url), 'utf8')
  const manifest = JSON.parse(raw)

  assert.equal(manifest.manifestVersion, '0.15')
  assert.equal(manifest.id, 'com.suxeca.dsh-synapse')
  assert.equal(manifest.name, 'dsh-synapse')
  assert.ok(manifest.facets?.host?.entry, 'host facet entry is required')
  assert.equal(manifest.facets?.host?.apiVersion, 'v1alpha1')
  assert.ok(Array.isArray(manifest.requires?.contracts), 'requires.contracts must be array')
})
