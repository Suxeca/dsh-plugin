/**
 * E2E for the two new session-switcher shortcuts:
 *  1. Ctrl+Shift+M toggles between the conversation (data-view=dialog) and
 *     the dsh-synapse conversation map (data-view=map).
 *  2. Ctrl+X then M (non-editable focus) inserts `/model` into the composer
 *     so DSH's slash trigger pulls up the model popup.
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
async function waitFor(probe, timeoutMs = 6000) {
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

async function chord(key, mods = {}) {
  await page.evaluate(({ key, mods }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: false,
      bubbles: true, cancelable: true,
    }))
  }, { key, mods })
}

const viewState = () => page.evaluate(() => {
  const map = document.querySelector('button[data-view="map"]')
  const dialog = document.querySelector('button[data-view="dialog"]')
  if (!map || !dialog) return null
  const active = (el) => el.getAttribute('aria-pressed') === 'true' || el.classList.contains('active')
  return { mapActive: active(map), dialogActive: active(dialog) }
})

// ── 1. Ctrl+Shift+M: toggle conversation / conversation map ───────────────
const hasSynapse = await page.evaluate(() => !!document.querySelector('button[data-view="map"]'))
if (!hasSynapse) {
  check('dsh-synapse view switch present', false, 'no [data-view] buttons found')
} else {
  const before = await viewState()
  await chord('m', { ctrl: true, shift: true })
  const toMap = await waitFor(async () => (await viewState())?.mapActive === true)
  check('Ctrl+Shift+M switches to 会话地图', toMap, `before=${JSON.stringify(before)}`)
  await chord('m', { ctrl: true, shift: true })
  const backDialog = await waitFor(async () => (await viewState())?.dialogActive === true)
  check('Ctrl+Shift+M switches back to 对话', backDialog)
}

// ── 2. Ctrl+X then M: pull up /model ──────────────────────────────────────
// Make sure focus is NOT in an editable field first.
await page.evaluate(() => { document.activeElement?.blur?.() })
const composerBefore = await page.evaluate(() => {
  const ta = Array.from(document.querySelectorAll('textarea')).find(t => t.offsetParent !== null)
  return ta ? ta.value : null
})
await chord('x', { ctrl: true }) // arm prefix
await chord('m', {}) // trigger M
const modelInserted = await waitFor(() => page.evaluate(() => {
  const ta = Array.from(document.querySelectorAll('textarea')).find(t => t.offsetParent !== null)
  return ta !== undefined && ta.value.includes('/model')
}))
check('Ctrl+X M inserts /model into composer', modelInserted,
  `before=${JSON.stringify(composerBefore)}`)

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
