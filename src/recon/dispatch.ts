import type { LayoutModel, TabKey, Side } from '../core/model'
import type { Intent } from '../core/intents'
import { reduce, foldIntents } from '../core/reduce'
import { sideOfKey, visibleKeys } from '../core/select'
import { listForSide } from '../core/select'
import type { HostPort, LiveTabId, ReconcileReport } from '../host/port'
import { reconcile } from './reconcile'
import { serializeModelToLayout, buildModelFromLayout, type LegacyLayout } from '../persist/layout-model'
import { saveLayoutToDisk } from '../persist/layout-repo'
import { getSingleLayoutSlot, getDualLayoutSlot, getOsSingleLayoutSlot, getOsDualLayoutSlot, isOsModeEnabled, getSettings, getLastLoadedLayout } from '../settings/state'
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
/**
 * Restore-time OS routing override (2026-09-19, layout-mode fixes F3;
 * re-scoped 2026-09-19 adversarial F2). `setSettings` flips `osMode`
 * synchronously BEFORE `applyOsModeChange` runs, so a queued/superseded OS
 * transition can be restoring while the live setting already reads the NEXT
 * mode — `buildPersistedBlob` would then route the restore's persist into the
 * wrong pair of slots (a disable restore writing the non-OS model into
 * `osSingleLayout` because `osMode` flipped back on mid-run).
 *
 * TWO independent slots, run wins (F2 — the old single slot was
 * bootstrap-scoped and settled-NULL while the OS run was still going, so a
 * mid-run settings flip routed later persists with the LIVE setting):
 *
 *   `_persistOsOverride`     — RUN-scoped. Written ONLY via
 *                              `setPersistOsOverride`: `runOsEnable` sets
 *                              true at entry, `runOsDisable` false, each
 *                              clears to null in its finally at run end.
 *                              Survives bootstrap settle; shutdown/abort
 *                              clear it as a backstop.
 *   `_persistOsBootOverride` — BOOTSTRAP-scoped (the original lifecycle):
 *                              set at `bootstrapFromLayout` entry from
 *                              `opts.osActive` (absent → null → live
 *                              setting), cleared when that bootstrap's task
 *                              settles (only while its generation is still
 *                              current — a superseding bootstrap owns the
 *                              value), on the pending-abort path, and on
 *                              shutdown. Boot passes no value (null → live
 *                              setting, unchanged behavior).
 *
 * Effective routing: `_persistOsOverride ?? _persistOsBootOverride ??
 * isOsModeEnabled()` — a run's intent is authoritative whenever a run is
 * active; outside runs the bootstrap slot behaves exactly as before
 * (settle → null-ish backstop).
 *
 * Scheme note: a one-deep push/restore-prev on a single variable was
 * considered and rejected — a settle arriving between a run's
 * `setPersistOsOverride` and its own bootstrap's push (e.g. a prior boot
 * bootstrap settling while a run is in its pre-restore window, or an enable
 * run on the seed path that never bootstraps) would restore a pre-run value
 * and clobber the run's override. Two slots have no such interleaving.
 */
let _persistOsOverride: boolean | null = null
let _persistOsBootOverride: boolean | null = null

/**
 * Set (or clear, with null) the RUN-scoped OS routing override for the
 * caller's OS-mode run. See the `_persistOsOverride` doc for the two-slot
 * lifecycle: OS runs bracket their whole body with this (entry value →
 * finally null); `bootstrapFromLayout`'s settle never touches it.
 */
export function setPersistOsOverride(osActive: boolean | null): void {
  _persistOsOverride = osActive
}
/**
 * Warm-restore persistence gate override (2026-09-15). `reconcileAndPersist`
 * refuses to write while `_pendingLayout` is armed so a partial boot model is
 * never persisted over the stored layout. A warm MODE-SWITCH restore (second
 * drawer enable/disable, OS disable) has the opposite failure mode: if the
 * entering slot carries an unresolvable key, `_pendingLayout` blocks the write
 * indefinitely and a reload restores the stale top-level layout — the restored
 * second-drawer tabs vanish (live bug 2026-09-15). Those restores set this flag
 * (via `bootstrapFromLayout(..., { persistWhilePending: true })`), so the
 * resolved live model IS written immediately while the retry window keeps
 * merging late-resolving keys. Boot never sets it.
 */
let _persistResolvedWhilePending = false
/**
 * True once the user changed drawer geometry / hidden state / side inside the
 * pending-restore window. `mergeResolvedInto` then keeps the USER's copies
 * instead of re-adopting the rebuilt (layout) ones — a late-resolving tab
 * must not undo a resize/open-close/hide made while it registered
 * (review batch 4).
 */
let _pendingWindowUserState = false
let _restoringPending = false
/** Coalescing flags for dispatchTrackedActiveSync (see its doc comment). */
let _trackedSyncScheduled = false
let _trackedSyncQueued = false
/** Boot-only retry window for partial restores (late-registering tabs). */
let _restoreDeadline = 0
const RESTORE_RETRY_WINDOW_MS = 30_000
/** Current boot placement pass (see bootPlacementDone). Null post-shutdown. */
let _bootPlacementPass: Promise<void> | null = null

// --- Model-commit subscribers (S2 flat renderer) ---
type ModelSubscriber = () => void
const _modelSubscribers = new Set<ModelSubscriber>()

/**
 * Subscribe to model commits (bootstrap, dispatch, host-sync merges). Called
 * after every `_model` assignment so chrome driven by the model (the S2 main
 * renderer) can re-render without polling. Returns an unsubscribe function.
 */
export function onModelChanged(cb: ModelSubscriber): () => void {
  _modelSubscribers.add(cb)
  return () => { _modelSubscribers.delete(cb) }
}

/** Assign _model; notify subscribers on reference change. Null never notifies
 *  (teardown — subscribers are torn down with their DOM). */
function commitModel(next: LayoutModel | null): void {
  if (_model === next) return
  _model = next
  if (next === null) return
  for (const cb of Array.from(_modelSubscribers)) {
    try { cb() } catch { /* subscriber errors must not break the queue */ }
  }
}

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

/**
 * Merge a rebuild of the pending layout into the CURRENT model
 * (REFACTOR-PLAN v2 §4.5). Placement/order are ADD-ONLY: keys the current
 * model already holds — whether from the earlier partial restore or from
 * USER ACTIONS inside the boot window — keep their current position; only
 * keys absent from the model are inserted, at their saved index from the
 * rebuild (clamped), so late-registering tabs land where the layout put
 * them. Hidden set, drawer geometry, and side adopt the rebuild (the
 * layout's saved state — the current model's copies were built from the
 * same layout and never diverge during the pending window). Active adopts
 * the rebuild ONLY when the current active is null (boot default) — a user
 * click inside the window keeps its tab. Returns the original model when
 * nothing changed (callers short-circuit on identity, like the reducer).
 */
function mergeResolvedInto(current: LayoutModel, rebuilt: LayoutModel): LayoutModel {
  const inModel = new Set<string>([...current.primary, ...current.secondary])
  const mergeSide = (side: Side): readonly TabKey[] => {
    const cur = listForSide(current, side)
    const reb = listForSide(rebuilt, side)
    const fresh = reb.filter((k) => !inModel.has(k))
    if (fresh.length === 0) return cur
    // Insert in rebuilt order (ascending saved index) — each insert lands at
    // its saved position without disturbing previously-merged or existing
    // keys' relative order.
    const next = cur.slice()
    for (const k of fresh) {
      inModel.add(k)
      next.splice(Math.min(reb.indexOf(k), next.length), 0, k)
    }
    return next
  }
  const primary = mergeSide('primary')
  const secondary = mergeSide('secondary')
  const hidden = rebuilt.hidden.filter((k) => inModel.has(k))
  // START-MENU-only set (LUMI-16b): adopts the rebuild exactly like `hidden`
  // (the rebuild was built from the same layout blob).
  const menuHidden = rebuilt.menuHidden.filter((k) => inModel.has(k))
  // User actions inside the pending window win over the layout for the
  // fields the rebuild would otherwise overwrite wholesale (drawer geometry,
  // hidden set, side). Only active had this guard before.
  const keepUser = _pendingWindowUserState
  const next: LayoutModel = {
    ...current,
    primary,
    secondary,
    hidden: keepUser ? current.hidden : hidden,
    menuHidden: keepUser ? current.menuHidden : menuHidden,
    active: {
      primary: current.active.primary ?? rebuilt.active.primary,
      secondary: current.active.secondary ?? rebuilt.active.secondary,
    },
    drawers: keepUser ? current.drawers : rebuilt.drawers,
    side: keepUser ? current.side : rebuilt.side,
  }
  // Identity-preserving when nothing changed.
  if (
    sameKeys(next.primary, current.primary) &&
    sameKeys(next.secondary, current.secondary) &&
    sameKeys(next.hidden, current.hidden) &&
    sameKeys(next.menuHidden, current.menuHidden) &&
    next.active.primary === current.active.primary &&
    next.active.secondary === current.active.secondary &&
    next.drawers.primary.open === current.drawers.primary.open &&
    next.drawers.primary.width === current.drawers.primary.width &&
    next.drawers.secondary.open === current.drawers.secondary.open &&
    next.drawers.secondary.width === current.drawers.secondary.width &&
    next.side === current.side
  ) {
    return current
  }
  return next
}

/** Order-sensitive array equality for TabKey lists. */
/**
 * Record user changes to state that `mergeResolvedInto` otherwise re-adopts
 * from the rebuilt layout while a restore is pending. Only geometry / hidden
 * / side are marked; tab placement is already add-only in the merge and the
 * active key has its own `current ?? rebuilt` guard.
 */
function markPendingWindowUserIntent(intent: Intent): void {
  if (_pendingLayout === null) return
  const t = intent.t
  if (t === 'setDrawer' || t === 'swapSides' || t === 'setHidden' || t === 'setMenuHidden') {
    _pendingWindowUserState = true
  }
}

/** Order-sensitive array equality for TabKey lists. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function bootstrap(model: LayoutModel, host: HostPort, version?: string): void {
  _unsubscribeWorldChanged?.()
  const gen = ++_generation
  commitModel(model)
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
  void task.then((next) => {
    if (gen !== _generation || _host !== host) return
    // This bootstrap's restore window is over: the BOOTSTRAP-scoped OS
    // override is scoped to it (the RUN-scoped `setPersistOsOverride` value
    // is untouched here and survives until its OS run's finally — F2). A
    // SUPERSEDED bootstrap (gen mismatch → returned above) never clears it —
    // the newer bootstrap owns the value.
    _persistOsBootOverride = null
    // reconcileAndPersist may have corrected the model (e.g. adopted the
    // observed drawer side when the host could not apply the model's side —
    // NO-GO bridge). Keep that correction.
    if (next !== model) commitModel(next)
    _bootstrapping = false
    if (_worldSyncPending) {
      _worldSyncPending = false
      void enqueueHostSync(host, gen).catch(() => {})
    }
  }, () => {
    if (gen === _generation && _host === host) {
      _persistOsBootOverride = null
      _bootstrapping = false
    }
  })
}

function enqueueHostSync(host: HostPort, generation: number): Promise<void> {
  const task = _queue.then(async () => {
    if (generation !== _generation || _host !== host || !_model) return
    const observed = host.observe()
    // React can publish the drawer after setup's first fiber walk. Converge
    // the persisted layout at that readiness boundary instead of adopting
    // host defaults as the user's saved order (REFACTOR-PLAN v2 §4.5):
    //   - Rebuild the layout through the resolver (idempotent — derived
    //     from the same immutable layout, so it is add-only by
    //     construction).
    //   - MERGE newly-resolved keys into the CURRENT model at their saved
    //     index — user actions inside the window are never undone, and late
    //     tabs keep their positional fidelity.
    //   - Commit the partial set on the first ready pass (early UX) and
    //     keep converging until every stored id resolves or the boot
    //     deadline expires.
    // The old attempts/stall counters are gone: rebuilding is cheap, no
    // write fires while nothing new resolves (persistModel byte-dedup), and
    // the deadline subsumes both guards.
    if (_pendingLayout !== null && inventoryIsReady(observed) && observed.tabs.length > 0) {
      if (_restoringPending) return
      if (Date.now() > _restoreDeadline) {
        dlog('[dispatch] pending-layout restore aborted (retry window expired)')
        _pendingLayout = null
        // Persist is NOT forced here: the abort can run while `_model` is
        // still partial (or empty), and only the hasTabs-guarded commit path
        // may write. Clear the warm-restore override too — it exists only
        // while the retry window is open. Clear the BOOTSTRAP-scoped OS
        // override (F2): it is scoped to this bootstrap's window. NEVER touch
        // the RUN-scoped `_persistOsOverride` here (L4, 2026-09-23): a normal
        // OS run clears its own run slot in its finally — the 30s deadline is
        // not a reliable run-end signal, and nulling the run slot mid-run
        // would re-route persists with the live setting.
        _persistResolvedWhilePending = false
        _persistOsBootOverride = null
        return
      }
      const rebuilt = buildModelFromLayout(
        _pendingLayout as any,
        (id) => host.findKey(id),
        observed.drawerSide,
      )
      const expected = pendingLayoutTabCount(_pendingLayout)
      const resolvedAll = rebuilt.primary.length + rebuilt.secondary.length >= expected
      const merged = mergeResolvedInto(_model, rebuilt)
      // Un-gate persistence BEFORE the write: reconcileAndPersist only
      // persists when _pendingLayout is null, so a completing restore must
      // clear it first or the final blob never lands on disk.
      if (resolvedAll) {
        _pendingLayout = null
        // Lifecycle hygiene (R2-7): both flags only exist while a pending
        // restore is armed. Placed AFTER mergeResolvedInto (above) on
        // purpose: the merge reads _pendingWindowUserState for THIS call —
        // clearing first would drop the user's geometry/hidden on the final
        // merge.
        _persistResolvedWhilePending = false
        _pendingWindowUserState = false
      }
      if (merged !== _model) {
        _restoringPending = true
        try {
          // Only mutate _model if our generation is still current. A
          // shutdown or re-bootstrap that happened while the restore was
          // awaiting must not overwrite the new generation's model.
          if (generation === _generation) {
            commitModel(await reconcileAndPersist(merged, generation))
          }
        } finally {
          _restoringPending = false
        }
      }
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
      observedDrawerSide: observed.drawerSide,
      before: { primary: _model.primary, secondary: _model.secondary, side: _model.side },
      after: { primary: next.primary, secondary: next.secondary, side: next.side },
    })
    if (next.side !== _model.side) {
      // Diagnostic: the host's drawer physically moved — e.g. Lumiverse's
      // own "Drawer side" setting was toggled (the same field Canvas "Swap
      // drawer locations" writes). The model + Configure Tabs converge on
      // the observed side.
      dlog('[dispatch] host drawer side adopted (Lumiverse "Drawer side" setting toggled)', {
        observed: observed.drawerSide,
        modelBefore: _model.side,
        modelAfter: next.side,
      })
    }
    if (next === _model) return
    // Capture the reconciliation result, but only mutate _model if our
    // generation is still current. A shutdown or re-bootstrap that happened
    // while reconcileAndPersist was awaiting must not overwrite the new
    // generation's model. The bug this fixes: a previous test's pending
    // syncFromHost would mutate _model AFTER the next test's bootstrap had
    // set it, leaking the old host's state into the new test.
    const result = await reconcileAndPersist(next, generation)
    if (generation === _generation) commitModel(result)
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
  _trackedSyncScheduled = false
  _trackedSyncQueued = false
  _host = null
  _model = null
  _version = 'unknown'
  _pendingLayout = null
  _persistResolvedWhilePending = false
  _persistOsOverride = null
  _persistOsBootOverride = null
  _restoringPending = false
  _restoreDeadline = 0
  _pendingWindowUserState = false
  _bootPlacementPass = null
  // Never inherit the previous session's dedup key: a fresh setup must be
  // able to write the same content again (review B3).
  _lastPersistedLayout = null
  _queue = Promise.resolve()
}

export function getModel(): LayoutModel | null {
  return _model
}

export function getHost(): HostPort | null {
  return _host
}

let _lastPersistedLayout: string | null = null

/**
 * The layout blob written to disk: the active model serialization plus the
 * durable single/dual mode profiles (top-level `singleLayout` / `dualLayout`
 * fields, hydrated back at boot by hydrateModeLayoutSlots) and the OS-mode
 * variants (`osSingleLayout` / `osDualLayout`).
 */
export type PersistedLayout = LegacyLayout & {
  dualLayout?: LegacyLayout | null
  singleLayout?: LegacyLayout | null
  osDualLayout?: LegacyLayout | null
  osSingleLayout?: LegacyLayout | null
}

/**
 * Serialize the current owned model into the legacy layout format (live ids).
 * Null when no host or model is active (boot, teardown, tests).
 */
export function snapshotOwnedModelLayout(): LegacyLayout | null {
  const host = _host
  const model = _model
  if (!host || !model) return null
  return serializeModelToLayout(model, (key) => host.resolve(key), _version)
}

/**
 * Build the layout blob that is written to disk: the active model
 * serialization plus the durable mode profiles.
 *
 * Model shape is authoritative over the `secondSidebarEnabled` setting:
 * when the model still holds secondary tabs (the disable fallback where no
 * single layout existed to restore), we must NOT clobber the stored single
 * profile with a dual serialization. `model.secondary.length > 0` ⟺ dual.
 *
 * OS mode (spec §3.2): while OS mode is on, the non-OS slots are FROZEN at
 * their stored values — OS edits (closed windows, nullable active) must
 * never leak into them (D12: disable restores the saved non-OS slot,
 * slot-wins). The active mode's OS slot receives the live serialization
 * (which carries `closedTabIds` from the model — serializeModelToLayout
 * stamps it unconditionally; the OS closed-set lives in the model). While
 * OS is off, the OS slots pass through their stored values — symmetric
 * freezing from the last OS session.
 *
 * Invariant (2026-09-15): OS mode off ⇒ the closed-set is NOT durable state.
 * `model.closed` should already be empty (os/os-mode.ts clears residual
 * membership on disable), but this is the persistence backstop: a leftover
 * membership must never be written into the top-level blob or a non-OS mode
 * slot, where a reload would hydrate hidden windows with no Start menu to
 * reopen them. The OS slots keep their stored `closedTabIds` untouched.
 */
function buildPersistedBlob(model: LayoutModel, resolve: (key: TabKey) => string | null): PersistedLayout {
  const layout = serializeModelToLayout(model, resolve, _version)
  const isDual = model.secondary.length > 0
  // Restore-time override wins (see `_persistOsOverride`): a queued OS
  // transition restores under the mode IT belongs to even when the live
  // setting has already been superseded by a later toggle. Run-scoped slot
  // first (F2 — survives bootstrap settle until the run ends), then the
  // bootstrap-scoped slot, then the live setting.
  const os = _persistOsOverride ?? _persistOsBootOverride ?? isOsModeEnabled()
  // Non-OS serialization: closedTabIds only survive while OS mode is on.
  // menuHiddenTabIds follows the same rule (LUMI-16b): the Start menu is OS
  // chrome, so the menu-hidden set is not durable state outside an OS
  // session — the OS slots keep their stored copies, symmetric with closed.
  const base: LegacyLayout = os
    ? layout
    : { ...layout, closedTabIds: [], menuHiddenTabIds: [] }
  // Facet freeze — mirrors `layout/snapshot.ts` buildPersistedLayout: a
  // disabled persistDrawerOpenState / persistDrawerWidth facet keeps the
  // LAST-LOADED main-drawer open/width on disk instead of the latest live
  // geometry ("turning a facet off freezes its disk value", docs/persistence.md).
  // No last-loaded layout (or a missing field) → live value, no undefined leak.
  // Mode slots below stay live (`base`) so each profile round-trips whole.
  const s = getSettings()
  const lastPrimary = (getLastLoadedLayout()?.primary ?? null) as { open?: unknown; width?: unknown } | null
  const basePrimary = base.primary ?? {}
  const lastOpen = lastPrimary?.open
  const lastWidth = lastPrimary?.width
  const frozenOpen = typeof lastOpen === 'boolean' ? lastOpen : basePrimary.open
  const frozenWidth = typeof lastWidth === 'number' ? lastWidth : basePrimary.width
  return {
    ...base,
    primary: {
      ...basePrimary,
      open: s.persistDrawerOpenState ? basePrimary.open : frozenOpen,
      width: s.persistDrawerWidth ? basePrimary.width : frozenWidth,
    },
    dualLayout: os ? getDualLayoutSlot() : isDual ? base : getDualLayoutSlot(),
    singleLayout: os ? getSingleLayoutSlot() : isDual ? getSingleLayoutSlot() : base,
    osDualLayout: isDual ? (os ? base : getOsDualLayoutSlot()) : getOsDualLayoutSlot(),
    osSingleLayout: isDual ? getOsSingleLayoutSlot() : (os ? base : getOsSingleLayoutSlot()),
  }
}

function persistModel(model: LayoutModel): void {
  const host = _host
  if (!host) return
  const layout = buildPersistedBlob(model, (key) => host.resolve(key))
  // Cascade guard: a host-sync storm (extension enable/update re-renders)
  // can reach reconcileAndPersist with an UNCHANGED model. Without dedup
  // every round re-wrote the identical layout to disk + IPC forever (freeze
  // log: constant bytes=2135 SAVE_LAYOUT loop). Identical serialized content
  // → skip the write entirely.
  const json = JSON.stringify(layout)
  if (json === _lastPersistedLayout) {
    dlog('[dispatch] persist layout skipped (byte-identical)')
    return
  }
  _lastPersistedLayout = json
  // Diagnostic: one summary per actual disk write — what the persisted blob
  // carries (drawer side, per-drawer counts, hidden, actives, mode slots).
  // Verifies every reorder/move/mode change landed in the durable layout
  // that a hard refresh + server restart restores. tabOrder is the COMBINED
  // host order (primary + secondary); primary = combined − detached.
  const persistedTabs = Array.isArray(layout.tabOrder) ? layout.tabOrder.length : 0
  const persistedSecondary = Array.isArray(layout.detachedTabs) ? layout.detachedTabs.length : 0
  dlog('[dispatch] persist layout', {
    drawerSide: layout.drawerSide,
    primary: persistedTabs - persistedSecondary,
    secondary: persistedSecondary,
    hidden: Array.isArray(layout.hiddenTabIds) ? layout.hiddenTabIds.length : 0,
    activePrimary: layout.primary?.tabId ?? null,
    activeSecondary: layout.secondary?.activeTabId ?? null,
    singleSlot: layout.singleLayout != null,
    dualSlot: layout.dualLayout != null,
    bytes: json.length,
  })
  // Fire-and-await: errors are logged but do not block the dispatch queue.
  // The owned model remains the source of truth; a failed save is
  // surfaced via the debug log and will be retried on the next dispatch.
  saveLayoutToDisk(layout).then((r) => {
    if (r.status === 'error') {
      // A failed write must not stay dedup-cached: the next dispatch with the
      // same content has to retry, otherwise the change only lives in memory
      // (review B3). Only clear OUR entry — a newer persist may already have
      // succeeded and re-armed the cache.
      if (_lastPersistedLayout === json) _lastPersistedLayout = null
      // eslint-disable-next-line no-console
      console.warn('[canvas] saveLayoutToDisk failed:', r.reason)
    }
  }).catch((err: unknown) => {
    if (_lastPersistedLayout === json) _lastPersistedLayout = null
    // eslint-disable-next-line no-console
    console.warn('[canvas] saveLayoutToDisk rejected:', err)
  })
}

async function reconcileAndPersist(model: LayoutModel, generation = _generation): Promise<LayoutModel> {
  const host = _host
  if (!host || generation !== _generation) return model
  const report = await reconcile(model, host)
  // The host could not apply the model's drawer side (NO-GO settings
  // bridge — the DOM will never flip). Adopt the observed side so the model
  // stops fighting the world and the persisted blob never carries a drawer
  // side the drawer does not actually have (enable-toggle poison:
  // same-side drawers + stuck override + SAVE_LAYOUT cascade, 2026-08-17).
  if (report.modelSideCorrection !== undefined && model.side !== report.modelSideCorrection) {
    model = { ...model, side: report.modelSideCorrection }
  }
  // A teardown or replacement may have happened while host reconciliation was
  // awaiting React/DOM work. Never write the old generation after that point.
  // Do not overwrite a non-empty persisted layout while the host is still at
  // its pre-React empty bootstrap boundary. The readiness callback will retry
  // the restore once live tab identities exist.
  const hasTabs = model.primary.length > 0 || model.secondary.length > 0
  // `hasTabs` still guards empty writes on every path. The pending gate opens
  // only for warm restores that opted in (`_persistResolvedWhilePending`) —
  // see the flag's doc comment.
  const persistAllowed = _pendingLayout === null || _persistResolvedWhilePending
  if (generation === _generation && _host === host && persistAllowed && hasTabs) {
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

    markPendingWindowUserIntent(intent)
    const next = reduce(_model, intent)
    if (next === _model) {
      dlog('[dispatch] no-op (reduce returned same model)', { t: intent.t })
      return
    }

    commitModel(next)
    commitModel(await reconcileAndPersist(next, gen))
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

    for (const intent of intents) markPendingWindowUserIntent(intent)
    const next = foldIntents(_model, intents)
    dlog('[dispatch] batch', {
      intents,
      before: { primary: _model.primary, secondary: _model.secondary },
      after: { primary: next.primary, secondary: next.secondary },
    })
    if (next === _model) return

    commitModel(next)
    commitModel(await reconcileAndPersist(next, gen))
  })
  _queue = task.catch(() => {})

  return task
}

/**
 * Move a tab (resolved from a live id) to the other drawer.
 *
 * `visibleIndex` overrides the destination insertion point (visible-index
 * semantics, `-1` = append — see `visibleToAbsoluteIndex`). Callers that just
 * move (context menu, DnD fallback) omit it and keep the append default; the
 * OS launch path passes an explicit end index for absent windows.
 */
export function dispatchMoveByLiveId(
  liveId: LiveTabId,
  activateDest = true,
  visibleIndex?: number,
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
        index: visibleIndex ?? destVisible,
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
    index: visibleIndex ?? destVisible,
    activateDest,
  })
}

/**
 * Activate a tab on a side, resolving the TabKey from a LIVE id via the host.
 *
 * This is the producer for the SECONDARY drawer's click path. The secondary
 * wrapper lives on document.body — outside the main-sidebar subtree the host
 * observes — so clicking a secondary tab never fires a world-changed
 * observer (the mechanism that keeps the primary side converged via
 * applySyncFromHost's adoptActive). The drawer-tracked active
 * (getActiveSecondaryTabId) updates, but the owned model's active.secondary
 * lags, and the STALE key is what serializeModelToLayout writes to
 * layout.json — after a hard refresh the OLD tab comes back active instead
 * of the one the user clicked. The click handler dispatches this so the
 * model — and the persisted secondary.activeTabId — follows the click.
 *
 * No-op (resolves without dispatching) when the owned model is not
 * bootstrapped or the live id cannot resolve to a model key.
 */
export function dispatchActivateByLiveId(liveId: LiveTabId, side: Side): Promise<void> {
  const host = _host
  if (!host) return Promise.resolve()
  const key = host.findKey(liveId)
  if (!key) {
    dlog('[dispatch] dispatchActivateByLiveId: findKey returned null', { liveId, side })
    return Promise.resolve()
  }
  return dispatch({ t: 'activate', key, side })
}

/**
 * UNIFIED producer: sync BOTH drawers' tracked actives into the owned model
 * in one round (2026-08-16).
 *
 * Each drawer's tracked active is the single source of truth for "which tab
 * is active there": `resolvePrimaryActiveTabId()` (taskbar → the main-mirror
 * key; host mode → the host drawer's tabBtnActive) and
 * `getActiveSecondaryTabId()`. Every user-activation path in BOTH drawers
 * writes one of these two, so instead of wiring a producer at every click
 * surface (secondary buttons, main-mirror buttons, DnD, handoffs, …), the
 * WRITERS themselves dispatch this intent:
 *
 * - `setActiveSecondaryTabId` (tabs/active-tab.ts) — the choke point every
 *   secondary activation flows through (clicks, reopen, placement-with-
 *   activation, neighbor handoff). The secondary wrapper lives on
 *   document.body, outside the host sidebar subtree, so those activations
 *   never produce host-syncs on their own.
 * - the main-mirror `commitState` activeKey write (sidebar/main-tab-pin.ts) —
 *   taskbar parity: mirror activations don't reliably mutate the observed
 *   world (the host sidebar observer is childList-only and React re-renders
 *   are attribute changes), so the model's primary active lags the mirror
 *   key and the stale key is what layout.json persists.
 *
 * The reducer (`applySyncActive`) only ADOPTS keys already on the right side
 * and visible, and is identity-preserving — restore/placement echoes and
 * already-converged rounds short-circuit at dispatch's `next === _model`
 * gate, so the cost of hooking the writers is one queued no-op.
 *
 * No-op (resolves without dispatching) pre-bootstrap or when neither tracked
 * active resolves to a model key. Also skipped while the owned model is mid-
 * boot / mid-restore (`_bootstrapping || _restoringPending`): tracked-active
 * writes in that window are restore-driven echoes (the model is being
 * converged FROM the layout) and syncing them back reconciles against a
 * half-ready world — each round can rewrite layout.json during the boot
 * mutation storm (constant-bytes SAVE_LAYOUT cascade, 2026-08-17). User
 * activations after readiness are unaffected.
 */
export async function dispatchTrackedActiveSync(): Promise<void> {
  // Coalesce: writers fire this per CHANGE (remount placement loops set the
  // tracked id several times in one tick). The body re-reads the tracked
  // values at run time, so collapsing concurrent triggers into one dispatch
  // is correct and prevents queue saturation during remount storms.
  //
  // A trigger arriving DURING the await (after the body already read the
  // tracked values) must not be dropped: queue one trailing rerun that
  // re-reads at run time (review batch 3). Without it, rapid secondary clicks
  // could leave model.active.secondary on the earlier tab and persist it.
  if (_trackedSyncScheduled) {
    _trackedSyncQueued = true
    return
  }
  _trackedSyncScheduled = true
  try {
    do {
      _trackedSyncQueued = false
      await dispatchTrackedActiveSyncInner()
    } while (_trackedSyncQueued)
  } finally {
    _trackedSyncScheduled = false
  }
}

async function dispatchTrackedActiveSyncInner(): Promise<void> {
  const host = _host
  if (!host) return
  if (_bootstrapping || _restoringPending) {
    dlog('[dispatch] dispatchTrackedActiveSync skipped (model mid-boot/restore)')
    return
  }
  const active = await import('../tabs/active-tab')
  const primaryId = active.resolvePrimaryActiveTabId()
  const secondaryId = active.getActiveSecondaryTabId()
  const primary = primaryId ? host.findKey(primaryId) : null
  const secondary = secondaryId ? host.findKey(secondaryId) : null
  if (!primary && !secondary) {
    dlog('[dispatch] dispatchTrackedActiveSync: nothing resolvable', { primaryId, secondaryId })
    return
  }
  await dispatch({ t: 'syncActive', primary, secondary })
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
   * S2: the mirror parity keys are gone — nothing to capture anymore.
   * The owned model's applyMove adopts the replacement into
   * active.primary (activeAfterRemoval) and the flat renderer renders
   * it; applyMainMirrorMoveChrome re-asserts the content from the model.
   * The shape stays so live DnD / owned-commit call sites compile.
   */
  neighborBtn: null
  reassertId: null
}

/**
 * S2 capture: no-op. The old pre-placement capture (mirror neighbor from
 * hidden host buttons, exclusive mirror key) died with the parity layer —
 * the model already owns the neighbor decision (applyMove adoption) and
 * the renderer renders it once the move intent commits.
 */
export async function captureMainMirrorMoveChrome(
  liveId: LiveTabId,
  target: Side,
): Promise<MainMirrorMoveChrome> {
  void liveId
  void target
  return { neighborBtn: null, reassertId: null }
}

/**
 * S2 content re-assert after a move to the secondary drawer: the host
 * drifts its panel content to the first remaining tab after a container
 * remount, and reconcile can no longer detect that drift through
 * diffActive (the world's isActiveInPrimary is model-derived). Re-click
 * the CURRENT model primary active's host button — after the move intent
 * commits, applyMove has already adopted the replacement for active-tab
 * moves; for non-active moves this re-clicks the unchanged active (the
 * old reassertId behavior). No-op without a model primary active or when
 * it still points at the tab that just moved. Callers gate on
 * target === 'secondary'.
 */
export async function applyMainMirrorMoveChrome(
  chrome: MainMirrorMoveChrome,
  liveId: LiveTabId,
): Promise<void> {
  void chrome
  const model = _model
  const host = _host
  if (!model || !host) return
  const key = model.active.primary
  if (!key) return
  const id = host.resolve(key)
  if (!id || id === liveId) return

  // Scope the lookup to the MAIN sidebar via findMainTabButton. A global
  // document.querySelector('button[data-tab-id]') can match a Canvas
  // secondary button (which also carries data-tab-id) when the host's
  // main button is hidden or untagged — for extension tabs the host button
  // has no data-tab-id until the tagger runs, so the global query would
  // find the secondary button and activate the tab in the WRONG drawer.
  // Dynamic import avoids the dispatch → buttons → secondary → dispatch
  // circular dep.
  const { findMainTabButton } = await import('../tabs/buttons')
  const btn = findMainTabButton(id) as HTMLElement | null
  if (btn && btn.isConnected) {
    dlog(`[tabmove] apply chrome: re-asserting model active content (${id})`)
    try { btn.click() } catch { /* host may throw during teardown */ }
  } else {
    dlog('[tabmove] apply chrome: re-assert button not found in main sidebar', { id })
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
  // A collapsed drawer has no displayed window to hand off from: the tracked
  // cell is reopen memory (OS minimize/close keeps it), not display truth.
  if (getModel()?.drawers.secondary.open !== true) return { neighborBtn: null }
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
      const facadeKey = host.findKey(liveId)
      await sidebar.assignToSecondary(liveId, facadeKey ? { facadeKey } : undefined)
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
  // On mobile, moving a tab must NOT auto-open the destination drawer (only
  // one drawer open at a time; the user opens it explicitly) — same policy
  // as assignTab (tabs/assignment.ts) and assignToSecondary. Desktop keeps
  // the rClick open-so-the-move-is-visible behavior.
  if (target === 'secondary') {
    const secondary = await import('../sidebar/secondary')
    if (!secondary.isSecondarySidebarOpen()) {
      const { isMobileViewport } = await import('../sidebar/mobile-exclusion')
      if (!isMobileViewport()) {
        dlog('[tabmove] placementFirstMove: secondary drawer not open; opening explicitly')
        secondary.openSecondarySidebar()
      } else {
        dlog('[tabmove] placementFirstMove: mobile — drawer left closed (no auto-open on move)')
      }
    }
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
  // The main-mirror content re-assert ran at step 2.5 for moves INTO the
  // secondary drawer.
  if (target === 'primary') {
    await applySecondaryNeighborHandoff(secondaryChrome, liveId)
  }

  // S2 (step 2.5): main-mirror content re-assert AFTER the move intent —
  // the model's active (applyMove adopt) is only current post-dispatch.
  if (target === 'secondary') {
    await applyMainMirrorMoveChrome(chrome, liveId)
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
  opts?: { persistWhilePending?: boolean; osActive?: boolean },
): void {
  let model = buildModelFromLayout(layout as any, (id) => host.findKey(id))
  // F2 read backstop (mirrors buildPersistedBlob's write backstop): a stale
  // OS-shaped top-level blob + settings with osMode off (interrupted OS
  // disable reload, failed layout write, corrupt/missing settings.json)
  // hydrates model.closed with no Start menu to reopen those windows — the
  // renderer hides closed membership unconditionally. Clear on restores that
  // belong to a non-OS session. Gate follows `opts.osActive` when supplied
  // (a superseded OS-enable run must keep the closed-set of the OS slot it
  // is restoring; a disable run clears it) and the live setting otherwise
  // (boot). OS slots keep their stored closed sets in the blob either way.
  if (!(opts?.osActive ?? isOsModeEnabled()) && model.closed.length > 0) {
    dlog('[dispatch] dropped OS closed-set on non-OS boot/restore', {
      closed: model.closed.length,
    })
    model = { ...model, closed: [] }
  }
  // Same backstop for the START-MENU-only set (LUMI-16b): with OS mode off
  // the Start menu does not exist, so a stale menu-hidden set must never
  // survive into a non-OS session (the OS slots keep their stored copies).
  if (!(opts?.osActive ?? isOsModeEnabled()) && model.menuHidden.length > 0) {
    dlog('[dispatch] dropped OS menu-hidden set on non-OS boot/restore', {
      menuHidden: model.menuHidden.length,
    })
    model = { ...model, menuHidden: [] }
  }
  if (pendingLayoutTabCount(layout) === 0) {
    const observed = host.observe()
    if (inventoryIsReady(observed) && observed.tabs.length > 0) {
      model = reduce(model, { t: 'syncFromHost', observed })
    }
  }
  // Only retain a deferred restore when the first identity walk could not
  // resolve EVERY saved tab. Extension buttons often register AFTER this
  // point (React commit lag, late extension registration); a fully-empty
  // model was the historical gate, which dropped stragglers whenever most
  // tabs resolved on the first pass (the "extension tab doesn't persist
  // across reload" bug). enqueueHostSync converges the unresolved set on
  // later world changes — merging at saved indices — until everything
  // resolves or the boot deadline expires.
  _restoringPending = false
  _pendingWindowUserState = false
  const expected = pendingLayoutTabCount(layout)
  const resolved = model.primary.length + model.secondary.length
  _restoreDeadline = Date.now() + RESTORE_RETRY_WINDOW_MS
  // Warm restores (mode switch / OS disable) opt into persisting the resolved
  // model while the retry window is open — the entering slot must not strand
  // the live layout on disk (see _persistResolvedWhilePending). Boot calls
  // without the option: the retry window owns persistence.
  _persistResolvedWhilePending = opts?.persistWhilePending === true
  // Restore-time OS routing (see `_persistOsOverride`). Explicit `false` must
  // override; only an ABSENT option leaves the live setting in charge. This
  // writes the BOOTSTRAP-scoped slot only — a run-scoped value set by
  // `setPersistOsOverride` sits independently and is never clobbered here
  // (F2).
  _persistOsBootOverride = opts?.osActive === undefined ? null : opts.osActive
  _pendingLayout = layout != null && resolved < expected
    ? layout
    : null
  if (_pendingLayout !== null) {
    dlog('[dispatch] pending-layout armed', {
      expected,
      resolved,
      persistWhilePending: _persistResolvedWhilePending,
    })
  }
  bootstrap(model, host, version)
  // Placement-pass generation guard: bootstrap() just incremented
  // _generation — capture it so the async pass below can detect that a
  // NEWER bootstrap (mode switch) has superseded this one.
  const passGen = _generation

  // Diagnostic: boot restore summary — what the saved layout asked for vs
  // what resolved. Verifies the persisted layout (drawer side, split, order)
  // survives hard refresh + server restart.
  const savedLayout = (layout ?? {}) as { drawerSide?: unknown; detachedTabs?: unknown[] }
  dlog('[dispatch] boot restore', {
    expectedTabs: expected,
    resolvedTabs: resolved,
    pendingRetry: _pendingLayout !== null,
    savedDrawerSide: savedLayout.drawerSide ?? null,
    savedSecondary: Array.isArray(savedLayout.detachedTabs) ? savedLayout.detachedTabs.length : 0,
    modelSide: model.side,
    modelPrimary: model.primary.length,
    modelSecondary: model.secondary.length,
  })

  // Place model-secondary tabs into the secondary shell right after boot,
  // before any user interaction: with the drawer already open at boot, the
  // open path's re-assignment loop never runs (openSecondarySidebar bails),
  // so restored tabs would stay visible in the main drawer until the first
  // move (2026-07-31). openOnClosed:false — a closed drawer must not be
  // force-opened; setActiveWhenReady:false — no activation while closed;
  // the persisted active.secondary is shown when the drawer is open.
  const primaryBootKey = model.active.primary
  // Only meaningful when secondary tabs exist: placements (and their host
  // force-activation churn) only run then. Single-drawer boots skip.
  const primaryBootLiveId =
    primaryBootKey !== null
    && model.secondary.length > 0
    && !model.secondary.includes(primaryBootKey)
      ? host.resolve(primaryBootKey)
      : null
  // Captured before the async pass: a partial restore's pending merge may
  // still ADD secondary keys, so the removal sweep below must be skipped
  // until the model is complete (see the sweep call).
  const restorePending = _pendingLayout !== null
  _bootPlacementPass = (async () => {
    // A newer bootstrap (mode switch) supersedes an older placement pass —
    // bail before any work (gate, placement, re-assert).
    if (passGen !== _generation) return
    // Secondary placement visual gate (2026-09, live-verify #5 final): this
    // pass serializes secondary placements and can outlive the main restore
    // reveal (setup caps its wait at 1.5s). Hold the second drawer + pinned
    // strip hidden until placements settle so its active panel can never
    // paint before the tab buttons. Released in the finally; the 5s safety
    // cap guarantees the drawer can never stay hidden after a wedged pass.
    let gate: typeof import('../sidebar/main-persist') | null = null
    let gateReleased = false
    let gateSafety: ReturnType<typeof setTimeout> | null = null
    const releaseGate = () => {
      if (gateReleased) return
      gateReleased = true
      try { gate?.releaseSecondaryPlacementReveal() } catch { /* non-fatal */ }
    }
    // A newer bootstrap (mode switch) supersedes an older placement pass —
    // bail BEFORE the reveal-gate import + hold: this return would skip the
    // pass's finally (the hold's only release path), so a hold here leaks.
    if (passGen !== _generation) return
    try {
      gate = await import('../sidebar/main-persist')
      gate.holdSecondaryPlacementReveal()
      gateSafety = setTimeout(releaseGate, 5000)
    } catch { /* non-fatal */ }
    try {
      const m = await import('../sidebar/secondary')
      // A newer bootstrap (mode switch) supersedes an older placement pass —
      // the stale pass must not place (or sweep/re-assert) below.
      if (passGen !== _generation) return
      await m.reassignSecondaryTabsFromModel({
        openOnClosed: false,
        setActiveWhenReady: false,
        activateKey: model.active.secondary ?? null,
      })
      // Removal half (2026-09-15): a slot restore that moves a tab
      // secondary→primary — OS-mode disable, any layout restore — leaves the
      // host button in the secondary shell. Reconcile cannot see the
      // divergence (observe() derives location from the model-derived
      // assignment facade), so without this sweep the tab renders in both the
      // main mirror strip and the secondary strip and neither duplicate can
      // load content. Placement is model-driven; removal is this sweep.
      // Skipped on a partial restore: the pending merge may still add
      // secondary keys, which the sweep would wrongly unassign.
      if (!restorePending) {
        // A newer bootstrap (mode switch) supersedes an older placement pass —
        // the stale pass must not run the removal sweep.
        if (passGen !== _generation) return
        try {
          await m.unassignSecondaryTabsNotInModel()
        } catch (err) {
          dwarn('[bootstrap] unassignSecondaryTabsNotInModel failed:', err)
        }
      }
      if (primaryBootLiveId === null) return
      // Boot-placement primary re-assert (2026-09): each builtin assign
      // force-activates the tab in the HOST main drawer (lazy panel-data
      // load) before moving it to secondary, so when the pass settles the
      // host's active tab is the LAST MOVED tab — a container tab has no
      // main panelContent, so the mirror's parked node is empty and the main
      // drawer goes black (content flashes until the churn finishes). User
      // moves re-assert via their handoff (preserve/neighbor); boot restore
      // had no such tail. Re-click the persisted primary — mirror-mode
      // activateMainMirrorFromRestore no-ops mid-session when a user key
      // exists, so this is boot-only in effect — then let the repark watch
      // (or the second attempt) park the content React renders.
      const reassertPrimary = async (): Promise<void> => {
        // Load BOTH modules first, then gate once (L10, 2026-09-23): a
        // supersede landing inside either dynamic import must drop the
        // re-assert — the old shape clicked before the second import's await
        // could observe a mid-flight generation bump.
        let mp: { ensureRestoredPrimaryTab(id: string): void } | null = null
        let mm: { ensureHostContentParkedPublic(): void } | null = null
        try {
          mp = await import('../sidebar/main-persist')
        } catch { /* non-fatal */ }
        try {
          mm = await import('../sidebar/main-mirror-drawer')
        } catch { /* non-fatal */ }
        // A newer bootstrap (mode switch) supersedes an older placement pass —
        // the stale pass must not re-click the pre-switch primary or park.
        if (passGen !== _generation) return
        try {
          mp?.ensureRestoredPrimaryTab(primaryBootLiveId)
        } catch { /* non-fatal */ }
        try {
          mm?.ensureHostContentParkedPublic()
        } catch { /* non-fatal */ }
      }
      // A newer bootstrap (mode switch) supersedes an older placement pass —
      // the stale pass must not re-assert the primary.
      if (passGen !== _generation) return
      await reassertPrimary()
      // L10: re-check after the awaited re-assert — a supersede that landed
      // inside reassertPrimary's dynamic imports must not schedule the retry.
      if (passGen !== _generation) return
      try {
        const mm = await import('../sidebar/main-mirror-drawer')
        if (mm.isMainMirrorActive()) {
          // Second attempt: covers a coalesced trailing placement run that
          // finishes after this pass (its tail is click-free, but be safe).
          setTimeout(() => {
            // A newer bootstrap (mode switch) supersedes an older placement
            // pass — drop the stale 500ms retry.
            if (passGen !== _generation) return
            void reassertPrimary()
          }, 500)
        }
      } catch { /* non-fatal */ }
    } catch (err) {
      dwarn('[bootstrap] reassignSecondaryTabsFromModel failed:', err)
    } finally {
      if (gateSafety) clearTimeout(gateSafety)
      releaseGate()
    }
  })()
}

/**
 * Resolves when the boot placement pass (secondary tab placement + primary
 * content re-assert) has settled. setup.ts awaits this (capped) before
 * revealing the main drawer so the pass's host force-activations never flash
 * other panels in the open mirror.
 */
export function bootPlacementDone(): Promise<void> {
  return _bootPlacementPass ?? Promise.resolve()
}

export function flush(): Promise<void> {
  return _queue
}

/**
 * Test-only snapshot of the pending-restore lifecycle flags (B3 hygiene).
 * Both flags are private to this module; the B3-1 test asserts they reset
 * only AFTER the final merge of a completing pending restore.
 */
export function __getPendingRestoreFlagsForTest(): {
  persistResolvedWhilePending: boolean
  pendingWindowUserState: boolean
} {
  return {
    persistResolvedWhilePending: _persistResolvedWhilePending,
    pendingWindowUserState: _pendingWindowUserState,
  }
}
