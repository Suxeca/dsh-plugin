/**
 * Test & Simulation for tools/pre-execute Gate of @suxeca/dsh-plugin-repo-auditor
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateStage1, compileAuditResult } from '../lib/heuristics.js'

test('tools/pre-execute Gate: Low credibility / hollow repo triggers ask approval', async () => {
  // 1. Simulate a hollow repo with 1500 fake stars, 2 forks, 0 watchers, 12 KB size
  const fakeRepo = {
    full_name: 'bot-farm/hollow-star-project',
    name: 'hollow-star-project',
    owner: { login: 'bot-farm' },
    stargazers_count: 1500,
    forks_count: 2,
    subscribers_count: 0,
    size: 12, // 12 KB < 30 KB
    open_issues_count: 0,
    created_at: new Date(Date.now() - 3600 * 1000 * 24 * 3).toISOString(),
    pushed_at: new Date().toISOString(),
    archived: false,
    fork: false,
    description: 'A completely hollow project boosted by fake stars',
    has_issues: true,
  }

  const stage1 = evaluateStage1(fakeRepo)
  const audit = compileAuditResult(fakeRepo, stage1)

  assert.equal(audit.grade, 'F', 'Grade must be F')
  assert.ok(audit.flags.includes('CRITICAL_LOW_FORK_RATIO'), 'Must detect CRITICAL_LOW_FORK_RATIO')
  assert.ok(audit.flags.includes('CRITICAL_LOW_WATCHER_RATIO'), 'Must detect CRITICAL_LOW_WATCHER_RATIO')
  assert.ok(audit.flags.includes('HOLLOW_REPO_SIZE'), 'Must detect HOLLOW_REPO_SIZE')
  assert.ok(audit.score <= 30, 'Score should be heavily penalized')

  // 2. Simulate the gate logic from src/index.ts
  function simulateGate(execName, execArgs, auditResult) {
    let targetRepo = null

    if (execName === 'plugin_manager') {
      if (execArgs?.action === 'install_bundle' && typeof execArgs.target === 'string') {
        const clean = execArgs.target.replace(/^(?:https?:\/\/)?github\.com\//i, '').replace(/\.git$/i, '')
        const parts = clean.split('/')
        if (parts.length >= 2) targetRepo = { owner: parts[0], repo: parts[1] }
      }
    }

    if (execName === 'bash') {
      const cmd = typeof execArgs?.command === 'string' ? execArgs.command : ''
      if (/SKIP_REPO_AUDIT=1/.test(cmd)) {
        return { kind: 'allow' }
      }
      const gitCloneMatch = cmd.match(/git\s+clone\s+(?:--\S+\s+)*(?:https?:\/\/github\.com\/|git@github\.com:)([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git|\/|\s|$)/i)
      if (gitCloneMatch) {
        targetRepo = { owner: gitCloneMatch[1], repo: gitCloneMatch[2] }
      }
    }

    if (!targetRepo) return { kind: 'allow' }

    const isHighRisk =
      auditResult.grade === 'D' ||
      auditResult.grade === 'F' ||
      auditResult.flags.includes('CRITICAL_LOW_FORK_RATIO') ||
      auditResult.flags.includes('HOLLOW_REPO_SIZE')

    if (isHighRisk) {
      const flagsDesc = auditResult.flags.length > 0 ? auditResult.flags.join(', ') : '异常指标'
      return {
        kind: 'ask',
        reason: `Repo ${targetRepo.owner}/${targetRepo.repo} has low credibility (Grade: ${auditResult.grade}, Score: ${auditResult.score}). Flags: ${flagsDesc}`,
        displayReason: {
          zh: `检测到目标仓库 ${targetRepo.owner}/${targetRepo.repo} 疑似刷星或空壳项目（评分 ${auditResult.score}/100，评级 ${auditResult.grade}，告警：${flagsDesc}）。确认要继续安装/执行吗？`,
          en: `Repository ${targetRepo.owner}/${targetRepo.repo} is suspected of fake stars or hollow codebase (Score: ${auditResult.score}/100, Grade: ${auditResult.grade}, Flags: ${flagsDesc}). Proceed with execution?`,
        },
      }
    }

    return { kind: 'allow' }
  }

  // 3. Test plugin_manager install_bundle interception
  const pmDecision = simulateGate('plugin_manager', {
    action: 'install_bundle',
    target: 'https://github.com/bot-farm/hollow-star-project',
  }, audit)

  assert.equal(pmDecision.kind, 'ask', 'plugin_manager should be intercepted with ask')
  assert.ok(pmDecision.displayReason.zh.includes('bot-farm/hollow-star-project'))
  assert.ok(pmDecision.displayReason.zh.includes('CRITICAL_LOW_FORK_RATIO'))
  assert.ok(pmDecision.displayReason.en.includes('Proceed with execution?'))

  // 4. Test bash git clone interception
  const bashDecision = simulateGate('bash', {
    command: 'git clone https://github.com/bot-farm/hollow-star-project.git',
  }, audit)

  assert.equal(bashDecision.kind, 'ask', 'git clone should be intercepted with ask')
  assert.ok(bashDecision.reason.includes('Grade: F'))

  // 5. Test escape hatch SKIP_REPO_AUDIT=1
  const bypassDecision = simulateGate('bash', {
    command: 'SKIP_REPO_AUDIT=1 git clone https://github.com/bot-farm/hollow-star-project.git',
  }, audit)

  assert.equal(bypassDecision.kind, 'allow', 'Escape hatch must allow immediately')
})
