# Contributing

## Development setup

Requirements: Node.js 20 or newer and pnpm 10.28.2.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
```

## Change requirements

- Preserve fail-closed behavior for unknown contracts and malformed widening requests.
- Strip malformed escalation fields only when the target mode is known and cannot widen the standing policy.
- Never select tools solely because their arguments contain matching field names.
- Add pure decision tests and ToolRuntime/Cordis integration coverage for behavioral changes.
- Keep public types generated from TypeScript source; do not hand-edit `dist`.
- Update `README.md` and `CHANGELOG.md` for user-visible changes.

Before opening a pull request, run:

```bash
pnpm run check
pnpm pack:check
```

Commits should be focused and explain the observable behavior being changed. Security findings must follow `SECURITY.md` instead of a public issue.
