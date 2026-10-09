#!/usr/bin/env node
/**
 * 把编译期/运行时需要的 DSH 包链到本包的 node_modules。
 *
 * 为什么需要这一步：`@deepseek-ai/dsh-tools` 在仓库根 node_modules 里的那份是
 * 装不全的（`autoInstallPeers: false`，它的 peer 依赖没落地），运行时会
 * `Cannot find package '@deepseek-ai/dsh-scope'`。生态既有做法（见
 * third-party/dsh-super-injector）是一律链到 **DSH 源码 checkout**——
 * 那正是当前运行的 harness 自己的那份，版本天然一致。
 *
 * 用法：`node scripts/link-checkout-deps.mjs`（DSH_CHECKOUT 可覆盖探测路径）。
 *
 * @module @suxeca/dsh-typesafe/scripts/link-checkout-deps
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 候选 checkout 路径：环境变量优先，其次本机常见位置。 */
function findCheckout() {
  const candidates = [
    process.env.DSH_CHECKOUT,
    '/home/suxeca/Workspace/deepseek-harness',
    join(process.env.HOME ?? '', 'dsh-harness'),
    join(process.env.HOME ?? '', '.dsh', 'dsh-harness'),
  ].filter((candidate) => typeof candidate === 'string' && candidate !== '')
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'packages', 'core', 'tools', 'lib', 'index.js'))) return candidate
  }
  return undefined
}

/** 需要链接的包：`@deepseek-ai/<name>` → checkout 内的相对路径。 */
const LINKS = [
  ['dsh-tools', 'packages/core/tools'],
]

const checkout = findCheckout()
if (checkout === undefined) {
  console.error('[dsh-typesafe] 找不到 DSH checkout（试过 DSH_CHECKOUT 与常见路径）。')
  console.error('[dsh-typesafe] 请设 DSH_CHECKOUT=<deepseek-harness 目录> 后重试。')
  process.exit(1)
}

console.log(`[dsh-typesafe] checkout: ${checkout}`)
for (const [name, relative] of LINKS) {
  const target = join(checkout, relative)
  const link = join(ROOT, 'node_modules', '@deepseek-ai', name)
  if (!existsSync(target)) {
    console.error(`[dsh-typesafe] 目标不存在：${target}`)
    process.exit(1)
  }
  mkdirSync(dirname(link), { recursive: true })
  rmSync(link, { recursive: true, force: true })
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  console.log(`[dsh-typesafe] @deepseek-ai/${name} -> ${target}`)
}
console.log('[dsh-typesafe] 链接就绪。')
