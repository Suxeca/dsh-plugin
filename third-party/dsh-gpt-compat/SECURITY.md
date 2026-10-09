# Security Policy

## Supported versions

Only the latest published minor version receives security fixes. Pre-release builds and development snapshots are unsupported.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's [private security advisory form](https://github.com/YaoaY/dsh-gpt-compat/security/advisories/new) and include:

- affected version;
- DSH, Node.js, and operating-system versions;
- minimal configuration and reproduction;
- expected and observed authorization behavior;
- potential impact.

Maintainers should acknowledge a report within seven days and provide an initial assessment within fourteen days. Timelines may change when a fix requires a coordinated DSH core release.

## Scope

Security-sensitive behavior includes tool selection, provider routing, sandbox-mode classification, argument preservation or removal, and interactions with the native DSH approval flow. Unknown contracts and malformed widening requests must remain fail-closed. A request for a known target that cannot widen the current policy may have both escalation fields removed even when its justification is missing or malformed, because the call continues only under the already-authorized standing policy.
