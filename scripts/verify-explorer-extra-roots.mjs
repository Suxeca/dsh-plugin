/**
 * E2E for the explorer "external root" enhancement: add an absolute path
 * outside the session cwd, see it mount as a top-level root, expand it, and
 * reference/open files inside it. Also checks the add-input validation and
 * that the root persists across a reload.
 * Run from dsh-web-ui (playwright resolves), needs GUI + Google Chrome.
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
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-shell-overlay]', { timeout: 25000 })
await page.waitForTimeout(2000)

async function chord(key, mods = {}) {
  await page.evaluate(({ key, mods }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: false,
      bubbles: true, cancelable: true,
    }))
  }, { key, mods })
}

// Open the right workbench (it may be collapsed by default now).
await chord('b', { ctrl: true, shift: true })
const panelOpen = await waitFor(() => page.evaluate(() => {
  const host = document.querySelector('[data-dsh-better-sidebar]')
  if (!host) return false
  const fixed = Array.from(host.querySelectorAll('div')).find(el => getComputedStyle(el).position === 'fixed' && el.style.width !== '')
  return !!fixed && getComputedStyle(fixed).visibility === 'visible'
}))
check('right workbench opened', panelOpen)

// Clear any stale extra roots first (fresh browser context anyway).
await page.evaluate(() => localStorage.removeItem('dsh-better-sidebar:explorer-extra-roots'))

// Click the "＋ 添加外部目录" header button.
const addBtn = page.getByRole('button', { name: '添加外部目录' }).first()
await addBtn.click()
const inputVisible = await waitFor(() => page.getByPlaceholder('输入外部目录绝对路径，Enter 添加').isVisible().catch(() => false))
check('add-path input appears', inputVisible)

// Invalid path rejected.
await page.keyboard.type('not-an-absolute-path')
await page.keyboard.press('Enter')
const invalidShown = await waitFor(() => page.getByText('无效绝对路径').isVisible().catch(() => false))
check('invalid path shows error', invalidShown)

// Type a real absolute path outside the cwd (/tmp) and add it. Adding
// auto-expands the new root, so its children render immediately.
const rowsBeforeAdd = await page.evaluate(() =>
  document.querySelectorAll('[data-dsh-better-sidebar] [role="button"]').length)
await page.getByPlaceholder('输入外部目录绝对路径，Enter 添加').fill('/tmp')
await page.keyboard.press('Enter')
const tmpRowVisible = await waitFor(() =>
  page.locator('[role="button"][title="/tmp"]').count().then(c => c === 1).catch(() => false))
check('外部目录 /tmp root added', tmpRowVisible)
const grew = await waitFor(() => page.evaluate((base) =>
  document.querySelectorAll('[data-dsh-better-sidebar] [role="button"]').length > base, rowsBeforeAdd))
check('/tmp root auto-expands with children', grew)

// Click toggles collapse (children hide), click again re-expands.
await p_wait(600) // let the expanded /tmp level settle before clicking
const rowsAfterAdd = await page.evaluate(() =>
  document.querySelectorAll('[data-dsh-better-sidebar] [role="button"]').length)
await page.locator('[role="button"][title="/tmp"]').click()
const collapsed = await waitFor(() => page.evaluate((peak) => {
  const rows = document.querySelectorAll('[data-dsh-better-sidebar] [role="button"]').length
  return rows < peak - 30 // /tmp holds many entries; collapsing should drop well below the peak
}, rowsAfterAdd))
check('/tmp click collapses', collapsed)
await page.locator('[role="button"][title="/tmp"]').click()
const reexpanded = await waitFor(() => page.evaluate((peak) =>
  document.querySelectorAll('[data-dsh-better-sidebar] [role="button"]').length > peak - 5, rowsAfterAdd))
check('/tmp click re-expands', reexpanded)
function p_wait(ms) { return new Promise(r => setTimeout(r, ms)) }

// Persistence: the root survives a reload.
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-shell-overlay]', { timeout: 25000 })
await page.waitForTimeout(1500)
// The card may be collapsed after reload (openByDefault=false) — reopen.
await chord('b', { ctrl: true, shift: true })
await waitFor(() => page.getByText('外部目录').isVisible().catch(() => false))
const persisted = await page.locator('text=/^tmp$/').last().isVisible().catch(() => false)
check('extra root persists across reload', persisted)

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
