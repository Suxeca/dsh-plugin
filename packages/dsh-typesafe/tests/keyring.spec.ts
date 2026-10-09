/**
 * @suxeca/dsh-typesafe — 密钥解析单元测试（契约 E / keyring）。
 *
 * 为什么这样测：这一层决定「设置页能不能保存」和「错误消息里会不会漏密钥」，
 * 后者是安全红线而不是功能细节。所以测试分两类：一类用桩 provider 精确控制
 * describe/resolve/set/unset 的返回值与抛错，断言三态（env / credential / none）
 * 与写入前的遮蔽规则；另一类专门用「形如 apikey_ 的哨兵」驱动每条错误路径，
 * 断言它绝不出现在任何 Error message 里。env 表一律显式注入，绝不读真实进程环境，
 * 因此结果与运行机器无关。
 *
 * @module @suxeca/dsh-typesafe/tests/keyring.spec
 */

import { describe, expect, it } from 'vitest'

import { CREDENTIAL_REF } from '../src/shared.ts'
import { Keyring } from '../src/host/keyring.ts'
import type { CredentialProviderLike } from '../src/host/keyring.ts'

/** 哨兵密钥：用它驱动错误路径，再断言它绝不回显。 */
const SENTINEL_KEY = 'apikey_ts_keyring_sentinel_0001'

/** 第二个密钥：用来区分「env 里那份」与「credentials 里那份」。 */
const OTHER_KEY = 'apikey_ts_keyring_other_0002'

/** 桩 provider 的行为脚本。 */
interface ProviderScript {
  /** `describe` 的成功返回；缺省为「未配置但可写」。 */
  describeInfo?: { configured: boolean; source?: string; writable: boolean }
  /** `describe` 抛出的错误。 */
  describeError?: unknown
  /** `resolve` 的成功返回；缺省 undefined（未配置）。 */
  resolveValue?: { value: string; source: string }
  /** `resolve` 抛出的错误。 */
  resolveError?: unknown
  /** `set` 抛出的错误。 */
  setError?: unknown
  /** `unset` 抛出的错误。 */
  unsetError?: unknown
}

/** 桩 provider 与它收到的调用记录。 */
interface ScriptedProvider {
  readonly provider: CredentialProviderLike
  readonly refs: {
    readonly describe: string[]
    readonly resolve: string[]
    readonly set: { readonly ref: string; readonly value: string }[]
    readonly unset: string[]
  }
}

/**
 * 造一个记录型 credentials 桩：行为由脚本决定，调用全部留痕。
 *
 * @param script - 每个方法返回什么或抛什么。
 * @returns 结构上满足 `CredentialProviderLike` 的桩与调用记录。
 */
function scriptedProvider(script: ProviderScript): ScriptedProvider {
  const describeRefs: string[] = []
  const resolveRefs: string[] = []
  const setCalls: { ref: string; value: string }[] = []
  const unsetRefs: string[] = []

  const provider: CredentialProviderLike = {
    async describe(ref: string) {
      describeRefs.push(ref)
      if (script.describeError !== undefined) throw script.describeError
      return script.describeInfo ?? { configured: false, writable: true }
    },
    async resolve(ref: string) {
      resolveRefs.push(ref)
      if (script.resolveError !== undefined) throw script.resolveError
      return script.resolveValue
    },
    async set(ref: string, value: string) {
      setCalls.push({ ref, value })
      if (script.setError !== undefined) throw script.setError
    },
    async unset(ref: string) {
      unsetRefs.push(ref)
      if (script.unsetError !== undefined) throw script.unsetError
    },
  }

  return { provider, refs: { describe: describeRefs, resolve: resolveRefs, set: setCalls, unset: unsetRefs } }
}

/**
 * 取 promise 的拒绝原因，供断言 message 用。
 *
 * @param call - 预期会失败的 promise。
 * @returns 拒绝原因（通常在 `unknown` 上，需自行收窄）。
 */
async function failureOf(call: Promise<void>): Promise<unknown> {
  try {
    await call
  } catch (error) {
    return error
  }
  throw new Error('expected the call to reject')
}

/** 把拒绝原因压成可断言的文本（非 Error 时为空串）。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

describe('Keyring.read', () => {
  it('prefers the environment value and marks it read-only', async () => {
    const { provider } = scriptedProvider({
      describeInfo: { configured: true, writable: true },
      resolveValue: { value: OTHER_KEY, source: 'credentials' },
    })
    const ring = new Keyring(provider, CREDENTIAL_REF, { [CREDENTIAL_REF]: SENTINEL_KEY })

    const result = await ring.read()

    expect(result.key).toBe(SENTINEL_KEY)
    expect(result.state).toEqual({ configured: true, source: 'env', writable: false })
    expect(result.error).toBeUndefined()
  })

  it('treats a blank environment value as unconfigured and falls back to credentials', async () => {
    const { provider, refs } = scriptedProvider({
      describeInfo: { configured: true, writable: true },
      resolveValue: { value: OTHER_KEY, source: 'credentials' },
    })
    const ring = new Keyring(provider, CREDENTIAL_REF, { [CREDENTIAL_REF]: '   ' })

    const result = await ring.read()

    expect(result.key).toBe(OTHER_KEY)
    expect(result.state).toEqual({ configured: true, source: 'credential', writable: true })
    expect(refs.resolve).toEqual([CREDENTIAL_REF])
    expect(refs.describe).toEqual([CREDENTIAL_REF])
  })

  it('reports a credential key as read-only when describe says so', async () => {
    const { provider } = scriptedProvider({
      describeInfo: { configured: true, writable: false },
      resolveValue: { value: SENTINEL_KEY, source: 'credentials' },
    })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    const result = await ring.read()

    expect(result.key).toBe(SENTINEL_KEY)
    expect(result.state).toEqual({ configured: true, source: 'credential', writable: false })
  })

  it('reports unconfigured when credentials resolves nothing', async () => {
    const { provider } = scriptedProvider({
      describeInfo: { configured: false, writable: false },
      resolveValue: undefined,
    })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    const result = await ring.read()

    expect(result.key).toBeUndefined()
    expect(result.state).toEqual({ configured: false, source: 'none', writable: false })
    expect(result.error).toBeUndefined()
  })

  it('downgrades to read-only with a redacted error when describe fails', async () => {
    const { provider } = scriptedProvider({
      describeError: new Error(`credentials backend rejected ${SENTINEL_KEY}`),
      resolveValue: { value: SENTINEL_KEY, source: 'credentials' },
    })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    const result = await ring.read()

    expect(result.key).toBe(SENTINEL_KEY)
    expect(result.state).toEqual({ configured: true, source: 'credential', writable: false })
    expect(result.error).toBeDefined()
    expect(result.error).not.toContain(SENTINEL_KEY)
  })

  it('reports an error and no key when credentials is not mounted', async () => {
    const ring = new Keyring(undefined, CREDENTIAL_REF, {})

    const result = await ring.read()

    expect(result.key).toBeUndefined()
    expect(result.state).toEqual({ configured: false, source: 'none', writable: false })
    expect(result.error).toContain('credentials 服务')
  })

  it('surfaces a redacted error instead of throwing when resolve fails', async () => {
    const { provider } = scriptedProvider({
      describeInfo: { configured: false, writable: false },
      resolveError: new Error(`vault unavailable for ${SENTINEL_KEY}`),
    })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    const result = await ring.read()

    expect(result.key).toBeUndefined()
    expect(result.error).toBeDefined()
    expect(result.error).not.toContain(SENTINEL_KEY)
  })

  it('re-reads the key on every call instead of caching it', async () => {
    const script: ProviderScript = {
      describeInfo: { configured: true, writable: true },
      resolveValue: { value: SENTINEL_KEY, source: 'credentials' },
    }
    const { provider } = scriptedProvider(script)
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    expect((await ring.read()).key).toBe(SENTINEL_KEY)
    script.resolveValue = { value: OTHER_KEY, source: 'credentials' }
    expect((await ring.read()).key).toBe(OTHER_KEY)
  })
})

describe('Keyring.save', () => {
  it('refuses to write while the environment shadows credentials', async () => {
    const { provider, refs } = scriptedProvider({ describeInfo: { configured: true, writable: true } })
    const ring = new Keyring(provider, CREDENTIAL_REF, { [CREDENTIAL_REF]: SENTINEL_KEY })

    const failure = await failureOf(ring.save(OTHER_KEY))
    const message = messageOf(failure)

    expect(message).toContain('只读')
    expect(message).not.toContain(OTHER_KEY)
    expect(message).not.toContain(SENTINEL_KEY)
    expect(refs.set).toHaveLength(0)
  })

  it('refuses to write when the provider reports it as read-only', async () => {
    const { provider, refs } = scriptedProvider({ describeInfo: { configured: true, writable: false } })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    await expect(ring.save(SENTINEL_KEY)).rejects.toThrow('只读')
    expect(refs.set).toHaveLength(0)
  })

  it('refuses to write when credentials is not mounted', async () => {
    const ring = new Keyring(undefined, CREDENTIAL_REF, {})

    await expect(ring.save(SENTINEL_KEY)).rejects.toThrow('未挂载 credentials 服务')
  })

  it('refuses blank or whitespace-bearing keys', async () => {
    const { provider, refs } = scriptedProvider({ describeInfo: { configured: true, writable: true } })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    for (const invalid of ['', '   ', 'has space', 'line\nbreak']) {
      await expect(ring.save(invalid)).rejects.toThrow('密钥为空或含空白字符')
    }
    expect(refs.set).toHaveLength(0)
  })

  it('stores the trimmed value through the provider and re-reads afterwards', async () => {
    const { provider, refs } = scriptedProvider({
      describeInfo: { configured: false, writable: true },
      resolveValue: undefined,
    })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    await ring.save(`  ${SENTINEL_KEY}  `)

    expect(refs.set).toEqual([{ ref: CREDENTIAL_REF, value: SENTINEL_KEY }])
    expect(refs.resolve).toHaveLength(1)
  })

  it('never leaks the key through a provider write failure', async () => {
    const { provider } = scriptedProvider({
      describeInfo: { configured: true, writable: true },
      setError: new Error(`write failed for ${SENTINEL_KEY}`),
    })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    const failure = await failureOf(ring.save(SENTINEL_KEY))
    const message = messageOf(failure)

    expect(message).not.toContain(SENTINEL_KEY)
  })
})

describe('Keyring.clear', () => {
  it('deletes the reference through the provider', async () => {
    const { provider, refs } = scriptedProvider({ describeInfo: { configured: true, writable: true } })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    await ring.clear()

    expect(refs.unset).toEqual([CREDENTIAL_REF])
  })

  it('refuses to clear while the environment shadows credentials', async () => {
    const { provider, refs } = scriptedProvider({ describeInfo: { configured: true, writable: true } })
    const ring = new Keyring(provider, CREDENTIAL_REF, { [CREDENTIAL_REF]: SENTINEL_KEY })

    const failure = await failureOf(ring.clear())

    expect(messageOf(failure)).toContain('只读')
    expect(refs.unset).toHaveLength(0)
  })

  it('refuses to clear when credentials is not mounted', async () => {
    const ring = new Keyring(undefined, CREDENTIAL_REF, {})

    await expect(ring.clear()).rejects.toThrow('未挂载 credentials 服务')
  })
})

describe('Keyring.looksValid', () => {
  it('accepts non-empty values without internal whitespace', () => {
    expect(Keyring.looksValid('apikey_abc123')).toBe(true)
    expect(Keyring.looksValid('  padded  ')).toBe(true)
  })

  it('rejects blank values and internal whitespace', () => {
    expect(Keyring.looksValid('')).toBe(false)
    expect(Keyring.looksValid('   ')).toBe(false)
    expect(Keyring.looksValid('has space')).toBe(false)
    expect(Keyring.looksValid('tab\there')).toBe(false)
  })
})

/**
 * 软依赖的挂载时序：返回取值函数的来源必须**每次现取**。
 *
 * 为什么值得单列一组：`credentials` 对本插件是软依赖，挂载时刻不由本插件决定，
 * 运行期注入的实例更是一定晚于宿主服务。若在 `apply()` 里读一次就把服务本体缓存，
 * 那么「那一刻恰好还没挂载」会退化成永久失效——而表现是静默的（工具 no-key、
 * 分流 fail-open、状态页只显示未配置），线上极难定位。这组测试锁住现取语义。
 */
describe('Keyring credential source resolution', () => {
  it('sees a provider that appears only after construction', async () => {
    const { provider } = scriptedProvider({
      describeInfo: { configured: true, writable: true },
      resolveValue: { value: SENTINEL_KEY, source: 'credentials' },
    })
    let mounted: CredentialProviderLike | undefined
    const ring = new Keyring(() => mounted, CREDENTIAL_REF, {})

    // 构造后立刻读：此刻还没挂载，应当如实报告未配置。
    expect((await ring.read()).state.configured).toBe(false)

    // 服务挂上来了 —— 同一个 Keyring 实例必须能看见它，无需重建。
    mounted = provider
    const after = await ring.read()
    expect(after.key).toBe(SENTINEL_KEY)
    expect(after.state).toEqual({ configured: true, source: 'credential', writable: true })
  })

  it('does not cache the provider reference across operations', async () => {
    const first = scriptedProvider({ describeInfo: { configured: true, writable: true } })
    const second = scriptedProvider({
      describeInfo: { configured: true, writable: true },
      resolveValue: { value: OTHER_KEY, source: 'credentials' },
    })
    let current: CredentialProviderLike | undefined = first.provider
    const ring = new Keyring(() => current, CREDENTIAL_REF, {})

    await ring.read()
    current = second.provider
    const result = await ring.read()

    expect(result.key).toBe(OTHER_KEY)
    expect(second.refs.resolve).toEqual([CREDENTIAL_REF])
    expect(first.refs.resolve).toEqual([CREDENTIAL_REF])
  })

  it('still accepts a plain provider reference', async () => {
    const { provider } = scriptedProvider({
      describeInfo: { configured: true, writable: true },
      resolveValue: { value: SENTINEL_KEY, source: 'credentials' },
    })
    const ring = new Keyring(provider, CREDENTIAL_REF, {})

    expect((await ring.read()).key).toBe(SENTINEL_KEY)
  })

  it('reports unmounted and refuses to save while the getter yields nothing', async () => {
    const ring = new Keyring(() => undefined, CREDENTIAL_REF, {})

    const failure = await failureOf(ring.save(SENTINEL_KEY))

    expect(messageOf(failure)).toContain('未挂载 credentials 服务')
  })

  it('saves through a provider the getter only yields on the second look', async () => {
    const { provider, refs } = scriptedProvider({ describeInfo: { configured: true, writable: true } })
    let mounted: CredentialProviderLike | undefined
    const ring = new Keyring(() => mounted, CREDENTIAL_REF, {})

    mounted = provider
    await ring.save(SENTINEL_KEY)

    expect(refs.set).toEqual([{ ref: CREDENTIAL_REF, value: SENTINEL_KEY }])
  })
})
