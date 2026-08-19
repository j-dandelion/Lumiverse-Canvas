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
import { getMainSidebar, getMainWrapper } from '../dom/lumiverse'
import { isMainDrawerOpen } from '../store'
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
 * Find the host main drawer's open/close toggle button — the direct-child
 * <button> of the wrapper whose CSS-module class contains "drawerTab"
 * (ViewportDrawer renders it as the sibling of the drawer panel). Mirrors
 * main-persist's findDrawerToggleButton; kept local so the placement graph
 * does not pull in the persistence watcher.
 */
function findMainDrawerToggle(wrapper: HTMLElement): HTMLButtonElement | null {
  for (const btn of Array.from(wrapper.querySelectorAll(':scope > button'))) {
    if (/drawerTab/i.test((btn as HTMLElement).className)) {
      return btn as HTMLButtonElement
    }
  }
  return null
}

/**
 * Read the HOST main drawer's CURRENT state from the live DOM: the wrapper's
 * open class (drawerOpen) and the sidebar's active tab button (drawerTab).
 *
 * This is the state WorldBookPanel's visibility gate effectively reads
 * (drawerOpen && drawerTab === 'lorebook') — NOT Canvas's own tracked active
 * (resolvePrimaryActiveTabId), which can disagree in taskbar mode (mirror
 * key). DOM truth is used because the fiber store snapshot (findStoreData)
 * is frequently null in the live runtime (observed 2026-08-19).
 */
function hostMainDrawerDomState(): { open: boolean; tab: string | null } | null {
  try {
    const wrapper = getMainWrapper()
    const open = wrapper ? /wrapperOpen/.test(wrapper.className) : false
    const sidebar = getMainSidebar()
    const activeBtn = sidebar?.querySelector(
      'button.tabBtnActive, button[class*="tabBtnActive"]',
    ) as HTMLElement | null
    const tab = activeBtn?.getAttribute('data-tab-id')
      ?? activeBtn?.getAttribute('title')
      ?? null
    return { open, tab }
  } catch {
    return null
  }
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
    // Warm/cold boot: mount via main activation so panel data-fetch effects
    // run before the host reparents the registry root.
    //
    // ORDERING (2026-08-18, empty lorebook book-dropdown in the second
    // drawer): getBuiltInTabRoot → ensureRegistryRoot CREATES the registry
    // root and mounts the panel as a side effect. The old code resolved the
    // root BEFORE pre-activating, so the panel mounted while the host main
    // drawer was showing a different tab and visibility-gated data loads
    // never fired — WorldBookPanel only calls loadBooks() when
    // drawerOpen && drawerTab === 'lorebook', so the moved Lorebook tab's
    // selection dropdown stayed empty. Pre-activate (click the main button)
    // FIRST so the root is created while the host still has the tab active.
    const prevMainOpen = isMainDrawerOpen()
    dlog(
      `[canvas-debug] ASSIGN_SEC_BUILTIN_PRE_ACTIVATE tab=${tabId} ` +
      `hostDrawer=${JSON.stringify(hostMainDrawerDomState())} prevMainOpen=${prevMainOpen}`,
    )
    const { ensureBuiltInTabActiveInMain } = await import('./assignment')
    await ensureBuiltInTabActiveInMain(tabId, {
      // The default isTabActiveInMainDrawer reads Canvas's OWN tracked active
      // (resolvePrimaryActiveTabId), which can report the tab active while the
      // HOST drawer would not fire the panel's visibility-gated load: taskbar
      // mode returns the mirror key (the host store's drawerTab can be a
      // different tab), and a closed drawer leaves drawerOpen false even when
      // drawerTab matches. Only skip the pre-activation click when the HOST
      // main drawer actually has the tab active AND open — the one state where
      // loadBooks already ran or will run when the root mounts.
      isTabActiveInMainDrawer: () => {
        const st = hostMainDrawerDomState()
        return st != null && st.open && st.tab === tabId
      },
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
    dlog(
      `[canvas-debug] ASSIGN_SEC_BUILTIN_POST_ACTIVATE tab=${tabId} ` +
      `hostDrawer=${JSON.stringify(hostMainDrawerDomState())}`,
    )
    // The pre-activation click opened the host main drawer (handleTabClick →
    // openDrawer). Close it again when it was closed before: nothing else in
    // the move/restore flow re-closes it, and a boot with a closed main
    // drawer would otherwise come back with it open (the layout's
    // primary.open is authoritative and must be preserved).
    if (!prevMainOpen && isMainDrawerOpen()) {
      const wrapper = getMainWrapper()
      const toggle = wrapper ? findMainDrawerToggle(wrapper) : null
      toggle?.click()
    }
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
