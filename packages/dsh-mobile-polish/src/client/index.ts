/** Android/mobile layout refinements & image attachment support for DSH web UI. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Context service augmentations (rc.1): the old `dsh-client-runtime/client`
// re-exported these implicitly. Each augmenting module must be imported for its
// `declare module '@deepseek-ai/cordis'` block to apply.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ImageUploadButton } from './ImageUploadButton.tsx'
import { MobileControls } from './MobileControls.tsx'
import { installViewportLock } from './viewport-lock.ts'
import { installFilePreviewRecovery } from './file-preview-recovery.ts'

export const STYLE_ID = '@suxeca/dsh-mobile-polish/styles'
export const inject = ['slots']

export const MOBILE_CSS = `
@media (max-width: 768px) {
  /* A fullscreen document owns its tab strip; floating switches must not cover it. */
  body:has([data-sidebar-right-panel='fullscreen'][data-sidebar-right-open]) .dsh-synapse-switch {
    display: none !important;
  }
  [data-document-preview] [data-textpreview-body] {
    min-width: 0;
    overflow-wrap: anywhere;
    -webkit-overflow-scrolling: touch;
  }
  [data-document-preview] pre {
    max-width: 100%;
    overflow-x: auto;
    white-space: pre;
  }
  [data-document-preview] img {
    max-width: 100%;
    height: auto;
  }
  [data-mobile-file-recovery] {
    max-width: 280px;
    padding: 16px;
    text-align: center;
    color: var(--dsw-alias-label-secondary);
  }
  [data-mobile-file-recovery] button {
    min-height: 44px;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--dsw-alias-border-l2);
    background: var(--dsw-specific-input-major);
    color: var(--dsw-alias-label-primary);
    cursor: pointer;
  }
}

/* 移动端顶栏净化：隐藏右上角冗余全屏/小鲸鱼按钮，保留精简的日月灯双半圆视图切换 */
@media (max-width: 768px) {
  [data-mobile-controls] {
    display: none !important;
  }
}

/* Clean composer toolbar: hide redundant '+' commands button (triggered directly via '/' in textarea). */
[data-composer-card] button[aria-label='命令'],
[data-composer-card] button[aria-label='Commands'] {
  display: none !important;
}

/* Runtime switch for the separately loaded whale animation plugin. */
html[data-dsh-whale-disabled] .Md3f7G_turnStatus::after,
html[data-dsh-whale-disabled] [class*='_turnStatus']::after {
  display: none !important;
  content: none !important;
  background-image: none !important;
}

@media (max-width: 600px) {
  /* Android keyboard lock: the whole frame rides the *visible* viewport
     (--dsh-mobile-vv-height, published by the visualViewport sync below), so
     the sticky composer sits above the keyboard when it opens and back on the
     screen floor when it closes — it can never be stranded mid-screen by
     Chrome's residual visual-viewport pan after a send (the "input box jumps
     up, the 停止生成 tooltip ghost floats alone at the bottom" symptom).
     The attribute is only set while visualViewport exists on a narrow coarse
     pointer device, so desktop and plain 100%-height layouts are untouched.
     The :root[attr] form outranks the focus-mode html[attr] rules (equal
     specificity otherwise), which is what lets min-height:0 beat its 100dvh. */
  :root[data-dsh-mobile-vv],
  :root[data-dsh-mobile-vv] body,
  :root[data-dsh-mobile-vv] #root {
    height: var(--dsh-mobile-vv-height, 100%) !important;
    min-height: 0 !important;
    overflow: hidden !important;
  }

  /* Focus mode's fixed full-bleed slot rides the same lock: inset:0 would
     pin it to the (stale) layout viewport and strand the composer behind the
     keyboard; the explicit height keeps it on the visible area. */
  :root[data-dsh-mobile-vv][data-dsh-conversation-focus] [data-slot='conversation'] {
    height: var(--dsh-mobile-vv-height, 100dvh) !important;
  }

  /* Conversation focus mode is strictly mobile-only: it must never alter desktop
     shell geometry, sidebar columns or top navigation pills. */
  html[data-dsh-conversation-focus],
  html[data-dsh-conversation-focus] body {
    width: 100% !important;
    height: 100% !important;
    min-height: 100dvh !important;
    overflow: hidden !important;
  }

  /* Android browsers often place a native floating control over the upper-right
     corner in fullscreen. Move our exit control to the free upper-left seat. */
  html[data-dsh-conversation-focus] [data-mobile-controls] {
    top: max(8px, env(safe-area-inset-top)) !important;
    right: auto !important;
    left: max(8px, env(safe-area-inset-left)) !important;
  }

  html[data-dsh-conversation-focus] .dsh-synapse-switch {
    visibility: hidden !important;
    pointer-events: none !important;
  }

  html[data-dsh-conversation-focus] [data-slot='conversation'] {
    position: fixed !important;
    inset: 0 !important;
    z-index: 60 !important;
    display: block !important;
    width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    max-width: none !important;
    overflow: hidden !important;
    isolation: isolate;
  }

  html[data-dsh-conversation-focus] [data-slot='conversation'] > *,
  html[data-dsh-conversation-focus] [data-conversation-scroll] {
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
  }

  /* These are explicit, framework-owned seats rather than positional children:
     hiding them cannot remove the resident conversation root. */
  html[data-dsh-conversation-focus] [data-slot='conversation.session.header'],
  html[data-dsh-conversation-focus] [data-composer-seat] {
    display: none !important;
  }

  html[data-dsh-conversation-focus] [data-conversation-scroll] {
    flex: 1 1 auto !important;
    box-sizing: border-box !important;
    padding-top: 48px !important;
    --dsh-composer-height: 0px !important;
  }

  html[data-dsh-conversation-focus] [data-sidebar-collapsed] > :first-child [data-slot='sidebar'] > * > :first-child {
    visibility: hidden !important;
    pointer-events: none !important;
  }
}

/* ── Mobile Settings Modal Optimization (Full width + Horizontal tabs + Roomy content) ── */
@media (max-width: 768px) {
  /* Settings root panel: full-screen layout on phone */
  [role="dialog"][aria-modal="true"]:has(nav),
  [class*="_panel"]:has([class*="_nav"]) {
    width: 100vw !important;
    height: 100% !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    max-height: 100dvh !important;
    border-radius: 0 !important;
    flex-direction: column !important;
    margin: 0 !important;
  }

  /* Nav rail converts to top horizontal scrolling tabs */
  [role="dialog"][aria-modal="true"] > nav,
  [class*="_panel"] > [class*="_nav"] {
    width: 100% !important;
    flex-direction: row !important;
    align-items: center !important;
    overflow-x: auto !important;
    padding: 10px 16px 6px !important;
    gap: 8px !important;
    border-bottom: 1px solid var(--dsw-alias-border-l2) !important;
    flex: none !important;
    -webkit-overflow-scrolling: touch;
  }

  [role="dialog"][aria-modal="true"] > nav > :first-child,
  [class*="_panel"] [class*="_navTitle"] {
    display: none !important;
  }

  [role="dialog"][aria-modal="true"] > nav > :nth-child(2),
  [class*="_panel"] [class*="_navList"] {
    flex-direction: row !important;
    overflow-x: auto !important;
    gap: 6px !important;
    width: 100% !important;
    flex-wrap: nowrap !important;
    scrollbar-width: none;
  }

  [role="dialog"][aria-modal="true"] > nav > :nth-child(2)::-webkit-scrollbar,
  [class*="_panel"] [class*="_navList"]::-webkit-scrollbar {
    display: none !important;
  }

  [role="dialog"][aria-modal="true"] > nav > :nth-child(2) button,
  [class*="_panel"] [class*="_navCell"] {
    flex: none !important;
    height: 34px !important;
    padding: 6px 12px !important;
    border-radius: 10px !important;
    white-space: nowrap !important;
    font-size: 13px !important;
  }

  /* Content area takes 100% width and remaining height */
  [role="dialog"][aria-modal="true"] > div,
  [class*="_panel"] > [class*="_content"] {
    flex: 1 !important;
    min-width: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
  }

  [role="dialog"][aria-modal="true"] > div > :first-child,
  [class*="_panel"] [class*="_header"] {
    padding: 8px 16px !important;
    height: 44px !important;
    min-height: 44px !important;
  }

  [role="dialog"][aria-modal="true"] > div > :nth-child(2),
  [class*="_panel"] [class*="_options"] {
    padding: 0 16px 32px !important;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch !important;
  }

  /* General settings rows: remove desktop 48px padding-right */
  [data-slot="settings.general.item"] [class*="_rowText"],
  [class*="_rowText"] {
    padding-right: 8px !important;
  }

  /* Theme cubes: 3 cubes fit nicely in one line */
  [class*="_cubeRow"] {
    gap: 6px !important;
  }
  [class*="_themeCube"] {
    flex: 1 1 80px !important;
    padding: 12px 6px !important;
    border-radius: 12px !important;
  }
}

@media (max-width: 480px) {
  [data-slot="settings.general.item"] [class*="_row"] {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 8px !important;
  }

  [data-slot="settings.general.item"] [class*="_rowText"] {
    padding-right: 0 !important;
    width: 100% !important;
  }

  [data-slot="settings.general.item"] [class*="_selector"] {
    align-self: flex-start !important;
  }
}

@media (max-width: 600px) {
  /* 日月灯微型圆形切换器 (32px × 32px 极简小圆，彻底取代原先 172px 宽的遮挡大胶囊) */
  .dsh-synapse-switch {
    position: fixed !important;
    top: max(8px, env(safe-area-inset-top)) !important;
    left: 50% !important;
    z-index: 65 !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 32px !important;
    height: 32px !important;
    box-sizing: border-box !important;
    padding: 1px !important;
    transform: translateX(-50%) !important;
    border: 1px solid rgba(255, 255, 255, 0.18) !important;
    border-radius: 50% !important;
    background: rgba(15, 23, 42, 0.88) !important;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35) !important;
    backdrop-filter: blur(16px) !important;
    -webkit-backdrop-filter: blur(16px) !important;
    overflow: hidden !important;
    gap: 0 !important;
  }

  .dsh-synapse-switch button {
    flex: 1 1 0 !important;
    width: 15px !important;
    height: 30px !important;
    min-width: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    background: transparent !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer !important;
    color: #94a3b8 !important;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
  }

  .dsh-synapse-switch button[data-view="dialog"] {
    border-radius: 15px 0 0 15px !important;
    padding-left: 2px !important;
  }

  .dsh-synapse-switch button[data-view="map"] {
    border-radius: 0 15px 15px 0 !important;
    padding-right: 2px !important;
  }

  .dsh-synapse-switch button[data-view="dialog"].active {
    background: linear-gradient(135deg, #f59e0b, #d97706) !important;
    color: #ffffff !important;
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.6) !important;
  }

  .dsh-synapse-switch button[data-view="map"].active {
    background: linear-gradient(135deg, #6366f1, #4f46e5) !important;
    color: #ffffff !important;
    box-shadow: 0 0 8px rgba(99, 102, 241, 0.6) !important;
  }

  /* 消除 52px 顶栏大偏移：小圆不再占用顶部垂直通行空间 */
  html:not([data-dsh-conversation-focus]) [data-sidebar-collapsed] [data-slot='conversation.session.header'] > header {
    margin-top: calc(max(6px, env(safe-area-inset-top))) !important;
  }

  /* An expanded mobile sidebar is a full-width drawer, not a desktop column
     that squeezes the conversation into an unreadable vertical strip.

     The drawer's state is the frame's data-sidebar-collapsed attribute:
     present while the rail is collapsed, dropped while the drawer is open. The
     frame is reachable by its stable data-shell-overlay child rather than by
     position or a hashed CSS-module class, and html:not(:has(...)) reads the
     open state from wherever the frame sits in the shell. The pre-0.1.5
     details-column form of these selectors went dead when the shell stopped
     rendering that attribute — the drawer silently reverted to a desktop
     column. */
  html:not(:has([data-sidebar-collapsed])) div:has(> [data-shell-overlay]) {
    grid-template-columns: minmax(0, 1fr) 0 0 !important;
  }

  html:not(:has([data-sidebar-collapsed])) div:has(> [data-shell-overlay]) > :first-child,
  html:not(:has([data-sidebar-collapsed])) div:has(> [data-shell-overlay]) [data-slot='sidebar'],
  html:not(:has([data-sidebar-collapsed])) div:has(> [data-shell-overlay]) [data-slot='sidebar'] > * {
    width: 100vw !important;
    max-width: 100vw !important;
  }

  /* The open drawer owns the whole viewport: the floating display controls
     (whale / conversation fullscreen) and the session-switcher capsule are
     fixed-position and paint above it, so they must not cover its header and
     collapse toggle. */
  html:not(:has([data-sidebar-collapsed])) [data-mobile-controls],
  html:not(:has([data-sidebar-collapsed])) .dsh-synapse-switch {
    visibility: hidden !important;
    pointer-events: none !important;
  }

  /* Focus layout: the stock narrow shell keeps a 56px icon rail. Reclaim that
     width for the transcript, but preserve its first toggle as a floating,
     reachable control so navigation is never trapped. */
  [data-sidebar-collapsed] {
    grid-template-columns: 0 minmax(0, 1fr) 0 !important;
  }

  [data-sidebar-collapsed] > :first-child {
    overflow: visible !important;
    border-right: 0 !important;
    background: transparent !important;
  }

  [data-sidebar-collapsed] > :first-child [data-slot='sidebar'] > * {
    width: 0 !important;
    min-width: 0 !important;
    overflow: visible !important;
    background: transparent !important;
    pointer-events: none;
  }

  [data-sidebar-collapsed] > :first-child [data-slot='sidebar'] > * > :not(:first-child) {
    display: none !important;
  }

  [data-sidebar-collapsed] > :first-child [data-slot='sidebar'] > * > :first-child {
    position: fixed !important;
    top: max(10px, env(safe-area-inset-top)) !important;
    left: 10px !important;
    z-index: 45 !important;
    width: 40px !important;
    height: 40px !important;
    display: grid !important;
    place-items: center !important;
    border: 1px solid var(--dsw-alias-border-l2-darkmode-thin) !important;
    border-radius: 14px !important;
    background: color-mix(in srgb, var(--dsw-specific-input-major) 86%, transparent) !important;
    box-shadow: var(--dsw-shadow-lv2) !important;
    backdrop-filter: blur(18px) saturate(1.15) !important;
    -webkit-backdrop-filter: blur(18px) saturate(1.15) !important;
    pointer-events: auto !important;
  }

  /* Shared mobile width axis: +16px for the composer and transcript before
     even counting the reclaimed sidebar rail. */
  [data-slot='conversation'] > * {
    --dsh-composer-side-clearance: 8px !important;
    --dsh-composer-text-max-height: min(240px, 32dvh) !important;
  }

  [data-composer-card] {
    gap: 8px !important;
    padding-top: 8px !important;
    border-radius: 18px !important;
  }

  /* The stock row intentionally wraps on constrained widths. Mobile instead
     keeps the essential controls on one line and compresses labels. */
  [data-composer-card] > :last-child {
    flex-wrap: nowrap !important;
    gap: 4px !important;
    min-height: 40px !important;
    padding: 0 6px 6px !important;
  }

  [data-composer-card] > :last-child > :first-child {
    flex: 0 1 auto !important;
    gap: 4px !important;
  }

  [data-composer-card] > :last-child > :first-child > :nth-child(2) {
    gap: 2px !important;
  }

  [data-composer-card] > :last-child > :last-child {
    flex: 1 1 auto !important;
    justify-content: flex-end !important;
    gap: 4px !important;
    margin-left: auto !important;
    min-width: 0 !important;
  }

  /* Permission remains identifiable by its shield; verbose labels are moved
     to aria-label/title and the dropdown. Handles both shipped locales. */
  button[aria-label^='访问模式'] > span:not(:has(svg)),
  button[aria-label^='Access mode'] > span:not(:has(svg)) {
    display: none !important;
  }

  button[aria-label^='访问模式'],
  button[aria-label^='Access mode'] {
    height: 32px !important;
    padding-inline: 6px 3px !important;
    gap: 2px !important;
  }

  [data-slot='conversation.input.model'] {
    min-width: 0 !important;
    max-width: min(150px, 42vw) !important;
  }

  [data-slot='conversation.input.model'] > * {
    min-width: 0 !important;
    max-width: 100% !important;
  }

  [data-slot='conversation.input.model'] button {
    width: 100% !important;
    max-width: 100% !important;
    height: 32px !important;
    gap: 3px !important;
    padding-inline: 5px 2px !important;
    font-size: 12px !important;
  }

  [data-composer-card] button[aria-label='发送消息'],
  [data-composer-card] button[aria-label='Send message'],
  [data-composer-card] button[aria-label='停止'],
  [data-composer-card] button[aria-label='停止生成'],
  [data-composer-card] button[aria-label='Stop generating'],
  [data-composer-card] button[aria-label='Stop'] {
    width: 36px !important;
    height: 36px !important;
    transform: none !important;
  }
}

/* Touch devices: a tap leaves focus on the button, so the 500ms-delay
   hover tooltip (e.g. 停止生成) materializes AFTER the tap and stays
   pinned at its click-time fixed coordinates as the layout settles —
   the floating ghost label in the corner. Tooltips carry no touch
   affordance; suppress them wherever hover does not exist. */
@media (hover: none) and (pointer: coarse) {
  [role='tooltip'] {
    display: none !important;
  }
}

@media (max-width: 370px) {
  /* Very small Android WebViews keep the model name; effort remains available
     in the picker/title instead of forcing a second toolbar line. */
  [data-slot='conversation.input.model'] button > span:nth-of-type(2) {
    display: none !important;
  }
}
`

/** Install stylesheet and register ImageUploadButton into composer slot. */
export function apply(ctx: ClientContext): void {
  const installStyles = (): (() => void) => {
    let tag = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_ID}"]`)
    const owned = tag === null
    if (tag === null) {
      tag = document.createElement('style')
      tag.dataset.plugin = '@suxeca/dsh-mobile-polish'
      tag.dataset.pluginCss = STYLE_ID
      document.head.appendChild(tag)
    }
    tag.textContent = MOBILE_CSS
    return () => { if (owned) tag?.remove() }
  }

  if (ctx.effect !== undefined) ctx.effect(installStyles)
  else installStyles()

  // Android keyboard lock: pin the frame to the visual viewport so the
  // composer never strands mid-screen after the keyboard closes (see
  // viewport-lock.ts). Inert on desktop/iOS; ctx.effect owns teardown.
  const lockViewport = (): (() => void) => installViewportLock(window)
  if (ctx.effect !== undefined) ctx.effect(lockViewport)
  else lockViewport()

  ctx.effect(() => installFilePreviewRecovery(document, () => window.location.reload()))

  ctx.inject(['slots'], (scope: ClientContext) => {
    scope.slots.inject('conversation.input.left', () =>
      scope.slots.register({
        name: 'conversation.input.left',
        id: 'mobile-image-uploader',
        order: 5,
      }, ImageUploadButton),
    )
    scope.slots.inject('shell.overlay', () =>
      scope.slots.register({
        name: 'shell.overlay',
        id: 'mobile-display-controls',
        order: 90,
      }, MobileControls),
    )
  })
}
