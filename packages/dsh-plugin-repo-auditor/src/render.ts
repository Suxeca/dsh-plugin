/**
 * Markdown report renderer for GitHub Repo Auditor (v0.2.0).
 */

import type { BatchAuditOutput, RepoAuditResult, SecurityRiskLevel } from './types.js'

function gradeEmoji(grade: RepoAuditResult['grade']): string {
  switch (grade) {
    case 'A': return '🟢 A (极高可信)'
    case 'B': return '🔵 B (正常)'
    case 'C': return '🟡 C (轻微偏离)'
    case 'D': return '🟠 D (疑似异常)'
    case 'F': return '🔴 F (高危风险)'
  }
}

function riskEmoji(risk?: SecurityRiskLevel): string {
  switch (risk) {
    case 'CRITICAL': return '🔥 恶意/极高危'
    case 'HIGH': return '🔴 高危'
    case 'MEDIUM': return '🟡 中危'
    case 'LOW': return '🔵 低危'
    case 'NONE': return '🟢 安全'
    default: return '⚪ 未检'
  }
}

export function renderMarkdownReport(data: BatchAuditOutput): string {
  const lines: string[] = []

  lines.push('### 🛡️ GitHub 仓库真实性与防刷星审计报告 (CMU Heuristics & Supply Chain)')
  lines.push('')

  if (data.audits.length === 0) {
    lines.push('_未审计任何仓库。_')
    return lines.join('\n')
  }

  // Summary Table
  lines.push('| 仓库 (Repository) | 评分 | 评级 | 供应链安全 | Stars | Fork 比率 | Watcher 比率 | 异常标记 | 结论 |')
  lines.push('| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :--- |')

  for (const item of data.audits) {
    if (item.error) {
      lines.push(`| [${item.repo}](https://github.com/${item.repo}) | - | ⚠️ 失败 | - | - | - | - | \`ERROR\` | ${item.error} |`)
      continue
    }

    const flagsStr = item.flags.length > 0 ? item.flags.map(f => `\`${f}\``).join(', ') : '无 (None)'
    const forkRatioPct = `${(item.forkRatio * 100).toFixed(2)}%`
    const watcherRatioPct = `${(item.watcherRatio * 100).toFixed(2)}%`
    const cachedBadge = item.cached ? ' *(缓存)*' : ''
    const scBadge = riskEmoji(item.supplyChain?.securityRisk)

    lines.push(
      `| [${item.repo}](https://github.com/${item.repo})${cachedBadge} | **${item.score}** | ${gradeEmoji(item.grade)} | ${scBadge} | ${item.stars.toLocaleString()} | ${forkRatioPct} | ${watcherRatioPct} | ${flagsStr} | ${item.verdict} |`
    )
  }

  lines.push('')

  // Detailed Analysis Section
  for (const item of data.audits) {
    if (item.error) continue

    lines.push(`#### 📦 审计详情: \`${item.repo}\``)
    lines.push(`- **基本指标**: Stars: \`${item.stars}\` | Forks: \`${item.forks}\` | Watchers: \`${item.watchers}\` | 体积: \`${item.sizeKb} KB\` | 活跃周期: \`${item.lifespanDays} 天\` | Open Issues: \`${item.openIssues}\``)
    lines.push(`- **CMU 论文启发式指标分析**:`)
    lines.push(`  - Fork / Star 比率: \`${(item.forkRatio * 100).toFixed(2)}%\` (正常参考值 ≥ 5%；< 2% 为严重异常)`)
    lines.push(`  - Watcher / Star 比率: \`${(item.watcherRatio * 100).toFixed(3)}%\` (正常参考值 ≥ 0.5%；< 0.1% 为严重异常)`)
    lines.push(`  - 代码与星标密度: \`${item.sizeKb < 30 && item.stars >= 100 ? '⚠️ 空壳代码警告 (Star >= 100 且体积 < 30KB)' : '正常'}\``)

    // Supply chain and permissions details
    if (item.supplyChain) {
      const sc = item.supplyChain
      lines.push(`- **🔒 供应链与 DSH 插件权限预检**:`)
      lines.push(`  - 仓库形态: \`${sc.isDshPlugin ? 'DSH 官方/第三方插件包' : '标准开源仓库'}\` | 安全风险等级: **${riskEmoji(sc.securityRisk)}**`)
      if (sc.installScripts.length > 0) {
        lines.push(`  - 自动执行脚本 (Lifecycle Hooks):`)
        for (const s of sc.installScripts) {
          lines.push(`    - \`${s}\``)
        }
      } else {
        lines.push(`  - 自动执行脚本: _无生命周期安装钩子 (无 preinstall/postinstall 等风险)_`)
      }

      if (sc.permissions.length > 0) {
        lines.push(`  - 宿主敏感权限/能力调用:`)
        for (const p of sc.permissions) {
          lines.push(`    - \`${p}\``)
        }
      } else if (sc.isDshPlugin) {
        lines.push(`  - 宿主敏感权限: _纯净无特权 (未请求 credentials/child_process/pre-execute 等特权)_`)
      }

      if (sc.supplyChainFlags.length > 0) {
        lines.push(`  - 供应链安全告警: ${sc.supplyChainFlags.map(f => `\`${f}\``).join(' ')}`)
      }
    }

    if (item.sampledCount !== undefined && item.sampledCount > 0) {
      const botPct = ((item.botSampleRatio ?? 0) * 100).toFixed(1)
      lines.push(`- **Stargazer 水军账号抽样**: 抽检最新点赞用户 \`${item.sampledCount}\` 名，检出低质量/水军账号 \`${item.lowQualityCount}\` 名 (占比 **${botPct}%**)`)
      if (item.suspiciousSamples && item.suspiciousSamples.length > 0) {
        lines.push(`  - **疑似水军账号特征摘要**:`)
        for (const s of item.suspiciousSamples.slice(0, 5)) {
          const reasonDesc = s.reason === 'hollow_account' ? '三无空白账号 (0仓库/0关注/无Bio/无公司)' : `新注册闪电水军 (注册仅 ${s.accountAgeDays} 天)`
          lines.push(`    - @${s.login}: ${reasonDesc}`)
        }
      }
    } else {
      const reason = item.score >= 85
        ? `一阶指标高度健康 (得分 ${item.score} ≥ 85)，触发动态配额保护，已跳过二级点赞者抽样`
        : `免鉴权配额限制或超时保护，已跳过二级点赞者抽样`
      lines.push(`- **Stargazer 水军抽样**: _${reason}_`)
    }

    if (item.flags.length > 0) {
      lines.push(`- **告警项**: ${item.flags.map(f => `\`${f}\``).join(' ')}`)
    }
    lines.push('')
  }

  // Quota & Rate Limit Footer
  lines.push('---')
  if (data.rateLimitRemaining !== undefined) {
    const total = data.rateLimitLimit ? ` / ${data.rateLimitLimit}` : ''
    lines.push(`💡 **GitHub API 配额状态**: 当前剩余 \`${data.rateLimitRemaining}${total}\` 次请求。`)
    if (data.rateLimitLimit === 60) {
      lines.push('*(提示: 当前处于免鉴权 60次/小时 模式。若需频繁大批量审计，建议在插件设置或环境变量中配置 GITHUB_TOKEN)*')
    }
  }

  return lines.join('\n')
}
