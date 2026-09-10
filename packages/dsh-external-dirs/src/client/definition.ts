/**
 * Stage one of this package's registration: what the `external-dirs` tab type IS.
 *
 * A **page** type, not a viewer: it claims no `dsh-resource://` patterns and is
 * opened from the Sidebar's guide page. Files it shows are opened through
 * `tab.actions.openResource` with a `dsh-resource://file/<absolute path>`
 * address, which the official preview tabs claim — this package renders no
 * preview itself.
 *
 * @module @suxeca/dsh-external-dirs/client/definition
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** The tab kind this package owns. */
export const EXTERNAL_DIRS_KIND = 'external-dirs'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const EXTERNAL_DIRS_ID = '@suxeca/dsh-external-dirs'

/** Copy used by the type's guide entry and chip title. */
export const LABELS = {
  title: '外部目录',
  guideTitle: '外部目录',
  guideDescription: '浏览工作区之外的目录（只读），点击文件用官方预览打开',
} as const

/**
 * The external-directory type's registry definition.
 * @returns the definition to register.
 */
export function externalDirsDefinition(): SidebarRightTabDefinition {
  return {
    id: EXTERNAL_DIRS_ID,
    kind: EXTERNAL_DIRS_KIND,
    // An outside-the-product type: it must win over nothing built in, and the
    // band also documents intent for the resolver.
    priority: 'extension',
    title: () => LABELS.title,
    guide: [{
      order: 40,
      title: () => LABELS.guideTitle,
      description: () => LABELS.guideDescription,
    }],
  }
}
