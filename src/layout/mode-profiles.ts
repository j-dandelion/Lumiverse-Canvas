// Mode layout profiles — durable single-drawer and dual-drawer layouts.
//
// The user can switch between single-drawer mode and dual-drawer mode. Each
// mode keeps its OWN saved layout so switching never destroys the other:
//   - `singleLayout` profile — the layout shown when the second drawer is off
//     (all tabs in the main drawer, single order, single hidden set, host
//     drawer side, main open/active).
//   - `dualLayout` profile — the layout shown when the second drawer is on
//     (tabs split across main + secondary, dual order, drawer state).
//
// The profiles live in the persisted layout blob (top-level `singleLayout` /
// `dualLayout` fields) and in memory (settings/state.ts slot getters).
// The single slot is ALSO the disable-time host restore source — the
// session-only "vanilla baseline" capture is retired (REFACTOR-PLAN v2
// §4.6): the slot is captured from the same pre-dual state at enable time,
// so one artifact serves both mode restore and host restore.

import type { LegacyLayout } from '../persist/layout-model'
import { CANVAS_VERSION } from '../persist/backend-ctx'
import { getHostDrawerSettings } from '../dom/host-settings'
import { isMainDrawerOpen, getMainDrawerSide, getDrawerTabs } from '../store'
import { getActiveTabId } from '../tabs/active-tab'
import { getMainDrawerWidth } from '../dom/lumiverse'
import type { HostPort } from '../host/port'
import { bootstrapFromLayout, flush as flushOwnedModel } from '../recon/dispatch'
import { restoreMainDrawerFromDom } from '../sidebar/main-persist'
import { getSettings, isOsModeEnabled } from '../settings/state'

/**
 * Build a durable single-drawer layout from the CURRENT live host state.
 * Used only when no persisted singleLayout slot exists (e.g. the session
 * started in dual mode via a settings.json that predates this feature).
 * Best-effort — the true pre-dual layout was never saved anywhere, so the
 * dual-era host primary order is the closest available representation.
 */
export function buildSingleLayoutFromLiveHost(): LegacyLayout {
  try {
    const settings = getHostDrawerSettings() ?? {}
    const mainOpen = isMainDrawerOpen()
    let mainActiveTabId: string | null = null
    if (mainOpen) {
      const active = getActiveTabId()
      if (active.state === 'active') mainActiveTabId = active.id
    }
    return {
      version: CANVAS_VERSION,
      primary: {
        open: mainOpen,
        width: readPrimaryWidthFallback(),
        tabId: mainActiveTabId ?? undefined,
      },
      secondary: { open: false, width: 420, activeTabId: undefined },
      detachedTabs: [],
      tabOrder: Array.isArray(settings.tabOrder) ? settings.tabOrder.slice() : [],
      hiddenTabIds: Array.isArray(settings.hiddenTabIds) ? settings.hiddenTabIds.slice() : [],
      drawerSide: settings.side || getMainDrawerSide(),
    }
  } catch {
    // DOM unavailable (headless / host mid-init): return a minimal safe
    // single layout — all tabs primary, no hidden, defaults elsewhere.
    return {
      version: CANVAS_VERSION,
      primary: { open: false, width: 420, tabId: undefined },
      secondary: { open: false, width: 420, activeTabId: undefined },
      detachedTabs: [],
      tabOrder: [],
      hiddenTabIds: [],
      drawerSide: 'left',
    }
  }
}

/**
 * Restore a mode's layout into the live app. One routine for both mode
 * switches (REFACTOR-PLAN v2 §4.6):
 *   1. Bootstrap the owned model from the slot — the reconcile pass writes
 *      host side / tabOrder / hiddenTabIds through setSide / setOrder /
 *      setHidden (the "slot wins" rule: any host drift during the other
 *      mode is overwritten with the saved state).
 *   2. Restore the main drawer's open/active via the battle-tested
 *      main-persist path (restore guard, content settle, tab handoff).
 * Never throws — returns the outcome for logging.
 */
export interface RestoreSingleModeOpts {
  /**
   * Which side of an OS toggle this restore belongs to. Authoritative for
   * (a) persist routing during the restore (`bootstrapFromLayout`'s
   * `osActive` override — the live setting may already read the NEXT mode
   * when a queued transition executes) and (b) the OS active/fallback gates
   * below. Defaults to the live setting (all mode-switch callers inside a
   * stable session pass nothing or pass the captured intent).
   */
  osActive?: boolean
  /** Facet gates (boot recovery): default true = current behavior. */
  restoreOpen?: boolean
  restoreWidth?: boolean
}

export async function restoreSingleModeLayout(
  slot: LegacyLayout,
  host: HostPort,
  opts?: RestoreSingleModeOpts,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    // Warm mid-session restore (second-drawer mode switch, OS disable):
    // persist the resolved model even when the slot carries an unresolvable
    // key. Without this the pending-restore gate blocks the write and a
    // reload restores the stale top-level layout — the restored second-drawer
    // tabs vanish (live bug 2026-09-15). Boot keeps the plain retry window.
    bootstrapFromLayout(slot, host, CANVAS_VERSION, {
      persistWhilePending: true,
      osActive: opts?.osActive,
    })
    await flushOwnedModel()
  } catch (err) {
    return { ok: false, reason: `bootstrap: ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    // Which side of an OS toggle this restore belongs to (see
    // RestoreSingleModeOpts.osActive): read once so the three gates below
    // cannot disagree if the live setting is superseded mid-restore.
    const osActive = opts?.osActive ?? isOsModeEnabled()
    // Facet gates: boot recovery honors the persisted facets the same way
    // setup's applyMainDrawer does; mode-switch callers keep restoreOpen/
    // restoreWidth true (that mode's own open state IS the layout).
    const restoreOpen = opts?.restoreOpen !== false
    const restoreWidth = opts?.restoreWidth !== false
    // Main drawer open/active from the slot's primary state. The saved
    // active tab id may be stale (hidden/unknown) — fall back to the first
    // visible host tab rather than crashing.
    //
    // F2 gate (spec AR): while OS mode is on, a slot with NO saved active
    // tab is INTENTIONAL (all windows minimized/closed — no displayed
    // window) — do not pick a fallback tab. The drawer restores open with
    // an empty content area (the user reopens windows from the strip /
    // Start menu). Non-OS keeps the fallback (vanilla always has an active).
    const open = !!slot.primary?.open
    let tabId: string | null = slot.primary?.tabId ?? null
    // Closed-active staleness (2026-09-19): a crashy/older OS slot can carry
    // `primary.tabId` inside `closedTabIds`. buildModelFromLayout rejects
    // that active (model.active → null) but the DOM restore below would
    // still click it open — a D17 split (UI shows a window the model calls
    // closed). Treat it like any stale saved tab: no active, OS fallback
    // rules apply after.
    if (tabId && osActive && Array.isArray(slot.closedTabIds) && slot.closedTabIds.includes(tabId)) {
      tabId = null
    }
    if (tabId && !isTabKnownAndVisible(tabId)) {
      // OS mode: a stale saved tab (gone/hidden) restores NO active — never
      // a fallback pick (F2: active:null is intentional in OS mode).
      tabId = osActive ? null : pickSafeFallbackTabId()
    }
    if (open && !tabId && !osActive) tabId = pickSafeFallbackTabId()
    // Restore the slot's saved main width when width persistence is on
    // (review batch 2). Passing undefined made the mode switch keep the live
    // width, and the next shell-truth host sync then overwrote the slot.
    // Mirrors snapshot.isWidthPersistenceEnabled() without importing
    // layout/snapshot (partial test mocks of it omit new exports).
    const width = getSettings().persistDrawerWidth && typeof slot.primary?.width === 'number'
      ? slot.primary.width
      : undefined
    // targetOpen is ignored by restoreMainDrawerFromDom when restoreOpen is
    // false (width-only / unsuppress path), so it is always safe to pass.
    restoreMainDrawerFromDom(open, tabId, restoreWidth ? width : undefined, {
      restoreOpen,
      restoreWidth,
    })
  } catch (err) {
    return { ok: false, reason: `main drawer: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { ok: true }
}

function readPrimaryWidthFallback(): number {
  // Guard against headless/mid-init environments where the DOM helpers throw.
  if (typeof document === 'undefined') return 420
  try {
    const w = getMainDrawerWidth()
    return w > 0 ? w : 420
  } catch {
    return 420
  }
}

/** True when the tabId is in the current host drawerTabs and not hidden. */
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

/** Pick a safe built-in fallback (first visible host tab). */
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
