/**
 * User-owned settings for the smooth-stream plugin, exposed to the Host
 * settings service and edited from the Web Settings "plugin configuration"
 * page. This is the runtime-editable complement to {@link StreamConfig}: that
 * contract is composed at load and bridged once through the boot global, while
 * these preferences live in the durable user-settings document and take effect
 * live.
 */
/** Settings namespace registered by the Host and served through the plugin RPC. */
export const STREAM_SETTINGS_NS = 'smooth-stream';
/** Defaults shared by the Host schema and the client-side fallback. */
export const DEFAULT_STREAM_SETTINGS = {
    thinkAutoExpand: true,
};
