// Hidden-tab sync: re-apply Configure hide after hard refresh, and heal
// extension id suffix drift so hide survives re-registration.
//
// Host React filters primary buttons by exact drawerSettings.hiddenTabIds.
// Canvas-owned secondary / main-mirror buttons only got display:none at
// Configure commit — finishRestore and late assigns never re-read host.
//
// S2 (2026-09): the host write-back is GONE (model owns `hidden`; the
// Canvas copy is the hydrate/converge bridge). This sync now reads host +
// Canvas, heals, keeps the Canvas copy aligned, and DOM-applies the strips.

import { getHostDrawerSettings } from '../dom/host-settings'
import { getDrawerTabs } from '../store'
import {
  healHiddenTabIds,
  isTabIdHidden,
} from '../persist/tab-id-heal'
import { BUILTIN_TAB_IDS } from './configure-catalog'
import {
  applyHiddenTabIdsToMirror,
  applyHiddenTabIdsToSecondary,
  applyHiddenTabIdsToHostMain,
} from './buttons'
import { getSecondaryTabList } from '../sidebar/secondary'
import {
  getCanvasHiddenTabIds,
  hydrateCanvasHiddenFromLayout,
  mergeHiddenTabIdLists,
  normalizeHiddenIds,
  setCanvasHiddenTabIds,
  __resetCanvasHiddenTabIdsForTest,
} from './canvas-hidden'

export { healHiddenTabIds, isTabIdHidden } from '../persist/tab-id-heal'
export {
  getCanvasHiddenTabIds,
  hydrateCanvasHiddenFromLayout,
  mergeHiddenTabIdLists,
  setCanvasHiddenTabIds,
  __resetCanvasHiddenTabIdsForTest,
} from './canvas-hidden'

/** Collect live tab ids from catalog sources + secondary strip DOM. */
export function collectLiveTabIdsForHiddenHeal(): string[] {
  const ids = new Set<string>()
  for (const id of BUILTIN_TAB_IDS) ids.add(id)
  for (const t of getDrawerTabs()) {
    if (t?.id) ids.add(t.id)
  }
  try {
    const list = getSecondaryTabList()
    if (list) {
      for (const btn of Array.from(
        list.querySelectorAll('button[data-tab-id]'),
      ) as HTMLElement[]) {
        const tid = btn.getAttribute('data-tab-id')
        if (tid) ids.add(tid)
      }
    }
  } catch {
    // DOM optional in unit tests
  }
  // Host main strip (includes taskbar-hidden host buttons that still carry ids).
  if (typeof document !== 'undefined') {
    for (const btn of Array.from(
      document.querySelectorAll(
        '.sidebar button[data-tab-id], [class*="tabList"] button[data-tab-id]',
      ),
    ) as HTMLElement[]) {
      const tid = btn.getAttribute('data-tab-id')
      if (tid) ids.add(tid)
    }
  }
  return [...ids]
}

export type SyncHiddenTabsResult = {
  /** Effective hidden ids after heal (what we applied / stored on Canvas). */
  hiddenIds: string[]
}

/** Coalesce bursty tab-register syncs (many extensions at once). */
let _debouncedSyncTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Debounced `syncHiddenTabsFromHost` for high-frequency sites (tab register).
 * Immediate sites (finishRestore) should call `syncHiddenTabsFromHost` directly.
 */
export function scheduleSyncHiddenTabsFromHost(opts?: {
  delayMs?: number
}): void {
  const delayMs = opts?.delayMs ?? 50
  if (_debouncedSyncTimer !== null) clearTimeout(_debouncedSyncTimer)
  _debouncedSyncTimer = setTimeout(() => {
    _debouncedSyncTimer = null
    try {
      syncHiddenTabsFromHost()
    } catch {
      // best-effort
    }
  }, delayMs)
}

/**
 * Re-read host + Canvas hiddenTabIds, heal against live tabs, keep the
 * Canvas copy (hydrate/converge bridge — the model owns `hidden`), and
 * apply to Canvas secondary + main strips.
 *
 * Safe to call repeatedly (on finishRestore, tab register, setup).
 */
export function syncHiddenTabsFromHost(): SyncHiddenTabsResult {
  const host = getHostDrawerSettings()
  const hostStored = normalizeHiddenIds(host?.hiddenTabIds)
  const canvasStored = getCanvasHiddenTabIds()
  const stored = mergeHiddenTabIdLists(hostStored, canvasStored)

  const liveIds = collectLiveTabIdsForHiddenHeal()
  // Canvas-copy path: never drop unmatched (late extension register).
  const forCanvas = healHiddenTabIds(stored, liveIds, { keepUnmatched: true })
  // DOM path: only ids that map onto something currently live on strips.
  const forDom = healHiddenTabIds(stored, liveIds, { keepUnmatched: false })

  // Always keep the Canvas layout copy aligned with effective hide (healed).
  // This is what survives hard refresh (hydrate bridge at boot).
  setCanvasHiddenTabIds(forCanvas)

  // Apply union: healed live targets + keep stored exact ids still on strip
  // (forDom already covers paired live; re-apply stored for exact mid-heal).
  const applySet = new Set<string>([...forDom, ...stored.filter((id) => liveIds.includes(id))])
  applyHiddenTabIdsToSecondary(applySet)
  applyHiddenTabIdsToMirror(applySet)
  applyHiddenTabIdsToHostMain(applySet)

  return { hiddenIds: forCanvas }
}

/**
 * Resolve host + Canvas hidden list for Configure draft construction: heal
 * against live catalog so toggles match what the user sees after refresh.
 */
export function resolveHiddenTabIdsForDraft(
  storedHidden: readonly string[] | undefined | null,
  liveCatalogIds: readonly string[],
): string[] {
  const stored = normalizeHiddenIds(storedHidden)
  if (!stored.length) return []
  // Keep unmatched so a Configure auto-commit before extensions register
  // does not wipe host hides for tabs not yet in the catalog.
  return healHiddenTabIds(stored, liveCatalogIds, { keepUnmatched: true })
}
