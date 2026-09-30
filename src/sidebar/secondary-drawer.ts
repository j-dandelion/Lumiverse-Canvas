// SecondaryDrawer: state machine for secondary drawer lifecycle.
//
// Manages tab assignment to the secondary, coordinates with DrawerObserver
// for DOM-based tab discovery, and owns the showSecondaryTab display-toggle
// path. Extension tabs use the host's registered container location and
// preserve their persistent root; built-in tabs (Characters, History) use
// the display-toggle path directly.

import { drawerObserver, keyForTabShape, type ObservedTab } from './drawer-observer'
import {
  showSecondaryTab as showSecondaryTabDisplay,
  addSecondaryTabButton,
  removeSecondaryTabButton,
  findMainTabButton,
  hideMainTabButton,
  showMainTabButton,
  clearSecondaryTabButtonActive,
  updateDrawerTabVisibility,
  readMainButtonShortName,
  isSettingsButton,
} from '../tabs/buttons'
import {
  getTabAssignments, getTabSidebar, setTabAssignment, deleteTabAssignment,
} from '../tabs/assignment'
import {
  getActiveSecondaryTabId,
  resolvePrimaryActiveTabId,
  setActiveSecondaryTabId,
} from '../tabs/active-tab'
import {
  ensureSecondaryShellMounted,
  getSecondaryWrapper,
  openSecondarySidebar,
  isSecondarySidebarOpen,
  closeSecondarySidebar,
} from './secondary'
import {
  findStoreData,
  getDrawerTabs,
  getHostStoreTabs,
  isMainDrawerOpen,
  type DrawerTab,
} from '../store'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { isExtensionKey, type TabKey } from '../core/model'
import { dlog, dwarn } from '../debug/log'
import { getHostBridge } from '../dom/host-bridge'
import { getMainSidebar, getMainWrapper } from '../dom/lumiverse'
import { isMobileViewport } from './mobile-exclusion'

export type SecondaryDrawerState = 'closed' | 'open' | 'tab_active'

let _state: SecondaryDrawerState = 'closed'
let _activeTabId: string | null = null

// Guard flag: when true, the onTabUnregistered handlers (in this file and
// in src/setup.ts) skip ALL their work — assignment deletion, button removal,
// layout persistence, active-tab reset, and auto-close. The layout restore
// flow can fire onTabUnregistered spuriously as Lumiverse re-renders the
// main sidebar (extensions finish loading, React re-commits the button
// tree, the wrapper's activateFn() flips state). Without this guard:
//   1. The composite id assignment is wiped mid-restore.
//   2. The MutationObserver-driven restore pass would re-run
//      assignToSecondary, racing with the restore's end-of-restore
//      block (which is the authoritative state-setter).
//   3. The auto-close would race with the restore's end-of-restore
//      block.
// The owned model's restore boundary is the
// authoritative state-setter during restore. setRestoringFromLayout(true)
// is called before the observer attaches; setRestoringFromLayout(false)
// is called when finishRestore() runs. After the flag is cleared, the
// handlers resume normal behavior for user-initiated move-back and
// extension uninstall.
let _restoringFromLayout = false
export function setRestoringFromLayout(value: boolean): void {
  _restoringFromLayout = value
}
export function isRestoringFromLayout(): boolean {
  return _restoringFromLayout
}

// Guard flag: when true, assignToSecondary skips the showSecondaryTabDisplay
// call at the end of its run. openSecondarySidebar fires a re-assignment
// loop that calls assignToSecondary for every assigned tab — each call
// currently calls showSecondaryTabDisplay(resolvedId), and the last one
// wins. When the user clicks a tab button while the drawer is closed, the
// click handler calls showSecondaryTab(clickedTabId) synchronously, but the
// async re-assignment loop then overwrites the highlight with the last tab
// in the list. Setting this flag during that loop prevents the overwrite.
let _suppressAutoActivation = false
export function setSuppressAutoActivation(value: boolean): void {
  _suppressAutoActivation = value
}
export function isSuppressAutoActivation(): boolean {
  return _suppressAutoActivation
}

/**
 * Resolve a tab in Lumiverse's Zustand store by id (canonical) or title
 * (fallback for when the context-menu's store lookup missed and the
 * tabId we received is actually the human-readable title). Force-walks
 * the fiber tree to bypass the 3s store cache, so callers always see
 * the current state.
 */
function findStoreTab(tabIdOrTitle: string): DrawerTab | null {
  findStoreData(true)
  const tabs = getDrawerTabs()
  return tabs.find((t) => t.id === tabIdOrTitle)
    || tabs.find((t) => t.title === tabIdOrTitle)
    || null
}

/**
 * Initialize the SecondaryDrawer state machine. Wires up DrawerObserver
 * handlers for tab unregistration cleanup.
 */
export function initSecondaryDrawer(_ctx: SpindleFrontendContext): void {
  // The ctx param is kept for API compatibility; the subsystem that
  // consumed it was deleted in the Phase 2 cleanup.
  void _ctx
  // Watch for tabs being unregistered — if we have an assignment, clean it up.
  // Note: setup.ts also registers an onTabUnregistered handler; this is the
  // SecondaryDrawer-specific one that also handles state machine transitions.
  drawerObserver.onTabUnregistered((tabId) => {
    if (getTabAssignments().has(tabId)) {
      // Skip ALL work during layout restore. The restore's end-of-interval
      // logic in the owned dispatcher is the authoritative state-setter; any
      // mutation here would race with it. See _restoringFromLayout comment
      // above for the full failure mode this prevents.
      if (_restoringFromLayout) return
      deleteTabAssignment(tabId)
      removeSecondaryTabButton(tabId)
      // Persist via the owned model; no-op persistLayout was retired.
      if (_activeTabId === tabId) {
        _activeTabId = null
        _state = getTabAssignments().size > 0 ? 'open' : 'closed'
        // Auto-close if the unregistered tab was the last one.
        // Same rationale as the unassignFromSecondary path above.
        if (_state === 'closed') {
          closeSecondarySidebar()
          updateDrawerTabVisibility()
        }
      }
    }
  })
}

/**
 * Shared post-placement finalize for assignToSecondary branches.
 * Consolidates setTabAssignment → hideMainTabButton → addSecondaryTabButton →
 * updateDrawerTabVisibility → (optional open) → header → showSecondaryTab →
 * persistLayout that used to be copy-pasted across extension/built-in paths.
 *
 * Extension path wires assignment *before* open (and may open first), then
 * calls this with `wireAssignment: false` and `openOnClosed: false`.
 * Built-in path places root first, then calls this with defaults.
 */
async function finalizeAssignToSecondary(opts: {
  resolvedId: string
  title: string
  root: HTMLElement
  iconSvg?: string
  shortName?: string
  deferActivation: boolean
  /** When true (default), setTabAssignment + hideMainTabButton. */
  wireAssignment?: boolean
  /**
   * When true (default), open secondary if closed (subject to mobile/restore).
   * Extension path opens earlier and passes false.
   */
  openOnClosed?: boolean
  /**
   * When true (default for extension semantics), set drawer active state when
   * !mobile && !defer even if already open. Built-in only sets active on open
   * (pass false); showSecondaryTab still runs via showActive.
   */
  setActiveWhenReady?: boolean
  /**
   * When true (default), paint showSecondaryTab + persistLayout.
   * Built-in early-return uses true; leave true for all current callers.
   */
  showAndPersist?: boolean
  /** Frozen owned-model identity; never re-derive it from a transient live ID. */
  facadeKey?: TabKey
}): Promise<void> {
  const {
    resolvedId,
    title,
    root,
    iconSvg,
    shortName,
    deferActivation,
    wireAssignment = true,
    openOnClosed = true,
    setActiveWhenReady = true,
    showAndPersist = true,
    facadeKey,
  } = opts

  addSecondaryTabButton({
    id: resolvedId,
    title,
    root,
    iconSvg,
    shortName,
    facadeKey,
  })
  updateDrawerTabVisibility()

  if (wireAssignment) {
    setTabAssignment(resolvedId, 'secondary')
    hideMainTabButton(resolvedId)
  }

  dlog('[SecondaryDrawer] finalize open-gate', {
    resolvedId,
    openOnClosed,
    state: _state,
    sidebarOpen: isSecondarySidebarOpen(),
    mobile: isMobileViewport(),
    restoring: isRestoringFromLayout(),
    deferActivation,
    setActiveWhenReady,
  })
  if (
    openOnClosed
    && _state === 'closed'
    && !isSecondarySidebarOpen()
    && !isMobileViewport()
    && !isRestoringFromLayout()
  ) {
    await openSecondarySidebar()
    dlog('[SecondaryDrawer] finalize open-gate:BRANCH open+tab_active', { resolvedId })
    // Built-in: only promote to tab_active when not deferring.
    // Extension open path sets `_state = 'open'` earlier (openOnClosed false).
    if (!deferActivation) {
      _state = 'tab_active'
      _activeTabId = resolvedId
      setActiveSecondaryTabId(resolvedId)
    }
  } else if (setActiveWhenReady && !isMobileViewport() && !deferActivation) {
    dlog('[SecondaryDrawer] finalize open-gate:BRANCH tab_active-only', { resolvedId })
    _activeTabId = resolvedId
    _state = 'tab_active'
    setActiveSecondaryTabId(resolvedId)
  } else {
    dlog('[SecondaryDrawer] finalize open-gate:BRANCH none', { resolvedId })
  }

  const headerTitle = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-title')
  if (headerTitle && !deferActivation) {
    headerTitle.textContent = title
  }

  if (showAndPersist) {
    // showSecondaryTab applies sidebar-ux-tab-active; suppressed during restore
    // so finishRestore remains authoritative for the active tab.
    //
    // EMPTY-CONTENT TRAP (2026-07-31): this display call is gated on
    // !deferActivation, and deferActivation is forced true whenever
    // setSuppressAutoActivation is on — i.e. during the whole
    // reassignSecondaryTabsFromModel loop. The loop therefore creates
    // buttons + reparents roots but displays nothing. Callers that run the
    // loop must show a tab themselves afterwards (reassignSecondaryTabsFromModel
    // activates the persisted active.secondary or the first placed tab).
    if (!isMobileViewport() && !deferActivation) {
      showSecondaryTabDisplay(resolvedId)
    }
    // Persist via the owned model; no-op persistLayout was retired.
  }

  // Mirror of unassignFromSecondary: host hide does not trigger the pin
  // MutationObserver (style not watched). Force strip rebuild under taskbar mode.
  if (wireAssignment) {
    try {
      const m = await import('./main-tab-pin')
      m.reconcileMainTabListPin()
    } catch { /* pin optional during teardown */ }
  }
}

type AssignCtx = {
  tabId: string
  tab: ObservedTab
  resolvedId: string
  facadeKey: TabKey
  iconSvg?: string
  shortName?: string
  deferActivation: boolean
  /** Boot placement (drawer closed) must not force-open — defaults to true. */
  openOnClosed?: boolean
  /** Boot placement must not activate a tab in a closed drawer. */
  setActiveWhenReady?: boolean
}

type HostMainDrawerState = { open: boolean; tabId: string | null }

function readHostMainDrawerState(): HostMainDrawerState {
  const wrapper = getMainWrapper()
  const sidebar = getMainSidebar()
  const activeButton = sidebar?.querySelector(
    'button.tabBtnActive, button[class*="tabBtnActive"]',
  ) as HTMLElement | null
  return {
    open: wrapper ? /wrapperOpen/.test(wrapper.className) : isMainDrawerOpen(),
    tabId: activeButton?.getAttribute('data-tab-id')
      || activeButton?.getAttribute('title')
      || null,
  }
}

function findMainDrawerToggle(): HTMLButtonElement | null {
  const wrapper = getMainWrapper()
  if (!wrapper) return null
  for (const button of Array.from(wrapper.querySelectorAll(':scope > button'))) {
    if (/drawerTab/i.test((button as HTMLElement).className)) {
      return button as HTMLButtonElement
    }
  }
  return null
}

function findMainExtensionButton(resolvedId: string, title: string): HTMLElement | null {
  const sidebar = getMainSidebar()
  return (
    sidebar?.querySelector(`button[data-tab-id="${CSS.escape(resolvedId)}"]`)
    || sidebar?.querySelector(`button[title="${CSS.escape(title)}"]`)
  ) as HTMLElement | null
}

function isExtensionButton(
  button: HTMLElement,
  resolvedId: string,
  title: string,
): boolean {
  const id = button.getAttribute('data-tab-id') || ''
  const buttonTitle = button.getAttribute('title') || ''
  return id === resolvedId || id === title || buttonTitle === title
}

function usableMainButton(button: HTMLElement | null): button is HTMLElement {
  return !!button
    && button.isConnected
    && button.style.display !== 'none'
    && !isSettingsButton(button)
}

function findPrimaryRestoreButton(
  preferredId: string | null,
  resolvedId: string,
  title: string,
): HTMLElement | null {
  const sidebar = getMainSidebar()
  if (!sidebar) return null

  if (preferredId) {
    const preferred = findMainTabButton(preferredId) as HTMLElement | null
    if (
      usableMainButton(preferred)
      && !isExtensionButton(preferred, resolvedId, title)
    ) return preferred
  }

  return Array.from(sidebar.querySelectorAll('button[data-tab-id], button[title]'))
    .map((button) => button as HTMLElement)
    .find((button) =>
      usableMainButton(button)
      && !isExtensionButton(button, resolvedId, title),
    ) ?? null
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * Activate an extension's real host button to trigger lazy panel mounting.
 * The host mobility API cannot move tabs owned by another extension, so this
 * path waits for the persistent root and then uses Canvas's established DOM
 * reparenting path.
 */
async function mountExtensionRootFromMain(
  args: {
    resolvedId: string
    title: string
    findRoot: () => HTMLElement | null
  },
): Promise<HTMLElement | null> {
  const { resolvedId, title, findRoot } = args
  if (isMobileViewport()) {
    dlog('[SecondaryDrawer] extension mount activation skipped on mobile', { resolvedId })
    return null
  }

  const sidebar = getMainSidebar()
  const targetButton = findMainExtensionButton(resolvedId, title)
  if (!sidebar || !targetButton || !targetButton.isConnected) {
    dwarn('[SecondaryDrawer] cannot mount extension root: main button unavailable', {
      resolvedId,
      title,
      hasSidebar: !!sidebar,
      hasButton: !!targetButton,
    })
    return null
  }

  const before = readHostMainDrawerState()
  const beforeExtensionRoots = new Set(
    Array.from(document.querySelectorAll<HTMLElement>(
      '[data-spindle-drawer-tab][data-spindle-ext-id]',
    )),
  )
  const capturedRoots = new Set<HTMLElement>()
  const hostTab = getHostStoreTabs().find((item) =>
    item.id === resolvedId || item.id === title || item.title === title,
  )
  const expectedTabId = hostTab?.id.startsWith('spindle:') ? hostTab.id : null
  const expectedExtensionId = hostTab?.extensionId && hostTab.extensionId !== 'unknown'
    ? hostTab.extensionId
    : null
  const captureAddedRoots = (records: MutationRecord[]): void => {
    for (const record of records) {
      if (
        record.type === 'attributes'
        && record.target instanceof HTMLElement
        && record.target.matches('[data-spindle-drawer-tab][data-spindle-ext-id]')
        && !beforeExtensionRoots.has(record.target)
        && !capturedRoots.has(record.target)
      ) {
        capturedRoots.add(record.target)
        dlog('[SecondaryDrawer] captured extension root during main activation', JSON.stringify({
          tabId: record.target.getAttribute('data-spindle-drawer-tab'),
          extensionId: record.target.getAttribute('data-spindle-ext-id'),
          connected: record.target.isConnected,
        }))
      }
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue
        const roots = [
          ...(node.matches('[data-spindle-drawer-tab][data-spindle-ext-id]') ? [node] : []),
          ...Array.from(node.querySelectorAll<HTMLElement>(
            '[data-spindle-drawer-tab][data-spindle-ext-id]',
          )),
        ]
        for (const root of roots) {
          if (!beforeExtensionRoots.has(root) && root.tagName !== 'BUTTON' && !capturedRoots.has(root)) {
            capturedRoots.add(root)
            dlog('[SecondaryDrawer] captured extension root during main activation', JSON.stringify({
              tabId: root.getAttribute('data-spindle-drawer-tab'),
              extensionId: root.getAttribute('data-spindle-ext-id'),
              connected: root.isConnected,
            }))
          }
        }
      }
    }
  }
  const rootObserver = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(captureAddedRoots)
  rootObserver?.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-spindle-drawer-tab', 'data-spindle-ext-id'],
  })
  const findNewlyMountedRoot = (): HTMLElement | null => {
    const candidates = new Set<HTMLElement>(capturedRoots)
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(
      '[data-spindle-drawer-tab][data-spindle-ext-id]',
    ))) {
      if (!beforeExtensionRoots.has(element)) candidates.add(element)
    }
    const all = Array.from(candidates)
    const matchingTab = expectedTabId
      ? all.filter((element) => element.getAttribute('data-spindle-drawer-tab') === expectedTabId)
      : []
    if (matchingTab.length === 1) return matchingTab[0]
    const matchingExtension = expectedExtensionId
      ? all.filter((element) => element.getAttribute('data-spindle-ext-id') === expectedExtensionId)
      : []
    if (matchingExtension.length === 1) return matchingExtension[0]
    return all.length === 1 ? all[0] : null
  }
  let capturedRoot: HTMLElement | null = null
  const findMountedRoot = (): HTMLElement | null => {
    capturedRoot = capturedRoot || findRoot() || findNewlyMountedRoot()
    return capturedRoot
  }
  const wasTargetHidden = targetButton.style.display === 'none'
  if (wasTargetHidden) targetButton.style.display = ''

  const targetWasSelected = before.tabId === resolvedId || before.tabId === title
  dlog('[SecondaryDrawer] mounting extension root via main activation', JSON.stringify({
    resolvedId,
    title,
    before,
    targetWasSelected,
    wasTargetHidden,
    expectedTabId,
    expectedExtensionId,
    storeEntry: hostTab ? { id: hostTab.id, extensionId: hostTab.extensionId, hasRoot: !!hostTab.root } : null,
  }))

  let root: HTMLElement | null = null
  try {
    // Open the host drawer explicitly before relying on tab selection to
    // mount visibility-gated extension panels. In Canvas mirror mode, clicking
    // a host tab can select it while the host wrapper itself stays closed.
    if (!before.open) {
      const toggle = findMainDrawerToggle()
      if (toggle) toggle.click()
      else targetButton.click()
      await nextFrame()
    }
    const afterOpen = readHostMainDrawerState()
    dlog('[SecondaryDrawer] host state after opening for extension activation', JSON.stringify(afterOpen))
    if (afterOpen.tabId !== resolvedId && afterOpen.tabId !== title) {
      targetButton.click()
    }
    dlog('[SecondaryDrawer] host state after selecting extension', JSON.stringify(readHostMainDrawerState()))

    const deadline = Date.now() + 2500
    let delayMs = 16
    while (Date.now() < deadline) {
      root = findMountedRoot()
      if (root && root.tagName !== 'BUTTON') break
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
      delayMs = Math.min(125, delayMs * 2)
    }
    root = root && root.tagName !== 'BUTTON' ? root : null
    if (root) await nextFrame()
  } finally {
    if (rootObserver) {
      captureAddedRoots(rootObserver.takeRecords())
      rootObserver.disconnect()
    }
    root = root || findRoot() || findNewlyMountedRoot()
    // Restore the prior main selection, or select a remaining main tab if the
    // extension being moved was itself active. Never click a Canvas-hidden
    // tab or Lumiverse's Settings tab as a fallback.
    if (before.tabId) {
      const desiredId = before.tabId === resolvedId || before.tabId === title
        ? resolvePrimaryActiveTabId()
        : before.tabId
      const restoreButton = findPrimaryRestoreButton(desiredId, resolvedId, title)
      if (restoreButton) {
        const afterActivation = readHostMainDrawerState()
        const restoreId = restoreButton.getAttribute('data-tab-id')
          || restoreButton.getAttribute('title')
          || ''
        if (afterActivation.tabId !== restoreId) restoreButton.click()
      }
    }
    if (!before.open && isMainDrawerOpen()) {
      findMainDrawerToggle()?.click()
    }

    // Let the host finish its selection/render pass before Canvas reparents
    // the now-mounted persistent extension root.
    await nextFrame()
    if (wasTargetHidden && !root) targetButton.style.display = 'none'
  }

  if (root && root.tagName !== 'BUTTON') {
    // The activation restore can replace a root in hosts that remount panels.
    // Prefer the current store/DOM root, falling back to the captured node.
    const currentRoot = findMountedRoot()
    return currentRoot && currentRoot.tagName !== 'BUTTON' ? currentRoot : root
  }

  dlog('[SecondaryDrawer] extension root did not mount after main activation', JSON.stringify({
    resolvedId,
    title,
    after: readHostMainDrawerState(),
    expectedTabId,
    expectedExtensionId,
    candidates: Array.from(capturedRoots).map((element) => ({
      tabId: element.getAttribute('data-spindle-drawer-tab'),
      extensionId: element.getAttribute('data-spindle-ext-id'),
      connected: element.isConnected,
    })),
  }))
  return null
}

function scheduleFailedExtensionPlacementRollback(resolvedId: string, facadeKey: TabKey): void {
  showMainTabButton(resolvedId)
  if (_restoringFromLayout) {
    // Keep the persisted placement intent; restore can run before an
    // extension finishes loading. The visible host button preserves access,
    // and a later restore/reassignment pass can retry the mount.
    dlog('[SecondaryDrawer] retaining rootless extension assignment during layout restore', {
      resolvedId,
    })
    return
  }
  // Placement runs inside the owned-model dispatch queue. Queue the rollback
  // after that placement settles instead of awaiting a nested dispatch here.
  setTimeout(() => {
    void import('../recon/dispatch').then(({ dispatch, getModel }) => {
      if (!getModel()) {
        deleteTabAssignment(resolvedId)
        return
      }
      if (getTabSidebar(facadeKey) !== 'secondary') return
      return dispatch({
        t: 'move',
        key: facadeKey,
        to: 'primary',
        index: -1,
        activateDest: false,
      })
    }).catch((err) => {
      dwarn('[SecondaryDrawer] failed extension placement rollback threw:', err)
    })
  }, 0)
}

/**
 * Extension tabs: activate the host button when needed to mount the persistent
 * root, then reparent that root into the secondary drawer.
 */
async function assignExtensionTabToSecondary(ctx: AssignCtx): Promise<void> {
  const { tabId, tab, resolvedId, facadeKey, iconSvg, shortName, deferActivation } = ctx
  // A direct user move places the DOM before dispatching the owned-model move.
  // Remember the initial side so the post-mount race check can distinguish
  // that expected primary state from a tab moved back out of secondary.
  const assignmentSideAtStart = getTabSidebar(facadeKey)
  setTabAssignment(resolvedId, 'secondary')
  // On mobile, do not auto-open during assign (would enforceExclusionOnOpen).
  // During layout restore, skip auto-open so finishRestore decides open state.
  if (_state === 'closed' && !isSecondarySidebarOpen() && !isMobileViewport() && !isRestoringFromLayout()) {
    await openSecondarySidebar()
    _state = 'open'
  }

  // Scope to secondary wrapper — shared class also exists on main-mirror.
  const secondaryContent =
    getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content') ?? null
  const bareId = resolvedId.includes(':')
    ? (resolvedId.replace(/:\d+$/, '').split(':').pop() ?? resolvedId)
    : resolvedId
  const existingRoot = (secondaryContent?.querySelector(
    `[data-canvas-moved="${CSS.escape(resolvedId)}"]`,
  ) ?? secondaryContent?.querySelector(
    `[data-canvas-moved="${CSS.escape(bareId)}"]`,
  )) as HTMLElement | null

  if (existingRoot) {
    const storeTabForButton = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)
    hideMainTabButton(resolvedId)
    await finalizeAssignToSecondary({
      resolvedId,
      title: tab.title || storeTabForButton?.title || resolvedId,
      root: existingRoot,
      iconSvg: iconSvg
        || (tab.button as HTMLElement | undefined)?.querySelector('svg')?.outerHTML
        || storeTabForButton?.iconSvg,
      shortName: shortName || readMainButtonShortName(tab.button as Element) || storeTabForButton?.shortName,
      deferActivation,
      wireAssignment: false,
      openOnClosed: false,
      facadeKey,
      // DnD cross-drawer placement passes setActiveWhenReady:false so the
      // dropped tab is NOT activated in the destination (quiet DnD contract).
      setActiveWhenReady: ctx.setActiveWhenReady ?? true,
    })
    return
  }

  // Extension mobility is owner-scoped in Lumiverse; Canvas cannot set the
  // location of a tab owned by another extension. Resolve the live root from
  // the host inventory and mount it through the real main tab button when it
  // is lazy, then use the same persistent-root DOM placement as main.
  const secondaryWrapper = getSecondaryWrapper()
  const secondaryContentMain = secondaryWrapper?.querySelector('.sidebar-ux-panel-content')
  const storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)

  if (!secondaryContentMain) {
    dwarn('[SecondaryDrawer] cannot place extension root: secondary content missing', {
      resolvedId,
      title: tab.title,
    })
    scheduleFailedExtensionPlacementRollback(resolvedId, facadeKey)
    return
  }

  const findHostStoreTab = (): DrawerTab | null => {
    const hostStoreTabs = getHostStoreTabs()
    return hostStoreTabs.find((item) => item.id === resolvedId)
      || hostStoreTabs.find((item) => item.id === tabId)
      || hostStoreTabs.find((item) => item.title === tab.title)
      || null
  }

  const findRealRoot = (): HTMLElement | null => {
    const fiberTab = findHostStoreTab()
    const storeRoot = fiberTab?.root && fiberTab.root !== tab.button
      ? fiberTab.root as HTMLElement
      : null
    if (storeRoot?.isConnected && storeRoot.tagName !== 'BUTTON') return storeRoot

    // Some host snapshots expose the canonical tab ID before their root
    // pointer updates. The host stamps that ID on the rendered extension root.
    const stampedIds = [fiberTab?.id, resolvedId, tabId]
      .filter((id): id is string => !!id)
    for (const id of stampedIds) {
      const stampedRoot = document.querySelector(
        `[data-spindle-drawer-tab="${CSS.escape(id)}"]`,
      ) as HTMLElement | null
      if (stampedRoot?.isConnected && stampedRoot.tagName !== 'BUTTON') return stampedRoot
    }
    return null
  }
  let realRoot = findRealRoot()

  if (!realRoot) {
    try {
      realRoot = await mountExtensionRootFromMain({
        resolvedId,
        title: tab.title || storeTab?.title || resolvedId,
        findRoot: findRealRoot,
      })
    } catch (err) {
      dwarn('[SecondaryDrawer] extension main activation failed:', err)
      scheduleFailedExtensionPlacementRollback(resolvedId, facadeKey)
      return
    }
  }

  // A user move-back or extension removal can race the mount wait. Respect
  // the latest placement decision before moving the host root.
  const currentMainButton = findMainExtensionButton(
    resolvedId,
    tab.title || storeTab?.title || resolvedId,
  )
  const currentSide = getTabSidebar(facadeKey)
  const movedBackDuringMount = assignmentSideAtStart === 'secondary'
    && currentSide !== 'secondary'
  if (movedBackDuringMount || !currentMainButton?.isConnected) {
    showMainTabButton(resolvedId)
    dlog('[SecondaryDrawer] extension mount placement cancelled after host activation', JSON.stringify({
      resolvedId,
      initialSide: assignmentSideAtStart,
      currentSide,
      mainButtonFound: !!currentMainButton,
      hostStoreEntryFound: !!findHostStoreTab(),
    }))
    return
  }

  if (!realRoot || realRoot.tagName === 'BUTTON') {
    dwarn('[SecondaryDrawer] extension root unavailable after main activation; placement did not complete', JSON.stringify({
      resolvedId,
      title: tab.title || storeTab?.title || resolvedId,
      mainButtonFound: !!currentMainButton,
      hostStoreEntryFound: !!findHostStoreTab(),
    }))
    scheduleFailedExtensionPlacementRollback(resolvedId, facadeKey)
    return
  }

  const root = realRoot

  // Reparent only after the activation and host selection restoration have
  // settled. The host root is persistent; this preserves its live React state.
  // It may already be detached because the host restored its previous active
  // tab immediately after the activation render; retaining the node reference
  // still lets Canvas mount that same root here.
  root.setAttribute('data-canvas-moved', resolvedId)

  if (root.parentElement !== secondaryContentMain) {
    secondaryContentMain.appendChild(root)
  }

  await nextFrame()
  if (!secondaryContentMain.contains(root)) {
    dlog('[SecondaryDrawer] host reclaimed extension root during activation restore; retrying DOM placement', {
      resolvedId,
      parentTag: root.parentElement?.tagName || null,
    })
    secondaryContentMain.appendChild(root)
    await nextFrame()
  }
  if (!secondaryContentMain.contains(root)) {
    root.removeAttribute('data-canvas-moved')
    root.removeAttribute('data-canvas-active')
    dwarn('[SecondaryDrawer] host reclaimed extension root after DOM placement; placement did not complete', {
      resolvedId,
      title: tab.title || storeTab?.title || resolvedId,
    })
    scheduleFailedExtensionPlacementRollback(resolvedId, facadeKey)
    return
  }

  // During restore / suppress, leave data-canvas-active alone so
  // finishRestore → showSecondaryTab is the sole content switcher.
  if (!deferActivation) {
    for (const child of Array.from(secondaryContentMain.children)) {
      if (child instanceof HTMLElement) {
        if (child === root) {
          child.setAttribute('data-canvas-active', '')
        } else {
          child.removeAttribute('data-canvas-active')
        }
      }
    }
  }

  // Wire the secondary chrome only after the actual content root is present.
  setTabAssignment(resolvedId, 'secondary')
  hideMainTabButton(resolvedId)
  await finalizeAssignToSecondary({
    resolvedId,
    title: tab.title || storeTab?.title || resolvedId,
    root,
    iconSvg: (tab.button as HTMLElement | undefined)?.querySelector('svg')?.outerHTML || storeTab?.iconSvg,
    shortName: readMainButtonShortName(tab.button as Element) || storeTab?.shortName,
    deferActivation,
    wireAssignment: false,
    openOnClosed: false,
    facadeKey,
    // Quiet DnD: see existingRoot branch above.
    setActiveWhenReady: ctx.setActiveWhenReady ?? true,
  })
  return
}

/**
 * Built-in tabs: host React-managed roots — place via requestTabLocation
 * (moveBuiltInTabToSecondaryContainer). Never raw-appendChild out of main
 * panelContent (main-mirror parks that node).
 */
async function assignBuiltInTabToSecondary(ctx: AssignCtx): Promise<void> {
  const { tabId, tab, resolvedId, facadeKey, deferActivation } = ctx
  const secondaryWrapper = getSecondaryWrapper()
  const secondaryContent = secondaryWrapper?.querySelector('.sidebar-ux-panel-content')
  const storeTab = findStoreTab(resolvedId) || findStoreTab(tabId) || findStoreTab(tab.title)
  const wSpindle = getHostBridge()
  const wSpindleUi = wSpindle?.ui
  dlog(
    `[canvas-debug] ASSIGN_SEC_BUILTIN_ENTER tab=${resolvedId} hasStoreTab=${!!storeTab} ` +
    `hasSecondaryContent=${!!secondaryContent}`,
  )

  // Early exit: already reparented — dual-id (bare vs composite tags).
  let alreadyInSecondary: HTMLElement | null = null
  if (secondaryContent) {
    const idsToTry = resolvedId !== tabId ? [resolvedId, tabId] : [resolvedId]
    for (const id of idsToTry) {
      alreadyInSecondary = secondaryContent.querySelector(
        `[data-canvas-moved="${CSS.escape(id)}"]`,
      ) as HTMLElement | null
      if (alreadyInSecondary) break
    }
  }
  if (alreadyInSecondary) {
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_EARLY_RETURN tab=${resolvedId} branch=ALREADY_IN_SECONDARY`)
    const title = wSpindleUi?.getBuiltInTabTitle?.(tabId) || tab.title || storeTab?.title || resolvedId
    await finalizeAssignToSecondary({
      resolvedId,
      title,
      root: alreadyInSecondary,
      iconSvg: tab.button?.querySelector('svg')?.outerHTML || alreadyInSecondary.querySelector('svg')?.outerHTML,
      shortName: readMainButtonShortName(tab.button as Element) || storeTab?.shortName,
      deferActivation,
      wireAssignment: true,
      openOnClosed: ctx.openOnClosed ?? true,
      facadeKey,
      // Built-in: only set tab_active when we open; otherwise show path only.
      setActiveWhenReady: ctx.setActiveWhenReady ?? false,
    })
    return
  }

  if (!secondaryContent) {
    dwarn('[SecondaryDrawer] assignToSecondary: secondary content missing; cannot place built-in.', {
      tabId,
      resolvedId,
    })
    return
  }

  let root: HTMLElement | undefined
  let placedViaHost = false

  // Prefer host tabLocations (bridge + store.moveTabTo), then DOM reparent
  // inside moveBuiltInTabToSecondaryContainer. Do not treat "got a registry
  // root" alone as success — that produced empty secondary panels.
  //
  // Do NOT resolve the registry root here: moveBuiltInTabToSecondaryContainer
  // owns root resolution and pre-activates the tab in the host main drawer
  // FIRST (a main-button click) so the panel's mount-time/visibility data
  // effects fire while the host still has the tab active. Pre-resolving the
  // root here mounted the panel before that pre-activation, so the Lorebook
  // panel never loaded its book list — its dropdown stayed empty in the
  // second drawer (WorldBookPanel.loadBooks is gated on
  // drawerOpen && drawerTab === 'lorebook').
  if (wSpindleUi?.getBuiltInTabRoot) {
    const { moveBuiltInTabToSecondaryContainer } = await import('../tabs/builtin-move')
    root = await moveBuiltInTabToSecondaryContainer({
      tabId,
      deferActivation,
    })
    placedViaHost = !!root
  }

  // Extension-style store roots only (not DRAWER_TABS registry roots).
  // Built-in registry roots go through moveBuiltIn (host or DOM fallback).
  if (!root && storeTab?.root && storeTab.extensionId) {
    root = storeTab.root
    if (root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(root)
    }
    root.setAttribute('data-canvas-moved', resolvedId)
    dlog(`[canvas-debug] ASSIGN_SEC_BUILTIN_STORE_REPARENT tab=${resolvedId} branch=STORE_ROOT`)
  }

  if (!root) {
    dwarn(
      '[SecondaryDrawer] assignToSecondary: built-in tab not placed ' +
      '(host location write failed, DOM reparent failed, or root missing).',
      { tabId, resolvedId, hasGetRoot: !!wSpindleUi?.getBuiltInTabRoot },
    )
    return
  }

  // During restore, leave data-canvas-active alone so finishRestore wins.
  if (!deferActivation) {
    for (const child of Array.from(secondaryContent.children)) {
      if (child instanceof HTMLElement) {
        if (child === root || child.getAttribute('data-canvas-moved') === resolvedId) {
          child.setAttribute('data-canvas-active', '')
        } else if (child.hasAttribute('data-canvas-moved')) {
          child.removeAttribute('data-canvas-active')
        }
      }
    }
  }

  const title = wSpindleUi?.getBuiltInTabTitle?.(tabId) || tab.title || storeTab?.title || resolvedId
  const iconSvg = tab.button?.querySelector('svg')?.outerHTML || root.querySelector('svg')?.outerHTML
  const shortName = readMainButtonShortName(tab.button as Element) || storeTab?.shortName

  // Host may remount panelContent under the hidden wrapper after host/DOM move.
  if (placedViaHost) {
    try {
      const m = await import('./main-mirror-drawer')
      if (m.isMainMirrorActive()) m.ensureHostContentParkedPublic()
    } catch { /* ignore */ }
  }

  await finalizeAssignToSecondary({
    resolvedId,
    title,
    root,
    iconSvg,
    shortName,
    deferActivation,
    wireAssignment: true,
    openOnClosed: ctx.openOnClosed ?? true,
    facadeKey,
    setActiveWhenReady: ctx.setActiveWhenReady ?? false,
  })
}

/**
 * Assign a tab to the secondary drawer. Extension tabs are reparented
 * via DOM appendChild (preserving state); built-in tabs (Characters,
 * History) use host requestTabLocation / store-root placement.
 *
 * Tab resolution: DrawerObserver first (built-in path), then Lumiverse's
 * store (extension path). Extension tab buttons in Lumiverse's
 * ViewportDrawer.tsx:247-273 don't carry `data-tab-id`, so DrawerObserver
 * can't register them — we fall back to the Zustand store snapshot.
 *
 * Public entry is a thin resolver + dispatcher; placement lives in
 * assignExtensionTabToSecondary / assignBuiltInTabToSecondary with shared
 * finalizeAssignToSecondary for the post-placement tail.
 */
export async function assignToSecondary(
  tabId: string,
  opts?: { openOnClosed?: boolean; setActiveWhenReady?: boolean; facadeKey?: TabKey },
): Promise<void> {
  // Snapshot at entry so fire-and-forget async tails still defer activation
  // after finishRestore / openSecondarySidebar clear the live flags.
  // Only "become the active secondary tab" side effects are gated — assignment,
  // button create, reparent, and hideMainTabButton always proceed.
  const deferActivation =
    isRestoringFromLayout() || isSuppressAutoActivation()

  // Without a live shell, built-in place and extension reparent no-op (content
  // missing / tab list missing). Heal detached or never-mounted wrappers first.
  if (!ensureSecondaryShellMounted({ initialOpen: false })) {
    dwarn(`[SecondaryDrawer] assignToSecondary: secondary shell unavailable; skip "${tabId}"`)
    return
  }

  let tab = drawerObserver.getTab(tabId)
  let iconSvg: string | undefined
  let shortName: string | undefined

  if (!tab) {
    const storeTab = findStoreTab(tabId)
    if (!storeTab) {
      dwarn(`[SecondaryDrawer] assignToSecondary: tab ${tabId} not found in DrawerObserver or store`)
      return
    }
    // findMainTabButton resolves by id first, then by title (buttons.ts:35-83).
    // For extension tabs without data-tab-id, the title-based path is what hits.
    const button = findMainTabButton(storeTab.title)
    if (!button) {
      dwarn(`[SecondaryDrawer] assignToSecondary: tab ${tabId} found in store but no main sidebar button (title="${storeTab.title}")`)
      return
    }
    tab = {
      tabId: storeTab.id,
      button: button as HTMLElement,
      extensionId: storeTab.extensionId,
      title: storeTab.title,
      key: keyForTabShape(storeTab.id, storeTab.extensionId, storeTab.title),
      titles: new Set([storeTab.title]),
    }
    iconSvg = storeTab.iconSvg
    shortName = storeTab.shortName
  } else {
    iconSvg = tab.button.querySelector('svg')?.outerHTML
  }

  const resolvedId = tab.tabId
  dlog(`[SecondaryDrawer] assigning ${resolvedId} to secondary (ext=${tab.extensionId})`)

  // The observer/store metadata can lag behind the frozen model identity.
  // In particular, live DnD may hand us `ext:unknown/Title` while the
  // observer still reports `extensionId: unknown`; routing that entry to the
  // built-in path can fail to find a registry root and leave the parked main
  // mirror as the only clickable control. The owned TabKey namespace is the
  // authoritative kind signal when the caller supplies it.
  const facadeKey = opts?.facadeKey ?? tab.key
  let isExtensionTab = isExtensionKey(facadeKey)
    || (!!tab.extensionId && tab.extensionId !== 'unknown')
  if (!isExtensionTab || !tab.extensionId || tab.extensionId === 'unknown' || tab.tabId === tab.title) {
    // Resolve stale addresses independently of the frozen model kind. A key
    // like ext:unknown/Title correctly says "extension", but it does not
    // supply the host's current live ID. The host store (fiber walk) is the
    // source for that address; findStoreTab/getDrawerTabs can return this same
    // stale observer entry and therefore cannot perform the upgrade.
    // unreachable (resolved above) — TS cannot narrow `tab` past the await
    if (!tab) return
    const t = tab
    const hostStoreTabs = getHostStoreTabs()
    const storeTab = hostStoreTabs.find((x) => x.id === tabId)
      || hostStoreTabs.find((x) => x.id === t.tabId)
      || hostStoreTabs.find((x) => x.title === t.title)
    if (storeTab?.extensionId && storeTab.extensionId !== 'unknown') {
      dlog('[SecondaryDrawer] assignToSecondary: observer entry stale — upgraded from store', {
        fromId: t.tabId,
        toId: storeTab.id,
        extFrom: t.extensionId,
        extTo: storeTab.extensionId,
      })
      tab = {
        ...tab,
        tabId: storeTab.id,
        extensionId: storeTab.extensionId,
        title: storeTab.title,
        titles: new Set([storeTab.title]),
      }
      iconSvg = iconSvg ?? storeTab.iconSvg
      shortName = shortName ?? storeTab.shortName
      isExtensionTab = true
    }
  }

  const ctx: AssignCtx = {
    tabId,
    tab,
    resolvedId: tab.tabId,
    // Prefer the move intent's model key; otherwise carry the observer's
    // frozen identity through button creation instead of re-resolving a
    // session-specific live ID after the placement awaits.
    facadeKey,
    iconSvg,
    shortName,
    deferActivation,
    openOnClosed: opts?.openOnClosed,
    setActiveWhenReady: opts?.setActiveWhenReady,
  }
  if (isExtensionTab) {
    await assignExtensionTabToSecondary(ctx)
  } else {
    await assignBuiltInTabToSecondary(ctx)
  }
}

/**
 * Remove a tab from the secondary drawer. Reparented roots are moved back
 * to the main panel. Built-in tabs have no extensionId (or an empty one),
 * so no extension teardown is required.
 */
export async function unassignFromSecondary(tabId: string): Promise<void> {
  dlog(`[SecondaryDrawer] unassigning ${tabId} from secondary`)

  // Resolve the bare id to the store's composite id. The wrapper button's
  // data-tab-id is the bare options.id, but the main sidebar button was
  // hidden with the composite id (assignToSecondary:125 used the store's
  // resolvedId). Without resolution, findMainTabButton returns null and
  // the button stays hidden. The segment match works for extensions;
  // built-ins fall through to findStoreTab.
  let resolvedShowId = tabId
  let resolvedExtId: string | undefined
  findStoreData(true)  // force-walk the fiber tree to bypass 3s store cache
  const _tabs = getDrawerTabs()
  const _bySegment = _tabs.find(t => t.id.includes(`:tab:${tabId}:`) || t.id === tabId)
  if (_bySegment) {
    resolvedShowId = _bySegment.id
    resolvedExtId = _bySegment.extensionId
  } else {
    const storeTab = findStoreTab(tabId)
    if (storeTab) {
      resolvedShowId = storeTab.id
      resolvedExtId = storeTab.extensionId
    } else {
      dwarn(`[SecondaryDrawer] unassign: could not resolve bare id "${tabId}" to composite id; known tabs=`, _tabs.map(t => ({ id: t.id, title: t.title })))
    }
  }

  // Built-in vs extension placement is different (see secondary.tsx teardown
  // and tabs/assignment.ts primary restore):
  //   - Built-in: host owns tabLocations. Must requestTabLocation({kind:
  //     'main-drawer'}) so ContainerTabContent renders on activate. Never
  //     raw-removeChild/appendChild React roots (orphans → empty/wrong content).
  //   - Extension: Canvas reparented the store root into secondary; put it
  //     back into main panel content via appendChild so instance state survives.
  // Owned-model restore → unassignUnwantedSecondary calls this directly (skips
  // assignment.ts), so the host reset must live here, not only in assignTab.
  const bridge = getHostBridge()
  const bridgeUi = bridge?.ui
  let bridgeRoot: HTMLElement | undefined
  try {
    bridgeRoot =
      (bridgeUi?.getBuiltInTabRoot?.(tabId) as HTMLElement | undefined) ||
      (resolvedShowId !== tabId
        ? (bridgeUi?.getBuiltInTabRoot?.(resolvedShowId) as HTMLElement | undefined)
        : undefined)
  } catch {
    bridgeRoot = undefined
  }
  // Built-in if registry root present, or host title resolves (getBuiltInTabTitle
  // is free / no ui_panels). Avoid treating unknown extension ids as built-in.
  const isBuiltIn =
    bridgeRoot != null ||
    !!(
      bridgeUi?.getBuiltInTabTitle?.(tabId) ||
      (resolvedShowId !== tabId ? bridgeUi?.getBuiltInTabTitle?.(resolvedShowId) : undefined)
    )

  // Dual-id lookup: built-ins often tag with bare tabId (builtin-move) while
  // resolvedShowId may be a composite store id.
  const _secondaryContentForUnassign = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content')
  let _movedRoot: HTMLElement | null = null
  if (_secondaryContentForUnassign) {
    const idsToTry = resolvedShowId !== tabId
      ? [resolvedShowId, tabId]
      : [resolvedShowId]
    for (const id of idsToTry) {
      _movedRoot = _secondaryContentForUnassign.querySelector(
        `[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`,
      ) as HTMLElement | null
      if (_movedRoot) break
    }
  }

  if (isBuiltIn) {
    // Prefer the bare id the host registered (tabId / bridge root tag).
    // Non-CORE: requestTabLocation allowlist may no-op; store.moveTabTo may be
    // missing. DOM-placed tabs need appendChild back to main panelContent.
    const hostTabId =
      bridgeRoot?.getAttribute?.('data-tab-id') ||
      tabId
    let hostResetOk = false
    try {
      const { requestHostTabToMain } = await import('../tabs/host-tab-location')
      const result = requestHostTabToMain(hostTabId)
      hostResetOk = result.ok
      if (!result.ok) {
        dwarn(
          `[SecondaryDrawer] unassign: could not reset tabLocations for ${hostTabId} (via=${result.via})`,
        )
      }
    } catch (err) {
      dwarn(`[SecondaryDrawer] unassign: requestHostTabToMain failed for ${hostTabId}:`, err)
    }

    const {
      isDomPlacedBuiltIn,
      restoreDomPlacedBuiltInToMain,
      CANVAS_DOM_PLACED_ATTR,
    } = await import('../tabs/builtin-move')
    const domPlaced =
      isDomPlacedBuiltIn(hostTabId) ||
      isDomPlacedBuiltIn(tabId) ||
      !!_movedRoot?.hasAttribute?.(CANVAS_DOM_PLACED_ATTR) ||
      !!bridgeRoot?.hasAttribute?.(CANVAS_DOM_PLACED_ATTR)

    if (domPlaced || (!hostResetOk && _movedRoot)) {
      // DOM fallback path (or host reset failed with residual secondary root).
      restoreDomPlacedBuiltInToMain(hostTabId, _movedRoot || bridgeRoot)
      if (tabId !== hostTabId) {
        const { clearDomPlacedBuiltIn } = await import('../tabs/builtin-move')
        clearDomPlacedBuiltIn(tabId)
      }
    } else {
      // Host-owned move: only clear Canvas attrs — never steal the React root.
      const clearAttrs = (el: HTMLElement | null | undefined) => {
        if (!el) return
        el.removeAttribute('data-canvas-moved')
        el.removeAttribute('data-canvas-active')
        el.removeAttribute(CANVAS_DOM_PLACED_ATTR)
      }
      clearAttrs(_movedRoot)
      clearAttrs(bridgeRoot)
      if (!_movedRoot && typeof document !== 'undefined') {
        const idsToTry = resolvedShowId !== tabId
          ? [resolvedShowId, tabId]
          : [resolvedShowId]
        for (const id of idsToTry) {
          const residual = document.querySelector(
            `[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`,
          ) as HTMLElement | null
          if (residual) {
            clearAttrs(residual)
            break
          }
        }
      }
    }
  } else if (_movedRoot) {
    // Extension reparent path: ask the host to move the tab back to the
    // main drawer first (updates tabLocations → ContainerTabContent Pass 2
    // removes the root from the canvas-secondary-drawer container, and the
    // main drawer's TabPanelContent will mount it on activation). If the
    // host can't move it (allowlist deny + store.moveTabTo missing), DETACH
    // the store root — the host owns placement (TabPanelContent moves the
    // root into its containerRef when the tab activates).
    // 2026-08-17: this used to append the root into getMainPanelContent() —
    // the node the main-mirror parks in its shell — leaving orphan roots as
    // visible children of the parked content area (stacked panels; "content
    // stays on a previous tab" after moves / mode switches).
    let hostResetOk = false
    try {
      const { requestHostTabToMain } = await import('../tabs/host-tab-location')
      const result = requestHostTabToMain(resolvedShowId)
      hostResetOk = result.ok
      dlog('[SecondaryDrawer] unassignExtensionTab: requestHostTabToMain', {
        tabId: resolvedShowId, ok: result.ok, via: result.via,
      })
    } catch (err) {
      dwarn(`[SecondaryDrawer] unassignExtensionTab: requestHostTabToMain failed for ${resolvedShowId}:`, err)
    }

    if (!hostResetOk) {
      // Fallback: detach the root so the host re-attaches it on activation.
      if (_movedRoot.parentElement) {
        try {
          _movedRoot.parentElement.removeChild(_movedRoot)
        } catch {
          /* host may have removed it already */
        }
      }
    }
    _movedRoot.removeAttribute('data-canvas-moved')
    _movedRoot.removeAttribute('data-canvas-active')
    _movedRoot.style?.removeProperty?.('position')
    _movedRoot.style?.removeProperty?.('inset')
    _movedRoot.style?.removeProperty?.('display')
  } else if (typeof document !== 'undefined') {
    // Fallback: root already outside secondary — clear residual attrs only.
    const idsToTry = resolvedShowId !== tabId
      ? [resolvedShowId, tabId]
      : [resolvedShowId]
    for (const id of idsToTry) {
      const residual = document.querySelector(
        `[data-canvas-moved="${CSS.escape(id)}"]:not([data-canvas-secondary])`,
      ) as HTMLElement | null
      if (residual) {
        residual.removeAttribute('data-canvas-moved')
        residual.removeAttribute('data-canvas-active')
        break
      }
    }
  }

  // Clean up _tabAssignments for both the bare id (registered by the
  // wrapper) and the composite id (registered by assignToSecondary).
  deleteTabAssignment(tabId)
  if (resolvedShowId !== tabId) {
    deleteTabAssignment(resolvedShowId)
  }
  removeSecondaryTabButton(tabId)
  const activeId = getActiveSecondaryTabId()
  if (activeId === tabId || activeId === resolvedShowId) {
    _activeTabId = null
    setActiveSecondaryTabId(null)
    clearSecondaryTabButtonActive()
  }
  showMainTabButton(resolvedShowId)
  // Main-mirror strip filters display:none host buttons and only rebuilds
  // on its own reconcile. Without this, the unhidden host button stays
  // invisible in the pin strip until some other host mutation.
  try {
    const m = await import('./main-tab-pin')
    m.reconcileMainTabListPin()
  } catch { /* pin module optional during early teardown */ }

  if (getTabAssignments().size === 0) {
    _state = 'closed'
    _activeTabId = null
    setActiveSecondaryTabId(null)
    // Auto-close the secondary drawer when the last tab is moved out.
    // Default behavior (no silent flag) persists the closed state via
    // persistOpenState() so the next reload starts with the drawer
    // closed. closeSecondarySidebar is idempotent — safe on already-closed.
    // Also hide the drawer tab button itself (display:none inline) so
    // it can't be clicked to reopen an empty drawer.
    closeSecondarySidebar()
    updateDrawerTabVisibility()
  }
  // Persist via the owned model; no-op persistLayout was retired.
}

/**
 * Activate a tab in the secondary drawer (display-toggle path).
 * This is the showSecondaryTab path — all content is pre-mounted.
 */
export function activateSecondaryTab(tabId: string): void {
  _activeTabId = tabId
  _state = 'tab_active'
  showSecondaryTabDisplay(tabId)
}

/**
 * Get the current active secondary tab ID.
 */
export function getActiveSecondaryTab(): string | null {
  return _activeTabId
}

/**
 * Get the current state.
 */
export function getSecondaryDrawerState(): SecondaryDrawerState {
  return _state
}

/**
 * Keep the drawer state machine in sync with the shell's physical open
 * state. `openSecondarySidebar`/`closeSecondarySidebar` live in the shell
 * module and don't own `_state`, so the finalize gate (which checks
 * `_state === 'closed'`) can read a stale 'closed' while the drawer is
 * visibly open — the observed drift in the 2026-07-31 rClick session.
 * Called by the shell when the drawer actually opens/closes.
 */
export function markDrawerOpenState(open: boolean): void {
  if (open) {
    _state = _activeTabId ? 'tab_active' : 'open'
  } else {
    _state = 'closed'
  }
}

/**
 * Tear down the secondary drawer state machine. Called on Canvas disable.
 */
export function teardownSecondaryDrawer(): void {
  _state = 'closed'
  _activeTabId = null
  setActiveSecondaryTabId(null)
}
