/**
 * E2E for Ctrl+C clearing the composer draft (Claude-Code-CLI cancel-input
 * style): without a selection it clears the whole text; with a selection the
 * native copy behavior is preserved (no clear). Outside editable fields the
 * browser copy is untouched.
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
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-shell-overlay]', { timeout: 25000 })
await page.waitForTimeout(2500)

async function setComposer(value, caretStart, caretEnd = caretStart) {
  await page.evaluate(({ value, caretStart, caretEnd }) => {
    const ta = Array.from(document.querySelectorAll('textarea')).find(t => t.offsetParent !== null)
    if (!ta) return
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.focus()
    ta.setSelectionRange(caretStart, caretEnd)
  }, { value, caretStart, caretEnd })
}
const composerValue = () => page.evaluate(() => {
  const ta = Array.from(document.querySelectorAll('textarea')).find(t => t.offsetParent !== null)
  return ta ? ta.value : null
})

// 1. No selection: Ctrl+C clears the whole draft.
await setComposer('hello world', 11)
await page.keyboard.press('Control+c')
await page.waitForTimeout(120)
check('no selection: Ctrl+C clears draft', (await composerValue()) === '', `value=${JSON.stringify(await composerValue())}`)

// 2. With selection: Ctrl+C preserves native copy (draft unchanged).
await setComposer('hello world', 0, 5)
await page.keyboard.press('Control+c')
await page.waitForTimeout(120)
check('selection: Ctrl+C keeps text (copy)', (await composerValue()) === 'hello world', `value=${JSON.stringify(await composerValue())}`)

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
