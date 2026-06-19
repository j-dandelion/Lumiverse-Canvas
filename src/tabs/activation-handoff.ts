/**
 * Activation handoff on tab move — symmetric orchestrator for source
 * replacement and destination activation.
 *
 * Rules:
 *   Part A: source activates neighbor iff the moved tab was the active tab
 *           in the source drawer at the time of the move.
 *   Part B: when Part A fires, activate the tab immediately above the
 *           moved tab's prior slot, or the tab immediately below if no
 *           tab exists above.  'Slot' = position before removal.
 *   Part C: destination activates the moved tab on every move, except on
 *           mobile (isMobileViewport() === true).  Unconditional on
 *           active-status.
 *
 * Part A and Part B apply on ALL viewports.  Part C is mobile-skipped.
 * Symmetric for primary and secondary drawers.
 *
 * PUBLIC API: runHandoff, captureSourceList only.
 */
import { dlog } from '../debug/log'
import { isMobileViewport } from '../sidebar/mobile-exclusion'
import {
  isTabActiveInMainDrawer,
  getActiveSecondaryTabId,
  setActiveSecondaryTabId,
} from './active-tab'
import { findMainTabButton, showSecondaryTab } from './buttons'
import { findStoreData, getDrawerTabs } from '../store'
import { getMainPanelContent, getMainSidebar } from '../dom/lumiverse'

/* ------------------------------------------------------------------ */
/* captureSourceList                                                   */
/* ------------------------------------------------------------------ */

/**
 * Capture the ordered list of tab IDs in the source drawer *before* the
 * DOM mutation that the move triggers.
 *
 * For 'primary': reads BOTH the main sidebar DOM (built-in tabs have
 * `data-tab-id={bareId}`, set by Lumiverse's ViewportDrawer.tsx:226)
 * AND the store's `drawerTabs` (extension tabs). Lumiverse's
 * `DRAWER_TABS` (the static built-in config in
 * `lib/drawer-tab-registry.tsx`) is never in the Zustand store, so a
 * store-only read produces an empty source list when the moved tab is
 * built-in. With an empty list, `pickSourceReplacement` returns null,
 * Gate A is skipped, and the host's `pendingActiveTabReset` useEffect
 * (`ViewportDrawer.tsx:114-120`) activates 'profile' as the first
 * non-moved tab — which is the "always Profile" bug. The DOM read
 * gives us the built-in tabs in visual order. The store read covers
 * extension tabs (which have no `data-tab-id` attribute on their
 * button). Merge: DOM first (visual order), then store IDs not in
 * the DOM. If both reads are empty, one RAF retry on the DOM only
 * (the store is the same).
 *
 * For 'secondary': queries the DOM for `.sidebar-ux-tab-list button[data-tab-id]`.
 */
export async function captureSourceList(side: 'primary' | 'secondary', h?: TestHooks): Promise<string[]> {
  if (side === 'primary') {
    const _findStore = h?.findStoreData ?? findStoreData
    const _getTabs = h?.getDrawerTabs ?? getDrawerTabs
    const _getSidebar = h?.getMainSidebar ?? getMainSidebar

    // Read built-in tabs from the main sidebar DOM.
    const mainSidebar = _getSidebar()
    const domIds: string[] = []
    if (mainSidebar) {
      const btns = mainSidebar.querySelectorAll('button[data-tab-id]') as NodeListOf<HTMLButtonElement>
      for (const btn of btns) {
        const id = btn.getAttribute('data-tab-id')
        if (id) domIds.push(id)
      }
    }

    // Also read extension tabs from the store. Belt-and-suspenders for
    // extension tabs that haven't mounted yet (cold-start) or that are
    // registered but not yet in the DOM.
    _findStore(true)
    const storeIds = _getTabs().map(t => t.id).filter(Boolean)

    // Merge: DOM first (preserves visual order, which is what
    // pickSourceReplacement expects), then store IDs not already in
    // the DOM. Dedup to handle the edge case where a tab appears in
    // both (shouldn't happen, but defensive).
    const merged: string[] = []
    const seen = new Set<string>()
    for (const id of domIds) {
      if (!seen.has(id)) {
        merged.push(id)
        seen.add(id)
      }
    }
    for (const id of storeIds) {
      if (!seen.has(id)) {
        merged.push(id)
        seen.add(id)
      }
    }

    if (merged.length === 0) {
      // Cold-start race: the DOM or store may be empty on the first
      // move.  One RAF lets the initial mount settle, then retry the
      // DOM only (the store is the same).
      await new Promise<void>(r => requestAnimationFrame(() => r()))
      const retrySidebar = _getSidebar()
      if (retrySidebar) {
        const btns = retrySidebar.querySelectorAll('button[data-tab-id]') as NodeListOf<HTMLButtonElement>
        for (const btn of btns) {
          const id = btn.getAttribute('data-tab-id')
          if (id && !seen.has(id)) {
            merged.push(id)
            seen.add(id)
          }
        }
      }
    }

    // Filter out tabs that are currently in the secondary drawer. The
    // main sidebar DOM includes built-in tab buttons regardless of
    // location (Lumiverse still renders them in main even when the
    // tab's root is in secondary), and the store includes extension
    // tabs regardless of location. Without this filter,
    // pickSourceReplacement can pick a tab-in-secondary as the
    // replacement, which activates a tab with empty content in main
    // (the root is in secondary, so the main panel is blank with just
    // the tab's header showing). This is the "Memory (cortex) header
    // with empty content" / "personas picked from secondary" bug.
    //
    // v8 fix: use the main sidebar button's CSS display as the
    // authoritative signal. When canvas moves a tab to secondary, it
    // sets btn.style.display = 'none' on the corresponding main
    // sidebar button (see showSecondaryTab in src/tabs/buttons.ts).
    // Hidden buttons = tabs in secondary; visible buttons = tabs in
    // main. This is reliable because it directly reflects canvas's
    // own state-management, with no dependency on Lumiverse's host
    // bridge (which was found unreliable — it returned null for tabs
    // in secondary) or on the main-panel DOM (which only contains
    // the active tab's root, so checking root-in-main-panel filtered
    // out ALL non-active tabs in main, leaving the source list with
    // ~5 items — a previous over-filter regression that picked an
    // HTML Preview extension tab as the replacement for create).
    const _getSidebarForFilter = h?.getMainSidebar ?? getMainSidebar
    const mainSidebarEl = _getSidebarForFilter()
    if (mainSidebarEl) {
      const filtered: string[] = []
      const filteredOut: string[] = []
      for (const id of merged) {
        // Find the button for this tab in the main sidebar. If the
        // button exists and is hidden (display=none), the tab is in
        // secondary — exclude it. If the button is not found, include
        // the tab defensively (could be a tab not yet rendered in the
        // sidebar, e.g., a freshly mounted extension tab).
        const btn = mainSidebarEl.querySelector(`button[data-tab-id="${id}"]`) as HTMLElement | null
        if (btn && btn.style.display === 'none') {
          filteredOut.push(id)
          dlog(`[tabmove] captureSourceList: filtering out tabId="${id}" (button display=none, in secondary)`)
          continue
        }
        filtered.push(id)
      }
      dlog(`[tabmove] captureSourceList: kept ${filtered.length}, filtered out ${filteredOut.length} (filteredOut=[${filteredOut.join(',')}])`)
      return filtered
    }

    return merged
  }
  // secondary — DOM-based (the store may be unreliable for wrapper tabs)
  const btns = document.querySelectorAll('.sidebar-ux-tab-list button[data-tab-id]')
  return Array.from(btns).map(b => b.getAttribute('data-tab-id')).filter(Boolean) as string[]
}

/* ------------------------------------------------------------------ */
/* isMovedTabActiveInSource                                            */
/* ------------------------------------------------------------------ */

/**
 * Gate for Part A: was the moved tab the active tab in the source drawer?
 *
 * For 'primary': uses isTabActiveInMainDrawer after awaiting one
 * microtask (allows store commit to settle after the DOM mutation).
 *
 * For 'secondary': reads getActiveSecondaryTabId() directly.
 *
 * preMoveSourceActiveTab (when provided by the caller, i.e. assignment.ts
 * capturing state BEFORE the move's requestTabLocation + unassign side
 * effects) overrides the post-move check for BOTH sides. This is critical
 * for 'secondary' because unassignFromSecondary resets the active tab
 * to the first remaining secondary tab before runHandoff runs, so the
 * post-move read would always return false.
 */
async function isMovedTabActiveInSource(tabId: string, side: 'primary' | 'secondary', h?: TestHooks, preMoveSourceActiveTab?: boolean): Promise<boolean> {
  if (preMoveSourceActiveTab !== undefined) {
    return preMoveSourceActiveTab
  }
  if (side === 'primary') {
    // One-microtask defer: the store commit that records the active tab
    // may not have landed yet when we are called (the move's
    // requestTabLocation triggers a React commit that is async).
    await new Promise<void>(r => Promise.resolve().then(() => r()))
    return (h?.isTabActiveInMainDrawer ?? isTabActiveInMainDrawer)(tabId)
  }
  return (h?.getActiveSecondaryTabId ?? getActiveSecondaryTabId)() === tabId
}

/* ------------------------------------------------------------------ */
/* pickSourceReplacement  (PURE — no side-effects, no logging)         */
/* ------------------------------------------------------------------ */

/**
 * Given the moved tab's id and the source list captured before removal,
 * return the id of the tab that should become active in the source
 * drawer (Part B).
 *
 * Logic: pick the tab immediately above (lower index) the moved tab.
 * If none exists above, pick the tab immediately below (higher index).
 * If the list has no neighbor, return null (drawer ends empty).
 */
function pickSourceReplacement(tabId: string, sourceList: string[]): string | null {
  const idx = sourceList.indexOf(tabId)
  if (idx === -1) return sourceList.length > 0 ? sourceList[0] : null
  if (idx > 0) return sourceList[idx - 1]
  if (idx < sourceList.length - 1) return sourceList[idx + 1]
  return null
}

/* ------------------------------------------------------------------ */
/* activateInPrimary                                                   */
/* ------------------------------------------------------------------ */

/**
 * Activate a tab in the primary (main) drawer.
 *
 * Uses segment-match id resolution (the composite store id may differ
 * from the bare id passed in), finds the main button, dispatches a
 * click, then runs the 100ms post-click verification.
 */
async function activateInPrimary(tabId: string, h?: TestHooks): Promise<void> {
  const _findBtn = h?.findMainTabButton ?? findMainTabButton
  const _findStore = h?.findStoreData ?? findStoreData
  const _getTabs = h?.getDrawerTabs ?? getDrawerTabs
  const _getPanel = h?.getMainPanelContent ?? getMainPanelContent

  let resolvedId = tabId
  const directBtn = _findBtn(tabId) as HTMLElement | null
  if (!directBtn) {
    _findStore(true)
    const tabs = _getTabs()
    const bySegment = tabs.find(t => t.id.includes(`:tab:${tabId}:`) || t.id === tabId)
    if (bySegment) {
      resolvedId = bySegment.id
      dlog(`[tabmove] primary restore: resolved bare id "${tabId}" -> composite id "${resolvedId}" via store segment match`)
    } else {
      dlog(`[tabmove] primary restore: could not resolve bare id "${tabId}" to composite id; known tabs=`, tabs.map(t => ({ id: t.id, title: t.title })))
    }
  }
  const mainBtn = (directBtn ?? _findBtn(resolvedId)) as HTMLElement | null
  if (mainBtn) {
    dlog(`[tabmove] primary restore: main button found tabId="${tabId}" resolvedId="${resolvedId}" display=${mainBtn.style.display} classList="${mainBtn.className}"`)
    mainBtn.click()
    dlog(`[tabmove] primary restore: clicked main button to activate tabId="${resolvedId}"`)

    // BUG 5 FIX v5 (stick observer): re-click if the host's
    // pendingActiveTabReset useEffect (ViewportDrawer.tsx:114-120) fires
    // AFTER our click and overrides the active state. The host's reset
    // picks the first non-moved tab in allTabs — but allTabs includes
    // built-ins regardless of location, so the reset can pick a tab
    // that's in the secondary drawer (e.g., memory) and set
    // drawerTab=memory, leaving the main drawer's content area empty
    // because memory's root is in secondary. This race is the
    // "sometimes Profile / sometimes empty header" bug. The 100ms
    // verification below catches the case where the host fires BEFORE
    // our click; the stick observer catches the case where the host
    // fires AFTER. The 200ms safety timeout prevents fighting a
    // legitimate user tab swap.
    const stickSidebar = (h?.getMainSidebar ?? getMainSidebar)()
    let stickObserver: MutationObserver | null = null
    if (stickSidebar && typeof MutationObserver !== 'undefined') {
      stickObserver = new MutationObserver(() => {
        const currentActive = stickSidebar.querySelector('button[class*="tabBtnActive"]') as HTMLElement | null
        const currentActiveId = currentActive?.getAttribute('data-tab-id')
        if (currentActiveId && currentActiveId !== resolvedId) {
          if (stickObserver) { stickObserver.disconnect(); stickObserver = null }
          dlog(`[tabmove] primary restore: stick observer fired — host overwrote "${resolvedId}" with "${currentActiveId}", re-clicking`)
          mainBtn.click()
        }
      })
      stickObserver.observe(stickSidebar, { attributes: true, attributeFilter: ['class'], subtree: true })
      setTimeout(() => { if (stickObserver) { stickObserver.disconnect(); stickObserver = null } }, 200)
      dlog(`[tabmove] primary restore: stick observer armed for resolvedId="${resolvedId}"`)
    }

    // 100ms post-click verification (Q5 user-confirmed).
    await new Promise<void>(resolve => {
      setTimeout(() => {
        const active = mainBtn.className.includes('tabBtnActive')
        const wUiForCheck = (window as any).spindle?.ui
        const rootForCheck = wUiForCheck?.getBuiltInTabRoot?.(resolvedId)
        const mainPanelContentForCheck = _getPanel()
        const rootInMain = rootForCheck && mainPanelContentForCheck ? mainPanelContentForCheck.contains(rootForCheck) : null
        const rootChildCount = rootForCheck ? rootForCheck.children.length : null
        const rootComputedDisplay = rootForCheck ? getComputedStyle(rootForCheck).display : null
        const rootRect = rootForCheck ? rootForCheck.getBoundingClientRect() : null
        dlog(`[tabmove] primary restore: post-click verification tabId="${resolvedId}" isActive=${active} rootInMain=${rootInMain} rootChildren=${rootChildCount} rootDisplay=${rootComputedDisplay} rootRect=${rootRect ? `${rootRect.width}x${rootRect.height}` : 'null'}`)
        // Host's ViewportDrawer useEffect (spindle-placement.ts:350-361) fires
        // ~1-16ms after requestTabLocation commits, resetting drawerTab to
        // the first non-moved tab (topmost). By 100ms, the useEffect has
        // cleared pendingActiveTabReset, so a re-click sticks. The BUG 3
        // FIX observer at assignment.ts:308-337 is intentionally NOT armed
        // when the moved tab is active, so this re-click is the only
        // counter to the host's reset.
        if (!active) {
          dlog(`[tabmove] primary restore: post-click verification FAILED (host overwrote), re-clicking main button to activate tabId="${resolvedId}"`)
          mainBtn.click()
        }
        if (active && rootInMain === false && rootForCheck && mainPanelContentForCheck) {
          if (!mainPanelContentForCheck.contains(rootForCheck)) {
            mainPanelContentForCheck.appendChild(rootForCheck)
            dlog(`[tabmove] primary restore: fallback mount — appended built-in root to main panel content for tabId="${resolvedId}"`)
          }
        }
        resolve()
      }, 100)
    })
  } else {
    dlog(`[tabmove] primary restore: main button NOT FOUND for tabId="${tabId}" resolvedId="${resolvedId}"`)
  }
}

/* ------------------------------------------------------------------ */
/* activateInSecondary                                                 */
/* ------------------------------------------------------------------ */

/**
 * Activate a tab in the secondary drawer.
 *
 * Dual-write: setActiveSecondaryTabId (in-memory state) + data-canvas-active
 * attribute on the moved root element (CSS source of truth).
 *
 * Invariant: both writes must happen for the activation to be visible.
 * The in-memory state is read by getActiveSecondaryTabId() for Part A
 * gating on subsequent moves; the DOM attribute drives the CSS hide
 * rule [data-canvas-moved]:not([data-canvas-active]).
 */
function activateInSecondary(tabId: string, h?: TestHooks): void {
  if (!h) { showSecondaryTab(tabId); return; }
  const _setSecondaryTabId = h?.setActiveSecondaryTabId ?? setActiveSecondaryTabId
  _setSecondaryTabId(tabId)
  // Find the moved root by data-canvas-moved attribute and set data-canvas-active
  const secondaryContent = document.querySelector('.sidebar-ux-panel-content') as HTMLElement | null
  if (secondaryContent) {
    const movedRoots = Array.from(
      secondaryContent.querySelectorAll('[data-canvas-moved]:not([data-canvas-secondary])')
    ) as HTMLElement[]
    for (const root of movedRoots) {
      const tid = root.getAttribute('data-canvas-moved') || ''
      if (tid === tabId) {
        root.setAttribute('data-canvas-active', '')
      } else {
        root.removeAttribute('data-canvas-active')
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* runHandoff  (orchestrator)                                          */
/* ------------------------------------------------------------------ */

export interface TestHooks {
  isMobileViewport?: () => boolean
  isTabActiveInMainDrawer?: (tabId: string) => boolean
  getActiveSecondaryTabId?: () => string | null
  setActiveSecondaryTabId?: (tabId: string | null) => void
  findMainTabButton?: (tabId: string) => HTMLElement | null
  findStoreData?: (force?: boolean) => void
  getDrawerTabs?: () => Array<{id: string; title?: string}>
  getMainPanelContent?: () => HTMLElement | null
  getMainSidebar?: () => HTMLElement | null
  // Host-bridge v0.5.24 — returns {kind: 'main-drawer' | 'container', containerId?}.
  // null = unknown / not available (test environment).
  getTabLocation?: (tabId: string) => { kind: string; containerId?: string } | null
}

export interface HandoffArgs {
  tabId: string
  source: 'primary' | 'secondary'
  destination: 'primary' | 'secondary'
  sourceList: string[]
  preMoveSourceActiveTab?: boolean
  _testHooks?: TestHooks
}

/**
 * Orchestrator: run both gates (source replacement, destination
 * activation) independently.  Each gate is wrapped in try/catch so
 * that a failure in one does not prevent the other from executing.
 */
export async function runHandoff({ tabId, source, destination, sourceList, preMoveSourceActiveTab, _testHooks: h }: HandoffArgs): Promise<void> {
  const wasActive = await isMovedTabActiveInSource(tabId, source, h, preMoveSourceActiveTab)
  const replacementId = pickSourceReplacement(tabId, sourceList)
  const isMobile = (h?.isMobileViewport ?? isMobileViewport)()

  // [canvas-debug] HANDOFF_DECIDE — emitted at the top of runHandoff
  dlog(
    `[canvas-debug] HANDOFF_DECIDE movedTab=${tabId} source=${source} destination=${destination} ` +
    `wasActive=${wasActive} replacement=${replacementId ?? 'NONE'} mobile=${isMobile} ` +
    `activateSource=${wasActive && replacementId !== null} activateDestination=${!isMobile}`
  )

  // [canvas-debug] HANDOFF_REPLACE_PICK — after pickSourceReplacement returns
  const above = replacementId !== null
    ? (sourceList.indexOf(replacementId) < sourceList.indexOf(tabId) ? replacementId : null)
    : null
  const below = replacementId !== null
    ? (sourceList.indexOf(replacementId) > sourceList.indexOf(tabId) ? replacementId : null)
    : null
  dlog(
    `[canvas-debug] HANDOFF_REPLACE_PICK source=${source} movedTab=${tabId} ` +
    `above=${above ?? 'NONE'} below=${below ?? 'NONE'} picked=${replacementId ?? 'NONE'}`
  )

  // Gate A: source activation — was active AND replacement found
  if (wasActive && replacementId !== null) {
    try {
      if (source === 'primary') {
        await activateInPrimary(replacementId, h)
      } else {
        activateInSecondary(replacementId, h)
      }
    } catch (err) {
      dlog(`[canvas-debug] HANDOFF_ERROR gate=source source=${source} replacement=${replacementId} err=${err}`)
    }
  }

  // Gate B: destination activation — unconditional except mobile
  if (!isMobile) {
    // [canvas-debug] HANDOFF_DEST_ACTIVATE
    dlog(
      `[canvas-debug] HANDOFF_DEST_ACTIVATE destination=${destination} tabId=${tabId} ` +
      `method=${destination === 'primary' ? 'click-main-button' : 'setActiveSecondaryTabId+data-canvas-active'} ` +
      `skippedMobile=${isMobile}`
    )
    try {
      if (destination === 'primary') {
        await activateInPrimary(tabId, h)
      } else {
        activateInSecondary(tabId, h)
      }
    } catch (err) {
      dlog(`[canvas-debug] HANDOFF_ERROR gate=destination destination=${destination} tabId=${tabId} err=${err}`)
    }
  }
}
