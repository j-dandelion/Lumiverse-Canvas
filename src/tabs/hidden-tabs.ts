// Host hidden-tab sync: re-apply drawerSettings.hiddenTabIds after hard refresh,
// and heal extension id suffix drift so hide survives re-registration.
//
// Host React filters primary buttons by exact hiddenTabIds. Canvas-owned
// secondary / main-mirror buttons only got display:none at Configure commit —
// finishRestore and late assigns never re-read host, so hidden tabs reappeared.
// Extension ids (`…:tab:name:N`) change the :N suffix across sessions; without
// heal, host exact-match also fails for primary after reload.

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

export { healHiddenTabIds, isTabIdHidden } from '../layout/tab-id-heal'

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
  /** Effective hidden ids after heal (what we applied). */
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
 * Re-read host hiddenTabIds, heal against live tabs, optionally write healed
 * ids back to host (so React primary filter matches), and apply to Canvas
 * secondary + main-mirror strips.
 *
 * Safe to call repeatedly (on finishRestore, tab register, setup).
 */
export function syncHiddenTabsFromHost(opts?: {
  /** Patch host when heal rewrites ids (default true). */
  writeBack?: boolean
}): SyncHiddenTabsResult {
  const writeBack = opts?.writeBack !== false
  const host = getHostDrawerSettings()
  const stored = Array.isArray(host?.hiddenTabIds)
    ? host!.hiddenTabIds!.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  const liveIds = collectLiveTabIdsForHiddenHeal()
  // Write-back path: never drop unmatched (late extension register).
  const forHost = healHiddenTabIds(stored, liveIds, { keepUnmatched: true })
  // DOM path: only ids that map onto something currently live on strips.
  const forDom = healHiddenTabIds(stored, liveIds, { keepUnmatched: false })

  let wroteBack = false
  if (writeBack && stored.length > 0) {
    const same =
      forHost.length === stored.length
      && forHost.every((id, i) => id === stored[i])
    if (!same) {
      wroteBack = patchHostDrawerSettings({ hiddenTabIds: forHost })
      if (wroteBack) {
        dlog('[hidden-tabs] healed hiddenTabIds write-back', {
          from: stored,
          to: forHost,
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
 * Resolve host hidden list for Configure draft construction: heal against
 * live catalog so toggles match what the user sees after refresh.
 */
export function resolveHiddenTabIdsForDraft(
  storedHidden: readonly string[] | undefined | null,
  liveCatalogIds: readonly string[],
): string[] {
  const stored = Array.isArray(storedHidden)
    ? storedHidden.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  if (!stored.length) return []
  // Keep unmatched so a Configure auto-commit before extensions register
  // does not wipe host hides for tabs not yet in the catalog.
  return healHiddenTabIds(stored, liveCatalogIds, { keepUnmatched: true })
}
