import { describe, expect, it } from 'vitest'
import { MOBILE_CSS, STYLE_ID } from '../src/client/index.ts'

describe('mobile polish stylesheet contract', () => {
  it('is scoped to mobile viewports and keeps a navigation escape hatch', () => {
    expect(MOBILE_CSS).toContain('@media (max-width: 600px)')
    expect(MOBILE_CSS).toContain('grid-template-columns: 0 minmax(0, 1fr) 0 !important')
    expect(MOBILE_CSS).toContain('pointer-events: auto !important')
  })

  it('prevents composer wrapping and compacts permission/model controls', () => {
    expect(MOBILE_CSS).toContain('flex-wrap: nowrap !important')
    expect(MOBILE_CSS).toContain("button[aria-label^='访问模式']")
    expect(MOBILE_CSS).toContain("[data-slot='conversation.input.model']")
    expect(STYLE_ID).toBe('@suxeca/dsh-mobile-polish/styles')
  })

  it('supports a persistent whale switch and transcript-only focus mode', () => {
    expect(MOBILE_CSS).toContain('html[data-dsh-whale-disabled]')
    expect(MOBILE_CSS).toContain('html[data-dsh-conversation-focus]')
    expect(MOBILE_CSS).toContain("position: fixed !important")
    expect(MOBILE_CSS).toContain("@media (max-width: 600px)")
  })

  it('pins the frame to the visual viewport and kills touch tooltip ghosts', () => {
    expect(MOBILE_CSS).toContain(':root[data-dsh-mobile-vv]')
    expect(MOBILE_CSS).toContain('var(--dsh-mobile-vv-height, 100%)')
    expect(MOBILE_CSS).toContain('@media (hover: none) and (pointer: coarse)')
    expect(MOBILE_CSS).toContain("[role='tooltip']")
  })

  it('keeps the open mobile drawer full width and clears the floating controls off it', () => {
    // The 0.1.5 shell reports the open drawer by the ABSENCE of
    // data-sidebar-collapsed; data-details-collapsed no longer exists.
    expect(MOBILE_CSS).not.toContain('data-details-collapsed')
    expect(MOBILE_CSS).toContain('html:not(:has([data-sidebar-collapsed])) div:has(> [data-shell-overlay])')
    expect(MOBILE_CSS).toContain('grid-template-columns: minmax(0, 1fr) 0 0 !important')
    // Fixed-position controls would otherwise paint over the drawer header.
    expect(MOBILE_CSS).toContain('html:not(:has([data-sidebar-collapsed])) [data-mobile-controls]')
    expect(MOBILE_CSS).toContain('html:not(:has([data-sidebar-collapsed])) .dsh-synapse-switch')
  })

  it('uses the compact circle without reserving the retired capsule row', () => {
    // The user replaced the 172px capsule with a 32px circle; no extra row is reserved.
    expect(MOBILE_CSS).toContain(
      "html:not([data-dsh-conversation-focus]) [data-sidebar-collapsed] [data-slot='conversation.session.header'] > header",
    )
    expect(MOBILE_CSS).toContain('margin-top: calc(max(6px, env(safe-area-inset-top))) !important')
    expect(MOBILE_CSS).not.toContain('width: min(172px')
    expect(MOBILE_CSS).toContain("body:has([data-sidebar-right-panel='fullscreen'][data-sidebar-right-open]) .dsh-synapse-switch")
  })
})
