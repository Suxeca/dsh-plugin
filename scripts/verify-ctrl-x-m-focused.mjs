/**
 * E2E: Ctrl+X M now works while the composer textarea is focused (no
 * selection), while a real cut gesture (selection present) still keeps its
 * native behavior — the sequence must NOT hijack Ctrl+X when text is
 * selected.
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
await page.waitForTimeout(2500)

const composerValue = () => page.evaluate(() => {
  const ta = Array.from(document.querySelectorAll('textarea')).find(t => t.offsetParent !== null)
  return ta ? ta.value : null
})
async function focusComposer() {
  await page.evaluate(() => {
    const ta = Array.from(document.querySelectorAll('textarea')).find(t => t.offsetParent !== null)
    ta?.focus()
  })
}

// 1. Focus composer (empty), no selection, Ctrl+X then M → /model inserted.
await focusComposer()
await page.keyboard.press('Control+x')
await page.keyboard.press('m')
const inserted = await waitFor(async () => (await composerValue())?.includes('/model') ?? false)
check('focused composer: Ctrl+X M inserts /model', inserted, `value=${JSON.stringify(await composerValue())}`)

// 2. Focus composer with a selection, Ctrl+X must NOT arm /model (cut path).
await page.evaluate(() => {
  const ta = Array.from(document.querySelectorAll('textarea')).find(t => t.offsetParent !== null)
  if (!ta) return
  ta.value = 'hello world'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  ta.focus()
  ta.setSelectionRange(0, 5)
})
await page.keyboard.press('Control+x')
await page.keyboard.press('m')
await page.waitForTimeout(400)
const afterCut = await composerValue()
check('selection present: Ctrl+X M does not hijack cut', afterCut !== null && !afterCut.includes('/model'),
  `value=${JSON.stringify(afterCut)}`)

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
