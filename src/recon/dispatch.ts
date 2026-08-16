import type { LayoutModel, TabKey, Side } from '../core/model'
import type { Intent } from '../core/intents'
import { reduce, foldIntents } from '../core/reduce'
import { sideOfKey, visibleKeys } from '../core/select'
import type { HostPort, LiveTabId, ReconcileReport } from '../host/port'
import { reconcile } from './reconcile'
import { serializeModelToLayout, buildModelFromLayout } from '../persist/layout-model'
import { saveLayoutToDisk } from '../persist/layout-repo'
import { dlog, dwarn } from '../debug/log'

let _host: HostPort | null = null
let _model: LayoutModel | null = null
let _queue: Promise<void> = Promise.resolve()
let _generation = 0
let _version = 'unknown'
let _unsubscribeWorldChanged: (() => void) | null = null
let _bootstrapping = false
let _worldSyncPending = false
let _pendingLayout: unknown = null
let _restoringPending = false
let _lastRestoredCount = -1
let _restoreAttempts = 0

function pendingLayoutTabCount(layout: any): number {
  if (!layout || typeof layout !== 'object') return 0
  const ids = new Set<string>()
  for (const id of Array.isArray(layout.tabOrder) ? layout.tabOrder : []) {
    if (typeof id === 'string') ids.add(id)
  }
  for (const tab of Array.isArray(layout.detachedTabs) ? layout.detachedTabs : []) {
    if (typeof tab?.tabId === 'string') ids.add(tab.tabId)
  }
  return ids.size
}

function inventoryIsReady(observed: { inventory?: { status: string } }): boolean {
  const status = observed.inventory?.status
  // Older/fake HostPort implementations do not expose inventory metadata, so
  // retain their established behavior (return true) for them. The live host
  // (`host/lumiverse/implementation.ts:190`) always calls
  // `drawerObserver.getSnapshot()` which returns a `status` field — either
  // 'empty', 'partial', or 'ready'. The sidebar `MutationObserver` in
  // `onWorldChanged` fires when tabs are added, so the transition from
  // 'partial' to 'ready' is observed and the gate activates on the live host.
  return status === undefined || status === 'ready' || status === 'degraded'
}

export function bootstrap(model: LayoutModel, host: HostPort, version?: string): void {
  _unsubscribeWorldChanged?.()
  const gen = ++_generation
  _model = model
  _host = host
  _version = version ?? 'unknown'
  _bootstrapping = true
  _worldSyncPending = false
  _unsubscribeWorldChanged = host.onWorldChanged(() => {
    if (gen !== _generation || _host !== host) return
    if (_bootstrapping) {
      _worldSyncPending = true
      return
    }
    void enqueueHostSync(host, gen).catch(() => {})
  })
  const task = reconcileAndPersist(model, gen)
  _queue = task.catch(() => {}).then(() => {})
  void task.then(() => {
    if (gen !== _generation || _host !== host) return
    _bootstrapping = false
    if (_worldSyncPending) {
      _worldSyncPending = false
      void enqueueHostSync(host, gen).catch(() => {})
    }
  }, () => {
    if (gen === _generation && _host === host) _bootstrapping = false
  })
}

function enqueueHostSync(host: HostPort, generation: number): Promise<void> {
  const task = _queue.then(async () => {
    if (generation !== _generation || _host !== host || !_model) return
    const observed = host.observe()
    // React can publish the drawer after setup's first fiber walk. Retry the
    // persisted layout at that readiness boundary instead of adopting host
    // defaults as the user's saved order.
    if (_pendingLayout !== null && inventoryIsReady(observed) && observed.tabs.length > 0) {
      if (_restoringPending) return
      _restoreAttempts++
      if (_restoreAttempts > 12) {
        dlog('[dispatch] pending-layout restore aborted after max retries', {
          attempts: _restoreAttempts,
        })
        _pendingLayout = null
        _lastRestoredCount = -1
        _restoreAttempts = 0
        return
      }
      const restored = buildModelFromLayout(
        _pendingLayout as any,
        (id) => host.findKey(id),
        observed.drawerSide,
      )
      const count = restored.primary.length + restored.secondary.length
      const expected = pendingLayoutTabCount(_pendingLayout)
      if (count > 0) {
        // Stalled: same count across retries with no progress toward expected
        // means the remaining tabs will never resolve. Commit the partial set
        // and stop retrying so reconcile writes cannot cascade.
        if (count === _lastRestoredCount && count < expected) {
          _pendingLayout = null
          _lastRestoredCount = -1
          _restoreAttempts = 0
          if (generation === _generation) {
            _model = await reconcileAndPersist(restored, generation)
          }
          return
        }
        _lastRestoredCount = count
        if (count >= expected) {
          _pendingLayout = null
          _lastRestoredCount = -1
          _restoreAttempts = 0
        }
        _restoringPending = true
        try {
          // Only mutate _model if our generation is still current. A
          // shutdown or re-bootstrap that happened while the restore was
          // awaiting must not overwrite the new generation's model.
          if (generation === _generation) {
            _model = await reconcileAndPersist(restored, generation)
          }
        } finally {
          _restoringPending = false
        }
        return
      }
      _lastRestoredCount = count
      return
    }
    const next = reduce(_model, { t: 'syncFromHost', observed })
    // A transient host lookup miss must not erase a populated owned model.
    // Host adapters normally provide a DrawerObserver fallback, but this guard
    // also protects startup and teardown boundaries where every live source is
    // briefly unavailable.
    if (!inventoryIsReady(observed)) {
      dlog('[dispatch] host-sync skipped non-ready inventory', {
        inventory: observed.inventory,
      })
      return
    }
    if (observed.tabs.length === 0 && (_model.primary.length > 0 || _model.secondary.length > 0)) {
      dlog('[dispatch] host-sync skipped empty observed world', {
        before: { primary: _model.primary, secondary: _model.secondary },
      })
      return
    }
    dlog('[dispatch] host-sync', {
      observed: observed.tabs.map(t => `${t.liveId}:${t.location}`),
      before: { primary: _model.primary, secondary: _model.secondary },
      after: { primary: next.primary, secondary: next.secondary },
    })
    if (next === _model) return
    // Capture the reconciliation result, but only mutate _model if our
    // generation is still current. A shutdown or re-bootstrap that happened
    // while reconcileAndPersist was awaiting must not overwrite the new
    // generation's model. The bug this fixes: a previous test's pending
    // syncFromHost would mutate _model AFTER the next test's bootstrap had
    // set it, leaking the old host's state into the new test.
    const result = await reconcileAndPersist(next, generation)
    if (generation === _generation) _model = result
  })
  _queue = task.catch(() => {})
  return task
}

export function shutdown(): void {
  _generation++
  _unsubscribeWorldChanged?.()
  _unsubscribeWorldChanged = null
  _bootstrapping = false
  _worldSyncPending = false
  _host = null
  _model = null
  _version = 'unknown'
  _pendingLayout = null
  _restoringPending = false
  _lastRestoredCount = -1
  _restoreAttempts = 0
  _queue = Promise.resolve()
}

export function getModel(): LayoutModel | null {
  return _model
}

export function getHost(): HostPort | null {
  return _host
}

let _lastPersistedLayout: string | null = null

function persistModel(model: LayoutModel): void {
  const host = _host
  if (!host) return
  const layout = serializeModelToLayout(model, (key) => host.resolve(key), _version)
  // Cascade guard: a host-sync storm (extension enable/update re-renders)
  // can reach reconcileAndPersist with an UNCHANGED model. Without dedup
  // every round re-wrote the identical layout to disk + IPC forever (freeze
  // log: constant bytes=2135 SAVE_LAYOUT loop). Identical serialized content
  // → skip the write entirely.
  const json = JSON.stringify(layout)
  if (json === _lastPersistedLayout) return
  _lastPersistedLayout = json
  // Fire-and-await: errors are logged but do not block the dispatch queue.
  // The owned model remains the source of truth; a failed save is
  // surfaced via the debug log and will be retried on the next dispatch.
  saveLayoutToDisk(layout).then((r) => {
    if (r.status === 'error') {
      // eslint-disable-next-line no-console
      console.warn('[canvas] saveLayoutToDisk failed:', r.reason)
    }
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[canvas] saveLayoutToDisk rejected:', err)
  })
}

async function reconcileAndPersist(model: LayoutModel, generation = _generation): Promise<LayoutModel> {
  const host = _host
  if (!host || generation !== _generation) return model
  await reconcile(model, host)
  // A teardown or replacement may have happened while host reconciliation was
  // awaiting React/DOM work. Never write the old generation after that point.
  // Do not overwrite a non-empty persisted layout while the host is still at
  // its pre-React empty bootstrap boundary. The readiness callback will retry
  // the restore once live tab identities exist.
  const hasTabs = model.primary.length > 0 || model.secondary.length > 0
  if (generation === _generation && _host === host && _pendingLayout === null && hasTabs) {
    persistModel(model)
  }
  return model
}

export function dispatch(intent: Intent): Promise<void> {
  const gen = _generation
  const host = _host
  if (host) dlog('[dispatch] intent', { t: intent.t, intent })
  if (!host) return Promise.resolve()

  const task = _queue.then(async () => {
    if (gen !== _generation) return
    if (!_model || !_host) return

    const next = reduce(_model, intent)
    if (next === _model) {
      dlog('[dispatch] no-op (reduce returned same model)', { t: intent.t })
      return
    }

    _model = next
    _model = await reconcileAndPersist(next, gen)
  })
  // Keep the shared queue usable after a failed host operation while preserving
  // the rejection for the caller that initiated this dispatch.
  _queue = task.catch(() => {})

  return task
}

export function dispatchBatch(intents: readonly Intent[]): Promise<void> {
  const gen = _generation
  const host = _host
  if (!host) return Promise.resolve()

  const task = _queue.then(async () => {
    if (gen !== _generation) return
    if (!_model || !_host) return

    const next = foldIntents(_model, intents)
    dlog('[dispatch] batch', {
      intents,
      before: { primary: _model.primary, secondary: _model.secondary },
      after: { primary: next.primary, secondary: next.secondary },
    })
    if (next === _model) return

    _model = next
    _model = await reconcileAndPersist(next, gen)
  })
  _queue = task.catch(() => {})

  return task
}

export function dispatchMoveByLiveId(
  liveId: LiveTabId,
  activateDest = true,
): Promise<void> {
  const host = _host
  const model = _model
  if (!host || !model) return Promise.resolve()

  const key = host.findKey(liveId)
  if (!key) return Promise.resolve()

  let from = sideOfKey(model, key)
  if (!from) {
    return dispatch({ t: 'syncFromHost', observed: host.observe() }).then(() => {
      const nextModel = _model
      if (!nextModel) return
      const nextFrom = sideOfKey(nextModel, key)
      if (!nextFrom) return
      const nextTo: Side = nextFrom === 'primary' ? 'secondary' : 'primary'
      const destVisible = visibleKeys(nextModel, nextTo).length
      return dispatch({
        t: 'move',
        key,
        to: nextTo,
        index: destVisible,
        activateDest,
      })
    })
  }

  const to: Side = from === 'primary' ? 'secondary' : 'primary'
  const destVisible = visibleKeys(model, to).length

  return dispatch({
    t: 'move',
    key,
    to,
    index: destVisible,
    activateDest,
  })
}

/**
 * Placement-first move for user-initiated moves (right-click "Move to
 * second drawer" and the secondary drawer's "Move to main drawer").
 *
 * Architecturally, this inverts the model-first flow used by
 * `dispatchMoveByLiveId`. We do the DOM work first (`assignToSecondary`
 * or `unassignFromSecondary`) so the user sees the move immediately,
 * then dispatch a `move` intent to catch the owned model up to the DOM.
 *
 * Why: the model-first flow goes through `reconcile → host.placeTab →
 * assignToSecondary`, which depends on the drawer's extensionId
 * classification being correct. For Lumiverse built-in tabs whose
 * data-tab-id has no spindle prefix (Personas, Wallpaper, etc.), the
 * drawer parses extensionId as 'unknown' and the downstream placement
 * can silently no-op. By calling the placement function directly we
 * use its built-in fallback (lazy mount + DOM reparent) without going
 * through the dispatch queue, and we keep the model in sync by
 * dispatching the `move` intent as a side effect after placement.
 *
 * The dispatch is idempotent: `applyMove` returns the same model if
 * the tab is already in the target side. If the placement succeeds
 * but the dispatch fails (queue stuck, dispatch rejected), the DOM is
 * ahead of the model; the next `syncFromHost` will surface the
 * divergence via `modelMatchesWorld` and a subsequent host notification
 * will catch the model up.
 *
 * Taskbar chrome (2026-07-31): in taskbar mode this function also owns
 * the main-mirror consequences of a move. The chrome decision is
 * captured BEFORE placement (the moved tab's host button is still
 * visible), then applied after: neighbor handoff when the user moved
 * their ACTIVE tab, content re-assert otherwise (the host drifts its
 * panel content to the first remaining tab after a container remount).
 * "Model already in target" — the common case for restored tabs being
 * re-moved — must only skip the move dispatch, never the chrome work:
 * an early return there leaves the mirror key on the moved tab with a
 * stale header and empty content.
 *
 * The capture/apply halves are exported (captureMainMirrorMoveChrome /
 * applyMainMirrorMoveChrome) so the live DnD cross-drawer path
 * (tab-list-dnd.ts) gets the same mirror handoff after its model-first
 * commit — without it, a mirror→secondary drag leaves the mirror key on
 * the moved tab, shows no neighbor, and the parked mirror button keeps
 * activating main-drawer content.
 */
export interface MainMirrorMoveChrome {
  /**
   * Nearest visible host button for the moved tab's replacement. Non-null
   * only when the moved tab IS the mirror's active (user moved their
   * ACTIVE tab) and a neighbor exists. Captured BEFORE placement — the
   * moved tab's host button is hidden afterward and
   * findNeighborHostButtonFor skips hidden buttons.
   */
  neighborBtn: HTMLElement | null
  /**
   * Mirror active id when the moved tab is NOT the mirror's active. Used to
   * re-assert that tab's content after the move (host panel drift — the
   * "content changed to Loom" regression).
   */
  reassertId: string | null
}

/**
 * Capture the taskbar chrome decision for a user-initiated move to the
 * secondary drawer, BEFORE any placement (see MainMirrorMoveChrome). Two
 * cases:
 *   - The moved tab IS the mirror's active: capture the nearest visible
 *     neighbor for the 07-19 handoff.
 *   - Otherwise: remember the mirror's active id for content re-assert.
 * No-op (both fields null) outside taskbar mode or for non-secondary
 * targets.
 */
export async function captureMainMirrorMoveChrome(
  liveId: LiveTabId,
  target: Side,
): Promise<MainMirrorMoveChrome> {
  if (target !== 'secondary') return { neighborBtn: null, reassertId: null }
  const pin = await import('../sidebar/main-tab-pin')
  if (!pin.isMainTabPinEnabled()) return { neighborBtn: null, reassertId: null }
  const mirrorKey = pin.getActiveMainMirrorKey()
  const mirrorId = mirrorKey?.startsWith('id__') ? mirrorKey.slice('id__'.length) : null
  if (!mirrorId) return { neighborBtn: null, reassertId: null }
  if (mirrorId === liveId) {
    const neighborBtn = pin.findNeighborHostButtonFor(liveId)
    if (neighborBtn) {
      dlog('[tabmove] capture chrome: active tab moved — neighbor handoff target', {
        liveId,
        neighbor: neighborBtn.getAttribute('title') || neighborBtn.getAttribute('data-tab-id'),
      })
    }
    return { neighborBtn, reassertId: null }
  }
  return { neighborBtn: null, reassertId: mirrorId }
}

/**
 * Apply the captured taskbar chrome after a move to the secondary drawer:
 * neighbor handoff (mirror key → neighbor + host button click for content
 * settle) or active-content re-assert, then converge the owned model's
 * primary active to the neighbor (mirror clicks don't always produce
 * host-syncs, so the model's active can lag the mirror key). No-op when
 * taskbar mode turned off between capture and apply. Callers gate on
 * target === 'secondary'.
 */
export async function applyMainMirrorMoveChrome(
  chrome: MainMirrorMoveChrome,
  liveId: LiveTabId,
): Promise<void> {
  const { neighborBtn, reassertId } = chrome
  const pin = await import('../sidebar/main-tab-pin')
  if (!pin.isMainTabPinEnabled()) return

  if (neighborBtn && neighborBtn.isConnected) {
    // User moved their ACTIVE tab: hand the mirror key/header/content to
    // the nearest visible neighbor (07-19 design). The host button click
    // forces content settle (the host drifts its panel to the first
    // remaining tab after a container remount).
    const title = neighborBtn.getAttribute('title') || neighborBtn.getAttribute('aria-label') || undefined
    dlog(`[tabmove] apply chrome: handing main-mirror to neighbor (${title ?? neighborBtn.getAttribute('data-tab-id')})`)
    pin.adoptMainMirrorNeighbor(neighborBtn, title)
  } else if (reassertId) {
    // Re-assert the user's active tab content (host panel drift — the
    // "content changed to Loom" regression).
    const btn = document.querySelector<HTMLElement>(
      `button[data-tab-id="${CSS.escape(reassertId)}"]`,
    )
    if (btn && btn.isConnected) {
      dlog(`[tabmove] apply chrome: re-asserting active tab content (${reassertId})`)
      try { btn.click() } catch { /* host may throw during teardown */ }
    }
  }

  // Neighbor convergence: keep the owned model aligned with the chrome
  // handoff. applyMove adopts the replacement for fresh moves when the
  // model's active matched the moved tab; this covers the stale-active and
  // already-in-target cases (mirror clicks don't always produce host-syncs,
  // so the model's primary active can lag the mirror key).
  if (neighborBtn) {
    const neighborLiveId = neighborBtn.getAttribute('data-tab-id')
    if (neighborLiveId) {
      const neighborKey = _host?.findKey(neighborLiveId)
      if (neighborKey && _model?.active.primary !== neighborKey) {
        dlog(`[tabmove] apply chrome: converging model active to neighbor (${neighborKey})`)
        void dispatch({ t: 'activate', key: neighborKey, side: 'primary' }).catch((err) => {
          dwarn('[tabmove] apply chrome: neighbor activate dispatch failed:', err)
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Secondary-drawer move chrome (2026-07-31)
//
// The main-mirror pair above handles moves OUT of the primary drawer. The
// SECOND drawer has the same requirement: when its ACTIVE tab is moved out
// (right-click "Move to main drawer", DnD secondary→primary, or a Configure
// cross-column drag), the nearest visible neighbor must become active in the
// drawer — and the owned model must converge to it.
//
// The drawer's tracked active (getActiveSecondaryTabId) is the source of
// truth, NOT the model: the secondary wrapper lives on document.body
// (outside the main-sidebar subtree the host observes), so secondary clicks
// don't produce host-syncs and model.active.secondary lags the drawer. A
// model-only handoff (applyMove's adoption) therefore misses whenever the
// model is stale; diffActive then targets the stale key instead of the true
// neighbor.
// ---------------------------------------------------------------------------

export interface SecondaryMoveChrome {
  /**
   * Nearest visible secondary button for the moved tab's replacement.
   * Non-null only when the moved tab IS the drawer's tracked active.
   * Captured BEFORE placement (the moved tab's button must still be in the
   * secondary list).
   */
  neighborBtn: HTMLElement | null
}

/**
 * Capture the secondary neighbor decision for a move OUT of the second
 * drawer, before any placement. No-op (null) when the moved tab is not the
 * drawer's tracked active — only active-tab moves need a replacement.
 */
export async function captureSecondaryNeighborForMove(
  liveId: LiveTabId,
): Promise<SecondaryMoveChrome> {
  const { getActiveSecondaryTabId } = await import('../tabs/active-tab')
  if (getActiveSecondaryTabId() !== liveId) return { neighborBtn: null }
  const { findNeighborSecondaryButtonFor } = await import('../tabs/buttons')
  const neighborBtn = findNeighborSecondaryButtonFor(liveId)
  if (neighborBtn) {
    dlog('[tabmove] capture secondary chrome: active tab moved — neighbor target', {
      liveId,
      neighbor: neighborBtn.getAttribute('title') || neighborBtn.getAttribute('data-tab-id'),
    })
  }
  return { neighborBtn }
}

/**
 * Apply the captured secondary chrome after a move out of the second
 * drawer: activate the neighbor in the drawer (active class, header,
 * content, tracked active) and converge the owned model's secondary active
 * to it so the next reconcile cannot revert to a stale key. No-op when
 * nothing was captured.
 */
export async function applySecondaryNeighborHandoff(
  chrome: SecondaryMoveChrome,
  liveId: LiveTabId,
): Promise<void> {
  const { neighborBtn } = chrome
  if (!neighborBtn) return
  const neighborId = neighborBtn.getAttribute('data-tab-id')
  if (!neighborId) return
  const title = neighborBtn.getAttribute('title') || neighborBtn.getAttribute('aria-label') || undefined
  dlog(`[tabmove] apply secondary chrome: activating neighbor (${title ?? neighborId})`)

  // Drawer chrome: full click-path activation (state + visuals + content).
  if (neighborBtn.isConnected) {
    try {
      const drawer = await import('../sidebar/secondary-drawer')
      drawer.activateSecondaryTab(neighborId)
    } catch {
      /* drawer may be tearing down */
    }
  }

  // Model convergence: secondary clicks don't reliably produce host-syncs,
  // so the model's secondary active can lag the drawer's tracked active.
  const neighborKey = _host?.findKey(neighborId)
  if (neighborKey && _model?.active.secondary !== neighborKey) {
    dlog(`[tabmove] apply secondary chrome: converging model active to neighbor (${neighborKey})`)
    void dispatch({ t: 'activate', key: neighborKey, side: 'secondary' }).catch((err) => {
      dwarn('[tabmove] apply secondary chrome: neighbor activate dispatch failed:', err)
    })
  }
}

export async function placementFirstMoveByLiveId(
  liveId: LiveTabId,
  target: Side,
): Promise<void> {
  const host = _host
  if (!host) {
    dlog('[tabmove] placementFirstMove: no host, bailing', { liveId, target })
    return
  }

  // 0. Taskbar chrome capture — BEFORE the placement, while the moved tab's
  // host button is still visible (findNeighborHostButtonFor excludes hidden
  // buttons). See captureMainMirrorMoveChrome for the two cases.
  const chrome = await captureMainMirrorMoveChrome(liveId, target)
  // Secondary drawer chrome: when moving the second drawer's ACTIVE tab
  // out, capture its replacement (nearest visible neighbor) BEFORE the
  // placement removes the moved button from the list.
  const secondaryChrome = target === 'primary'
    ? await captureSecondaryNeighborForMove(liveId)
    : { neighborBtn: null }

  // 1. Placement — DOM work happens now. The user sees the move.
  let placed = false
  try {
    const sidebar = await import('../sidebar/secondary-drawer')
    if (target === 'secondary') {
      await sidebar.assignToSecondary(liveId)
    } else {
      await sidebar.unassignFromSecondary(liveId)
    }
    placed = true
  } catch (err) {
    dwarn('[tabmove] placementFirstMove: placement threw', { liveId, target, err: String(err) })
  }

  if (!placed) {
    dlog('[tabmove] placementFirstMove: placement did not complete; skipping model update', { liveId, target })
    return
  }

  // 1.5 Drawer open + taskbar chrome handoff (idempotent). The capture/apply
  // split is shared with the live DnD cross-drawer path (tab-list-dnd.ts).
  if (target === 'secondary') {
    const secondary = await import('../sidebar/secondary')
    if (!secondary.isSecondarySidebarOpen()) {
      dlog('[tabmove] placementFirstMove: secondary drawer not open; opening explicitly')
      secondary.openSecondarySidebar()
    }

    await applyMainMirrorMoveChrome(chrome, liveId)
  }

  // 2. Model update — catch the owned model up to the DOM. Skip if the
  // host can't resolve the key (e.g. the tab vanished between right-click
  // and the placement). The move dispatch itself is skipped when the model
  // already has the tab in the target side (restored tabs being re-moved).
  const key = host.findKey(liveId)
  if (!key) {
    dlog('[tabmove] placementFirstMove: findKey returned null after placement', { liveId, target })
    return
  }

  const model = _model
  if (!model) {
    dlog('[tabmove] placementFirstMove: no model after placement', { liveId, target })
    return
  }

  const from = sideOfKey(model, key)
  if (from !== target) {
    // index: -1 → append to the destination (visibleToAbsoluteIndex
    // returns list.length for negative visible indices).
    // activateDest: false → don't switch the active tab on the destination
    // side; the placement function handles activation via deferActivation.
    // When the moved tab was the second drawer's ACTIVE, batch the neighbor
    // activate with the move so reconcile activates the replacement directly
    // — a follow-up dispatch would let diffActive target the STALE model
    // active first (secondary clicks don't produce host-syncs) and flash the
    // wrong tab.
    const neighborId = secondaryChrome.neighborBtn?.getAttribute('data-tab-id') ?? null
    const neighborKey = neighborId ? host.findKey(neighborId) : null
    if (neighborKey) {
      dlog('[tabmove] placementFirstMove: dispatching move + secondary neighbor activate', {
        liveId, key, from, to: target, neighbor: neighborKey,
      })
      await dispatchBatch([
        { t: 'move', key, to: target, index: -1, activateDest: false },
        { t: 'activate', key: neighborKey, side: 'secondary' },
      ])
    } else {
      dlog('[tabmove] placementFirstMove: dispatching move', { liveId, key, from, to: target })
      await dispatch({ t: 'move', key, to: target, index: -1, activateDest: false })
    }
  } else {
    dlog('[tabmove] placementFirstMove: model already in target', { liveId, key, target })
  }

  // Secondary drawer neighbor handoff (moves OUT of the second drawer).
  // The mirror handoff ran at step 1.5 for moves INTO the secondary drawer.
  if (target === 'primary') {
    await applySecondaryNeighborHandoff(secondaryChrome, liveId)
  }

  // Neighbor convergence lives inside the chrome helpers (shared with the
  // DnD cross-drawer path) — applyMove adopts the replacement for fresh
  // moves when the model's active matched the moved tab; the explicit
  // activate covers the stale-active and already-in-target cases.
}

export function bootstrapFromLayout(
  layout: unknown,
  host: HostPort,
  version?: string,
): void {
  let model = buildModelFromLayout(layout as any, (id) => host.findKey(id))
  if (pendingLayoutTabCount(layout) === 0) {
    const observed = host.observe()
    if (inventoryIsReady(observed) && observed.tabs.length > 0) {
      model = reduce(model, { t: 'syncFromHost', observed })
    }
  }
  // Only retain a deferred restore when the first identity walk could not
  // resolve any saved tabs. If the host is already ready, later world changes
  // must not replay an old bootstrap payload over legitimate user actions.
  _restoringPending = false
  _lastRestoredCount = -1
  _restoreAttempts = 0
  _pendingLayout = layout != null && model.primary.length + model.secondary.length === 0
    ? layout
    : null
  bootstrap(model, host, version)

  // Place model-secondary tabs into the secondary shell right after boot,
  // before any user interaction: with the drawer already open at boot, the
  // open path's re-assignment loop never runs (openSecondarySidebar bails),
  // so restored tabs would stay visible in the main drawer until the first
  // move (2026-07-31). openOnClosed:false — a closed drawer must not be
  // force-opened; setActiveWhenReady:false — no activation while closed;
  // the persisted active.secondary is shown when the drawer is open.
  void import('../sidebar/secondary').then((m) => {
    m.reassignSecondaryTabsFromModel({
      openOnClosed: false,
      setActiveWhenReady: false,
      activateKey: model.active.secondary ?? null,
    })
  }).catch((err) => {
    dwarn('[bootstrap] reassignSecondaryTabsFromModel failed:', err)
  })
}

export function flush(): Promise<void> {
  return _queue
}
