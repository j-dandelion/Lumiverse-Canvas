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
// `dualLayout` fields) and in memory (settings/state.ts slot getters). This
// module builds the *single* profile from durable sources when we leave dual
// mode: the persisted slot first, then the session vanilla baseline (the
// pre-dual host state), then the live host state as a last-resort fallback.

import type { LegacyLayout } from '../persist/layout-model'
import { CANVAS_VERSION } from '../persist/backend-ctx'
import { getHostDrawerSettings } from '../dom/host-settings'
import { isMainDrawerOpen, getMainDrawerSide } from '../store'
import { getActiveTabId } from '../tabs/active-tab'
import { getMainDrawerWidth } from '../dom/lumiverse'
import type { VanillaDrawerBaseline } from './vanilla-baseline'

/**
 * Build a durable single-drawer layout from the vanilla baseline (the
 * pre-dual host state captured on enable). The baseline carries the host
 * drawer settings + main open/active; the single layout adds the model-side
 * geometry (width, closed secondary) so bootstrapFromLayout can restore it.
 */
export function buildSingleLayoutFromBaseline(baseline: VanillaDrawerBaseline): LegacyLayout {
  return {
    version: CANVAS_VERSION,
    primary: {
      open: baseline.mainOpen,
      width: readPrimaryWidthFallback(),
      tabId: baseline.mainActiveTabId ?? undefined,
    },
    secondary: { open: false, width: 420, activeTabId: undefined },
    detachedTabs: [],
    tabOrder: Array.isArray(baseline.host.tabOrder) ? baseline.host.tabOrder.slice() : [],
    hiddenTabIds: Array.isArray(baseline.host.hiddenTabIds) ? baseline.host.hiddenTabIds.slice() : [],
    drawerSide: baseline.host.side,
  }
}

/**
 * Last-resort fallback: build a single-drawer layout from the CURRENT live
 * host state. Used only when neither the persisted singleLayout slot nor a
 * session vanilla baseline exists (e.g. the session started in dual mode via
 * a settings.json that predates this feature). Best-effort — the true
 * pre-dual layout was never saved anywhere, so the dual-era host primary
 * order is the closest available representation.
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
