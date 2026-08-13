import { clientBundle } from '../../shared/tsdown.client.ts'

// Pure client plugin: the node half is an empty apply (host roster seat), the
// browser half (src/client/index.ts) carries the whole feature. No extra
// externals — the host half imports nothing at runtime.
export default clientBundle('@deepseek-ai/dsh-client-ui-session-switcher', ['src/index.ts'])
