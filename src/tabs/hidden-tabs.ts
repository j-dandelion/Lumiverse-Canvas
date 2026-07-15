// Hidden-tab sync: re-apply Configure hide after hard refresh, and heal
// extension id suffix drift so hide survives re-registration.
//
// Host React filters primary buttons by exact drawerSettings.hiddenTabIds.
// Canvas-owned secondary / main-mirror buttons only got display:none at
// Configure commit — finishRestore and late assigns never re-read host.
//
// Additionally: host setSetting is often unreachable from the fiber walk
// (NO-GO or silent no-persist), so live hide worked via Canvas DOM apply
// while DB drawerSettings never received council/cortex/create. Canvas now
// owns a copy of hiddenTabIds in layout.json and merges it with host on
// every sync.

import {
  getHostDrawerSettings,
  patchHostDrawerSettings,
} from '../dom/host-settings'
import { getDrawerTabs } from '../store'
import {
  healHiddenTabIds,
  isTabIdHidden,
} from '../layout/tab-id-heal'
import { BUILTIN_TAB_IDS } from './configure-catalog'
import {
  applyHiddenTabIdsToMirror,
  applyHiddenTabIdsToSecondary,
} from './buttons'
import { getSecondaryTabList } from '../sidebar/secondary'
import { dlog } from '../debug/log'
import {
  getCanvasHiddenTabIds,
  hydrateCanvasHiddenFromLayout,
  mergeHiddenTabIdLists,
  normalizeHiddenIds,
  setCanvasHiddenTabIds,
  __resetCanvasHiddenTabIdsForTest,
} from './canvas-hidden'

export { healHiddenTabIds, isTabIdHidden } from '../layout/tab-id-heal'
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
  /** True when host store was patched with healed ids. */
  wroteBack: boolean
}

/** Coalesce bursty tab-register syncs (many extensions at once). */
let _debouncedSyncTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Debounced `syncHiddenTabsFromHost` for high-frequency sites (tab register).
 * Immediate sites (finishRestore) should call `syncHiddenTabsFromHost` directly.
 */
export function scheduleSyncHiddenTabsFromHost(opts?: {
  writeBack?: boolean
  delayMs?: number
}): void {
  const delayMs = opts?.delayMs ?? 50
  if (_debouncedSyncTimer !== null) clearTimeout(_debouncedSyncTimer)
  _debouncedSyncTimer = setTimeout(() => {
    _debouncedSyncTimer = null
    try {
      syncHiddenTabsFromHost({ writeBack: opts?.writeBack !== false })
    } catch {
      // best-effort
    }
  }, delayMs)
}

/**
 * Re-read host + Canvas hiddenTabIds, heal against live tabs, keep Canvas
 * copy, optionally write healed ids back to host (so React primary filter
 * matches), and apply to Canvas secondary + main-mirror strips.
 *
 * Safe to call repeatedly (on finishRestore, tab register, setup).
 */
export function syncHiddenTabsFromHost(opts?: {
  /** Patch host when heal rewrites ids or Canvas has ids host lacks (default true). */
  writeBack?: boolean
}): SyncHiddenTabsResult {
  const writeBack = opts?.writeBack !== false
  const host = getHostDrawerSettings()
  const hostStored = normalizeHiddenIds(host?.hiddenTabIds)
  const canvasStored = getCanvasHiddenTabIds()
  const stored = mergeHiddenTabIdLists(hostStored, canvasStored)

  const liveIds = collectLiveTabIdsForHiddenHeal()
  // Write-back path: never drop unmatched (late extension register).
  const forHost = healHiddenTabIds(stored, liveIds, { keepUnmatched: true })
  // DOM path: only ids that map onto something currently live on strips.
  const forDom = healHiddenTabIds(stored, liveIds, { keepUnmatched: false })

  // Always keep Canvas layout copy aligned with effective hide (healed).
  // This is what survives hard refresh even when host setSetting is NO-GO.
  setCanvasHiddenTabIds(forHost)

  let wroteBack = false
  if (writeBack && forHost.length > 0) {
    const hostSame =
      forHost.length === hostStored.length
      && forHost.every((id, i) => id === hostStored[i])
    if (!hostSame) {
      wroteBack = patchHostDrawerSettings({ hiddenTabIds: forHost })
      if (wroteBack) {
        dlog('[hidden-tabs] healed hiddenTabIds write-back', {
          from: hostStored,
          to: forHost,
        })
      } else {
        dlog('[hidden-tabs] host write-back NO-GO; Canvas layout copy retained', {
          hidden: forHost,
        })
      }
    }
  }

  // Apply union: healed live targets + keep stored exact ids still on strip
  // (forDom already covers paired live; re-apply stored for exact mid-heal).
  const applySet = new Set<string>([...forDom, ...stored.filter((id) => liveIds.includes(id))])
  applyHiddenTabIdsToSecondary(applySet)
  applyHiddenTabIdsToMirror(applySet)

  return { hiddenIds: forHost, wroteBack }
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
