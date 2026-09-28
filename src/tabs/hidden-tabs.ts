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
  resetCanvasHiddenTabIds,
  setCanvasHiddenTabIds,
  __resetCanvasHiddenTabIdsForTest,
} from './canvas-hidden'
import {
  currentLifecycleGeneration,
  isInstanceActive,
  isLifecycleCurrent,
} from '../lifecycle/instance'

export { healHiddenTabIds, isTabIdHidden } from '../persist/tab-id-heal'
export {
  getCanvasHiddenTabIds,
  hydrateCanvasHiddenFromLayout,
  mergeHiddenTabIdLists,
  resetCanvasHiddenTabIds,
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
 * Cancel a pending debounced sync. Registered as a teardown cleanup
 * (LUMI-21): the tab-register observer re-arms this timer DURING the
 * disable chain (restoreHostContent re-registers host tabs), so a timer
 * armed mid-teardown would otherwise fire post-teardown and re-hide the
 * vanilla strip (AC1's "no tab buttons"). Registered AFTER the
 * restoreHostContent cleanup in setup's FIFO chain so it sweeps timers
 * armed during teardown; the generation guard in the callback is the
 * belt-and-suspenders backstop for anything armed earlier.
 */
export function cancelScheduledHiddenTabsSync(): void {
  if (_debouncedSyncTimer !== null) {
    clearTimeout(_debouncedSyncTimer)
    _debouncedSyncTimer = null
  }
}

/**
 * Debounced `syncHiddenTabsFromHost` for high-frequency sites (tab register).
 * Immediate sites (finishRestore) should call `syncHiddenTabsFromHost` directly.
 */
export function scheduleSyncHiddenTabsFromHost(opts?: {
  delayMs?: number
}): void {
  const delayMs = opts?.delayMs ?? 50
  if (_debouncedSyncTimer !== null) clearTimeout(_debouncedSyncTimer)
  // LUMI-21: a timer armed pre-teardown (or mid-teardown) must not fire
  // post-teardown — guard at fire time against the arming generation.
  const armedGeneration = currentLifecycleGeneration()
  _debouncedSyncTimer = setTimeout(() => {
    _debouncedSyncTimer = null
    if (!isLifecycleCurrent(armedGeneration)) return
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
  // LUMI-21: no hidden-sync work once the instance is torn down. The
  // disable chain's restoreHostContent() re-registers host tabs, which
  // drives this sync against the freshly restored vanilla strip — without
  // the guard it re-applies the stored hidden set and strips the vanilla
  // tab buttons (AC1). Boot runs with the instance active, so boot restore
  // is unaffected.
  if (!isInstanceActive()) return { hiddenIds: getCanvasHiddenTabIds() }
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

  // OS mode (D3): closed∧unhidden tabs must stay OFF the strips even though
  // the hidden set alone no longer names them. Resolve the model's closed
  // set through the dispatch host (the same key→liveId seam the OS close
  // path uses) and merge those live ids into the DOM applies ONLY — the
  // Canvas copy stays pure hidden-list truth so a later un-hide (Configure
  // draft, menu manage) converges it without closed residue, and closed ids
  // never leak into hiddenTabIds persist. LAZY import: hidden-tabs sits
  // inside the registry load chain (registry → tab-list-dnd → hidden-tabs);
  // a static dispatch import would add a dispatch → reconcile → … cycle
  // edge through this path (the codebase tolerates the existing cycle —
  // active-tab — but a leaf surface like this should not add one).
  const closedOnlyLiveIds = new Set<string>()
  // LUMI-21: guard the lazy continuation — a dispatch import resolving
  // after teardown must not re-apply the hidden set to the restored strips.
  const armedGeneration = currentLifecycleGeneration()
  try {
    void import('../recon/dispatch').then((m) => {
      if (!isLifecycleCurrent(armedGeneration)) return
      const model = m.getModel()
      if (!model || model.closed.length === 0) return applySets(forDom, stored, liveIds)
      const hiddenKeys = new Set<string>(model.hidden)
      const resolved = new Set<string>()
      const hostMod = m.getHost()
      for (const key of model.closed) {
        if (hiddenKeys.has(key)) continue // hidden-set apply covers it
        const liveId = hostMod?.resolve(key)
        if (liveId) resolved.add(liveId)
      }
      applySets(forDom, stored, liveIds, resolved)
    }).catch(() => { /* dispatch unavailable — plain apply already ran */ })
  } catch {
    /* dispatch import threw synchronously — plain apply already ran */
  }

  function applySets(
    dom: readonly string[],
    all: readonly string[],
    live: readonly string[],
    extra?: ReadonlySet<string>,
  ): void {
    // Apply union: healed live targets + keep stored exact ids still on
    // strip (dom already covers paired live; re-apply stored for exact
    // mid-heal) + the OS closed∧unhidden live ids (suppression pass).
    const applySet = new Set<string>([
      ...dom,
      ...all.filter((id) => live.includes(id)),
      ...(extra ?? []),
    ])
    applyHiddenTabIdsToSecondary(applySet)
    applyHiddenTabIdsToMirror(applySet)
    applyHiddenTabIdsToHostMain(applySet)
  }

  // Fire the immediate pass (dispatch may not be ready yet; the async
  // continuation above re-applies with the closed set once it resolves).
  applySets(forDom, stored, liveIds)

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
