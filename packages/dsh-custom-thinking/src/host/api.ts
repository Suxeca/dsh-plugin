/**
 * /custom-thinking JSON API：读取 llm-pi-ai 配置下的自定义提供商模型思考配置，
 * 并把 UI 的操作折叠为最小 settings path ops 落盘。
 * 该 namesapce 已由 llm-pi-ai 插件注册（含 schema 校验与 assertServiceable），
 * `settings.mutate` 会做合法性与可服务性验证，写坏即拒——这里只产出合法结构。
 * @module dsh-custom-thinking/host/api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  ApplyOp, ApplyRequest, Envelope, ModelRow, ProviderRow, ThinkingLevel, ThinkingState, WireSpellings,
} from '../shared/types.ts'
import {
  collapseEfforts, isThinkingConfig, preparedModels, standardEfforts, withAllModelEfforts, withModelEfforts,
  type ModelLike,
} from './reasoning.ts'
import { isTrustedApiRequest } from './trust-fence.ts'

/** Host 端需要的最小服务面（结构类型，编译期从运行库解析）。 */
export interface HostContext {
  /** webServer 路由表。 */
  webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  /** settings 服务：读 resolved / 写 path ops。 */
  settings: {
    get(ns: string): unknown
    mutate(ns: string, ops: readonly { op: 'set' | 'unset'; path: string[]; value?: unknown }[], expectedRevision?: number): Promise<void>
  }
  /** 可选服务（不需要即不注入）。 */
  get(name: string): unknown
  logger: { warn(message: string): void; error?(message: unknown): void }
}

/** settings 里一条 path op。 */
type PathOp = { op: 'set' | 'unset'; path: string[]; value?: unknown }

/** llm-pi-ai resolved 配置的结构子集。 */
interface ConfigLike {
  providers?: Record<string, ProviderProfileLike>
}
interface ProviderProfileLike {
  displayName?: string
  api?: string
  baseURL?: string
  reasoning?: string
  compat?: { supportsReasoningEffort?: boolean; thinkingFormat?: string; [key: string]: unknown }
  models?: ModelEntry[]
  modelOverrides?: Record<string, unknown>
}
interface ModelEntry {
  id: string
  name?: string
  reasoningEfforts?: unknown
  [key: string]: unknown
}

/** llm 服务：读模型的实际 reasoning 元数据（advisory）。 */
interface LlmLike {
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<{
    reasoning?: { efforts: readonly { id: string }[]; defaultEffort?: string }
  }>
}

/** 已解析配置快照（本次 GET/apply 的单一事实源）。 */
interface Snapshot {
  providers: Record<string, ProviderProfileLike>
}

function readSnapshot(ctx: HostContext): Snapshot {
  const raw = ctx.settings.get('llm-pi-ai') as ConfigLike | undefined
  return { providers: (raw?.providers ?? {}) as Record<string, ProviderProfileLike> }
}

/** models 条目的展示配置态：false / null（未配置继承） / map。 */
function configuredOf(entry: ModelEntry): false | null | WireSpellings {
  const value = entry.reasoningEfforts
  if (value === false) return false
  if (value === undefined || value === null) return null
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value as WireSpellings
  return null
}

function isLevel(value: string): value is ThinkingLevel {
  return value === 'off' || value === 'minimal' || value === 'low' || value === 'medium'
    || value === 'high' || value === 'xhigh' || value === 'max'
}

/**
 * 读取当前配置 → 设置页状态。模型的实际可思考等级来自适配器 `resolveModelInfo`
 * （写入后即反映），失败时标记不可路由而不阻断整个 provider。
 */
async function buildState(ctx: HostContext): Promise<ThinkingState> {
  const { providers } = readSnapshot(ctx)
  const llm = ctx.get('llm') as LlmLike | undefined
  const rows: ProviderRow[] = []
  for (const [id, profile] of Object.entries(providers)) {
    const models = profile.models
    const list = Array.isArray(models) ? models : []
    const editable = list.length > 0
    const note = editable
      ? undefined
      : Array.isArray(profile.modelOverrides) || (profile.modelOverrides !== undefined && typeof profile.modelOverrides === 'object' && Object.keys(profile.modelOverrides).length > 0)
        ? '此路由使用 installed catalog（modelOverrides 方式自定义），思考等级请写在模型编辑卡片；本页提供 models 列表形式的路由使用。'
        : list.length === 0
          ? '此路由未声明 models 列表，无法在此页为模型开启思考。'
          : undefined
    const modelRows: ModelRow[] = []
    for (const entry of list) {
      const configured = configuredOf(entry)
      const row: ModelRow = {
        id: entry.id,
        name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id,
        configured,
        offered: [],
        available: true,
      }
      if (llm?.resolveModelInfo !== undefined) {
        try {
          const resolved = await llm.resolveModelInfo(id, entry.id)
          row.offered = resolved.reasoning?.efforts.map(effort => effort.id) ?? []
          row.defaultEffort = resolved.reasoning?.defaultEffort
        } catch {
          row.available = false
        }
      }
      modelRows.push(row)
    }
    const reasoning = typeof profile.reasoning === 'string' && isLevel(profile.reasoning) ? profile.reasoning : undefined
    rows.push({
      id,
      name: typeof profile.displayName === 'string' && profile.displayName.length > 0 ? profile.displayName : id,
      api: profile.api,
      baseURL: profile.baseURL,
      editable,
      reasoning,
      compatReasoningEffort: profile.compat?.supportsReasoningEffort,
      note,
      models: modelRows,
    })
  }
  return { providers: rows }
}

/** 校验并折叠一个 UI 草稿为合法 reasoningEfforts（false=禁用）。 */
function effortsOf(draft: { levels?: WireSpellings }): WireSpellings | false {
  if (draft.levels !== undefined && isThinkingConfig(draft.levels)) return draft.levels
  return standardEfforts()
}

/** 读请求体，限制大小。 */
function readJsonBody(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`invalid json body: ${String(error)}`))
      }
    })
    req.on('error', reject)
  })
}

/** 把一撮 apply 操作折叠为一组最小 path ops（同一 snapshot 内按序）。 */
function planOps(snapshot: Snapshot, ops: readonly ApplyOp[]): PathOp[] {
  const pathOps: PathOp[] = []
  const routeArrays = new Map<string, ModelLike[]>()
  for (const op of ops) {
    const profile = snapshot.providers[op.provider]
    if (profile === undefined) throw new Error(`unknown provider "${op.provider}"`)
    const base = (): ModelLike[] => {
      let arr = routeArrays.get(op.provider)
      if (arr === undefined) {
        arr = Array.isArray(profile.models) ? profile.models.map(entry => ({ ...entry })) : []
        routeArrays.set(op.provider, arr)
      }
      return arr
    }
    switch (op.kind) {
      case 'route-default': {
        const path = ['providers', op.provider, 'reasoning']
        if (op.reasoning === undefined) pathOps.push({ op: 'unset', path })
        else pathOps.push({ op: 'set', path, value: op.reasoning })
        break
      }
      case 'compat': {
        // pi-ai 只允许 openai-completions 路由声明 reasoning_effort 相关 compat 开关
        if (profile.api !== 'openai-completions') {
          throw new Error(`provider "${op.provider}" 的协议 ${profile.api ?? '(未知)'} 不支持 reasoning_effort 开关（仅 openai-completions）`)
        }
        const path = ['providers', op.provider, 'compat']
        const current = profile.compat === undefined ? {} : { ...profile.compat }
        const next = { ...current, supportsReasoningEffort: op.enableReasoningEffort }
        const onlyDefault = Object.keys(next).length === 1 && next.supportsReasoningEffort === false
        pathOps.push(onlyDefault ? { op: 'unset', path } : { op: 'set', path, value: next })
        break
      }
      case 'enable-standard': {
        const arr = base()
        routeArrays.set(op.provider, withAllModelEfforts(arr, effortsOf(op)))
        break
      }
      case 'disable-all': {
        const arr = base()
        routeArrays.set(op.provider, withAllModelEfforts(arr, false))
        break
      }
      case 'model': {
        const arr = base()
        const efforts = collapseEfforts(op.levels)
        routeArrays.set(op.provider, withModelEfforts(arr, op.modelId, efforts))
        break
      }
    }
  }
  for (const [route, arr] of routeArrays) {
    if (Array.isArray(snapshot.providers[route]?.models)) {
      pathOps.push({ op: 'set', path: ['providers', route, 'models'], value: preparedModels(arr) })
    }
  }
  return pathOps
}

/** 应用一组操作并返回最新状态。 */
async function applyOps(ctx: HostContext, ops: readonly ApplyOp[]): Promise<ThinkingState> {
  if (ops.length === 0) return buildState(ctx)
  const opsPlan = planOps(readSnapshot(ctx), ops)
  if (opsPlan.length > 0) {
    await ctx.settings.mutate('llm-pi-ai', opsPlan)
  }
  return buildState(ctx)
}

function writeJson(res: ServerResponse, envelope: Envelope<unknown>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/**
 * 注册 /custom-thinking 路由（前缀）：
 *  - GET  /custom-thinking/state   → 设置页状态
 *  - POST /custom-thinking/apply   → 批量应用操作，返回刷新后状态
 * 其余方法/路径返回 404。所有读写都过浏览器信任围栏。
 * @param ctx - host context（webServer/settings 已注入；llm/webRuntime 可选）。
 * @returns 路由注销函数。
 */
export function registerCustomThinkingRoutes(ctx: HostContext): () => void {
  const webRuntime = ctx.get('webRuntime') as { trustedHosts?: readonly string[] } | undefined
  const trustedHosts: readonly string[] = webRuntime?.trustedHosts ?? []
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, trustedHosts)
  return ctx.webServer.register({
    kind: 'prefix',
    path: '/custom-thinking',
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, { ok: false, error: { code: 'forbidden', message: 'forbidden' } }, 403)
        return
      }
      let pathname = '/'
      try {
        pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      } catch {
        writeJson(res, { ok: false, error: { code: 'bad-path', message: 'bad path' } }, 400)
        return
      }
      if (req.method === 'GET' && pathname === '/custom-thinking/state') {
        try {
          writeJson(res, { ok: true, value: await buildState(ctx) })
        } catch (error) {
          writeJson(res, { ok: false, error: { code: 'state-error', message: String(error) } }, 500)
        }
        return
      }
      if (req.method === 'POST' && pathname === '/custom-thinking/apply') {
        try {
          const body = (await readJsonBody(req)) as ApplyRequest | null
          const ops = Array.isArray(body?.ops) ? body.ops : []
          const value = await applyOps(ctx, ops)
          writeJson(res, { ok: true, value })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const code = /conflict|revision/i.test(message) ? 'settings-conflict' : 'apply-error'
          if (code !== 'settings-conflict') ctx.logger.warn(`dsh-custom-thinking: apply refused: ${message}`)
          writeJson(res, { ok: false, error: { code, message } }, 400)
        }
        return
      }
      writeJson(res, { ok: false, error: { code: 'not-found', message: 'not found' } }, 404)
    },
  })
}
