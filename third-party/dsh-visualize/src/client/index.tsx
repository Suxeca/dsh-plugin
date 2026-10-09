/**
 * dsh-visualize, browser half:
 * 1. The in-conversation compact Artifact capsule;
 * 2. Native DSH Right Sidebar integration (`sidebarRight` & `sidebarRightTabs`);
 * 3. Streaming preview in composer input dock.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { VisualizeCard } from './VisualizeCard.tsx'
import { StreamingPreview } from './StreamingPreview.tsx'
import { ArtifactSidebarTab, ArtifactSidebarTitle } from './ArtifactSidebarTab.tsx'
import { artifactManager } from './artifact-store.ts'

export const name = 'dsh-visualize'

export const inject = ['slots']

export const ARTIFACT_TAB_ID = '@dsh-external/dsh-visualize'
export const ARTIFACT_TAB_KIND = 'artifact'

/**
 * Register the keyed toolview, dock preview, and native right sidebar tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  artifactManager.setContext(ctx)

  // 1. Toolview 胶囊卡片
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'visualize' },
    VisualizeCard,
  ))

  // 2. 输入框流式预览
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'visualize-stream', order: 30 },
    StreamingPreview,
  ))

  // 3. 原生右侧栏 Tab 身体与标题插槽
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: ARTIFACT_TAB_ID },
    ArtifactSidebarTab,
  ))

  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: ARTIFACT_TAB_ID },
    ArtifactSidebarTitle,
  ))

  // 4. 注册并挂载到 sidebarRightTabs（安全通过 ctx.get 可选访问，绝不碰 ctx.sidebarRightTabs 代理）
  const registerTabDefinition = () => {
    const tabs = ctx.get('sidebarRightTabs') as any
    if (tabs && typeof tabs.register === 'function') {
      try {
        ctx.effect(() => tabs.register({
          id: ARTIFACT_TAB_ID,
          kind: ARTIFACT_TAB_KIND,
          patterns: ['sidebar://artifact', 'sidebar://artifact/**', 'dsh-resource://artifact/**'],
          priority: 'extension',
          canOpen: () => true,
          title: () => artifactManager.active?.title ?? 'Artifact',
        }), 'dsh-visualize: tab definition')
      } catch (e) {
        // idempotent catch
      }
    }
  }

  registerTabDefinition()
  ctx.on('service', (serviceName) => {
    if (serviceName === 'sidebarRightTabs') {
      registerTabDefinition()
    }
  })
}
