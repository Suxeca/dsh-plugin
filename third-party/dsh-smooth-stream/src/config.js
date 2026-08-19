/**
 * Shared plugin configuration contract. The Host half defines the
 * Schemastery schema over this shape (defaults live here so both halves stay
 * symmetric); the client half falls back to the same defaults when the Host
 * boot-config bridge is absent (client-only composition).
 */
/** Defaults shared by the Host schema and the client-side fallback. */
export const DEFAULT_STREAM_CONFIG = {
    mode: 'typewriter',
    preset: 'balanced',
    revealCharsPerSec: 80,
    scrollSpeedPxPerSec: 48,
    maxScrollSpeedPxPerSec: 1000,
};
/**
 * Window global the Host writes into the served index HTML. The browser boot
 * graph carries no per-entry config, so this inline script is the only
 * Host-to-client configuration channel for a composed web plugin.
 */
export const STREAM_BOOT_GLOBAL = '__DSH_SMOOTH_STREAM_CONFIG__';
