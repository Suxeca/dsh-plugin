import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8')
const mobileLayout = css.slice(css.indexOf('/* Mobile canvas presentation'))

test('mobile map separates the view switch and horizontally scrollable controls', () => {
  const mobile = mobileLayout
  assert.match(mobile, /grid-template-rows:\s*96px minmax\(0, 1fr\)/)
  assert.match(mobile, /\.canvas-controls[\s\S]*top:\s*50px/)
  assert.match(mobile, /overflow-x:\s*auto/)
  assert.match(mobile, /white-space:\s*nowrap/)
})

test('mobile cards use bounded viewport-aware geometry and a four-column footer', () => {
  const mobile = mobileLayout
  assert.match(mobile, /width:\s*min\(320px, calc\(100vw - 28px\)\)/)
  assert.match(mobile, /height:\s*clamp\(230px, 34dvh, 300px\)/)
  assert.match(mobile, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(mobile, /text-size-adjust:\s*100%/)
})

test('mobile initial camera uses the same 14px edge clearance as card CSS', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  const camera = app.slice(app.indexOf('function initialCanvasCamera'), app.indexOf('function placeConversationCards'))
  assert.match(camera, /Math\.max\(14, \(globalThis\.innerWidth - mobileCardWidth\) \/ 2\)/)
})

test('mobile load-conversation button opens a touch picker backed by loadSessionToMap', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8')
  assert.match(app, /class="load-session-button" data-action="open-session-picker">加载对话/)
  assert.match(app, /function renderSessionPicker\(\)/)
  assert.match(app, /data-action="load-session" data-session-id=/)
  assert.match(app, /await loadSessionToMap\(sessionId, sessionSummaryById\(sessionId\)\)/)
  assert.match(app, /state\.sessionPickerOpen = false[\s\S]*resetCanvasCamera\(\)[\s\S]*render\(\)/)
})

test('mobile session picker is a safe-area aware bottom sheet', () => {
  const mobile = css.slice(css.lastIndexOf('@media (max-width: 560px)'))
  assert.match(mobile, /\.session-picker[\s\S]*position:\s*fixed/)
  assert.match(mobile, /\.session-picker-sheet[\s\S]*max-height:\s*min\(72dvh, 620px\)/)
  assert.match(mobile, /env\(safe-area-inset-bottom\)/)
})
