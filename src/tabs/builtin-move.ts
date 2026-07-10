// Host-owned placement of built-in drawer tabs into the Canvas secondary
// container. Built-in roots are React-managed; Canvas must never raw-
// appendChild them out of main panelContent (especially when main-mirror
// has parked that node). Always use requestTabLocation.

import { dlog, dwarn } from '../debug/log'
import { getHostBridge } from '../dom/host-bridge'
import { getSecondaryWrapper } from '../sidebar/secondary'
// Lazy import ensureBuiltInTabActiveInMain to avoid circular import with
// assignment.ts (which imports this helper for the assignTab path).

export type MoveBuiltInToSecondaryOpts = {
  tabId: string
  /** When true, do not set data-canvas-active (restore / openSecondary loop). */
  deferActivation?: boolean
  /** Optional pre-resolved root; if omitted, helper resolves via bridge. */
  root?: HTMLElement
}

/**
 * Host-owned placement of a built-in into canvas-secondary-drawer.
 * Never appendChild's the root into secondary.
 * Returns the root on success, undefined if bridge/root unavailable.
 */
export async function moveBuiltInTabToSecondaryContainer(
  opts: MoveBuiltInToSecondaryOpts,
): Promise<HTMLElement | undefined> {
  const { tabId, deferActivation = false } = opts
  const bridge = getHostBridge()
  const ui = bridge?.ui
  if (!ui?.getBuiltInTabRoot || !ui.requestTabLocation) {
    dlog(
      `[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=${tabId} branch=BRIDGE_MISSING ` +
      `hasGetBuiltInTabRoot=${!!ui?.getBuiltInTabRoot} hasRequestTabLocation=${!!ui?.requestTabLocation}`,
    )
    return undefined
  }

  let root: HTMLElement | undefined = opts.root
  if (!root) {
    root = ui.getBuiltInTabRoot(tabId) as HTMLElement | undefined
  }

  if (!root) {
    // Warm/cold boot: mount via main activation so panel data-fetch effects
    // run before the host reparents the registry root.
    const { ensureBuiltInTabActiveInMain } = await import('./assignment')
    await ensureBuiltInTabActiveInMain(tabId, {
      getBuiltInTabRoot: (id) => ui.getBuiltInTabRoot?.(id) as HTMLElement | undefined,
      dlog,
    })
    // rAF #1: detached registry root commit + first useEffect (e.g. loadBooks)
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    root = ui.getBuiltInTabRoot(tabId) as HTMLElement | undefined
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

  // rAF #2: defer requestTabLocation (moveTabTo → pendingActiveTabReset)
  // until after the panel's first useEffect has run when we just mounted.
  // Harmless extra frame when root was already present.
  await new Promise<void>((r) => requestAnimationFrame(() => r()))

  dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_HOST_MOVE tab=${tabId} branch=REQUEST_TAB_LOCATION`)
  ui.requestTabLocation(tabId, {
    kind: 'container',
    containerId: 'canvas-secondary-drawer',
  })

  const afterLoc = ui.getTabLocation?.(tabId) ?? null
  watchForContainerPass3Reset(bridge!, tabId, root, afterLoc)

  return root
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
