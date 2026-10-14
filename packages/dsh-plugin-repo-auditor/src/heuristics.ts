/**
 * Heuristic algorithms inspired by CMU Paper (arXiv:2412.13459).
 */

import type { GitHubRepoMetadata, GitHubUserMetadata, RepoAuditResult, SuspiciousAccountSummary } from './types.js'

export interface Stage1Audit {
  score: number
  flags: string[]
  forkRatio: number
  watcherRatio: number
  lifespanDays: number
}

/**
 * Stage 1: Evaluate repository metadata (fork ratio, watcher ratio, repo size, lifespan, issue activity).
 */
export function evaluateStage1(repo: GitHubRepoMetadata): Stage1Audit {
  let score = 100
  const flags: string[] = []

  const stars = Math.max(0, repo.stargazers_count)
  const forks = Math.max(0, repo.forks_count)
  const watchers = Math.max(0, repo.subscribers_count)
  const sizeKb = Math.max(0, repo.size)

  const forkRatio = stars > 0 ? forks / stars : 0
  const watcherRatio = stars > 0 ? watchers / stars : 0

  const createdAt = new Date(repo.created_at).getTime()
  const pushedAt = new Date(repo.pushed_at).getTime()
  const now = Date.now()

  // Active span between creation and last push (in days)
  const lifespanDays = Math.max(0, (pushedAt - createdAt) / (1000 * 60 * 60 * 24))
  // Absolute age of the repository in days
  const repoAgeDays = Math.max(0.1, (now - createdAt) / (1000 * 60 * 60 * 24))

  // Interaction ratio anomaly check (only for repositories with stars >= 30)
  if (stars >= 30) {
    if (forkRatio < 0.02) {
      score -= 30
      flags.push('CRITICAL_LOW_FORK_RATIO')
    } else if (forkRatio < 0.05) {
      score -= 15
      flags.push('LOW_FORK_RATIO')
    }

    // Calibrated Watcher Ratio evaluation:
    // Mega repos (>50k stars) experience organic watcher decay due to notification fatigue.
    // High fork ratio and substantial codebase size grant cross-metric exemption.
    const isMegaRepo = stars >= 50000 && forkRatio >= 0.08
    const isHeavyForked = forkRatio >= 0.10 && sizeKb >= 10240 // >= 10MB

    const criticalWatcherThreshold = isMegaRepo ? 0.0005 : 0.001
    const lowWatcherThreshold = isMegaRepo ? 0.0015 : 0.005

    if (watcherRatio < criticalWatcherThreshold) {
      const penalty = isHeavyForked ? 10 : 25
      score -= penalty
      flags.push('CRITICAL_LOW_WATCHER_RATIO')
    } else if (watcherRatio < lowWatcherThreshold) {
      const penalty = isHeavyForked ? 5 : 15
      score -= penalty
      flags.push('LOW_WATCHER_RATIO')
    }
  }

  // Hollow repository detection: stars >= 100 but repository size < 30 KB
  if (stars >= 100 && sizeKb < 30) {
    score -= 35
    flags.push('HOLLOW_REPO_SIZE')
  }

  // Flash spike and abandonment: stars >= 200 but active lifespan < 2 days
  if (stars >= 200 && lifespanDays < 2) {
    score -= 30
    flags.push('SHORT_LIFESPAN_SPIKE')
  }

  // Fast star growth with 0 open issues (suspicious bot reception without real users)
  // Exempted if issues tab is disabled by owner (has_issues === false) or repository has high fork engagement
  const starsPerDay = stars / repoAgeDays
  const hasIssuesDisabled = repo.has_issues === false
  const isForkExempted = forkRatio >= 0.08 && forks >= 50

  if (stars >= 100 && starsPerDay > 10 && repo.open_issues_count === 0) {
    if (!hasIssuesDisabled && !isForkExempted) {
      score -= 20
      flags.push('ZERO_ISSUES_HIGH_STAR')
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    flags,
    forkRatio: Number(forkRatio.toFixed(4)),
    watcherRatio: Number(watcherRatio.toFixed(4)),
    lifespanDays: Number(lifespanDays.toFixed(1)),
  }
}

/**
 * Check if a sampled user exhibits bot / low-quality traits.
 */
export function inspectSampledUser(user: GitHubUserMetadata): SuspiciousAccountSummary | null {
  const accountAgeDays = Math.max(0, (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24))

  // 1. Hollow account: 0 repos, 0 followers, no bio, no company
  const isHollow =
    user.public_repos === 0 &&
    user.followers === 0 &&
    (!user.bio || user.bio.trim() === '') &&
    (!user.company || user.company.trim() === '')

  if (isHollow) {
    return {
      login: user.login,
      reason: 'hollow_account',
      public_repos: user.public_repos,
      followers: user.followers,
      accountAgeDays: Math.round(accountAgeDays),
    }
  }

  // 2. Newly created flash bot: registered < 30 days, repos <= 1, followers === 0
  if (accountAgeDays < 30 && user.public_repos <= 1 && user.followers === 0) {
    return {
      login: user.login,
      reason: 'newly_created_flash_bot',
      public_repos: user.public_repos,
      followers: user.followers,
      accountAgeDays: Math.round(accountAgeDays),
    }
  }

  return null
}

/**
 * Combine Stage 1 and Stage 2 into the final Audit Result.
 */
export function compileAuditResult(
  repo: GitHubRepoMetadata,
  stage1: Stage1Audit,
  sampledUsers?: GitHubUserMetadata[]
): RepoAuditResult {
  let score = stage1.score
  const flags = [...stage1.flags]

  let botSampleRatio: number | undefined
  let sampledCount: number | undefined
  let lowQualityCount: number | undefined
  const suspiciousSamples: SuspiciousAccountSummary[] = []

  if (sampledUsers && sampledUsers.length >= 3) {
    sampledCount = sampledUsers.length
    for (const u of sampledUsers) {
      const suspicious = inspectSampledUser(u)
      if (suspicious) {
        suspiciousSamples.push(suspicious)
      }
    }
    lowQualityCount = suspiciousSamples.length
    botSampleRatio = Number((lowQualityCount / sampledCount).toFixed(3))

    if (botSampleRatio >= 0.5) {
      score -= 30
      flags.push('HIGH_BOT_FOLLOWER_RATIO')
    } else if (botSampleRatio >= 0.25) {
      score -= 15
      flags.push('SUSPICIOUS_BOT_ACTIVITY')
    }
  }

  score = Math.max(0, Math.min(100, score))

  let grade: 'A' | 'B' | 'C' | 'D' | 'F' = 'A'
  if (score >= 90) grade = 'A'
  else if (score >= 75) grade = 'B'
  else if (score >= 60) grade = 'C'
  else if (score >= 40) grade = 'D'
  else grade = 'F'

  // Generate clear verdict
  let verdict = 'Healthy and credible open-source repository.'
  if (grade === 'F' || flags.includes('CRITICAL_LOW_FORK_RATIO') || flags.includes('HOLLOW_REPO_SIZE')) {
    verdict = 'High risk: Suspected fake star manipulation, hollow codebase, or bot network amplification.'
  } else if (grade === 'D') {
    verdict = 'Suspicious: Noticeable ratio anomalies or low-quality stargazer density detected.'
  } else if (grade === 'C') {
    verdict = 'Minor anomalies: Watcher or fork ratios deviate slightly from typical organic patterns.'
  } else if (grade === 'B') {
    verdict = 'Normal: Minor metric fluctuations within expected organic range.'
  }

  const res: RepoAuditResult = {
    repo: repo.full_name,
    score,
    grade,
    verdict,
    flags,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count,
    forkRatio: stage1.forkRatio,
    watcherRatio: stage1.watcherRatio,
    sizeKb: repo.size,
    lifespanDays: stage1.lifespanDays,
    openIssues: repo.open_issues_count,
    ...(botSampleRatio !== undefined ? { botSampleRatio } : {}),
    ...(sampledCount !== undefined ? { sampledCount } : {}),
    ...(lowQualityCount !== undefined ? { lowQualityCount } : {}),
    ...(suspiciousSamples.length > 0 ? { suspiciousSamples } : {}),
  }

  return JSON.parse(JSON.stringify(res)) as RepoAuditResult
}
