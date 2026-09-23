/**
 * OS-mode enable/disable orchestration (spec D11, D12; persistence §3.2).
 *
 * Enable (`osMode` false → true) — plan A2:
 *   1. Restore the ENTERING mode's OS slot (osDual/osSingle by active mode;
 *      always osSingle on mobile) when it has tabs that resolve against the
 *      host — the slot wins over live state (F1). Seed the slot from the
 *      live owned-model serialization only when it is absent/empty or fully
 *      unresolvable. D11: every visible tab seeds as an OPEN window — the
 *      model's closed set is empty whenever OS mode is off (invariant:
 *      `closed` membership only grows inside an OS session, and the
 *      disable restore bootstraps from a non-OS slot that carries none),
 *      so the seed needs no closed-set surgery.
 *   2. The restore runs under a synchronous reveal hold whose tail mirrors
 *      the drawer-enable path (placement pass → flush → content settle →
 *      Configure-modal refresh), then the owned-model persist path keeps
 *      the OS slot current automatically (dispatch.buildPersistedBlob
 *      routes OS-mode writes).
 *
 * Disable (`osMode` true → false):
 *   1. Close the persist window: snapshot the live OS serialization (which
 *      carries `closedTabIds` from the model) into the matching OS slot —
 *      the persist path kept it current; this closes any debounce gap
 *      before the non-OS restore runs.
 *   2. D12 slot-wins restore: bootstrap the entering (non-OS) slot of the
 *      current mode into the owned model — buildModelFromLayout finds no
 *      `closedTabIds` there, so the model's closed set empties naturally —
 *      and restore the main drawer's open/active/width via the
 *      battle-tested mode-profiles path. Same routine the dual re-enable
 *      flow uses (it is mode-agnostic).
 *   3. Belt-and-braces: cancelLayoutSave() is a compat no-op in the
 *      owned-model world (layout writes are immediate) — kept as a seam,
 *      same pattern as the second-drawer enable flow.
 *
 * Never throws: every failure degrades to a logged partial outcome — a
 * failed slot restore must not strand the UI in a half state that blocks
 * the settings toggle.
 */

import {
  getHost,
  getModel,
  dispatchBatch,
  snapshotOwnedModelLayout,
  bootPlacementDone,
  flush,
  setPersistOsOverride,
} from '../recon/dispatch'
import type { Intent } from '../core/intents'
import { cancelLayoutSave } from '../persist/layout-load'
import { restoreSingleModeLayout } from '../layout/mode-profiles'
import {
  holdMainDrawerReveal,
  releaseMainDrawerReveal,
  waitForMainContentSettled,
} from '../sidebar/main-persist'
import { foldLayoutToSingleShape, layoutHasTabs, slotResolves } from '../persist/layout-model'
import type { LegacyLayout } from '../persist/layout-model'
import { runOsTransition, withModeSwitchBarrier } from '../settings/mode-transition'
import {
  getSettings,
  setSettings,
  isOsModeEnabled,
  getSingleLayoutSlot,
  getDualLayoutSlot,
  setSingleLayoutSlot,
  setDualLayoutSlot,
  getOsSingleLayoutSlot,
  getOsDualLayoutSlot,
  setOsSingleLayoutSlot,
  setOsDualLayoutSlot,
} from '../settings/state'
import { dlog, dwarn } from '../debug/log'

// ── OS + mobile single-drawer force ──────────────────────────────────────────
//
// OS mode is live on mobile, but dual-drawer layout is not usable there
// (full-bleed drawers, mutual exclusion): while OS mode is on and the
// viewport is ≤600px, the second drawer is forced off through the real
// mode-switch API (so the dual layout is saved in the OS slot and restored on
// the way out). `osForcedSingleDrawer` records that the disable was
// OS-initiated; once OS mode is off — or the viewport leaves mobile — the
// user's dual-drawer mode is restored.
//
// Local matchMedia helper: importing sidebar/mobile-exclusion would pull the
// whole shell graph into this module's already-cyclic load chain
// (mobile-exclusion → sidebar/secondary → settings/state → panel → registry →
// os-mode).

function isMobileViewportLocal(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 600px)').matches
    )
  } catch {
    return false
  }
}

/** Single-flight with a dirty rerun: the OS toggle, a viewport crossing, and
 *  the boot sync can race; one mode switch at a time, everyone awaits the same
 *  promise, and a trigger landing mid-switch marks the run dirty so it reruns
 *  against fresh settings/viewport instead of being dropped.
 *
 *  `_mobileDrawerSyncNested` records the STARTING runner's `nested`-ness —
 *  a nested caller must never await a non-nested runner (deadlock; see
 *  syncOsMobileDrawerMode). Only meaningful while `_mobileDrawerSync` is
 *  non-null. */
let _mobileDrawerSync: Promise<void> | null = null
let _mobileDrawerSyncDirty = false
let _mobileDrawerSyncNested = false

/**
 * Reconcile the OS+mobile single-drawer invariant with the current settings
 * and viewport. Safe to call from any entry point (OS enable/disable,
 * viewport crossing, post-boot).
 *
 * `opts.nested` marks calls made from INSIDE an OS transition
 * (`runOsEnable`/`runOsDisable`): the OS run holds the drawer chain of the
 * hierarchical mode-transition arbiter, so the requestSecondDrawerMode calls
 * below must run nested (inline) or they would deadlock against that chain.
 * External callers (mobile-exclusion, setup) pass nothing — behavior
 * unchanged: their requests go through the public queued API.
 *
 * Join rules (single-flight + deadlock break, adversarial F1): the starting
 * runner's nested-ness is recorded; a nested caller joining a NON-nested
 * runner marks it dirty and runs the body inline instead of awaiting (that
 * runner may be queued on the drawer chain behind this very OS run). All
 * other joins await the shared promise as before.
 */
export function syncOsMobileDrawerMode(opts?: { nested?: boolean }): Promise<void> {
  const nested = !!opts?.nested
  if (_mobileDrawerSync) {
    if (nested && !_mobileDrawerSyncNested) {
      // Deadlock break (adversarial F1): a NESTED caller (inside
      // runOsTransition — it holds the drawer chain) must NEVER await a
      // NON-nested runner. That runner may itself be queued on the drawer
      // chain behind THIS OS run (its requestSecondDrawerMode went through
      // the public queued API) — awaiting it here is a circular wait: the
      // OS run waits for the runner, the runner waits for the chain the OS
      // run holds. Instead: flag the runner dirty (its loop reruns against
      // fresh settings once the chain releases) and run the body INLINE
      // now — safe because this caller already holds the drawer chain.
      _mobileDrawerSyncDirty = true
      return runSyncOsMobileDrawerMode(true)
    }
    // Safe joins (single-flight): a non-nested caller joining either runner
    // (it holds no chain the runner needs — a nested runner never queues,
    // a non-nested runner only waits on chains this caller isn't holding),
    // or a nested caller joining a NESTED runner (that runner's body takes
    // the nested request path too, so it cannot be stuck behind this run).
    _mobileDrawerSyncDirty = true
    return _mobileDrawerSync
  }
  // Record the STARTING runner's mode so joins above can discriminate.
  _mobileDrawerSyncNested = nested
  _mobileDrawerSync = (async () => {
    let i = 0
    do {
      _mobileDrawerSyncDirty = false
      await runSyncOsMobileDrawerMode(nested)
      // Dirty again while the last run was in flight ⇒ rerun (settings and
      // viewport are re-read at entry). Cap at 5 to bound pathological
      // flapping.
    } while (_mobileDrawerSyncDirty && ++i < 5)
    // L7 (2026-09-23): a joiner between the final `while` check and the
    // `.finally` below sets `_mobileDrawerSyncDirty` with no loop left to
    // re-read it — drain once more before callers observe resolution.
    while (_mobileDrawerSyncDirty && ++i < 5) {
      _mobileDrawerSyncDirty = false
      await runSyncOsMobileDrawerMode(nested)
    }
  })().finally(() => {
    // Null the single-flight slot FIRST so a late joiner starts a fresh
    // runner instead of setting dirty on a dead one. If dirty still raced
    // in before the null, re-dispatch (nested-ness preserved) so the
    // trigger is not dropped on the floor.
    _mobileDrawerSync = null
    if (_mobileDrawerSyncDirty) {
      _mobileDrawerSyncDirty = false
      void syncOsMobileDrawerMode({ nested: _mobileDrawerSyncNested })
    }
  })
  return _mobileDrawerSync
}

async function runSyncOsMobileDrawerMode(nested = false): Promise<void> {
  const s = getSettings()
  const force = !!s.osMode && isMobileViewportLocal()
  if (force && s.secondSidebarEnabled) {
    // Re-fires while the drawer is still enabled (recovery after an
    // interrupted switch), not only when the flag is unset.
    if (!s.osForcedSingleDrawer) setSettings({ osForcedSingleDrawer: true })
    dlog('[os] mobile: forcing single-drawer mode')
    const { requestSecondDrawerMode } = await import('../settings/second-drawer-mode')
    await requestSecondDrawerMode(false, nested ? { silent: true, nested: true } : { silent: true })
    return
  }
  if (!force && s.osForcedSingleDrawer) {
    dlog('[os] mobile: restoring dual-drawer mode')
    const { requestSecondDrawerMode } = await import('../settings/second-drawer-mode')
    await requestSecondDrawerMode(true, nested ? { nested: true } : undefined)
    // Only clear the latch when the drawer actually came back: the mode-switch
    // path swallows failures, so a resolved promise is not proof of success.
    // Keeping the latch lets the next sync trigger retry the restore.
    if (getSettings().secondSidebarEnabled) {
      setSettings({ osForcedSingleDrawer: false })
    } else {
      dwarn('[os] mobile: dual restore did not land; keeping forced-single latch')
    }
  }
}

// ── F6 mode-switch slot routing ──────────────────────────────────────────────
//
// While OS mode is on, the second-drawer mode switch must save/restore the
// OS slot variants (osSingle/osDual) — the non-OS slots are FROZEN during an
// OS session (buildPersistedBlob), so reading them would restore a stale
// pre-OS layout and clobbering them would leak OS state into it. These
// accessors are the single routing point second-drawer-mode.ts uses.

/** The mode slot of the CURRENT (OS-aware) session: single-drawer variant. */
export function getActiveSingleSlot(): LegacyLayout | null {
  return isOsModeEnabled() ? getOsSingleLayoutSlot() : getSingleLayoutSlot()
}

/** The mode slot of the CURRENT (OS-aware) session: dual-drawer variant. */
export function getActiveDualSlot(): LegacyLayout | null {
  return isOsModeEnabled() ? getOsDualLayoutSlot() : getDualLayoutSlot()
}

/** Write the single-drawer mode slot of the current (OS-aware) session. */
export function setActiveSingleSlot(layout: LegacyLayout): void {
  if (isOsModeEnabled()) setOsSingleLayoutSlot(layout)
  else setSingleLayoutSlot(layout)
}

/** Write the dual-drawer mode slot of the current (OS-aware) session. */
export function setActiveDualSlot(layout: LegacyLayout): void {
  if (isOsModeEnabled()) setOsDualLayoutSlot(layout)
  else setDualLayoutSlot(layout)
}

/**
 * Which OS slot owns the active mode. Model shape is authoritative
 * (`model.secondary.length > 0` ⟺ dual) — the same rule
 * dispatch.buildPersistedBlob applies to the non-OS slots.
 */
function activeModeIsDual(): boolean {
  const model = getModel()
  return !!model && model.secondary.length > 0
}

/**
 * Seed the current mode's OS slot from the live model (D11 — all open).
 * `target` overrides the mode-derived slot choice (the OS+mobile enable path
 * always enters via osSingle, even when the live model is dual-shaped).
 *
 * The single slot is ALWAYS written single-shaped (deep-review M1): on the
 * mobile path the live model can still be dual at seed time (the seed runs
 * before the nested mobile force), and a raw dual serialization in
 * `osSingleLayout` would restore as a dual model with
 * `secondSidebarEnabled: false` on every later mobile OS enable. The fold is
 * a no-op for an already-single live serialization.
 */
export function seedOsSlotFromLive(target?: 'single' | 'dual'): void {
  const raw = snapshotOwnedModelLayout()
  if (!raw) {
    dlog('[os] enable seed: no live model serialization (boot/teardown) — slot stays empty')
    return
  }
  const which = target ?? (activeModeIsDual() ? 'dual' : 'single')
  const layout = which === 'single' ? foldLayoutToSingleShape(raw) : raw
  if (which === 'dual') setOsDualLayoutSlot(layout)
  else setOsSingleLayoutSlot(layout)
  dlog('[os] enable seed: OS slot written', {
    mode: which,
    tabs: Array.isArray(layout.detachedTabs) ? layout.detachedTabs.length : 0,
    tabOrder: Array.isArray(layout.tabOrder) ? layout.tabOrder.length : 0,
  })
}

/** Snapshot the live OS state into the current mode's OS slot (close the window). */
function snapshotOsSlotFromLive(): void {
  const layout = snapshotOwnedModelLayout()
  if (!layout) return
  if (activeModeIsDual()) setOsDualLayoutSlot(layout)
  else setOsSingleLayoutSlot(layout)
  dlog('[os] disable snapshot: OS slot written', {
    mode: activeModeIsDual() ? 'dual' : 'single',
    closed: Array.isArray(layout.closedTabIds) ? layout.closedTabIds.length : 0,
  })
}

/**
 * True when the slot that an OS-mode ENTER would restore carries tabs
 * (shape-only — no host resolution; used by the settings-panel tile dirty
 * guard, where a dialog one keystroke early is safe).
 */
/**
 * The ENTERING OS-mode slot choice, shared by `runOsEnable` and
 * `osEntrySlotHasTabs` so the panel tile's `willRestore` gate can never
 * disagree with the run's actual slot choice (adversarial F6): mobile-first
 * `osSingle` (R1-7 — the osDual restore is skipped on mobile), else the OS
 * slot of the active mode (model shape authoritative).
 */
function entryOsSlot(): LegacyLayout | null {
  return isMobileViewportLocal()
    ? getOsSingleLayoutSlot()
    : activeModeIsDual()
      ? getOsDualLayoutSlot()
      : getOsSingleLayoutSlot()
}

export function osEntrySlotHasTabs(): boolean {
  return layoutHasTabs(entryOsSlot())
}

/**
 * True when the slot that an OS-mode EXIT would restore (the non-OS slot of
 * the current drawer mode) carries tabs. Shape-only — see osEntrySlotHasTabs.
 */
export function osExitSlotHasTabs(): boolean {
  const slot = getSettings().secondSidebarEnabled
    ? getDualLayoutSlot()
    : getSingleLayoutSlot()
  return layoutHasTabs(slot)
}

/**
 * OS enable (plan A2): restore the ENTERING mode's OS slot (seed only on
 * first enable / unresolvable slot), under a synchronous reveal hold that
 * mirrors the drawer-enable tail, then reconcile the mobile force.
 */
async function runOsEnable(): Promise<void> {
  // Run-scoped persist override (adversarial F2): persists DURING this run
  // (pending-window merges up to 30s, the enable tail's flush) must route
  // with the RUN's intent even if the user flips `osMode` mid-run. The
  // bootstrap-scoped override in dispatch settles long before this run ends;
  // this value is independent of it and is cleared here — after hold
  // release / modal refresh / sync — before control returns to the drain
  // loop (see the `_persistOsOverride` doc in dispatch.ts).
  setPersistOsOverride(true)
  try {
    // H1 commit barrier: drain → freeze commits across the OS-slot
    // seed/restore → refresh-only tail → unfreeze. The nested mobile-force
    // drawer switch stacks inside this barrier (its own withModeSwitchBarrier
    // is a nested no-drain pass).
    await withModeSwitchBarrier(async () => {
      const host = getHost()
      const mobile = isMobileViewportLocal()
      // L12 (2026-09-23): latch osForcedSingleDrawer at enable when entering
      // on mobile — the entry-slot read and the force's viewport re-read can
      // disagree if the viewport crosses mid-tail (after restore, before
      // syncOsMobileDrawerMode). With the latch set, a desktop cross still
      // takes the restore-dual branch (`!force && osForcedSingleDrawer`)
      // instead of stranding a single-shaped OS model under a dual setting.
      if (mobile && !getSettings().osForcedSingleDrawer) {
        setSettings({ osForcedSingleDrawer: true })
      }
      // Mobile-first (R1-7): the entering slot is ALWAYS osSingle — the osDual
      // restore is skipped (the live dual layout is what the mode switch saves
      // into the OS dual slot during the force below). Desktop: the OS slot of
      // the active mode (model shape is authoritative). Shared with
      // osEntrySlotHasTabs (F6).
      const slot = entryOsSlot()
      // Restore gate (R1-6): restore only a slot that has content AND whose ids
      // still resolve against the host — an all-unresolvable slot must not
      // replace the live model with an empty one (30s adoption suppression).
      const canRestore = !!(
        slot &&
        host &&
        layoutHasTabs(slot) &&
        slotResolves(slot, (id) => host.findKey(id))
      )
      // Hold BEFORE the restore (R1-3): static import — main-persist is already
      // in this module's graph via mode-profiles. The tail runs INSIDE the hold
      // so both drawers appear settled when it releases.
      holdMainDrawerReveal()
      try {
        if (canRestore) {
          const result = await restoreSingleModeLayout(slot as LegacyLayout, host!, { osActive: true })
          if (!result.ok) dwarn(`[os] enable restore partial: ${result.reason ?? 'unknown'}`)
          else dlog('[os] enable: OS slot restored', { mobile })
        } else {
          // First enable (D11), missing host, empty, or unresolvable slot →
          // seed the entering OS slot from live (mobile always seeds osSingle).
          if (!host) dlog('[os] enable: no host — skipping restore (seed path)')
          seedOsSlotFromLive(mobile ? 'single' : undefined)
        }
        // Mirror the drawer-enable tail INSIDE the hold: wait for the placement
        // pass the restore queued (capped), drain intents, settle content.
        try {
          await Promise.race([
            bootPlacementDone(),
            new Promise((r) => setTimeout(r, 5000)),
          ])
          await flush()
          await waitForMainContentSettled(1000)
        } catch { /* best-effort */ }
        // Modal (R1-4 / H1): inside the hold, after the tail — REFRESH ONLY.
        // The barrier dropped any mid-switch commit; flushing here was the
        // stale-draft-onto-restored-model bug — the refresh installs a fresh
        // draft/base and is what legitimately discards those edits.
        try {
          const m = await import('../tabs/configure-modal')
          if (m.isConfigureTabsModalOpen()) {
            m.refreshConfigureDraftFromLive()
          }
        } catch { /* module may not be loaded */ }
      } finally {
        releaseMainDrawerReveal()
      }
      // Mobile: force single-drawer mode after the OS slot seed/restore (the
      // live dual layout is what the mode switch saves into the OS dual slot).
      // No-op on desktop / when the second drawer is already off. Nested: this
      // run holds the drawer chain of the mode-transition arbiter.
      await syncOsMobileDrawerMode({ nested: true })
    })
  } finally {
    setPersistOsOverride(null)
  }
}

/**
 * OS disable (D12 slot-wins): snapshot the live OS state into its slot,
 * restore the non-OS slot of the current mode with the run's intent
 * (`osActive: false`), sweep residual closed windows, reconcile the mobile
 * force, then (R1-13) refresh the still-open Configure modal — symmetric
 * with enable.
 */
async function runOsDisable(): Promise<void> {
  // Run-scoped persist override (adversarial F2): persists DURING this run
  // (the residual-closed sweep, pending-window merges) route as OS-mode-OFF
  // with the RUN's intent even if the user flips `osMode` back on mid-run —
  // that flip is exactly the R1-blocker-1 race this override exists to close.
  // Cleared in the finally at run end (see setPersistOsOverride /
  // runOsEnable's parallel comment).
  setPersistOsOverride(false)
  try {
    // H1 commit barrier: drain → freeze commits across snapshot → restore →
    // refresh-only tail → unfreeze (nested mobile-force switch stacks inside).
    await withModeSwitchBarrier(async () => {
      snapshotOsSlotFromLive()
      // Belt-and-braces: cancelLayoutSave is a compat no-op (layout writes are
      // immediate); kept as a seam.
      cancelLayoutSave()
      // D12 slot-wins: restore the non-OS slot of the current mode
      // (`secondSidebarEnabled` is unchanged by an OS toggle — the mode the
      // user will land in). Empty/missing slot → nothing to restore (first
      // enable + immediate disable: the live state IS the non-OS state).
      const dual = getSettings().secondSidebarEnabled
      const slot = dual ? getDualLayoutSlot() : getSingleLayoutSlot()
      const host = getHost()
      const hasTabs = !!slot && ((slot.detachedTabs?.length ?? 0) > 0 || (slot.tabOrder?.length ?? 0) > 0)
      if (slot && host && hasTabs) {
        const result = await restoreSingleModeLayout(slot, host, { osActive: false })
        if (!result.ok) {
          dwarn(`[os] disable restore partial: ${result.reason ?? 'unknown'}`)
        } else {
          dlog('[os] disable: non-OS slot restored', { mode: dual ? 'dual' : 'single' })
        }
      }
      // Invariant: OS mode off ⇒ model.closed empty. A successful slot restore
      // bootstraps from a non-OS slot (which carries no closedTabIds), but a
      // missing/empty slot or a partial restore leaves the live closed-set —
      // and with the Start menu gone those windows would stay hidden forever
      // (no reopen path). Clear any survivors through the ordinary model path.
      const after = getModel()
      if (after && after.closed.length > 0) {
        dlog('[os] disable: clearing residual closed windows', { closed: after.closed.length })
        const reopen: Intent[] = after.closed.map((key) => ({ t: 'setClosed', key, closed: false }))
        await dispatchBatch(reopen)
      }
      // Mobile single-drawer restore: if OS mode had forced the second drawer
      // off (mobile), bring the user's dual mode back through the full
      // mode-switch API. Runs after the non-OS single restore above so the
      // switch saves the restored single state as the entering-mode baseline and
      // restores the non-OS dual slot. No-op when nothing was forced. Nested:
      // this run holds the drawer chain of the mode-transition arbiter.
      await syncOsMobileDrawerMode({ nested: true })
      // R1-13 / H1: refresh the still-open Configure modal from the
      // now-restored non-OS live state — REFRESH ONLY (a flush here would
      // re-apply a pre-switch draft onto the restored model). Runs last so it
      // sees the settled state (including any mobile dual restore).
      try {
        const m = await import('../tabs/configure-modal')
        if (m.isConfigureTabsModalOpen()) {
          m.refreshConfigureDraftFromLive()
        }
      } catch { /* module may not be loaded */ }
    })
  } finally {
    setPersistOsOverride(null)
  }
}

/** In-flight OS drain (A3): concurrent flips share one serialized run. */
let _osDrain: Promise<void> | null = null

/**
 * Live-apply entry: called by the osMode feature's apply() when the setting
 * flips. The live setting IS the desired state (every request setSettings
 * synchronously first); this drain converges to it through ONE serialized
 * OS transition (which also holds the drawer chain — plan A3 / R1-1).
 * Async-safe (the orchestrator is sync; orchestration floats with logged
 * failures).
 */
export function applyOsModeChange(
  prev: { osMode?: boolean },
  next: { osMode?: boolean },
): Promise<void> {
  if (prev.osMode === next.osMode) return Promise.resolve()
  if (_osDrain) return _osDrain
  _osDrain = runOsTransition(async () => {
    try {
      let last = prev.osMode === true // known pre-flip state from the apply diff
      while (last !== getSettings().osMode) {
        const target = getSettings().osMode
        try {
          if (target) await runOsEnable()
          else await runOsDisable()
        } catch (e) {
          dwarn('[os] mode run failed', e) // R1-14: never strand the drain
        }
        last = target
      }
    } finally {
      _osDrain = null
    }
  })
  return _osDrain
}
