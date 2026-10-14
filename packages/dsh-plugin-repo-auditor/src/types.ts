/**
 * Types for GitHub Repository Auditor plugin.
 */

export interface GitHubRepoMetadata {
  full_name: string
  name: string
  owner: { login: string }
  stargazers_count: number
  forks_count: number
  subscribers_count: number
  size: number // in KB
  open_issues_count: number
  has_issues?: boolean
  created_at: string
  pushed_at: string
  archived: boolean
  fork: boolean
  description: string | null
}

export interface GitHubUserMetadata {
  login: string
  public_repos: number
  followers: number
  bio: string | null
  company: string | null
  created_at: string
}

export interface SuspiciousAccountSummary {
  login: string
  reason: 'hollow_account' | 'newly_created_flash_bot'
  public_repos: number
  followers: number
  accountAgeDays: number
}

export interface RepoAuditResult {
  repo: string
  score: number // 0 - 100
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  verdict: string
  flags: string[]
  stars: number
  forks: number
  watchers: number
  forkRatio: number
  watcherRatio: number
  sizeKb: number
  lifespanDays: number
  openIssues: number
  botSampleRatio?: number
  sampledCount?: number
  lowQualityCount?: number
  suspiciousSamples?: SuspiciousAccountSummary[]
  cached?: boolean
  error?: string
}

export interface BatchAuditOutput {
  audits: RepoAuditResult[]
  rateLimitRemaining?: number
  rateLimitLimit?: number
}

export interface PluginConfig {
  token?: string
  sampleSize?: number
  enableInstallGate?: boolean
}
