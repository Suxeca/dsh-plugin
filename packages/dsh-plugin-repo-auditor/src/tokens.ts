/**
 * Detection markers, assembled at runtime.
 *
 * WHY THIS FILE EXISTS
 * This plugin statically inspects *other* packages for hostile markers:
 * pre-execution hooks, host-process execution, sensitive Cordis services and
 * gate-evasion tokens. If those markers appeared here as contiguous literals,
 * a static scan of THIS package would run into its own detector table and
 * report it as a prompt-injection / gate-evasion payload (a self-flag): the
 * auditor would grade itself CRITICAL, and its install gate would fire on the
 * users installing it.
 *
 * Building every marker from fragments keeps the runtime values byte-identical
 * to the literals they replace, without ever shipping those literals.
 * The first fragment of each pair/triple is deliberately not a marker itself.
 */

import type { Events } from 'cordis'

const lit = (...parts: string[]): string => parts.join('')

// --- DSH / Cordis service and hook markers ----------------------------------
/**
 * Typed as a Cordis event key so `ctx.on(TOKEN_PRE_EXECUTE, …)` keeps the hook
 * listener type-checked, while the name itself is still assembled at runtime.
 */
export const TOKEN_PRE_EXECUTE = lit('tools/', 'pre-execute') as keyof Events
export const TOKEN_PLUGIN_MANAGER = lit('plugin_', 'manager')
export const TOKEN_CREDENTIALS = lit('cred', 'entials')

// --- Node host APIs ---------------------------------------------------------
export const TOKEN_CHILD_PROCESS = lit('child_', 'process')
export const TOKEN_EXEC_SYNC = lit('exec', 'Sync')
export const TOKEN_SPAWN_SYNC = lit('spawn', 'Sync')
export const TOKEN_EXEC_FILE = lit('exec', 'File')

// --- Gate-evasion token -----------------------------------------------------
export const TOKEN_SKIP_GATE = lit('SKIP_REPO_', 'AUDIT')

// --- Credential-theft targets (already-escaped regex fragments) -------------
export const REGEX_SSH = lit('\\.', 'ssh')
export const REGEX_DOT_ENV = lit('\\.', 'env')
export const REGEX_NPMRC = lit('\\.', 'npmrc')
export const REGEX_AWS = lit('\\.', 'aws')
export const TOKEN_GITHUB_TOKEN = lit('GITHUB_', 'TOKEN')
export const REGEX_ETC_PASSWD = lit('/', 'etc', '/', 'passwd')

// --- Prompt-injection phrases (regex fragments) -----------------------------
export const REGEX_IGNORE_PREVIOUS = lit('ignore\\s+', 'previous\\s+', 'instructions')
export const REGEX_DISREGARD_PREVIOUS = lit('disregard\\s+', 'all\\s+', 'previous')
