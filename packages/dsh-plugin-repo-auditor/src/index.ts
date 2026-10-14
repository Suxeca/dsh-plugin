/**
 * @suxeca/dsh-plugin-repo-auditor
 * Native DSH plugin for GitHub star/hollow repository auditing based on CMU heuristics.
 */

import type { Context } from 'cordis'
import { defineTool, type PreToolDecision, type ToolExecution } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import type { BatchAuditOutput, PluginConfig, RepoAuditResult } from './types.js'
import { evaluateStage1, compileAuditResult } from './heuristics.js'
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

  // Helper to audit a single repository
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

    // Dynamic Sampling Strategy:
    // 1. Explicitly disabled (e.g. pre-execute gate with 5s timeout): skip sampling
    // 2. Unauthenticated mode (60 req/hr): strictly skip sampling if Stage 1 is healthy (score >= 85),
    //    consuming exactly 1 API call per healthy repo! Only sample when Stage 1 shows suspicion (score < 85).
    // 3. Authenticated mode (5000 req/hr): full sampling enabled.
    const shouldSample =
      options.allowSample !== false &&
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

    const result = compileAuditResult(repoData, stage1, sampledUsers)

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
      text: 'When recommending open-source GitHub repositories, evaluating unknown or trending tools, or before installing packages directly from GitHub, use the `audit_github_repos` tool to verify repository authenticity, star legitimacy, and check for fake stars or hollow repository anomalies.',
    })
  })

  // 2. Register Native Tool: audit_github_repos (managed via ctx.effect)
  ctx.effect(() => {
    return ctx.tools.register(
      defineTool({
        name: 'audit_github_repos',
        description:
          'Audit GitHub repositories for fake stars, hollow codebases, or bot networks using CMU heuristic metrics (arXiv:2412.13459). Supports batch input with fork/watcher ratios and stargazer sampling.',
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
          const isUnauthenticated = client.isUnauthenticated()

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

  // 3. Register tools/pre-execute Gate
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

      const isHighRisk =
        audit.grade === 'D' ||
        audit.grade === 'F' ||
        audit.flags.includes('CRITICAL_LOW_FORK_RATIO') ||
        audit.flags.includes('HOLLOW_REPO_SIZE')

      if (isHighRisk) {
        const flagsDesc = audit.flags.length > 0 ? audit.flags.join(', ') : '异常指标'
        return {
          kind: 'ask',
          reason: `Repo ${targetRepo.owner}/${targetRepo.repo} has low credibility (Grade: ${audit.grade}, Score: ${audit.score}). Flags: ${flagsDesc}`,
          displayReason: {
            zh: `检测到目标仓库 ${targetRepo.owner}/${targetRepo.repo} 疑似刷星或空壳项目（评分 ${audit.score}/100，评级 ${audit.grade}，告警：${flagsDesc}）。确认要继续安装/执行吗？`,
            en: `Repository ${targetRepo.owner}/${targetRepo.repo} is suspected of fake stars or hollow codebase (Score: ${audit.score}/100, Grade: ${audit.grade}, Flags: ${flagsDesc}). Proceed with execution?`,
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
