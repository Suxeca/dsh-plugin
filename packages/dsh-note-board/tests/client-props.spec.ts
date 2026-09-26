/**
 * Why the board rendered as a red error (and, before the boundary existed, as a
 * blank panel): a component prop named `ref`.
 *
 * React does not forward `ref` — `createElement` lifts it out of the config and
 * binds it as a React ref, so `props.ref` is `undefined` inside the component.
 * `BindingBar` guarded `ref === null`, which `undefined` passes, and then read
 * `.source` off it. The whole board unmounted, which is indistinguishable from
 * "this session has no ledger" — the single most misleading symptom available,
 * and the reason a session of debugging went into the wrong subsystem.
 *
 * The rename to `ledgerRef` is the fix. The first two tests here are the
 * mechanism (does React still swallow `ref`?) and the invariant (does this
 * package still rely on that name?); the third re-checks the built bundle so a
 * stale artifact cannot quietly keep the bug alive.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

const packageRoot = join(import.meta.dirname, '..')
const bodySource = readFileSync(join(packageRoot, 'src/client/Body.tsx'), 'utf8')
const bundlePath = join(packageRoot, 'lib/client.js')
const bundle = existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : null

describe('React consumes a prop named `ref`', () => {
  it('moves `ref` out of props and leaves every other name in place', () => {
    const Probe = (): null => null
    const bound = { source: 'none' }
    const element = createElement(Probe, { ref: bound, ledgerRef: bound }) as unknown as {
      readonly ref: unknown
      readonly props: Record<string, unknown>
    }
    // `createElement` writes `ref` onto the element itself; the component never
    // sees it. That is the whole bug: `props.ref` is `undefined`, so the
    // `=== null` guard did not fire and `sourceLabel` read `.source` off nothing.
    expect(element.props.ref).toBeUndefined()
    expect(element.ref).toBe(bound)
    expect(element.props.ledgerRef).toBe(bound)
  })
})

describe('the board does not name a prop `ref`', () => {
  it('passes the binding to BindingBar as `ledgerRef`', () => {
    expect(bodySource).toMatch(/h\(BindingBar,\s*\{\s*ledgerRef:/)
  })

  it('declares no component prop named `ref`', () => {
    // `sourceLabel(ref: LedgerRef)` is fine — a parameter is not a React prop.
    expect(bodySource).not.toMatch(/readonly ref\s*:/)
  })

  it('guards the binding against `undefined`, not only against `null`', () => {
    // Defence in depth: the original guard was `ref === null`, which `undefined`
    // walks straight through into `sourceLabel`.
    expect(bodySource).toMatch(/if \(ref === null \|\| ref === undefined\)/)
  })
})

describe.skipIf(bundle === null)('the built bundle carries the same invariant', () => {
  it('passes `ledgerRef` and never a `ref` prop', () => {
    // A `ref:` inside an object literal would mean some element is still handed
    // a prop React will silently swallow. This view uses no React refs at all,
    // so the token should not appear.
    expect(bundle).toMatch(/ledgerRef:/)
    expect(bundle ?? '').not.toMatch(/[{,]\s*ref\s*:/)
  })
})
