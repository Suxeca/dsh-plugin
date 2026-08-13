import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-lab-kit',
  ['src/index.ts'],
  {
    lib: {
      // Host-side services resolve at runtime from the dsh config tree;
      // their built declarations carry .ts-suffixed relative imports
      // rolldown cannot follow, so keep them external.
      external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-workspace', '@deepseek-ai/dsh-system-prompt'],
    },
  },
)
