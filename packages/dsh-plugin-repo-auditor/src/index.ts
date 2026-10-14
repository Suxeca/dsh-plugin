/**
 * @suxeca/dsh-plugin-repo-auditor (v0.2.0)
 * Native DSH plugin for GitHub star/hollow repository auditing and supply chain security inspection.
 */

import type { Context } from 'cordis'
import { defineTool, type PreToolDecision, type ToolExecution } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import type { BatchAuditOutput, PluginConfig, RepoAuditResult } from './types.js'
import { evaluateStage1, compileAuditResult } from './heuristics.js'
import { auditSupplyChain } from './supply-chain.js'
import { GitHubClient } from './github-client.js'
import { renderMarkdownReport } from './render.js'

export const name = '@suxeca/dsh-plugin-repo-auditor'

export const inject = ['tools', 'systemPrompt']

export const Config = z.object({
  token: z.string().description('GitHub Personal Access Token (可选，未配置时自动尝试 credentials / 环境变量 / 免鉴权模式)').default(''),
  sampleSize: z.number().description('抽样分析 Stargazers 水军账号数量 (默认 5)').default(5),
  enableInstallGate: z.boolean().description('是否开启 tools/pre-execute 安装拦截门禁').default(true),
})

const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes TTL cache

export function apply(ctx: Context, config: PluginConfig = {}): void {
  const resolvedConfig: PluginConfig = {
    token: config.token ?? '',
    sampleSize: typeof config.sampleSize === 'number' && config.sampleSize > 0 ? config.sampleSize : 5,
    enableInstallGate: config.enableInstallGate !== false,
  }

  const client = new GitHubClient(ctx, resolvedConfig)
  const auditCache = new Map<string, { expiresAt: number; data: RepoAuditResult }>()

  // Helper to audit a single repository (Heuristics + Zero-quota Supply Chain)
  async function auditSingleRepo(
    owner: string,
    repo: string,
    options: { forceRefresh?: boolean; allowSample?: boolean; signal?: AbortSignal } = {}
  ): Promise<RepoAuditResult> {
    const cacheKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`

    if (!options.forceRefresh) {
      const cached = auditCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        return { ...cached.data, cached: true }
      }
    }

    await client.resolveToken()

    const repoData = await client.getRepo(owner, repo, options.signal)
    const stage1 = evaluateStage1(repoData)

    // Run Zero-quota Supply Chain Inspection (Raw CDN)
    let supplyChainEval = undefined
    try {
      supplyChainEval = await auditSupplyChain(
        client,
        owner,
        repo,
        repoData.default_branch ?? 'main',
        options.signal
      )
    } catch {
      // Ignore supply chain check failures
    }

    // Dynamic Sampling Strategy:
    // 1. Explicitly disabled (e.g. pre-execute gate with 5s timeout): skip sampling
    // 2. Supply chain already flagged critical malware: skip sampling
    // 3. Unauthenticated mode (60 req/hr): strictly skip sampling if Stage 1 is healthy (score >= 85),
    //    consuming exactly 1 API call per healthy repo! Only sample when Stage 1 shows suspicion (score < 85).
    // 4. Authenticated mode (5000 req/hr): full sampling enabled.
    const shouldSample =
      options.allowSample !== false &&
      !supplyChainEval?.forceGradeF &&
      repoData.stargazers_count >= 10 &&
      (!client.isUnauthenticated() || stage1.score < 85)

    let sampledUsers = undefined
    if (shouldSample) {
      try {
        sampledUsers = await client.getStargazerSample(
          owner,
          repo,
          repoData.stargazers_count,
          resolvedConfig.sampleSize ?? 5,
          options.signal
        )
      } catch {
        // Fallback gracefully if sample fails
      }
    }

    const result = compileAuditResult(repoData, stage1, sampledUsers, supplyChainEval)

    // Store into cache
    auditCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      data: result,
    })

    return result
  }

  // 1. Register Lightweight System Prompt Section (managed via ctx.effect)
  ctx.effect(() => {
    return ctx.systemPrompt.section({
      name: 'tool:audit-github-repos',
      order: 520,
      text: 'When recommending open-source GitHub repositories, evaluating unknown or trending tools, or before installing packages directly from GitHub, use the `audit_github_repos` tool to verify repository authenticity, star legitimacy, supply chain security, and check for fake stars, malware hooks, or hollow repository anomalies.',
    })
  })

  // 2. Register Native Tool: audit_github_repos (managed via ctx.effect)
  ctx.effect(() => {
    return ctx.tools.register(
      defineTool({
        name: 'audit_github_repos',
        description:
          'Audit GitHub repositories for fake stars, hollow codebases, bot networks, and supply chain malware using CMU heuristic metrics and raw static inspection.',
        parameters: {
          repos: {
            type: 'array',
            required: true,
            description: 'Array of GitHub repository identifiers (e.g. ["owner/repo", "https://github.com/owner/repo"]).',
            items: { type: 'string' },
          },
          forceRefresh: {
            type: 'boolean',
            description: 'Whether to bypass the 10-minute cache and fetch fresh statistics.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              audits: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    repo: { type: 'string', required: true },
                    score: { type: 'number', required: true },
                    grade: { type: 'string', required: true },
                    verdict: { type: 'string', required: true },
                    flags: { type: 'array', required: true, items: { type: 'string' } },
                    stars: { type: 'number', required: true },
                    forks: { type: 'number', required: true },
                    watchers: { type: 'number', required: true },
                    forkRatio: { type: 'number', required: true },
                    watcherRatio: { type: 'number', required: true },
                    sizeKb: { type: 'number', required: true },
                    lifespanDays: { type: 'number', required: true },
                    openIssues: { type: 'number', required: true },
                    botSampleRatio: { type: 'number' },
                    sampledCount: { type: 'number' },
                    lowQualityCount: { type: 'number' },
                    supplyChain: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        isDshPlugin: { type: 'boolean', required: true },
                        securityRisk: { type: 'string', required: true },
                        installScripts: { type: 'array', required: true, items: { type: 'string' } },
                        permissions: { type: 'array', required: true, items: { type: 'string' } },
                        supplyChainFlags: { type: 'array', required: true, items: { type: 'string' } },
                      },
                    },
                    cached: { type: 'boolean' },
                    error: { type: 'string' },
                  },
                },
              },
              rateLimitRemaining: { type: 'number' },
              rateLimitLimit: { type: 'number' },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: renderMarkdownReport(value as BatchAuditOutput),
            },
          ],
        },
        async execute(args, exec): Promise<BatchAuditOutput> {
          const rawRepos = Array.isArray(args.repos) ? args.repos : []
          const forceRefresh = args.forceRefresh === true

          await client.resolveToken()

          const audits: RepoAuditResult[] = []

          for (const raw of rawRepos) {
            if (exec.signal?.aborted) {
              throw new Error('Audit execution aborted by user or timeout.')
            }

            const parsed = GitHubClient.parseRepo(raw)
            if (!parsed) {
              audits.push({
                repo: raw,
                score: 0,
                grade: 'F',
                verdict: 'Invalid repository identifier or URL format.',
                flags: ['INVALID_REPO_INPUT'],
                stars: 0,
                forks: 0,
                watchers: 0,
                forkRatio: 0,
                watcherRatio: 0,
                sizeKb: 0,
                lifespanDays: 0,
                openIssues: 0,
                error: 'Invalid GitHub repository format.',
              })
              continue
            }

            try {
              const audit = await auditSingleRepo(parsed.owner, parsed.repo, {
                forceRefresh,
                signal: exec.signal,
              })
              audits.push(audit)
            } catch (err: unknown) {
              const errorMsg = err instanceof Error ? err.message : String(err)
              audits.push({
                repo: `${parsed.owner}/${parsed.repo}`,
                score: 0,
                grade: 'F',
                verdict: `Failed to fetch repository metadata: ${errorMsg}`,
                flags: ['FETCH_FAILED'],
                stars: 0,
                forks: 0,
                watchers: 0,
                forkRatio: 0,
                watcherRatio: 0,
                sizeKb: 0,
                lifespanDays: 0,
                openIssues: 0,
                error: errorMsg,
              })
            }
          }

          const output: BatchAuditOutput = {
            audits,
            ...(client.rateLimit.remaining !== undefined ? { rateLimitRemaining: client.rateLimit.remaining } : {}),
            ...(client.rateLimit.limit !== undefined ? { rateLimitLimit: client.rateLimit.limit } : {}),
          }
          return JSON.parse(JSON.stringify(output)) as BatchAuditOutput
        },
      })
    )
  })

  // 3. Register Dual-Track tools/pre-execute Gate
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    if (!resolvedConfig.enableInstallGate) {
      return next()
    }

    let targetRepo: { owner: string; repo: string } | null = null

    // Check plugin_manager install_bundle
    if (exec.name === 'plugin_manager') {
      const args = exec.arguments as { action?: string; target?: string } | undefined
      if (args?.action === 'install_bundle' && typeof args.target === 'string') {
        targetRepo = GitHubClient.parseRepo(args.target)
      }
    }

    // Check bash commands (git clone, npm install github:...)
    if (exec.name === 'bash') {
      const args = exec.arguments as { command?: string } | undefined
      const cmd = typeof args?.command === 'string' ? args.command : ''

      // Escape hatch
      if (/SKIP_REPO_AUDIT=1/.test(cmd)) {
        return next()
      }

      // Match git clone https://github.com/owner/repo or git clone git@github.com:owner/repo
      const gitCloneMatch = cmd.match(/git\s+clone\s+(?:--\S+\s+)*(?:https?:\/\/github\.com\/|git@github\.com:)([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git|\/|\s|$)/i)
      if (gitCloneMatch && gitCloneMatch[1] && gitCloneMatch[2]) {
        targetRepo = { owner: gitCloneMatch[1], repo: gitCloneMatch[2] }
      }

      // Match npm/pnpm install github:owner/repo or https://github.com/owner/repo
      if (!targetRepo) {
        const npmMatch = cmd.match(/(?:npm|pnpm|yarn)\s+(?:install|add)\s+.*?(?:github:|(?:https?:\/\/)?github\.com\/)([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git|\/|\s|$)/i)
        if (npmMatch && npmMatch[1] && npmMatch[2]) {
          targetRepo = { owner: npmMatch[1], repo: npmMatch[2] }
        }
      }
    }

    if (!targetRepo) {
      return next()
    }

    // Run quick audit with 5s timeout protection
    try {
      const timeoutController = new AbortController()
      const timeoutId = setTimeout(() => timeoutController.abort(), 5000)

      const audit = await auditSingleRepo(targetRepo.owner, targetRepo.repo, {
        allowSample: false, // Don't block pre-execute with slow user profile sampling
        signal: timeoutController.signal,
      }).finally(() => clearTimeout(timeoutId))

      // Dual-track risk determination:
      // Track 1: Fake star / hollow repository anomalies (Grade D/F)
      const isStarRisk =
        audit.grade === 'D' ||
        audit.grade === 'F' ||
        audit.flags.includes('CRITICAL_LOW_FORK_RATIO') ||
        audit.flags.includes('HOLLOW_REPO_SIZE')

      // Track 2: Supply chain risk / sensitive permissions
      const isSupplyChainRisk =
        audit.supplyChain &&
        ['MEDIUM', 'HIGH', 'CRITICAL'].includes(audit.supplyChain.securityRisk)

      if (isStarRisk || isSupplyChainRisk) {
        const reasonsList: string[] = []
        if (isStarRisk) {
          reasonsList.push(`信度评级: ${audit.grade} (得分: ${audit.score})`)
        }
        if (audit.supplyChain && audit.supplyChain.securityRisk !== 'NONE') {
          reasonsList.push(`供应链风险: ${audit.supplyChain.securityRisk}`)
          if (audit.supplyChain.installScripts.length > 0) {
            reasonsList.push(`含安装脚本: ${audit.supplyChain.installScripts.map(s => s.split(':')[0]).join(', ')}`)
          }
          if (audit.supplyChain.permissions.length > 0) {
            reasonsList.push(`敏感权限: ${audit.supplyChain.permissions.join(', ')}`)
          }
        }

        const summaryStr = reasonsList.join('; ') || (audit.flags.length > 0 ? audit.flags.join(', ') : '存在异常')

        return {
          kind: 'ask',
          reason: `Repo ${targetRepo.owner}/${targetRepo.repo} triggered security gate (${summaryStr})`,
          displayReason: {
            zh: `检测到目标仓库 ${targetRepo.owner}/${targetRepo.repo} 存在安全风险（${summaryStr}）。确认要继续安装/执行吗？`,
            en: `Security risk detected for repository ${targetRepo.owner}/${targetRepo.repo} (${summaryStr}). Proceed with execution?`,
          },
        }
      }
    } catch {
      // On timeout or audit failure, do not block regular execution
      return next()
    }

    return next()
  })
}
