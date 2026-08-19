/**
 * E2E for Alt+U line-delete (Claude-Code-CLI style) in the focused composer:
 *  - caret mid-line: removes the line prefix before the caret
 *  - caret at line start: removes the whole previous line (incl. newline)
 *  - holding (auto-repeat keydowns) deletes repeatedly
 *  - selection present: deletes the selection first (standard editable)
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
async function altU(repeat = 1) {
  for (let i = 0; i < repeat; i++) {
    await page.keyboard.press('Alt+u')
  }
}

// 1. Mid-line: "12|34" -> delete "12" -> "34"
await setComposer('1234', 2)
await altU()
await page.waitForTimeout(120)
check('mid-line deletes prefix', (await composerValue()) === '34', `value=${JSON.stringify(await composerValue())}`)

// 2. Line-start: "abc\ndef\n|ghi" -> delete previous line "def\n" -> "abc\n|ghi"
await setComposer('abc\ndef\nghi', 8)
await altU()
await page.waitForTimeout(120)
check('line-start deletes previous line', (await composerValue()) === 'abc\nghi', `value=${JSON.stringify(await composerValue())}`)

// 3. Holding: "abc\ndef\nghi\n|jkl" with 3 repeats -> removes 3 previous lines -> "|jkl"
await setComposer('abc\ndef\nghi\njkl', 12)
await altU(3)
await page.waitForTimeout(150)
check('holding repeats deletes multiple lines', (await composerValue()) === 'jkl', `value=${JSON.stringify(await composerValue())}`)

// 4. Selection first: "hello world", select "hello" -> Alt+U deletes selection
await setComposer('hello world', 0, 5)
await altU()
await page.waitForTimeout(120)
check('selection deleted first', (await composerValue()) === ' world', `value=${JSON.stringify(await composerValue())}`)

check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
