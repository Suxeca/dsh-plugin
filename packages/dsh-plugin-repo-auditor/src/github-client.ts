/**
 * GitHub API Client with token resolution, rate limit monitoring, raw CDN fetch, and abort support.
 */

import type { Context } from 'cordis'
import type { GitHubRepoMetadata, GitHubUserMetadata, PluginConfig } from './types.js'

export interface RateLimitState {
  remaining?: number
  limit?: number
}

export class GitHubClient {
  private token: string = ''
  private tokenSource: 'config' | 'credentials' | 'env' | 'unauthenticated' = 'unauthenticated'
  public rateLimit: RateLimitState = {}

  constructor(private ctx: Context, private config: PluginConfig) {}

  /**
   * Resolve token via 4-tier fallback:
   * 1. Plugin Config
   * 2. Cordis credentials service
   * 3. process.env.GITHUB_TOKEN
   * 4. User dotfiles (~/.bashrc, ~/.env, .env)
   */
  async resolveToken(): Promise<void> {
    if (this.config.token && this.config.token.trim().length > 0) {
      this.token = this.config.token.trim()
      this.tokenSource = 'config'
      return
    }

    try {
      const credentials = this.ctx.get('credentials') as { resolve?: (ref: string) => Promise<{ value: string } | undefined> } | undefined
      if (credentials && typeof credentials.resolve === 'function') {
        const resolved = await credentials.resolve('GITHUB_TOKEN')
        if (resolved?.value && resolved.value.trim().length > 0) {
          this.token = resolved.value.trim()
          this.tokenSource = 'credentials'
          return
        }
      }
    } catch {
      // Ignore credentials service errors and fall through
    }

    if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim().length > 0) {
      this.token = process.env.GITHUB_TOKEN.trim()
      this.tokenSource = 'env'
      return
    }

    // Tier 4: Inspect local dotfiles (~/.bashrc, ~/.env, .env)
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const os = await import('node:os')
      const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(os.homedir(), '.env'),
        path.join(os.homedir(), '.bashrc'),
      ]
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf8')
          const m = content.match(/(?:export\s+)?GITHUB_TOKEN=[\x27\x22]?([a-zA-Z0-9_]+)[\x27\x22]?/)
          if (m && m[1] && m[1].trim().length > 0) {
            this.token = m[1].trim()
            this.tokenSource = 'env'
            return
          }
        }
      }
    } catch {
      // Ignore dotfile read errors
    }

    this.token = ''
    this.tokenSource = 'unauthenticated'
  }

  isUnauthenticated(): boolean {
    return this.tokenSource === 'unauthenticated'
  }

  getTokenSource(): string {
    return this.tokenSource
  }

  /**
   * Parse repo input to [owner, repo].
   */
  static parseRepo(input: string): { owner: string; repo: string } | null {
    let clean = input.trim()
    // Remove protocol and host if present
    clean = clean.replace(/^(?:https?:\/\/)?github\.com\//i, '')
    // Remove .git suffix and query/hash
    clean = clean.replace(/\.git$/i, '').split(/[?#]/)[0]
    // Clean trailing slashes
    clean = clean.replace(/\/+$/, '')

    const parts = clean.split('/')
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] }
    }
    return null
  }

  private async request<T>(url: string, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'dsh-plugin-repo-auditor/0.2.0',
    }

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`
    }

    const response = await fetch(url, { headers, signal })

    const remainingHeader = response.headers.get('x-ratelimit-remaining')
    const limitHeader = response.headers.get('x-ratelimit-limit')
    if (remainingHeader) this.rateLimit.remaining = parseInt(remainingHeader, 10)
    if (limitHeader) this.rateLimit.limit = parseInt(limitHeader, 10)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Repository or resource not found (HTTP 404): ${url}`)
      }
      if (response.status === 403) {
        const msg = this.isUnauthenticated()
          ? 'GitHub API rate limit exceeded (60 req/hr unauthenticated). Please configure GITHUB_TOKEN.'
          : 'GitHub API rate limit or permission error (HTTP 403).'
        throw new Error(msg)
      }
      throw new Error(`GitHub API request failed with status ${response.status}: ${response.statusText}`)
    }

    return (await response.json()) as T
  }

  async getRepo(owner: string, repo: string, signal?: AbortSignal): Promise<GitHubRepoMetadata> {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    return await this.request<GitHubRepoMetadata>(url, signal)
  }

  /**
   * Fetch raw file via GitHub Raw CDN (does NOT consume REST API rate limit).
   * Falls back to REST API contents only if raw fetch encounters network failure and a token is present.
   */
  async fetchRawFile(
    owner: string,
    repo: string,
    filePath: string,
    defaultBranch: string = 'main',
    signal?: AbortSignal
  ): Promise<string | null> {
    const cleanPath = filePath.replace(/^\/+/, '')
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(defaultBranch)}/${cleanPath}`

    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), 4000)

    const abortHandler = () => timeoutController.abort()
    if (signal) signal.addEventListener('abort', abortHandler)

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'dsh-plugin-repo-auditor/0.2.0',
      }
      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`
      }

      const res = await fetch(rawUrl, { headers, signal: timeoutController.signal })
      if (res.ok) {
        return await res.text()
      }
      if (res.status === 404) {
        return null
      }
    } catch {
      // Network failure on raw CDN
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', abortHandler)
    }

    // Fallback to REST API contents only when token is available to avoid consuming 60/hr quota
    if (this.token) {
      try {
        const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${cleanPath}?ref=${encodeURIComponent(defaultBranch)}`
        const json = await this.request<{ content?: string; encoding?: string }>(apiUrl, signal)
        if (json?.content && json.encoding === 'base64') {
          return Buffer.from(json.content, 'base64').toString('utf8')
        }
      } catch {
        return null
      }
    }

    return null
  }

  async getStargazerSample(
    owner: string,
    repo: string,
    totalStars: number,
    sampleSize: number,
    signal?: AbortSignal
  ): Promise<GitHubUserMetadata[]> {
    if (totalStars <= 0 || sampleSize <= 0) return []

    // Fetch the last available page (max page 100 for GitHub REST API)
    const perPage = 30
    const lastPage = Math.min(Math.max(1, Math.ceil(totalStars / perPage)), 100)
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stargazers?per_page=${perPage}&page=${lastPage}`

    let stargazers: Array<{ login: string }> = []
    try {
      stargazers = await this.request<Array<{ login: string }>>(url, signal)
    } catch {
      return []
    }

    if (!Array.isArray(stargazers) || stargazers.length === 0) {
      return []
    }

    // Pick up to sampleSize users
    const selected = stargazers.slice(0, sampleSize)
    const userProfiles: GitHubUserMetadata[] = []

    // Concurrent fetch with signal
    await Promise.all(
      selected.map(async (u) => {
        try {
          const userUrl = `https://api.github.com/users/${encodeURIComponent(u.login)}`
          const profile = await this.request<GitHubUserMetadata>(userUrl, signal)
          userProfiles.push(profile)
        } catch {
          // Ignore individual user fetch failures
        }
      })
    )

    return userProfiles
  }
}
