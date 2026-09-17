/**
 * OS-mode enable/disable orchestration (spec D11, D12; persistence §3.2).
 *
 * Enable (`osMode` false → true):
 *   1. Seed the current mode's OS slot from the live owned-model
 *      serialization. D11: every visible tab seeds as an OPEN window — the
 *      model's closed set is empty whenever OS mode is off (invariant:
 *      `closed` membership only grows inside an OS session, and the
 *      disable restore bootstraps from a non-OS slot that carries none),
 *      so the seed needs no closed-set surgery.
 *   2. The UI does not change on enable — the live layout IS the OS layout
 *      minus chrome, which mounts in later steps. From here the owned-model
 *      persist path keeps the OS slot current automatically
 *      (dispatch.buildPersistedBlob routes OS-mode writes).
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
 *   3. Cancel the debounced layout save first so the mid-restore state is
 *      never written (same pattern as the second-drawer enable flow).
 *
 * Never throws: every failure degrades to a logged partial outcome — a
 * failed slot restore must not strand the UI in a half state that blocks
 * the settings toggle.
 */

import { getHost, getModel, dispatchBatch, snapshotOwnedModelLayout } from '../recon/dispatch'
import type { Intent } from '../core/intents'
import { cancelLayoutSave } from '../persist/layout-load'
import { restoreSingleModeLayout } from '../layout/mode-profiles'
import type { LegacyLayout } from '../persist/layout-model'
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

/** Single-flight: the OS toggle, a viewport crossing, and the boot sync can
 *  race; one mode switch at a time, everyone awaits the same promise. */
let _mobileDrawerSync: Promise<void> | null = null

/**
 * Reconcile the OS+mobile single-drawer invariant with the current settings
 * and viewport. Safe to call from any entry point (OS enable/disable,
 * viewport crossing, post-boot).
 */
export function syncOsMobileDrawerMode(): Promise<void> {
  if (_mobileDrawerSync) return _mobileDrawerSync
  _mobileDrawerSync = runSyncOsMobileDrawerMode().finally(() => {
    _mobileDrawerSync = null
  })
  return _mobileDrawerSync
}

async function runSyncOsMobileDrawerMode(): Promise<void> {
  const s = getSettings()
  const force = !!s.osMode && isMobileViewportLocal()
  if (force && s.secondSidebarEnabled) {
    // Re-fires while the drawer is still enabled (recovery after an
    // interrupted switch), not only when the flag is unset.
    if (!s.osForcedSingleDrawer) setSettings({ osForcedSingleDrawer: true })
    dlog('[os] mobile: forcing single-drawer mode')
    const { requestSecondDrawerMode } = await import('../settings/second-drawer-mode')
    await requestSecondDrawerMode(false, { silent: true })
    return
  }
  if (!force && s.osForcedSingleDrawer) {
    setSettings({ osForcedSingleDrawer: false })
    dlog('[os] mobile: restoring dual-drawer mode')
    const { requestSecondDrawerMode } = await import('../settings/second-drawer-mode')
    await requestSecondDrawerMode(true)
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

/** Seed the current mode's OS slot from the live model (D11 — all open). */
export function seedOsSlotFromLive(): void {
  const layout = snapshotOwnedModelLayout()
  if (!layout) {
    dlog('[os] enable seed: no live model serialization (boot/teardown) — slot stays empty')
    return
  }
  if (activeModeIsDual()) setOsDualLayoutSlot(layout)
  else setOsSingleLayoutSlot(layout)
  dlog('[os] enable seed: OS slot written', {
    mode: activeModeIsDual() ? 'dual' : 'single',
    tabs: Array.isArray(layout.detachedTabs) ? layout.detachedTabs.length : 0,
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
 * Live-apply entry: called by the osMode feature's apply() when the setting
 * flips. Async-safe (the orchestrator is sync; orchestration floats with
 * logged failures).
 */
export async function applyOsModeChange(
  prev: { osMode?: boolean },
  next: { osMode?: boolean },
): Promise<void> {
  if (!prev.osMode && next.osMode) {
    // ── Enable ──
    seedOsSlotFromLive()
    // Mobile: force single-drawer mode after the OS slot seed (the live dual
    // layout is what the mode switch saves into the OS dual slot). No-op on
    // desktop / when the second drawer is already off.
    await syncOsMobileDrawerMode()
    return
  }
  if (prev.osMode && !next.osMode) {
    // ── Disable ──
    snapshotOsSlotFromLive()
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
      const result = await restoreSingleModeLayout(slot, host)
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
    // restores the non-OS dual slot. No-op when nothing was forced.
    await syncOsMobileDrawerMode()
    return
  }
}
