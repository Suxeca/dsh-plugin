/**
 * Manager core unit tests: profile read/install/uninstall against a
 * temporary profile directory, plus the default-path derivation.
 * @module dsh-plugin-manager/host/manager.spec
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultProfilePath, installBundle, listBundles, uninstallBundle } from './manager.ts'

const tempDirs: string[] = []

/** Create a temp profile with the given bundles/deps and return its path. */
async function makeProfile(bundles: string[], deps: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pmgr-test-'))
  tempDirs.push(dir)
  const path = join(dir, 'package.json')
  const json = {
    name: 'dsh-profile-web',
    dependencies: deps,
    dsh: { profile: { bundles } },
  }
  await writeFile(path, JSON.stringify(json, null, 2) + '\n', 'utf8')
  return path
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('defaultProfilePath', () => {
  it('prefers DSH_HOME over the OS home directory', () => {
    const previous = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = '/custom/dsh-home'
      expect(defaultProfilePath()).toBe('/custom/dsh-home/.dsh/profiles/web/package.json')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})

describe('listBundles', () => {
  it('returns every bundle with its dependency version', async () => {
    const path = await makeProfile(
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      { '@deepseek-ai/dsh-base': '0.1.0-rc.6', '@deepseek-ai/dsh-web-app': '0.1.0-rc.6' },
    )
    const result = await listBundles(path)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bundles).toEqual([
      { name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.6' },
      { name: '@deepseek-ai/dsh-web-app', version: '0.1.0-rc.6' },
    ])
    expect(result.value.path).toBe(path)
  })

  it('fails cleanly when the profile is missing', async () => {
    const result = await listBundles('/nonexistent/profile/package.json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('profile-not-found')
  })
})

describe('installBundle', () => {
  it('appends the bundle and a default latest dependency', async () => {
    const path = await makeProfile([])
    const result = await installBundle('@suxeca/dsh-plugin-manager', undefined, path)
    expect(result.ok).toBe(true)
    const written = JSON.parse(await readFile(path, 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
      dependencies?: Record<string, string>
    }
    expect(written.dsh?.profile?.bundles).toEqual(['@suxeca/dsh-plugin-manager'])
    expect(written.dependencies?.['@suxeca/dsh-plugin-manager']).toBe('latest')
  })

  it('keeps an explicit version', async () => {
    const path = await makeProfile([])
    const result = await installBundle('@suxeca/dsh-plugin-manager', '0.1.0-rc.4', path)
    expect(result.ok).toBe(true)
    const written = JSON.parse(await readFile(path, 'utf8')) as { dependencies?: Record<string, string> }
    expect(written.dependencies?.['@suxeca/dsh-plugin-manager']).toBe('0.1.0-rc.4')
  })

  it('rejects a duplicate bundle', async () => {
    const path = await makeProfile(['@suxeca/dsh-plugin-manager'])
    const result = await installBundle('@suxeca/dsh-plugin-manager', undefined, path)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('already-installed')
  })

  it('rejects an empty name', async () => {
    const path = await makeProfile([])
    const result = await installBundle('   ', undefined, path)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('name-required')
  })
})

describe('uninstallBundle', () => {
  it('removes the bundle and its dependency', async () => {
    const path = await makeProfile(['@suxeca/dsh-plugin-manager', '@deepseek-ai/dsh-base'], {
      '@suxeca/dsh-plugin-manager': 'latest',
      '@deepseek-ai/dsh-base': '0.1.0-rc.6',
    })
    const result = await uninstallBundle('@suxeca/dsh-plugin-manager', path)
    expect(result.ok).toBe(true)
    const written = JSON.parse(await readFile(path, 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
      dependencies?: Record<string, string>
    }
    expect(written.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
    expect(written.dependencies?.['@suxeca/dsh-plugin-manager']).toBeUndefined()
    expect(written.dependencies?.['@deepseek-ai/dsh-base']).toBe('0.1.0-rc.6')
  })

  it('rejects a bundle that is not installed', async () => {
    const path = await makeProfile([])
    const result = await uninstallBundle('@suxeca/dsh-missing', path)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not-installed')
  })
})
