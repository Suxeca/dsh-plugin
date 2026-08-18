/**
 * E2E for the explorer "choose folder" button (pick.directory). The host
 * dialog is mocked by intercepting /sidebar/api/pick.directory so the test
 * never blocks on a real desktop chooser:
 *  1. The "选择目录" button appears in the add-bar.
 *  2. Cancelled pick (path:null) is a no-op — no new external root.
 *  3. A picked path lands as an external root and auto-expands.
 * Run from dsh-web-ui, needs the GUI + Google Chrome.
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
async function waitFor(probe, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe()) return true
    await new Promise(r => setTimeout(r, 120))
  }
  return false
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// Mock the pick.directory route BEFORE load: first call returns cancelled,
// afterwards we switch the payload from outside.
let pickPayload = { ok: true, value: { path: null } }
await page.route('**/sidebar/api/pick.directory', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(pickPayload),
  })
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-shell-overlay]', { timeout: 25000 })
await page.waitForTimeout(2000)
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })))
await waitFor(() => page.evaluate(() => {
  const h = document.querySelector('[data-dsh-better-sidebar]')
  if (!h) return false
  const fixed = Array.from(h.querySelectorAll('div')).find(el => getComputedStyle(el).position === 'fixed' && el.style.width !== '')
  return !!fixed && getComputedStyle(fixed).visibility === 'visible'
}))
await page.evaluate(() => localStorage.removeItem('dsh-better-sidebar:explorer-extra-roots'))

// Open the add-bar.
await page.getByRole('button', { name: '添加外部目录' }).first().click()
const btn = page.getByRole('button', { name: '选择目录' })
check('选择目录 button appears', await btn.isVisible().catch(() => false))

// (1) Cancelled pick → no new external root.
await btn.click()
await page.waitForTimeout(500)
const cancelledNoRoot = await page.locator('[role="button"][title="/tmp"]').count()
check('cancelled pick adds no root', cancelledNoRoot === 0)

// (2) Picked path → external root added + auto-expanded.
pickPayload = { ok: true, value: { path: '/tmp' } }
await btn.click()
const added = await waitFor(() => page.locator('[role="button"][title="/tmp"]').count().then(c => c === 1).catch(() => false))
check('picked path adds /tmp root', added)
const prefix = await waitFor(() => page.getByText('外部目录').isVisible().catch(() => false))
check('外部目录 section appears', prefix)

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
