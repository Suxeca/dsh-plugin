/**
 * router-opencode-go: task-aware reasoning-mode router for the opencode-go
 * provider, with a continuous react↔spec axis.
 *
 * A provider-scoped copy of router-standard's `router-bootstrap`, tuned for
 * opencode-go's deepseek-v4-flash with three measured adaptations (A/B/C,
 * validated by a same-task/same-model three-way experiment, Aug 2026):
 *
 *   A. WEAK_FLASH carries a third "deep thinking" anchor (architecture /
 *      edge cases / integration points; produce when information is
 *      complete; end each reasoning block with a decision) — +50% reasoning
 *      chars and a 13-point physical-validation matrix on the probe task.
 *   B. Flash models always route weak (override ?? isFlashModel ? weak :
 *      sessionMode) instead of keyword classification — measured +91%
 *      reasoning overall with the anchor, and the only variant that
 *      iteratively fixed its own bugs.
 *   C. The session/event + inbox.append near-field guidance is removed: it
 *      never fires on dsh rc.6 (session-scoped events, no inbox handle,
 *      assemble-time ordering) — the deep guidance is statically part of the
 *      persona instead.
 *
 * The provider route is RECORDED rather than gated: measurements show the
 * assembly-time `variables` (installed by installModelSelection) can disagree
 * with the request that actually leaves (the selection chain is split across
 * two surfaces), so a hard provider gate would either skip the first turn or
 * misjudge it. Instead:
 *
 *   - `system-prompt/assemble` routes unconditionally (persona, first-turn
 *     core tools, weak-mode guidance) and snapshots the route facts it can
 *     see (`variables` → last request header → agent options);
 *   - `agent/request` records the AUTHORITATIVE provider/model of the
 *     request that actually leaves (the value `ctx.llm.stream` receives),
 *     which `dev_router_status` and `dev_mode_subagent` then use;
 *   - `dev_router_status` shows the recorded route and notes when it is not
 *     the preset's intended `opencode-go` provider.
 *
 * Reads the session's first user message, classifies the task into a
 * continuous mode in [0,1] (0 = spec plan-first, 1 = react doer), and on the
 * first model request injects the matching persona and first-turn core tool
 * set. After the first durable tool/call the full preset catalog is exposed
 * and nothing is touched again; the mode derives from durable session events,
 * so resume/reload keeps it.
 *
 * The agent can read and tune its own routing through `dev_router_status` and
 * `dev_router_mode` (self-optimization loop) — mode accepts band names
 * (spec/spec-lean/balanced/react-lean/react), 0-100 numbers, or 0.0-1.0.
 *
 * Zero external imports on purpose: relative preset rows resolve bare
 * specifiers from the user home, where `@deepseek-ai/*` is not installed.
 * The router tools therefore inline a minimal schema compiler instead of
 * importing `defineTool` from `@deepseek-ai/dsh-tools`.
 */

import {
  applyPersona, bandFor, coreFor, parseMode, personaFor, testinessFor, clamp01,
  isFlashModel, classifyTask, extractText,
} from './router-go-core.mjs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'router-opencode-go'

/** The provider this preset is intended for (informational; not a hard gate). */
const SCOPE_PROVIDER = 'opencode-go'

/** Prompt assembly, the tools registry, and the LLM route must exist. */
export const inject = ['systemPrompt', 'tools', 'llm']

/** Minimal spec → JSON Schema compiler (subset of defineTool's work). */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, meta] of Object.entries(spec || {})) {
    const prop = { type: meta.type }
    if (Array.isArray(meta.enum)) prop.enum = meta.enum
    if (meta.description) prop.description = meta.description
    properties[key] = prop
    if (meta.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

export function apply(ctx, config) {
  const overrides = new Map() // session id -> explicit mode (number 0..1)
  const agents = new Map() // session id -> Agent (live handle, in-process only)
  // session id -> route facts { provider, model, source }. Updated from
  // assembly snapshots (best effort) and overwritten by the authoritative
  // agent/request record of the request that actually leaves.
  const sessionInfo = new Map() // session id -> { provider, model, source }

  /** Route facts one assembly can see, most-authoritative first. */
  function routeFactsFor(agent, assembled) {
    const variables = assembled?.variables ?? {}
    const header = agent.session.requestHeader?.()?.config
    if (variables.provider !== undefined && variables.model !== undefined) {
      return { provider: variables.provider, model: variables.model, source: 'variables' }
    }
    if (header?.provider !== undefined && header.model !== undefined) {
      return { provider: header.provider, model: header.model, source: 'requestHeader' }
    }
    return {
      provider: agent.options?.provider,
      model: agent.options?.model,
      source: 'options',
    }
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined) return assembled
    const session = agent.session
    agents.set(session.id, agent)
    const route = routeFactsFor(agent, assembled)
    // Best-effort record; agent/request overwrites it with the authoritative
    // value. Kept even when the sources disagree so tools can show both.
    sessionInfo.set(session.id, route)

    // B (SheberDavid 实测)：Flash 一律走 weak（w7 最优解），不关键词分类。
    const mode = resolveMode(session, route.model)
    const persona = personaFor(mode, route.model)

    // The persona stays constant for the whole session (mode is fixed); only
    // the tool surface changes once, after the first durable tool/call.
    const sections = applyPersona(assembled.sections, persona)

    if (session.events.some((event) => event.type === 'tool/call')) {
      return { ...assembled, sections, contexts: [] } // promoted: full catalog
    }

    const core = new Set(coreFor(mode))
    const available = new Set(assembled.tools.map((tool) => tool.name))
    const shell = available.has('pwsh') ? 'pwsh' : available.has('bash') ? 'bash' : null
    if (shell === null) {
      throw new Error(`${name}: no platform shell in catalog`)
    }
    core.add(shell)

    return {
      ...assembled,
      sections,
      contexts: [],
      tools: assembled.tools.filter((tool) => core.has(tool.name)),
    }
  })

  // ── authoritative route record: the config the request actually leaves
  //    with. installModelSelection's request listener sits earlier on the
  //    waterfall (agent setup precedes preset mount), so `await next()`
  //    resolves to the final provider/model this session's selection picks —
  //    including a model switched via selectModel after creation. ──
  ctx.on('agent/request', async (_payload, next) => {
    const config = await next()
    const session = currentSession()
    if (session === undefined) return config
    sessionInfo.set(session.id, {
      provider: config.provider,
      model: config.model,
      source: 'request',
    })
    return config
  })

  // ── C: 动态近场引导（session/event + inbox.append）在 dsh rc.6 不触发，
  //    已删除；深度引导静态并入 WEAK_FLASH persona（router-go-core.mjs）。

  // 统一解析当前会话的 mode：显式 override 优先；否则 Flash 一律 weak
  //（SheberDavid 实测 w7 最优解），非 Flash 走关键词分类。
  // sessionModeUser 只分类真实用户消息（source.kind==='user'），跳过
  // sage-mem 等 plugin 注入的首条消息——否则记忆文本的关键词会把模式
  // 带偏（实测：sage-mem 文本把 "你好" 会话污染成 spec）。
  function resolveMode(session, modelId) {
    return overrides.get(session.id)
      ?? (isFlashModel(modelId) ? 'weak' : sessionModeUser(session))
  }

  /** 过滤版 sessionMode：跳过 plugin/系统注入消息，只分类真实用户消息。 */
  function sessionModeUser(session) {
    const events = session.events
    const userMsg = events.find(
      (e) => e.type === 'user/message' && e.data?.source?.kind === 'user',
    )
    return classifyTask(extractText(userMsg?.data))
  }

  // ── router visibility & tuning (agent self-optimization) ────────────────
  const registerTool = (tool) => {
    ctx.effect(() => ctx.tools.register({
      ...tool,
      parameters: toJsonSchema(tool.parameters),
      // output.schema is already a plain JSON Schema; keep it as-is
    }))
  }

  const modeSpec = {
    mode: {
      type: 'string',
      required: true,
      description: 'band name (spec / weak / mixed / react), a 0-100 number, a 0.0-1.0 number, or auto to clear the override',
    },
  }

  function fmtMode(mode) {
    return typeof mode === 'string' ? mode : mode.toFixed(2)
  }

  registerTool({
    name: 'dev_router_status',
    description: 'Show this session\'s reasoning-mode routing: mode, band, persona, first-turn core tools, test-suppression, route provider/model, and whether an override is active.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute() {
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      const agent = currentAgent()
      if (agent === undefined) return 'no agent session'
      const route = sessionInfo.get(session.id) ?? { provider: agent.options?.provider, model: agent.options?.model, source: 'options' }
      const mode = resolveMode(session, route.model)
      const lines = [
        `route=${route.provider}/${route.model} (source=${route.source})`,
        `mode=${fmtMode(mode)} (band=${bandFor(mode)})`,
        `persona=${personaFor(mode, route.model).replace(/\n/g, ' / ')}`,
        `core=[${coreFor(mode).join(', ')}]`,
        `testiness=${testinessFor(mode)}`,
        `override=${overrides.has(session.id) ? 'yes' : 'no'}`,
      ]
      if (route.provider !== SCOPE_PROVIDER) {
        lines.push(`note: preset router-opencode-go is designed for provider "${SCOPE_PROVIDER}" (session is on ${route.provider ?? '(none)'})`)
      }
      return lines.join('\n')
    },
  })

  registerTool({
    name: 'dev_router_mode',
    description: 'Set this session\'s reasoning mode: spec (plan-first) / weak (internal routing, model decides per task) / mixed (transition, trap) / react (doer). Accepts band names, 0-100, or 0.0-1.0; use auto to return to task classification. The next request applies it.',
    parameters: modeSpec,
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute(args) {
      const parsed = parseMode(args.mode)
      if (parsed === null) return `invalid mode "${args.mode}": use spec/weak/mixed/react, 0-100, 0.0-1.0, or auto`
      const session = currentSession()
      if (session === undefined) return 'no agent session'
      if (parsed === 'auto') overrides.delete(session.id)
      else overrides.set(session.id, parsed === 'weak' ? 'weak' : clamp01(parsed))
      const current = resolveMode(session, currentAgent()?.options?.model)
      return `mode=${fmtMode(current)} (band=${bandFor(current)}) — next request applies`
    },
  })

  // ── mode-isolated subagent: run a task in a DIFFERENT reasoning mode,
  //    without touching this session's trajectory (P6 showed tail persona
  //    is ineffective; DSH's native subagent inherits this persona, so the
  //    only working isolation is a fresh LLM call with its own system). ──
  registerTool({
    name: 'dev_mode_subagent',
    description: 'Run one task in a DIFFERENT reasoning mode than this session, in a fresh isolated context (own system prompt). The current session trajectory is untouched. Mode: spec (plan-first) / weak (internal routing) / react (doer) / balanced. Returns the subagent\'s answer text.',
    parameters: {
      mode: { type: 'string', required: true, description: 'spec / weak / react / balanced (or 0-100)' },
      task: { type: 'string', required: true, description: 'the task to hand to the mode-isolated subagent' },
      maxTokens: { type: 'number', description: 'output cap (default 1024)' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args) {
      const parsed = parseMode(args.mode)
      if (parsed === null || parsed === 'auto') return `invalid mode "${args.mode}"`
      const session = currentSession()
      const agent = session === undefined ? undefined : [...agents.values()].find((a) => a.session === session)
      if (agent === undefined || agent.options === undefined) return 'no agent route available'
      // Route facts: prefer the authoritative request record (selectModel
      // updates the per-session selection, not agent.options).
      const route = sessionInfo.get(session.id) ?? { provider: agent.options.provider, model: agent.options.model, source: 'options' }
      const { provider, model } = route
      if (!provider || !model) return 'agent route missing provider/model'

      const persona = personaFor(parsed, model)
      const maxTokens = Number(args.maxTokens || 1024)
      let text = ''
      let reasoningChars = 0
      try {
        const stream = ctx.llm.stream({
          provider,
          model,
          system: persona,
          messages: [{ role: 'user', content: [{ type: 'text', text: String(args.task) }] }],
          maxTokens,
        })
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') text += chunk.text
          else if (chunk.type === 'reasoning-delta') reasoningChars += chunk.text.length
        }
      } catch (error) {
        return `subagent error: ${error && error.message ? error.message : String(error)}`
      }
      const head = text.slice(0, 3000)
      return `[mode-subagent ${bandFor(parsed)} | reasoning ${reasoningChars} chars | route ${provider}/${model}]\n${head}${text.length > 3000 ? '\n…(truncated)' : ''}`
    },
  })

  function currentSession() {
    const agent = ctx.get('agent')
    if (agent !== undefined && agent.session !== undefined) return agent.session
    const last = [...agents.values()].at(-1)
    return last?.session
  }

  function currentAgent() {
    const session = currentSession()
    return session === undefined ? undefined : [...agents.values()].find((a) => a.session === session)
  }
}
