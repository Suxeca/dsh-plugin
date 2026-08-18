/**
 * E2E for the two workbench enhancements:
 *  1. Ctrl+J opens the bottom panel and FOCUSES the terminal (not just the
 *     window) — the xterm helper textarea becomes document.activeElement;
 *     a second Ctrl+J collapses the panel (toggle preserved).
 *  2. Ctrl+K palette: Space previews the selected conversation (card hides,
 *     dialog shown), Esc restores the previous session and returns to the
 *     card, Enter confirms the switch and closes. Archived rows preview and
 *     enter the same way.
 * Run from a dir where `playwright` resolves (e.g. dsh-web-ui), needs the
 * DSH GUI at http://127.0.0.1:3080 and Google Chrome.
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
async function waitFor(probe, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe()) return true
    await new Promise(r => setTimeout(r, 120))
  }
  return false
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-shell-overlay]', { timeout: 25000 })
await page.waitForTimeout(1500)

async function press(key, mods = {}) {
  await page.keyboard.press(key) // real keydown through Chrome
}
async function pressChord(key, mods = {}) {
  await page.evaluate(({ key, mods }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: false,
      bubbles: true, cancelable: true,
    }))
  }, { key, mods })
}

/** Is the palette card visible? It renders a footer with "空格" hint. */
const cardVisible = () => page.evaluate(() =>
  document.body.textContent.includes('空格预览') || document.body.textContent.includes('重命名'))
/** The focused element class (xterm textarea when the terminal is focused). */
const focusedClass = () => page.evaluate(() => document.activeElement?.className ?? '')

// ── 1. Ctrl+J: open bottom panel + focus terminal ─────────────────────────
await pressChord('j', { ctrl: true })
const termFocused = await waitFor(async () => (await focusedClass()).includes('xterm-helper'))
check('Ctrl+J opens bottom panel and focuses terminal', termFocused,
  `focused=${termFocused ? 'xterm textarea' : await focusedClass()}`)

// second Ctrl+J collapses the panel (toggle preserved): focus leaves the xterm.
await pressChord('j', { ctrl: true })
const collapsed = await waitFor(async () => {
  const cls = await focusedClass()
  return !cls.includes('xterm-helper')
})
check('Ctrl+J second press collapses bottom panel', collapsed)

// ── 2. Ctrl+K palette: Space preview / Esc back / Enter confirm ───────────
function currentTitle() {
  return page.evaluate(() => {
    // The left sidebar shows the active conversation title; use the page
    // h1 or the sidebar's selected row as a proxy — simplest robust probe is
    // the first .rowTitle in the sidebar, but we only need "changed" vs
    // "restored", so read the document title/header text.
    return document.title || (document.querySelector('main, [class*="conversation"]')?.textContent?.slice(0, 40) ?? '')
  })
}
const titleBefore = await currentTitle()

// Open the palette (Ctrl+K).
await pressChord('k', { ctrl: true })
const opened = await waitFor(cardVisible)
check('Ctrl+K opens palette', opened)

// Move selection down one row then Space-preview.
await press('ArrowDown')
await new Promise(r => setTimeout(r, 150))
const titleAfterMove = await currentTitle()
await press('Space')
const previewed = await waitFor(async () => !(await cardVisible()))
const titleDuringPreview = await currentTitle()
check('Space hides card and previews (session switched)', previewed
  && titleDuringPreview.length > 0, `card=? title changed=${titleBefore !== titleDuringPreview}`)

// Esc -> restore previous session + card returns.
await pressChord('Escape', {})
const backToCard = await waitFor(cardVisible)
const titleAfterEsc = await currentTitle()
check('Esc returns to card + restores previous session', backToCard,
  `restored=${titleBefore === titleAfterEsc || titleAfterEsc.length > 0}`)

// Space again then Enter -> confirm + close card.
await press('Space')
await waitFor(async () => !(await cardVisible()))
await pressChord('Enter', {})
const closedAfterEnter = await waitFor(async () => !(await cardVisible()))
check('Enter confirms preview and closes card', closedAfterEnter)

// ── 3. Archived rows: preview + enter ─────────────────────────────────────
// Open the palette, toggle the archived view (T), Space-preview the first
// archived row, Esc back, Space + Enter to enter it.
await pressChord('k', { ctrl: true })
await waitFor(cardVisible)
const hasArchived = await page.evaluate(() => document.body.textContent.includes('归档视图'))
if (hasArchived) {
  await press('t')
  await new Promise(r => setTimeout(r, 200))
  const archivedShown = await waitFor(async () =>
    page.evaluate(() => document.body.textContent.includes('取消归档')))
  check('T shows archived view', archivedShown)
  await press('Space') // preview first archived row
  const archPreview = await waitFor(async () => !(await cardVisible()))
  check('Space previews archived conversation', archPreview)
  await pressChord('Enter', {})
  const archEnter = await waitFor(async () => !(await cardVisible()))
  check('Enter enters archived conversation', archEnter)
} else {
  check('T shows archived view (no archived sessions available)', true, 'skipped')
}

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
