// Session-only vanilla baseline.
//
// Captures the **pre-dual** host drawer settings + main open/active
// state at the moment the user transitions from single-drawer to
// dual-drawer mode. On the return trip (disable), the baseline is
// applied to the host so the user sees the same vanilla Lumiverse
// layout they had before enabling the second drawer.
//
// Strictly session-only. The baseline must NOT be written to
// layout.json — it is not durable layout data. A page reload while in
// dual mode is a no-op for the baseline (it stays in memory only).
//
// Independent from the dual session profile (`dual-session-profile.ts`):
//   - Dual profile = Canvas state to restore on re-enable
//   - Vanilla baseline = host state to restore on disable (this file)
//
// The conflict rule is **baseline wins**: any Configure Apply, host-
// side edit, or other temporary dual change to the host settings is
// overwritten on disable. Discard and Cancel do not modify the
// baseline.

import {
  getHostDrawerSettings,
  isHostDrawerSettingsWritable,
  patchHostDrawerSettings,
  type HostDrawerSettings,
} from '../dom/host-settings'
import { isMainDrawerOpen } from '../store'
import { getActiveTabId } from '../tabs/active-tab'
import { getMainDrawerSide, getDrawerTabs } from '../store'
import { dlog, dwarn } from '../debug/log'

// ── Types ──

/**
 * The minimum subset of host drawer settings needed for a faithful
 * vanilla round trip. We do NOT include every field the host may
 * have; only the ones that Configure Tabs / dual mode can mutate.
 */
export type VanillaDrawerBaseline = {
  /** Host drawerSettings snapshot at capture time. */
  host: {
    side: 'left' | 'right'
    tabOrder: string[]
    hiddenTabIds: string[]
    showTabLabels?: boolean
  }
  /** Main drawer open state. */
  mainOpen: boolean
  /** Active main tab id (or null if closed / unknown). */
  mainActiveTabId: string | null
  /**
   * Wall-clock timestamp of the capture. Diagnostic only — used in
   * logs to verify a baseline is fresh (i.e. not carried over from a
   * stale session).
   */
  capturedAt: number
}

let _baseline: VanillaDrawerBaseline | null = null

// ── Public API ──

/** True when a vanilla baseline is currently in memory. */
export function hasVanillaBaseline(): boolean {
  return _baseline !== null
}

/** Read-only access to the captured baseline (null when none). */
export function getVanillaBaseline(): VanillaDrawerBaseline | null {
  return _baseline
}

/**
 * Clear the in-memory baseline. Called on successful restore so the
 * next single → dual transition captures a fresh snapshot of the
 * (now restored) vanilla state.
 */
export function clearVanillaBaseline(): void {
  _baseline = null
}

/**
 * Read the live vanilla host state from the fiber tree. Used by the
 * baseline capture and exposed for tests.
 *
 * Falls back to safe defaults if the host bridge is unavailable
 * (NO-GO) or the fiber tree has not populated yet — the baseline
 * is best-effort.
 */
export function readVanillaHostState(): {
  host: VanillaDrawerBaseline['host']
  mainOpen: boolean
  mainActiveTabId: string | null
} {
  const settings = getHostDrawerSettings() ?? {}
  const host: VanillaDrawerBaseline['host'] = {
    side: settings.side || getMainDrawerSide(),
    tabOrder: Array.isArray(settings.tabOrder) ? settings.tabOrder.slice() : [],
    hiddenTabIds: Array.isArray(settings.hiddenTabIds) ? settings.hiddenTabIds.slice() : [],
    showTabLabels: typeof settings.showTabLabels === 'boolean' ? settings.showTabLabels : undefined,
  }
  // Main open: store/DOM class.
  const mainOpen = isMainDrawerOpen()
  // Active tab: prefer active-tab's discriminated union, fall back to
  // store/DOM title match. Closed drawer → null (consistent with
  // snapshotLayout on applyMainDrawer).
  let mainActiveTabId: string | null = null
  if (mainOpen) {
    const active = getActiveTabId()
    if (active.state === 'active') {
      mainActiveTabId = active.id
    } else {
      // Fallback: scan host buttons for tabBtnActive and use its id/title.
      mainActiveTabId = readHostActiveTabIdFromDom()
    }
  }
  return { host, mainOpen, mainActiveTabId }
}

/**
 * Capture the current single-drawer host state as the vanilla
 * baseline. Idempotent — repeated calls **without** an intervening
 * `clearVanillaBaseline()` are no-ops, so repeated enable requests
 * while in dual mode do not overwrite the original baseline.
 *
 * Returns the captured (or pre-existing) baseline, plus a flag
 * indicating whether this call actually captured a fresh snapshot.
 */
export function captureVanillaBaseline(): {
  baseline: VanillaDrawerBaseline
  captured: boolean
} {
  if (_baseline) {
    return { baseline: _baseline, captured: false }
  }
  const state = readVanillaHostState()
  _baseline = {
    ...state,
    capturedAt: Date.now(),
  }
  dlog('[vanilla-baseline] captured:', {
    side: _baseline.host.side,
    tabOrderLen: _baseline.host.tabOrder.length,
    hiddenLen: _baseline.host.hiddenTabIds.length,
    showTabLabels: _baseline.host.showTabLabels,
    mainOpen: _baseline.mainOpen,
    mainActiveTabId: _baseline.mainActiveTabId,
  })
  return { baseline: _baseline, captured: true }
}

/**
 * Apply the baseline back to the host. Returns a result object so
 * the caller can decide whether to clear the baseline or retain it
 * for retry.
 *
 * Behavior on errors:
 *   - Host bridge NO-GO: returns `{ ok: false, reason: 'no-go' }`.
 *     The baseline is **retained** — the next attempt can retry, and
 *     silent failure is not acceptable per the plan.
 *   - Partial failure: returns `{ ok: false, reason: 'partial',
 *     details }`. Baseline is retained.
 *   - Full success: returns `{ ok: true }`. Caller is expected to
 *     call `clearVanillaBaseline()` on the next enable cycle.
 */
export type RestoreResult =
  | { ok: true }
  | { ok: false; reason: 'no-go' }
  | { ok: false; reason: 'partial'; details: string }

export async function restoreVanillaBaseline(
  baseline: VanillaDrawerBaseline,
): Promise<RestoreResult> {
  if (!isHostDrawerSettingsWritable()) {
    dwarn('[vanilla-baseline] restore skipped: host bridge NO-GO')
    return { ok: false, reason: 'no-go' }
  }

  // 1. Patch host drawerSettings in one atomic-like write.
  const partial: Partial<HostDrawerSettings> = {
    side: baseline.host.side,
    tabOrder: baseline.host.tabOrder.slice(),
    hiddenTabIds: baseline.host.hiddenTabIds.slice(),
  }
  if (typeof baseline.host.showTabLabels === 'boolean') {
    partial.showTabLabels = baseline.host.showTabLabels
  }
  const hostOk = patchHostDrawerSettings(partial)
  if (!hostOk) {
    dwarn('[vanilla-baseline] patchHostDrawerSettings returned false')
    return { ok: false, reason: 'no-go' }
  }

  // 2. Restore main drawer open + active tab. Best-effort: if the
  //    saved active tab is hidden or no longer registered, fall back
  //    to a safe tab without raising an error. We call the main-persist
  //    restore path directly (bypassing applyMainDrawer's facet gates)
  //    so the baseline restores unconditionally — the plan's "baseline
  //    wins" rule applies even when persistDrawerOpenState is OFF.
  const mainRestored = await restoreMainDrawerState(baseline.mainOpen, baseline.mainActiveTabId)

  if (!mainRestored.ok) {
    dwarn('[vanilla-baseline] main drawer restore partial:', mainRestored.reason)
    return { ok: false, reason: 'partial', details: mainRestored.reason }
  }

  dlog('[vanilla-baseline] restored host + main drawer state', {
    side: baseline.host.side,
    mainOpen: baseline.mainOpen,
    mainActiveTabId: baseline.mainActiveTabId,
  })
  return { ok: true }
}

// ── Helpers ──

/**
 * Resolve the active main tab id directly from the host DOM. Used as
 * a fallback when `getActiveTabId()` cannot determine the state
 * (e.g. mid-mount when the store cache is empty).
 */
function readHostActiveTabIdFromDom(): string | null {
  if (typeof document === 'undefined') return null
  const sidebar = document.querySelector('[data-spindle-mount="sidebar"]') as HTMLElement | null
  if (!sidebar) return null
  const active = sidebar.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]') as HTMLElement | null
  if (!active) return null
  return active.getAttribute('data-tab-id') || active.getAttribute('title') || null
}

/**
 * Restore the main drawer's open/close + active tab from a saved
 * baseline. Mirrors `applyMainDrawer`'s authority: it goes through
 * the existing main-persist restore path so the existing restore-
 * pending guard, content-settle watch, and `ensureRestoredPrimaryTab`
 * handoff all run as on initial load.
 *
 * Unlike `applyMainDrawer`, this is **not** gated on the open/width
 * facet settings — the vanilla baseline must restore unconditionally
 * per the plan's "baseline wins" rule.
 */
async function restoreMainDrawerState(
  targetOpen: boolean,
  targetActiveTabId: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Fall back to a safe active tab if the saved one is hidden /
  // unknown. We don't crash on stale baseline — just pick the first
  // visible host tab.
  let targetTabId = targetActiveTabId
  if (targetTabId) {
    const valid = isTabKnownAndVisible(targetTabId)
    if (!valid) targetTabId = pickSafeFallbackTabId()
  }
  if (targetOpen && !targetTabId) {
    targetTabId = pickSafeFallbackTabId()
  }

  try {
    const mainPersist = await import('../sidebar/main-persist')
    mainPersist.restoreMainDrawerFromDom(
      targetOpen,
      targetTabId,
      undefined,
      { restoreOpen: true, restoreWidth: true },
    )
  } catch (err) {
    return { ok: false, reason: `restoreMainDrawerFromDom threw: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { ok: true }
}

/** True when the tabId is in the current host drawerTabs and not hidden.
 *  Uses getDrawerTabs (not DOM) so tests can drive this without a real
 *  sidebar element. The DOM is only consulted as a last-resort display
 *  check when document is present (regression guard for the Lumiverse
 *  hide-via-inline-style path). */
function isTabKnownAndVisible(tabId: string): boolean {
  const tabs = getDrawerTabs()
  if (!tabs.some(t => t.id === tabId)) {
    // Suffix-drift fallback: strip trailing :N and re-check.
    const bare = tabId.replace(/:\d+$/, '').split(':').pop() || tabId
    if (!tabs.some(t => t.id === bare)) return false
  }
  // Also: is it in the host's hiddenTabIds?
  const settings = getHostDrawerSettings()
  const hidden = settings?.hiddenTabIds
  if (Array.isArray(hidden) && hidden.includes(tabId)) return false
  // Also: is the button display:none in the live DOM? (Best-effort, only
  // runs when document is present; ignored in headless tests.)
  if (typeof document !== 'undefined') {
    const btn = findHostTabButton(tabId)
    if (btn && btn.style.display === 'none') return false
  }
  return true
}

/** Pick a safe built-in fallback (first visible host tab). Uses
 *  getDrawerTabs (not DOM) so tests can drive this without a real
 *  sidebar. Falls through to a DOM scan ONLY when the store is
 *  empty (an unusual state where the host hasn't reported tabs yet
 *  but the DOM is ready). */
function pickSafeFallbackTabId(): string | null {
  const tabs = getDrawerTabs()
  if (tabs.length > 0) {
    const hidden = getHostDrawerSettings()?.hiddenTabIds
    const hiddenArr = Array.isArray(hidden) ? hidden : []
    for (const t of tabs) {
      if (!hiddenArr.includes(t.id)) return t.id
    }
  }
  // Last resort: walk the DOM. Skipped in headless tests.
  if (typeof document === 'undefined') return null
  const sidebar = document.querySelector('[data-spindle-mount="sidebar"]') as HTMLElement | null
  if (!sidebar) return null
  for (const btn of Array.from(sidebar.querySelectorAll('button[data-tab-id], button[title]'))) {
    const el = btn as HTMLElement
    if (el.style.display === 'none') continue
    const id = el.getAttribute('data-tab-id') || el.getAttribute('title')
    if (id) return id
  }
  return null
}

function findHostTabButton(tabId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const sidebar = document.querySelector('[data-spindle-mount="sidebar"]') as HTMLElement | null
  if (!sidebar) return null
  const exact = sidebar.querySelector(`button[data-tab-id="${cssEscape(tabId)}"]`) as HTMLElement | null
  if (exact) return exact
  const title = sidebar.querySelector(`button[title="${cssEscape(tabId)}"]`) as HTMLElement | null
  if (title) return title
  // Suffix-drift fallback.
  if (tabId.includes(':')) {
    const bare = tabId.replace(/:\d+$/, '').split(':').pop()
    if (bare) {
      return sidebar.querySelector(`button[data-tab-id="${cssEscape(bare)}"]`) as HTMLElement | null
    }
  }
  return null
}

// CSS.escape shim for older environments (JSDOM test envs).
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s)
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}
