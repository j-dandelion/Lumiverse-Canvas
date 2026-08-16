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
export async function restoreSingleModeLayout(
  slot: LegacyLayout,
  host: HostPort,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    bootstrapFromLayout(slot, host, CANVAS_VERSION)
    await flushOwnedModel()
  } catch (err) {
    return { ok: false, reason: `bootstrap: ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    // Main drawer open/active from the slot's primary state. The saved
    // active tab id may be stale (hidden/unknown) — fall back to the first
    // visible host tab rather than crashing.
    const open = !!slot.primary?.open
    let tabId: string | null = slot.primary?.tabId ?? null
    if (tabId && !isTabKnownAndVisible(tabId)) tabId = pickSafeFallbackTabId()
    if (open && !tabId) tabId = pickSafeFallbackTabId()
    restoreMainDrawerFromDom(open, tabId, undefined, {
      restoreOpen: true,
      restoreWidth: true,
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
