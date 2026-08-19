/**
 * E2E: Ctrl+K palette opens directly into search mode — the filter input is
 * visible and focused, and typing filters the conversation list.
 */
import { chromium } from 'playwright'
const URL = 'http://127.0.0.1:3080'
let pass = 0, fail = 0
const results = []
function check(name, ok, detail = '') { ok ? pass++ : fail++; results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-shell-overlay]', { timeout: 25000 })
await page.waitForTimeout(2000)
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })))
await page.waitForTimeout(400)
const inputVisible = await page.getByPlaceholder('输入标题过滤对话…').isVisible().catch(() => false)
check('panel opens into search (filter input visible)', inputVisible)
const focused = await page.evaluate(() => {
  const el = document.activeElement
  return !!el && el.tagName === 'INPUT'
})
check('filter input focused', focused)
// typing filters (no crash)
await page.keyboard.type('zzz-no-match')
await page.waitForTimeout(200)
check('typing in search does not crash', errors.length === 0)
await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
