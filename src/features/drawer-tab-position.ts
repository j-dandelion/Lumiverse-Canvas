// Feature: drawer-tab vertical drag repositioning.
//
// Enables click/tap-and-drag on the sidebar drawer tabs (main + secondary)
// to set their vertical position by dragging, overriding the Lumiverse
// display setting. The drag handler writes to the DOM directly for instant
// feedback, then persists to Canvas settings on drag-end.
//
// Bidirectional mirror: when mirrorCompactPosition is on, dragging the
// secondary also moves the main. The secondary's drag installer wires an
// onLiveUpdate callback that writes the new vh to the main's DOM on every
// pointermove. The style observer on the main (wired in drawer-sync.ts) then
// fires on the next microtask and writes the same value back to the
// secondary (idempotent). The secondary's onCommit also persists the
// main's override so the apply path doesn't undo the live update on the
// next settings diff.
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
      const teardown = installDrawerTabDrag(
        secondaryTab,
        'secondary',
        (vh) => {
          // Bidirectional mirror: when mirrorCompactPosition is on, a
          // drag of the secondary also moves the main. Persist BOTH
          // overrides so the next applyDrawerTabPosition tick (fired
          // by this same setSettings) writes a consistent state — if
          // we only wrote the secondary's override, the apply path
          // would overwrite the main's live-updated DOM with the main's
          // old override value and undo the drag.
          const settings = getSettings()
          if (settings.mirrorCompactPosition) {
            setSettings({
              secondaryDrawerTabOverrideVh: vh,
              mainDrawerTabOverrideVh: vh,
            })
          } else {
            setSettings({ secondaryDrawerTabOverrideVh: vh })
          }
        },
        // Live update: propagate the drag to the main when mirroring is
        // on. The drag handler only writes to the secondary; we write
        // the same vh to the main synchronously, then the style
        // observer on the main fires on the next microtask and writes
        // the value back to the secondary (idempotent — the drag
        // handler just wrote it). Both tabs move in lockstep.
        (vh) => {
          if (!getSettings().mirrorCompactPosition) return
          const mainTab = getMainDrawerTab()
          if (mainTab) mainTab.style.marginTop = `${vh}vh`
        },
      )
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
