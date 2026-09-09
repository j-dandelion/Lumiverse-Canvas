// Main-drawer "keep tab controls visible" — pin chrome + orchestration.
//
// S2 (2026-09): the mirror TAB STRIP is rendered by main-renderer.ts from
// the owned model (order/hidden/active/chrome). This module no longer
// clones host buttons, tracks an exclusive mirror key, heals/adopts
// activations, or writes through to the host drawer. It owns only:
//
//   1. Enable/teardown entrypoints for the Canvas main drawer shell.
//   2. PIN chrome (taskbarMode visual): tab-list reparent to the
//      body-level edge host between mount and reconcile passes.
//   3. The host sidebar observer → rAF-coalesced re-render (twin chrome
//      deltas: icons/labels/tagging settle after React commits).
//
// Mobile: always force-off (matches secondary pin).

import { getMainSidebar } from '../dom/lumiverse'
import { getMainDrawerSide } from '../store'
import { isTaskbarModeEnabled } from '../settings/state'
import { isMobileViewport } from './mobile-exclusion'
import {
  applyMainMirrorDrawer,
  getMainMirrorTabList,
  isMainMirrorActive,
  onMainMirrorTabActivated,
  pinMainMirrorShellTabList,
  reconcileMainMirrorDrawer,
  unpinMainMirrorShellTabList,
  __resetMainMirrorForTest,
} from './main-mirror-drawer'
import {
  clearPinnedTabListChrome,
  destroyMainPinHost,
  ensureMainPinHost,
  getMainPinHost,
  TAB_LIST_PINNED_CLASS,
} from './tab-position'
import {
  initMainRenderer,
  renderMainMirrorTabs,
  teardownMainRenderer,
} from './main-renderer'

/**
 * Single module state object for main-mirror pin chrome.
 *
 * S2: `activeKey`/`userPicked` are GONE — the owned model's active.primary
 * is the single highlight/content source (dispatch commit → renderer).
 */
interface MirrorState {
  /** PIN chrome only (S1): shell ownership is unconditional on desktop. */
  enabled: boolean
  sidebar: HTMLElement | null
  observer: MutationObserver | null
  reconcileRaf: number | null
}

const initialState: MirrorState = {
  enabled: false,
  sidebar: null,
  observer: null,
  reconcileRaf: null,
}

let _state: MirrorState = { ...initialState }

/** Commit a mirror-state patch. All state writes go through here. */
function commitState(updater: (prev: MirrorState) => Partial<MirrorState>): void {
  Object.assign(_state, updater(_state))
}

/**
 * Enable or disable the main-drawer Canvas mirror PIN (taskbar chrome).
 * `force: true` re-applies even when already in the target state.
 *
 * S1 gate inversion: the mirror DRAWER shell is Canvas-owned unconditionally
 * on desktop — `enabled` here only controls the PIN chrome (tab list
 * reparented to the screen-edge host). `false` keeps the shell mounted and
 * its renderer live; the tab list rides inside the drawer. Mobile always
 * tears down the mirror entirely (host drawer is the mobile surface).
 */
export function applyMainTabListPin(
  enabled: boolean,
  opts?: { force?: boolean },
): void {
  if (isMobileViewport()) {
    if (enabled && !opts?.force) return
    teardownMainPin()
    return
  }

  // Desktop: shell ownership first. Only force-remount when ENABLING (the
  // old re-apply semantics) — unpinning must never churn panelContent, so
  // the false branch mounts softly (no-op when the shell is already live).
  if (enabled) {
    applyMainMirrorDrawer(true, { force: !!opts?.force })
  } else {
    applyMainMirrorDrawer(true, { force: false })
  }

  // Renderer subscription is idempotent; the immediate render fills a
  // freshly mounted list without waiting for the next model commit.
  initMainRenderer()

  if (_state.enabled === enabled && !opts?.force) {
    scheduleReconcile()
    return
  }

  commitState(() => ({ enabled }))
  ensureObservers()
  if (enabled) {
    // Pin chrome ON: reparent + render (reconcileMainMirror pins via
    // pinMainMirrorShellTabList, idempotent with the mount-time pin).
    reconcileMainMirror()
  } else {
    // Pin chrome OFF: tab list back into the drawer; keep the shell's
    // renderer live (the shell is the main drawer either way).
    unpinMainMirrorShellTabList()
    reconcileMainMirror()
    void import('./strip-gutter').then((m) => m.clearStripGutters()).catch(() => {})
  }
}

/** Tear down only the pin chrome, keep the mirror drawer shell (taskbar OFF). */
function unpinMainMirrorForChromeOff(): void {
  try { unpinMainMirrorShellTabList() } catch { /* ignore */ }
  // Non-creating getter — never ensureMainPinHost here (would re-create the
  // host we are about to destroy).
  const host = getMainPinHost()
  if (host) {
    const pinnedLists = host.querySelectorAll(`.${TAB_LIST_PINNED_CLASS}`) as NodeListOf<HTMLElement>
    for (const el of Array.from(pinnedLists)) clearPinnedTabListChrome(el)
  }
  destroyMainPinHost()
}

/**
 * Re-apply main pin from current settings + live DOM.
 * Safe on mount, side-change, viewport cross-up, and settings apply.
 *
 * S1 gate inversion: the main mirror shell is ALWAYS mounted on desktop —
 * taskbarMode no longer gates ownership (it only controls the edge-strip
 * pin chrome). Mobile still force-tears-down (host drawer is the mobile
 * surface until the mobile task lands).
 */
export function reconcileMainTabListPin(): void {
  if (isMobileViewport()) {
    applyMainTabListPin(false, { force: true })
    void import('./strip-gutter').then((m) => m.updateStripGutters())
    return
  }
  // Drawer shell is always owned on desktop; renderer keeps filling it.
  reconcileMainMirrorDrawer()
  initMainRenderer()
  const shouldPin = isTaskbarModeEnabled()
  if (shouldPin) {
    commitState(() => ({ enabled: true }))
    ensureObservers()
    reconcileMainMirror()
  } else {
    // Gate inversion: shell stays; only the pin chrome tears down.
    if (_state.enabled) {
      commitState(() => ({ enabled: false }))
      unpinMainMirrorForChromeOff()
    }
    ensureObservers()
    // Render into the shell's own tab list (rides with the panel).
    reconcileMainMirror()
  }
  // Side-change remaps main/secondary strip gutters to left/right.
  void import('./strip-gutter').then((m) => m.updateStripGutters())
}

/** True when main pin / mirror mode is enabled (setting applied, not mobile). */
export function isMainTabListPinActive(): boolean {
  return _state.enabled && isMainMirrorActive()
}

/** Test-only: reset module state without requiring a full document. */
export function __resetMainTabPinForTest(): void {
  stopObservers()
  teardownMainRenderer()
  _state = { ...initialState }
  __resetMainMirrorForTest()
  destroyMainPinHost()
}

/**
 * Full teardown of main pin + mirror shell (mobile cross-down, extension
 * disable). Unlike applyMainTabListPin(false) — which only unpins and keeps
 * the shell — this removes the Canvas main drawer entirely.
 */
export function teardownMainPin(): void {
  commitState(() => ({ enabled: false }))
  stopObservers()
  teardownMainRenderer()
  applyMainMirrorDrawer(false, { force: true })
  destroyMainPinHost()
}

/** rAF-coalesced reconcile: pin chrome + renderer (twin chrome deltas). */
function scheduleReconcile(): void {
  if (_state.reconcileRaf !== null) return
  commitState(() => ({
    reconcileRaf: requestAnimationFrame(() => {
      commitState(() => ({ reconcileRaf: null }))
      if (isMainMirrorActive()) reconcileMainMirror()
    }),
  }))
}

/**
 * Pin-chrome half of the old clone reconcile: reparent the shell tab list
 * into the edge host when pinned, stamp the pinned classes, force the pinned
 * host visible, then hand the BUTTONS to the flat renderer.
 */
function reconcileMainMirror(): void {
  // S1: gated on shell liveness (desktop mirror mounted), not pin state —
  // the unpinned shell still needs pin-chrome reset + a render.
  if (!isMainMirrorActive()) return

  const side = getMainDrawerSide()
  const pinned = _state.enabled
  // Pin chrome: reparent the shell tab list into the body-level edge host
  // (idempotent with the mount-time pin). Off → list rides in the drawer.
  let host: HTMLElement | null = null
  if (pinned) {
    host = pinMainMirrorShellTabList(side)
  }

  const list = resolveMirrorList()
  if (!list) return

  if (pinned) {
    if (!list.classList.contains(TAB_LIST_PINNED_CLASS)) {
      list.classList.add(TAB_LIST_PINNED_CLASS)
    }
    // Pin host is ALWAYS visible while pin chrome is active — never hide
    // when host wrapperOpen flips (Canvas owns open/close).
    if (host && host.style.display === 'none') {
      host.style.display = ''
    }
  } else if (list.classList.contains(TAB_LIST_PINNED_CLASS)) {
    // Unpinned: drop the pinned-chrome flag so the list renders as an
    // in-drawer tab column.
    list.classList.remove(TAB_LIST_PINNED_CLASS)
  }

  const sidebar = getMainSidebar()
  if (sidebar && sidebar !== _state.sidebar) {
    attachSidebarObserver(sidebar)
  }

  // Flat renderer: model-keyed buttons, hidden, active, title, Settings dock.
  renderMainMirrorTabs()
}

function resolveMirrorList(): HTMLElement | null {
  // Prefer shell/pinned list from main-mirror-drawer.
  const fromShell = getMainMirrorTabList()
  if (fromShell) return fromShell

  // Fallback: create a list on the pin host (tests / partial mount) — only
  // while pin chrome is on; an unpinned shell-less state has nothing to sync.
  if (!_state.enabled) return null
  const side = getMainDrawerSide()
  const host = ensureMainPinHost(side)
  if (!host) return null
  let list = host.querySelector('.sidebar-ux-tab-list') as HTMLElement | null
  if (!list) {
    list = document.createElement('div')
    list.classList.add('sidebar-ux-tab-list')
    host.appendChild(list)
  }
  return list
}

/**
 * Activate a main tab for layout restore: click the host button for React
 * content and open/stamp the mirror drawer. The owned model's active.primary
 * IS the selection (seeded at boot from layout.json) — no mirror key is
 * written here. Never dispatches through the renderer's click path — that
 * toggle-closes when the drawer is already open on the same tab.
 */
export function activateMainMirrorFromRestore(
  hostBtn: HTMLElement | null,
  title?: string,
): void {
  const resolvedTitle =
    title ||
    hostBtn?.getAttribute('title') ||
    hostBtn?.getAttribute('aria-label') ||
    undefined
  if (hostBtn && hostBtn.isConnected) {
    try {
      hostBtn.click()
    } catch {
      /* host may throw during teardown */
    }
  }
  onMainMirrorTabActivated(resolvedTitle)
}

function ensureObservers(): void {
  const sidebar = getMainSidebar()
  if (sidebar) attachSidebarObserver(sidebar)
}

function attachSidebarObserver(sidebar: HTMLElement): void {
  if (_state.observer && _state.sidebar === sidebar) return
  if (_state.observer) {
    _state.observer.disconnect()
    commitState(() => ({ observer: null }))
  }
  commitState(() => ({ sidebar }))
  if (typeof MutationObserver === 'undefined') return
  // Coalesce heavily — host React mutates often; never do work sync in
  // the observer callback beyond scheduling one rAF reconcile. S2: the
  // reconcile is pin chrome + flat render (no clone sync) — the observer's
  // remaining job is twin-chrome convergence (icons/labels register late).
  const observer = new MutationObserver(() => scheduleReconcile())
  observer.observe(sidebar, {
    childList: true,
    subtree: true,
    attributes: true,
    // Do not watch style — host may thrash style during layout.
    attributeFilter: ['class', 'data-tab-id', 'title', 'aria-label'],
  })
  commitState(() => ({ observer }))
}

function stopObservers(): void {
  if (_state.observer) {
    _state.observer.disconnect()
    commitState(() => ({ observer: null, sidebar: null }))
  }
  if (_state.reconcileRaf !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(_state.reconcileRaf)
    commitState(() => ({ reconcileRaf: null }))
  }
}
