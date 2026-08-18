/**
 * Verify that a brand-new blank conversation starts with the right workbench
 * panel COLLAPSED (openByDefault=false). Reuses the panel visibility probing
 * from verify-shortcuts.mjs.
 */
import { chromium } from 'playwright'

const URL = 'http://127.0.0.1:3080'
let pass = 0
let fail = 0
const results = []
function check(name, ok, detail = '') {
  if (ok) pass += 1
  else fail += 1
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-shell-overlay]', { timeout: 20000 })

async function panelState() {
  return page.evaluate(() => {
    const host = document.querySelector('[data-dsh-better-sidebar]')
    if (!host) return { found: false }
    const fixed = Array.from(host.querySelectorAll('div')).filter(el => getComputedStyle(el).position === 'fixed')
    const right = fixed.find(el => el.style.width !== '')
    const vis = (el) => getComputedStyle(el).visibility === 'visible'
    return { found: true, rightOpen: !!right && vis(right), rightHidden: !!right && !vis(right) }
  })
}

// Click the New Session button (left rail/wide both expose aria-label 新建会话).
const newSession = page.getByRole('button', { name: '新建会话' }).first()
await newSession.click()
// Wait for the new session to mount (a blank conversation is current).
await page.waitForTimeout(1200)

const state = await panelState()
check('新会话右侧工作台默认折叠', state.found && state.rightHidden === true,
  `found=${state.found} open=${state.rightOpen} hidden=${state.rightHidden}`)
check('无页面错误', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
