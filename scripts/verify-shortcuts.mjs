/**
 * E2E verification for the layout/workbench shortcut chords.
 * Launch headless Chromium against the running DSH GUI and assert:
 *  - Ctrl+B toggles the left sidebar (frame data-sidebar-collapsed)
 *  - Alt+Shift+L / Esc toggles left sidebar fullscreen (data-left-fullscreen)
 *  - Ctrl+Shift+B toggles the right workbench panel (visibility)
 *  - Ctrl+J toggles the bottom panel (visibility)
 *  - Alt+Shift+R / Esc toggles right workbench fullscreen (z-index 54)
 * Assertions poll up to 2s — panel visibility flips after the slide-out
 * transition, not synchronously with the keydown.
 *
 * Run: copy to a dir where `playwright` resolves (e.g. dsh-web-ui's
 * node_modules), then `node verify-shortcuts.mjs` — requires the DSH GUI
 * running at http://127.0.0.1:3080 and Google Chrome installed (launches
 * with channel 'chrome').
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

/** Poll `probe` until it returns true or the timeout expires. */
async function waitFor(probe, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe()) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`) })

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-shell-overlay]', { timeout: 20000 })

async function press(key, mods = {}) {
  await page.evaluate(({ key, mods }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, metaKey: false,
      bubbles: true, cancelable: true,
    }))
  }, { key, mods })
}

const frameAttr = (attr) => page.evaluate((a) =>
  document.querySelector('div[data-shell-overlay]')?.parentElement?.getAttribute(a) ?? null, attr)

/** The right panel and the bottom panel: fixed elements with inline width /
 *  height inside the sidebar host; open = visibility visible. */
async function panelState() {
  return page.evaluate(() => {
    const host = document.querySelector('[data-dsh-better-sidebar]')
    if (!host) return { found: false }
    const fixed = Array.from(host.querySelectorAll('div')).filter(el => getComputedStyle(el).position === 'fixed')
    const right = fixed.find(el => el.style.width !== '')
    const bottom = fixed.find(el => el.style.width === '' && el.style.height !== '')
    const vis = (el) => getComputedStyle(el).visibility === 'visible'
    return {
      found: true,
      rightOpen: !!right && vis(right),
      rightHidden: !!right && !vis(right),
      rightZ: right ? getComputedStyle(right).zIndex : null,
      bottomOpen: !!bottom && vis(bottom),
      bottomHidden: !!bottom && !vis(bottom),
    }
  })
}

// 1. Ctrl+B: collapse (attr appears, value "true") then re-expand (attr gone).
const before = await frameAttr('data-sidebar-collapsed')
await press('b', { ctrl: true })
const collapsed = await waitFor(() => frameAttr('data-sidebar-collapsed').then(v => v !== null))
check('Ctrl+B collapses left sidebar', before === null && collapsed, `before=${before}`)
await press('b', { ctrl: true })
const reopened = await waitFor(() => frameAttr('data-sidebar-collapsed').then(v => v === null))
check('Ctrl+B re-expands left sidebar', reopened)

// 2. Alt+Shift+L: left fullscreen; Esc exits.
await press('l', { alt: true, shift: true })
const fsOn = await waitFor(() => frameAttr('data-left-fullscreen').then(v => v !== null))
check('Alt+Shift+L enters left fullscreen', fsOn)
await press('Escape')
const fsOff = await waitFor(() => frameAttr('data-left-fullscreen').then(v => v === null))
check('Esc exits left fullscreen', fsOff)

// 3. Ctrl+Shift+B: right workbench panel open ⟷ closed.
const p0 = await panelState()
await press('b', { ctrl: true, shift: true })
const closed = await waitFor(async () => (await panelState()).rightHidden === true)
check('Ctrl+Shift+B closes right panel', p0.found && p0.rightOpen === true && closed, `initOpen=${p0.rightOpen}`)
await press('b', { ctrl: true, shift: true })
const reopenedRight = await waitFor(async () => (await panelState()).rightOpen === true)
check('Ctrl+Shift+B re-opens right panel', reopenedRight)

// 4. Ctrl+J: bottom panel open ⟷ closed.
const b0 = await panelState()
await press('j', { ctrl: true })
const bottomOpened = await waitFor(async () => (await panelState()).bottomOpen === true)
check('Ctrl+J opens bottom panel', b0.found && b0.bottomOpen === false && bottomOpened, `initOpen=${b0.bottomOpen}`)
await press('j', { ctrl: true })
const bottomClosed = await waitFor(async () => (await panelState()).bottomHidden === true)
check('Ctrl+J closes bottom panel', bottomClosed)

// 5. Alt+Shift+R: right fullscreen (z-index 54); Esc exits.
await press('r', { alt: true, shift: true })
const fsR = await waitFor(async () => (await panelState()).rightZ === '54')
check('Alt+Shift+R fullscreens right panel', fsR)
await press('Escape')
const fsRoff = await waitFor(async () => (await panelState()).rightZ === '50')
check('Esc exits right fullscreen', fsRoff)

// 6. IME guard: composing Ctrl+B must NOT toggle.
const beforeIme = await frameAttr('data-sidebar-collapsed')
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'b', ctrlKey: true, isComposing: true, keyCode: 229, bubbles: true, cancelable: true,
  }))
})
await page.waitForTimeout(300)
const afterIme = await frameAttr('data-sidebar-collapsed')
check('IME-composing Ctrl+B ignored', beforeIme === afterIme)

// 7. Reload keeps the GUI alive (bundles load without page errors).
await page.reload({ waitUntil: 'domcontentloaded' })
const frameAfterReload = await page.waitForSelector('[data-shell-overlay]', { timeout: 20000 }).then(() => true).catch(() => false)
check('GUI reloads cleanly after rebuild', frameAfterReload === true)
const pageErrors = errors.filter(e => !e.includes('favicon'))
check('No page errors during test', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
