// Feature: drawer-tab vertical drag repositioning.
//
// Enables click/tap-and-drag on the sidebar drawer tabs (main + secondary)
// to set their vertical position by dragging, overriding the Lumiverse
// display setting. The drag handler writes to the DOM directly for instant
// feedback, then persists to Canvas settings on drag-end.
//
// This feature does NOT write to the Lumiverse store — the Lumiverse
// slider won't reflect the drag value live (documented limitation).

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { FullCanvasSettings } from '../settings/state'
import type { CanvasFeature } from './registry'
import { getSettings, setSettings } from '../settings/state'
import { registerCleanup } from '../sidebar/cleanup'
import { getSecondaryWrapper } from '../sidebar/secondary'
import { applyDrawerTabPosition } from '../drawerTabPosition'
import { installDrawerTabDrag } from '../drawerTabPosition/drag'

/**
 * Query the main drawer tab: Lumiverse's own drawer-tab button, excluding
 * our secondary sidebar's drawer-tab (which has the .sidebar-ux-drawer-tab
 * class).
 */
function getMainDrawerTab(): HTMLElement | null {
  return document.querySelector('[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)')
}

/**
 * Query the secondary drawer tab: the .sidebar-ux-drawer-tab inside the
 * secondary wrapper. Returns null if the wrapper doesn't exist.
 */
function getSecondaryDrawerTab(): HTMLElement | null {
  return getSecondaryWrapper()?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement | null
}

/** Guard against installing drag on the same element twice. */
const _dragInstalled = new WeakSet<HTMLElement>()

/** Feature stub for Phase A — drag installers added in Phase B. */
export const drawerTabDragFeature: CanvasFeature = {
  id: 'drawerTabDrag',

  init(_ctx: SpindleFrontendContext): void {
    // Install MutationObserver on document.body watching for the main
    // drawer tab's appearance, then install the drag handler.
    if (!getSettings().drawerTabDrag) return

    const observer = new MutationObserver(() => {
      const mainTab = getMainDrawerTab()
      if (mainTab && !_dragInstalled.has(mainTab)) {
        _dragInstalled.add(mainTab)
        const teardown = installDrawerTabDrag(mainTab, 'main', (vh) => {
          setSettings({ mainDrawerTabOverrideVh: vh })
        })
        registerCleanup(teardown)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    registerCleanup(() => observer.disconnect())

    // Try to install immediately if the tab already exists
    const mainTab = getMainDrawerTab()
    if (mainTab && !_dragInstalled.has(mainTab)) {
      _dragInstalled.add(mainTab)
      const teardown = installDrawerTabDrag(mainTab, 'main', (vh) => {
        setSettings({ mainDrawerTabOverrideVh: vh })
      })
      registerCleanup(teardown)
    }
  },

  mount(_ctx: SpindleFrontendContext): void {
    // Install drag on the secondary drawer tab.
    if (!getSettings().drawerTabDrag) return

    const secondaryTab = getSecondaryDrawerTab()
    if (secondaryTab && !_dragInstalled.has(secondaryTab)) {
      _dragInstalled.add(secondaryTab)
      const teardown = installDrawerTabDrag(secondaryTab, 'secondary', (vh) => {
        setSettings({ secondaryDrawerTabOverrideVh: vh })
      })
      registerCleanup(teardown)
    }

    // Apply the override to the DOM now that both tabs (possibly) exist.
    // Without this, the saved override is in settings but not on the DOM
    // until the user drags or until a settings change fires apply().
    applyDrawerTabPosition(getSettings(), getMainDrawerTab(), getSecondaryDrawerTab())
  },

  apply(prev: FullCanvasSettings, next: FullCanvasSettings): void {
    // Re-fire on override field changes too — the drag handler writes to
    // the DOM directly on pointermove, but the post-drag commit calls
    // setSettings({ mainDrawerTabOverrideVh: vh }) and we want the apply
    // tick to re-establish the canonical DOM state (idempotent write).
    if (prev.drawerTabDrag === next.drawerTabDrag &&
        prev.mainDrawerTabOverrideVh === next.mainDrawerTabOverrideVh &&
        prev.secondaryDrawerTabOverrideVh === next.secondaryDrawerTabOverrideVh) return
    applyDrawerTabPosition(next, getMainDrawerTab(), getSecondaryDrawerTab())
  },
}
