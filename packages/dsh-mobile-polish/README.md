# @suxeca/dsh-mobile-polish

Mobile layout refinements for the existing DSH Web application. Contributions include compact composer controls, viewport tracking, and mobile file-preview recovery.

## File previews

On viewports up to 768px, an expanded fullscreen right panel hides the floating Synapse switch so it cannot cover document tabs. Document bodies wrap long paths, preserve horizontal scrolling for code blocks, and constrain images to the available width.

A native unavailable-resource paragraph gains a manual page-reload button. This does not register a substitute file provider, bypass authentication, or change file access permissions. Genuine loading spinners do not gain the button. Its DOM observer and inserted controls are disposed with the plugin. Clicking the button reloads the whole page; it is not a per-file network retry.

Historical visualization cards previously invoked mobile fullscreen automatically, obscuring document links. The separate dsh-visualize change retains desktop auto-opening while requiring an explicit mobile open gesture.

## Verification

`pnpm test`: 9 passing stylesheet and viewport tests. `pnpm run build`: TypeScript and client bundle build pass. `tests/remote-preview-browser.mjs` runs against the existing authenticated DSH remote HTTP origin with a 390×844 touch viewport. It opens two real Markdown links, checks content, closes and reopens the panel, reloads the page and checks restoration, confirms the floating switch is hidden, and checks for browser exceptions. An isolated browser document covers unavailable-resource recovery without disabling the production file provider. Saved evidence lives in `test-evidence/`.

## Model Experience

These controls add no model tools, prompts, session inputs, or token usage. They affect browser presentation and manual reload behavior only.

## Known Limitations and Deferred Work

The original Huawei browser missing-provider state was not reproduced. A fresh authenticated remote Chromium session reads the same file successfully. These tests establish current remote Markdown access and recovery UI behavior, not a confirmed repair of a Huawei-specific provider failure. Huawei-device confirmation is still needed; PDF and other renderers were not part of this targeted test. Some existing styles depend on host DOM markers and need checking after Harness upgrades.
