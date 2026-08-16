// Host-owned placement of built-in drawer tabs into the Canvas secondary
// container. Prefer host tabLocations (requestTabLocation / store.moveTabTo)
// so ContainerTabContent reparents React roots.
//
// Last resort when both fail (non-CORE allowlist + fiber store unavailable):
// DOM-append the registry root into secondary panel content and track it for
// unassign/teardown. ContainerTabContent only manages keys present in
// tabLocations — unlisted roots stay where Canvas puts them.

import { dlog, dwarn } from '../debug/log'
import { getHostBridge } from '../dom/host-bridge'
import { getSecondaryWrapper } from '../sidebar/secondary'
import {
  CANVAS_DOM_PLACED_ATTR,
  clearDomPlacedBuiltIn,
  markDomPlacedBuiltIn,
} from './dom-placed-builtin'
import {
  CANVAS_SECONDARY_CONTAINER_ID,
  requestHostTabToSecondary,
} from './host-tab-location'
// Lazy import ensureBuiltInTabActiveInMain to avoid circular import with
// assignment.ts (which imports this helper for the assignTab path).

// Re-export restore helpers so existing import paths stay stable.
export {
  CANVAS_DOM_PLACED_ATTR,
  isDomPlacedBuiltIn,
  markDomPlacedBuiltIn,
  clearDomPlacedBuiltIn,
  __clearDomPlacedForTest,
  resolveMainPanelContentForRestore,
  restoreDomPlacedBuiltInToMain,
} from './dom-placed-builtin'

export type MoveBuiltInToSecondaryOpts = {
  tabId: string
  /** When true, do not set data-canvas-active (restore / openSecondary loop). */
  deferActivation?: boolean
  /** Optional pre-resolved root; if omitted, helper resolves via bridge. */
  root?: HTMLElement
}

/** Test seam: inject secondary panel content without mounting full shell. */
let _testSecondaryContent: HTMLElement | null = null

export function __setSecondaryContentForTest(el: HTMLElement | null): void {
  _testSecondaryContent = el
}

/**
 * Last-resort DOM reparent into secondary panel content when host tabLocations
 * writes are unavailable (non-CORE allowlist + no store.moveTabTo).
 */
function tryDomPlaceRoot(tabId: string, root: HTMLElement): boolean {
  const secondaryContent =
    _testSecondaryContent ??
    (getSecondaryWrapper()?.querySelector(
      '.sidebar-ux-panel-content',
    ) as HTMLElement | null)
  if (!secondaryContent) {
    dwarn(
      `[tabmove] cannot DOM-place "${tabId}" — secondary .sidebar-ux-panel-content missing`,
    )
    return false
  }

  try {
    if (root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(root)
    }
  } catch (err) {
    dwarn(`[tabmove] DOM appendChild failed for "${tabId}":`, err)
    return false
  }

  const inSecondary =
    root.parentElement === secondaryContent ||
    (typeof secondaryContent.contains === 'function' && secondaryContent.contains(root))
  if (!inSecondary) {
    dwarn(`[tabmove] DOM place for "${tabId}" did not stick (parent not secondary content)`)
    return false
  }

  root.setAttribute('data-canvas-moved', tabId)
  root.setAttribute(CANVAS_DOM_PLACED_ATTR, '')
  markDomPlacedBuiltIn(tabId)
  dlog(
    `[tabmove] place built-in "${tabId}" ok via=dom ` +
    `(bridge+store unavailable; registry root reparented into secondary)`,
  )
  return true
}

/**
 * Host-owned placement of a built-in into canvas-secondary-drawer.
 * Prefer bridge/store tabLocations; fall back to DOM reparent when both fail.
 * Returns the root on success, undefined if root/location/DOM unavailable.
 */
export async function moveBuiltInTabToSecondaryContainer(
  opts: MoveBuiltInToSecondaryOpts,
): Promise<HTMLElement | undefined> {
  const { tabId, deferActivation = false } = opts
  const bridge = getHostBridge()
  const ui = bridge?.ui
  if (!ui?.getBuiltInTabRoot) {
    dlog(
      `[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${tabId} branch=BRIDGE_MISSING ` +
      `hasGetBuiltInTabRoot=${!!ui?.getBuiltInTabRoot} hasRequestTabLocation=${!!ui?.requestTabLocation}`,
    )
    return undefined
  }

  let root: HTMLElement | undefined = opts.root
  if (!root) {
    try {
      root = ui.getBuiltInTabRoot(tabId) as HTMLElement | undefined
    } catch (err) {
      dwarn(`[tabmove] getBuiltInTabRoot threw for "${tabId}":`, err)
      root = undefined
    }
  }

  if (!root) {
    // Warm/cold boot: mount via main activation so panel data-fetch effects
    // run before the host reparents the registry root.
    const { ensureBuiltInTabActiveInMain } = await import('./assignment')
    await ensureBuiltInTabActiveInMain(tabId, {
      getBuiltInTabRoot: (id) => {
        try {
          return ui.getBuiltInTabRoot?.(id) as HTMLElement | undefined
        } catch {
          return undefined
        }
      },
      dlog,
    })
    // rAF #1: detached registry root commit + first useEffect (e.g. loadBooks)
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    try {
      root = ui.getBuiltInTabRoot(tabId) as HTMLElement | undefined
    } catch {
      root = undefined
    }
    if (!root) {
      dlog(
        `[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${tabId} branch=EARLY_RETURN getBuiltInTabRootReturned=undefined`,
      )
      dwarn(
        '[SecondaryDrawer] assignToSecondary: built-in tabId not registered (stale or renamed). Skipping restore.',
        { tabId },
      )
      return undefined
    }
    dlog(
      `[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${tabId} branch=LAZY_MOUNT_OK getBuiltInTabRootReturned=element`,
    )
  } else {
    dlog(
      `[canvas-debug] ASSIGN_SEC_BUILTIN_BRIDGE_ROOT tab=${tabId} branch=ROOT_READY via=opts-or-getBuiltInTabRoot`,
    )
  }

  // Tag before host move so attributes travel with the root.
  root.setAttribute('data-canvas-moved', tabId)
  if (!deferActivation) {
    root.setAttribute('data-canvas-active', '')
  }

  // rAF #2: defer tabLocations write (moveTabTo → pendingActiveTabReset)
  // until after the panel's first useEffect has run when we just mounted.
  // Harmless extra frame when root was already present.
  await new Promise<void>((r) => requestAnimationFrame(() => r()))

  dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_HOST_MOVE tab=${tabId} branch=REQUEST_TAB_LOCATION`)
  const placed = requestHostTabToSecondary(tabId)
  if (placed.ok) {
    // Prefer host ownership — drop any stale DOM-placed mark.
    root.removeAttribute(CANVAS_DOM_PLACED_ATTR)
    clearDomPlacedBuiltIn(tabId)
    dlog(
      `[canvas-debug] ASSIGN_SEC_BUILTIN_HOST_MOVE tab=${tabId} via=${placed.via} ` +
      `container=${CANVAS_SECONDARY_CONTAINER_ID}`,
    )

    const afterLoc = ui.getTabLocation?.(tabId) ?? {
      kind: 'container' as const,
      containerId: CANVAS_SECONDARY_CONTAINER_ID,
    }
    watchForContainerPass3Reset(bridge!, tabId, root, afterLoc)
    return root
  }

  // Last resort: DOM reparent (non-CORE allowlist + store.moveTabTo missing).
  if (tryDomPlaceRoot(tabId, root)) {
    if (!deferActivation) {
      root.setAttribute('data-canvas-active', '')
    }
    dlog(
      `[canvas-debug] ASSIGN_SEC_BUILTIN_HOST_MOVE tab=${tabId} via=dom ` +
      `container=${CANVAS_SECONDARY_CONTAINER_ID}`,
    )
    return root
  }

  root.removeAttribute('data-canvas-moved')
  root.removeAttribute('data-canvas-active')
  root.removeAttribute(CANVAS_DOM_PLACED_ATTR)
  clearDomPlacedBuiltIn(tabId)
  dwarn(
    `[tabmove] built-in "${tabId}" not moved to secondary — host allowlist denied, ` +
    `store.moveTabTo unavailable/failed, and DOM reparent failed. Aborting assign.`,
  )
  return undefined
}

/**
 * Warn if ContainerTabContent's Pass 3 reset undid our move. Pass 3
 * fires on the next React commit (~microtask) and reverts tabLocations
 * to main-drawer when the target container is missing from the host's
 * containers store.
 */
function watchForContainerPass3Reset(
  bridge: NonNullable<ReturnType<typeof getHostBridge>>,
  tabId: string,
  builtInRoot: HTMLElement,
  afterLoc: { kind: string; containerId?: string } | null,
): void {
  queueMicrotask(() => {
    try {
      const microLoc = bridge.ui.getTabLocation?.(tabId) ?? null
      const microContainer = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
      // contains may be missing on test fakes
      const rootInContainer =
        typeof microContainer?.contains === 'function'
          ? microContainer.contains(builtInRoot)
          : false
      if (afterLoc?.kind === 'container' && microLoc?.kind === 'main-drawer') {
        dwarn(
          `[tabmove] PASS 3 RESET DETECTED: tabLocations["${tabId}"] was set to ` +
          `${JSON.stringify(afterLoc)} but ContainerTabContent Pass 3 reset it to ` +
          `main-drawer because the target container is missing from Lumiverse's ` +
          `containers store. Fix: ensure the secondary drawer's panel content ` +
          `element is registered via bridge.containers.registerContainer BEFORE ` +
          `the move. (See secondary.tsx — the call exists but may be failing silently.)`,
        )
      }
      void rootInContainer
    } catch {
      /* test fakes / unmounted host */
    }
  })
}
