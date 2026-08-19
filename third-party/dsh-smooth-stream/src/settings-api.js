/** Shared wire vocabulary for the plugin-owned settings RPC channel. */
/** Dedicated, loopback-only RPC channel registered by the Host half. */
export const STREAM_SETTINGS_RPC_CHANNEL = '/smooth-stream';
/** Endpoints accepted by {@link STREAM_SETTINGS_RPC_CHANNEL}. */
export const STREAM_SETTINGS_RPC = {
    read: 'settings.read',
    write: 'settings.write',
    upgrade: 'plugin.upgrade',
};
