// DOM guard: monkey-patches removeChild / replaceChildren / appendChild on
// the main panel content container so that React's DOM mutations don't
// detach tabs we've relocated to the secondary sidebar.
//
// Extracted from tabs/assignment.ts. The guard is a pure DOM concern
// independent of the tab-assignment policy layer.

import { getMainPanelContent } from '../dom/lumiverse'
import { isMovedTabNode } from './active-tab'

// Narrow interface for the custom property we stamp on guarded containers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface GuardedNode extends Node {
  __sidebarUxGuarded?: boolean
  [key: string]: unknown
}

// Tracks which container currently has the guard installed. If React
// replaces the main panel content element (e.g. on a drawer re-render), the
// guard's `__sidebarUxGuarded` marker is on the old (detached) container
// and the new container is unguarded. `ensureNodeGuard` detects this and
// re-installs the guard on the current container.
let _guardedContainer: HTMLElement | null = null

/**
 * Override removeChild / replaceChildren / appendChild on a container node
 * so that React's DOM mutations don't detach tabs we've relocated to the
 * secondary sidebar.
 */
export function installNodeGuard(container: Node) {
  const guarded = container as GuardedNode
  if (guarded.__sidebarUxGuarded) return
  guarded.__sidebarUxGuarded = true

  const origRemoveChild = container.removeChild.bind(container)
  container.removeChild = function(child: Node) {
    if (isMovedTabNode(child)) return child
    return origRemoveChild(child)
  } as typeof container.removeChild

  // Guard replaceChildren — this is what ExtensionTabContent.useEffect calls
  const origReplaceChildren = (guarded as unknown as { replaceChildren?: (...nodes: Node[]) => void }).replaceChildren?.bind(container)
  if (origReplaceChildren) {
    ;(guarded as unknown as { replaceChildren: (...nodes: Node[]) => void }).replaceChildren = function(...nodes: Node[]) {
      const filtered = nodes.filter(n => !isMovedTabNode(n))
      return origReplaceChildren(...filtered)
    }
  }

  // Guard appendChild — React may also use this to re-add nodes
  const origAppendChild = container.appendChild.bind(container)
  container.appendChild = function(child: Node) {
    if (isMovedTabNode(child)) return child
    return origAppendChild(child)
  } as typeof container.appendChild
}

/**
 * Install (or re-install) the React-reclaim guard on the current main panel
 * content container. Idempotent: no-op if the guard is already on the
 * current container. Re-installs (and forgets the old container) if the
 * container has been replaced since the last install.
 */
export function ensureNodeGuard(): void {
  const mainContent = getMainPanelContent()
  if (!mainContent) return
  if (mainContent === _guardedContainer) return
  // Container changed (or first install). The old container (if any) is
  // detached and will be GC'd along with its guard methods.
  _guardedContainer = null
  installNodeGuard(mainContent)
  _guardedContainer = mainContent
}
