/**
 * Supply chain and DSH plugin permission static inspection.
 * Zero-quota inspection using GitHub Raw CDN.
 */

import type { GitHubClient } from './github-client.js'
import type { SecurityRiskLevel, SupplyChainAuditResult } from './types.js'

// Whitelist for common build/dev lifecycle hooks
const SAFE_HOOK_WHITELIST = [
  /\bhusky\b/i,
  /\blefthook\b/i,
  /\bpatch-package\b/i,
  /\btsc\b/i,
  /\besbuild\b/i,
  /\brimraf\b/i,
  /\bnapi\b/i,
  /\belectron-builder\b/i,
  /\bnpm\s+run\s+build\b/i,
]

// Critical malware signatures in lifecycle scripts
const CRITICAL_MALWARE_PATTERNS = [
  { pattern: /\b(curl|wget|Invoke-WebRequest|iwr|fetch\s*\(|https?:\/\/)\b/i, reason: 'Remote download/network request' },
  { pattern: /\b(eval\s*\(|node\s+-e|python\d?\s+-c|powershell|cmd\.exe|\|\s*(sh|bash|zsh))\b/i, reason: 'Dynamic code execution/piping' },
  { pattern: /\b(base64|Buffer\.from\s*\([^)]*base64|\\x[0-9a-fA-F]{2})\b/i, reason: 'Obfuscated payload' },
  { pattern: /(\.ssh|\.env|\.npmrc|\.aws|GITHUB_TOKEN|DEEPSEEK|credentials|\/etc\/passwd)/i, reason: 'Credential theft target' },
]

export interface SupplyChainEvaluation {
  result: SupplyChainAuditResult
  scoreDeduction: number
  forceGradeF: boolean
  criticalVerdict?: string
}

export async function auditSupplyChain(
  client: GitHubClient,
  owner: string,
  repo: string,
  defaultBranch: string = 'main',
  signal?: AbortSignal
): Promise<SupplyChainEvaluation> {
  const installScripts: string[] = []
  const permissions: string[] = []
  const supplyChainFlags: string[] = []
  let securityRisk: SecurityRiskLevel = 'NONE'
  let scoreDeduction = 0
  let forceGradeF = false
  let criticalVerdict: string | undefined

  // 1. Fetch package.json via Raw CDN
  const packageJsonRaw = await client.fetchRawFile(owner, repo, 'package.json', defaultBranch, signal)
  let packageJson: Record<string, unknown> | null = null

  if (packageJsonRaw) {
    try {
      packageJson = JSON.parse(packageJsonRaw) as Record<string, unknown>
    } catch {
      // Ignore JSON parse errors for non-standard package.json
    }
  }

  // 2. Scan lifecycle scripts and dependencies if package.json exists
  if (packageJson && typeof packageJson === 'object') {
    const scripts = (packageJson.scripts && typeof packageJson.scripts === 'object')
      ? (packageJson.scripts as Record<string, unknown>)
      : {}

    const lifecycleHookNames = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']
    for (const hookName of lifecycleHookNames) {
      const script = scripts[hookName]
      if (typeof script === 'string' && script.trim().length > 0) {
        installScripts.push(`${hookName}: ${script.trim()}`)

        // Check Critical Malware Patterns
        let matchedCritical = false
        for (const { pattern, reason } of CRITICAL_MALWARE_PATTERNS) {
          if (pattern.test(script)) {
            matchedCritical = true
            supplyChainFlags.push(`CRITICAL_INSTALL_SCRIPT(${hookName}: ${reason})`)
            break
          }
        }

        if (matchedCritical) {
          securityRisk = 'CRITICAL'
          scoreDeduction += 85
          forceGradeF = true
          criticalVerdict = 'High risk: Supply chain malware detected in lifecycle scripts (CRITICAL_INSTALL_SCRIPT).'
        } else {
          // Check whitelist for preinstall/install/postinstall
          if (['preinstall', 'install', 'postinstall'].includes(hookName)) {
            const isSafe = SAFE_HOOK_WHITELIST.some(regex => regex.test(script))
            if (isSafe) {
              supplyChainFlags.push(`HAS_LIFECYCLE_SCRIPT(${hookName})`)
              if (securityRisk === 'NONE') securityRisk = 'LOW'
            } else {
              supplyChainFlags.push(`SUSPICIOUS_INSTALL_HOOK(${hookName})`)
              scoreDeduction += 15
              if (securityRisk === 'NONE' || securityRisk === 'LOW') securityRisk = 'MEDIUM'
            }
          } else {
            supplyChainFlags.push(`HAS_LIFECYCLE_SCRIPT(${hookName})`)
            if (securityRisk === 'NONE') securityRisk = 'LOW'
          }
        }
      }
    }

    // Check unverified git dependencies
    const deps = {
      ...((packageJson.dependencies && typeof packageJson.dependencies === 'object') ? packageJson.dependencies as Record<string, string> : {}),
      ...((packageJson.devDependencies && typeof packageJson.devDependencies === 'object') ? packageJson.devDependencies as Record<string, string> : {}),
    }

    for (const [pkg, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && /^(github:|git\+https?:\/\/|git:\/\/)/i.test(spec)) {
        supplyChainFlags.push(`UNVERIFIED_GIT_DEPENDENCY(${pkg})`)
        scoreDeduction += 5
        if (securityRisk === 'NONE') securityRisk = 'LOW'
      }
    }
  }

  // 3. Cordis and DSH Plugin Static Permission Scan
  const hasDshBundle = packageJson && typeof packageJson === 'object' && packageJson.dsh && typeof (packageJson.dsh as Record<string, unknown>).bundle === 'object'
  const patchRaw = await client.fetchRawFile(owner, repo, 'cordis.patch.yml', defaultBranch, signal)
  const isDshPlugin = Boolean(hasDshBundle || patchRaw)

  if (isDshPlugin) {
    // Attempt to locate source entry file
    let entrySource: string | null = null
    const entryCandidates = ['src/index.ts', 'src/index.js', 'index.ts', 'index.js']

    if (packageJson?.main && typeof packageJson.main === 'string') {
      const mainPath = packageJson.main.replace(/^\.\//, '')
      entryCandidates.unshift(mainPath)
      if (mainPath.startsWith('lib/')) {
        entryCandidates.unshift(mainPath.replace(/^lib\//, 'src/').replace(/\.jsx?$/, '.ts'))
      }
    }

    for (const candidate of entryCandidates) {
      const content = await client.fetchRawFile(owner, repo, candidate, defaultBranch, signal)
      if (content) {
        entrySource = content
        break
      }
    }

    const combinedCode = `${patchRaw ?? ''}\n${entrySource ?? ''}`

    if (combinedCode.trim().length > 0) {
      // 3.1 Check sensitive Cordis service inject or Node dangerous operations
      const hasCredentialsInject = /\binject\s*=\s*\[[^\]]*['"]credentials['"][^\]]*\]/i.test(combinedCode) || /\bctx\.credentials\b/i.test(combinedCode)
      const hasPluginManagerInject = /\binject\s*=\s*\[[^\]]*['"]plugin_manager['"][^\]]*\]/i.test(combinedCode)
      const hasChildProcess = /\b(child_process|execSync|spawnSync|execFile)\b/i.test(combinedCode)

      if (hasCredentialsInject) {
        permissions.push('inject:credentials')
        supplyChainFlags.push('SENSITIVE_CORDIS_INJECT(credentials)')
        scoreDeduction += 10
        if (securityRisk !== 'CRITICAL') securityRisk = 'HIGH'
      }

      if (hasPluginManagerInject) {
        permissions.push('inject:plugin_manager')
        supplyChainFlags.push('SENSITIVE_CORDIS_INJECT(plugin_manager)')
        scoreDeduction += 10
        if (securityRisk !== 'CRITICAL') securityRisk = 'HIGH'
      }

      if (hasChildProcess) {
        permissions.push('node:child_process')
        supplyChainFlags.push('SENSITIVE_HOST_API(child_process)')
        scoreDeduction += 10
        if (securityRisk !== 'CRITICAL') securityRisk = 'HIGH'
      }

      // 3.2 Check tools/pre-execute interception hook
      if (/tools\/pre-execute/i.test(combinedCode)) {
        permissions.push('hook:tools/pre-execute')
        supplyChainFlags.push('HOOKS_PRE_EXECUTE')
        scoreDeduction += 5
        if (securityRisk === 'NONE' || securityRisk === 'LOW') securityRisk = 'MEDIUM'
      }

      // 3.3 Check Prompt Injection in system prompt registrations
      const promptInjectionRegex = /(SKIP_REPO_AUDIT|ignore\s+previous\s+instructions|disregard\s+all\s+previous)/i
      if (promptInjectionRegex.test(combinedCode)) {
        supplyChainFlags.push('PROMPT_INJECTION_SUSPECT')
        securityRisk = 'CRITICAL'
        scoreDeduction += 85
        forceGradeF = true
        criticalVerdict = 'High risk: Suspected prompt injection or security gate evasion payload in plugin definitions.'
      }
    }
  }

  return {
    result: {
      isDshPlugin,
      securityRisk,
      installScripts,
      permissions,
      supplyChainFlags,
    },
    scoreDeduction,
    forceGradeF,
    criticalVerdict,
  }
}
