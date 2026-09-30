// Boot recovery for the mode/slot mismatch (F5 — Workstream C of the
// layout-mode-switching fixes plan, `2026-09-19-canvas-layout-mode-fixes-plan.md`).
//
// The anomaly: a reload whose settings say `secondSidebarEnabled: true` while
// the loaded top-level blob is single-shaped (`detachedTabs` empty) and the
// model therefore boots with an empty secondary. The dual layout still lives
// in the `dualLayout`/`osDualLayout` slot. This module detects that state at
// boot (planModeRecovery — sync decision) and restores the entering slot
// through the normal mode-restore primitive (recoverModeLayoutAtBoot — apply),
// so setup performs exactly ONE main-drawer restore on the boot path
// (decision/apply split, plan R2-4).
//
// ── ACCEPTED TRADE-OFF (plan R2-1) — read before changing the preconditions ──
// An INTENTIONALLY-EMPTIED dual layout (the user moved the last secondary tab
// to the primary drawer, then reloaded) is INDISTINGUISHABLE from a mid-switch
// reload: both present as setting=dual + single-shaped top-level + non-empty
// dual slot. Recovery resurrects the saved dual layout in both cases — i.e.
// after intentionally emptying the second drawer and reloading, the tabs come
// back in the second drawer. This is LOCKED BY TEST C-3
// (`src/layout/__tests__/mode-recovery.test.ts`) and is deliberately NOT
// justified by the H4 guard: H4 is a different scope (it protects the stored
// slot from being overwritten at DISABLE time by a single-shaped live model);
// this is a boot-time product decision about which layout to show. Do not
// cite H4 as its rationale. Plan considered fix-at-source (persist the dual
// top-level before the settings flip) and rejected it for this round — the
// unload settings flush makes the window unavoidable without reordering the
// enable's mount/restore contract.
//
// Import graph stays lean on purpose: settings/state, recon/dispatch,
// layout/mode-profiles, persist/layout-model, debug/log, and dom/clamp (a
// zero-dependency leaf). The secondary shell module is pulled ONLY via a
// dynamic import inside the geometry step so this module never joins the
// sidebar shell graph at load time. The mobile-viewport check is a LOCAL
// matchMedia helper copied from os/os-mode.ts — NEVER import
// sidebar/mobile-exclusion here (documented load cycle; see the same comment
// in os-mode.ts and second-drawer-mode.ts).
//
// Facets: both the main-drawer restore inside restoreSingleModeLayout and the
// secondary geometry are gated on the persisted `persistDrawerOpenState` /
// `persistDrawerWidth` settings (plan R2-3/R2-5).

import { dlog, dwarn } from '../debug/log'
import {
  getSettings,
  isOsModeEnabled,
  getDualLayoutSlot,
  getOsDualLayoutSlot,
} from '../settings/state'
import { getModel, getHost } from '../recon/dispatch'
import { restoreSingleModeLayout } from './mode-profiles'
import { layoutHasTabs, slotResolves, type LegacyLayout } from '../persist/layout-model'
import { clampSidebarWidth } from '../dom/clamp'

// Local matchMedia helper: importing sidebar/mobile-exclusion would pull the
// whole shell graph into this module's load chain (same pattern — and the
// same warning comment — in os/os-mode.ts and settings/second-drawer-mode.ts).
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

/**
 * Sync decision: which entering dual slot should boot recovery restore, or
 * null. Called by setup AFTER the boot placement wait and BEFORE any
 * main-drawer restore, so the decision cannot race the apply (plan R2-4).
 *
 * Returns the slot only when ALL preconditions hold (plan C):
 *  1. `secondSidebarEnabled === true` (a single-mode session has nothing to
 *     recover — its own layout booted fine).
 *  2. The owned model exists and is single-shaped (`secondary.length === 0`).
 *  3. The loaded top-level blob's `detachedTabs` is empty/absent — the
 *     anomaly signature (setting says dual, top-level single-shaped). This
 *     also excludes late-resolving DUAL boots whose top-level HAS
 *     detachedTabs from ever entering recovery (plan R2-2) — no peeking at
 *     dispatch internals needed.
 *  4. The entering slot (`osMode ? osDualLayout : dualLayout`) passes
 *     `layoutHasTabs` AND the unresolvable-slot check (`slotResolves` against
 *     the live host) with a non-null host. An all-unresolvable slot must NOT
 *     replace a live model (same rule as OS-enable restore, plan A2).
 *  5. NOT (`osMode && mobile viewport`) — the OS mobile sync owns that path
 *     (setup calls syncOsMobileDrawerMode right after recovery).
 *
 * Pure decision: never mutates state. The accepted trade-off (intentional-
 * empty dual ≡ mid-switch reload) is documented in the file header and locked
 * by test C-3.
 */
export function planModeRecovery(layout: unknown): LegacyLayout | null {
  try {
    const s = getSettings()
    if (s.secondSidebarEnabled !== true) return null

    const model = getModel()
    if (!model || model.secondary.length !== 0) return null

    // Precondition 3: only the detachedTabs shape of the top-level blob
    // matters — a single layout still carries a non-empty tabOrder.
    const topDetached = (layout as { detachedTabs?: unknown } | null | undefined)?.detachedTabs
    if (Array.isArray(topDetached) && topDetached.length > 0) return null

    const host = getHost()
    if (!host) return null

    const slot = (isOsModeEnabled() ? getOsDualLayoutSlot() : getDualLayoutSlot()) as
      | LegacyLayout
      | null
      | undefined
    if (!slot || !layoutHasTabs(slot)) return null
    if (!slotResolves(slot, (id) => host.findKey(id) ?? null)) return null

    if (s.osMode && isMobileViewportLocal()) return null

    dlog('[mode-recovery] plan: recovering entering dual slot', {
      tabOrder: Array.isArray(slot.tabOrder) ? slot.tabOrder.length : 0,
      detached: Array.isArray(slot.detachedTabs) ? slot.detachedTabs.length : 0,
      osMode: s.osMode,
    })
    return slot
  } catch (err) {
    dwarn('[mode-recovery] planModeRecovery failed:', err)
    return null
  }
}

/**
 * Apply: restore the model + gated main drawer (+ secondary geometry).
 * Never throws — every failure is logged via dwarn and swallowed so a broken
 * recovery cannot fail the whole setup chain.
 *
 * The main-drawer restore is delegated entirely to restoreSingleModeLayout
 * with facet-derived opts (plan R2-3): setup must NOT additionally call
 * applyMainDrawer on this path — that would be a second main restore.
 */
export async function recoverModeLayoutAtBoot(slot: LegacyLayout): Promise<void> {
  // Failure-path backstop (adversarial F3): on the `entering` path the ONLY
  // unsuppress otherwise lives inside restoreMainDrawerFromDom — if
  // bootstrapFromLayout throws, restoreSingleModeLayout returns ok:false
  // before the DOM restore, or an early return/throw beats it, the drawer
  // would stay suppressed until the 3s watchdog. Every failure path below
  // ends in a best-effort unsuppress (same dynamic-import shape as
  // applyMainDrawer's catch in layout/main-restore.ts). unsuppressMainDrawer
  // is idempotent (restore-poll.test T3), so a belt-and-braces double
  // unsuppress on partial outcomes is harmless.
  const bestEffortUnsuppress = async (): Promise<void> => {
    try {
      const { unsuppressMainDrawer } = await import('../sidebar/main-persist')
      unsuppressMainDrawer()
    } catch (err) {
      dwarn('[mode-recovery] unsuppressMainDrawer failed:', err)
    }
  }
  try {
    const host = getHost()
    const model = getModel()
    if (!host || !model) {
      dwarn('[mode-recovery] host/model gone; skipping boot recovery', {
        host: !!host,
        model: !!model,
      })
      await bestEffortUnsuppress()
      return
    }

    const s = getSettings()
    const facetOpen = !!s.persistDrawerOpenState
    const facetWidth = !!s.persistDrawerWidth

    dlog('[mode-recovery] restoring entering dual slot', {
      tabOrder: Array.isArray(slot.tabOrder) ? slot.tabOrder.length : 0,
      detached: Array.isArray(slot.detachedTabs) ? slot.detachedTabs.length : 0,
      facetOpen,
      facetWidth,
      osActive: isOsModeEnabled(),
    })

    let result: { ok: boolean; reason?: string }
    try {
      result = await restoreSingleModeLayout(slot, host, {
        restoreOpen: facetOpen,
        restoreWidth: facetWidth,
        osActive: isOsModeEnabled(),
        // L3 (2026-09-23): boot recovery must use the plain retry window —
        // never durably persist a resolved-only dual blob during the 30s
        // pending window (early-reload placement loss).
        persistWhilePending: false,
      })
    } catch (err) {
      dwarn('[mode-recovery] restoreSingleModeLayout threw:', err)
      await bestEffortUnsuppress()
      return
    }
    // Partial-outcome logging, same shape as the mode-profiles callers in
    // second-drawer-mode.ts (bootstrap failure vs main-drawer failure).
    dlog('[mode-recovery] restore result', { ok: result.ok, reason: result.reason ?? null })
    if (!result.ok) {
      dwarn(`[mode-recovery] dual-layout restore partial: ${result.reason ?? 'unknown'}`)
      // ok:false ⇒ the success-path unsuppress inside
      // restoreMainDrawerFromDom may never have run (bootstrap failure
      // returns before it) — backstop it here.
      await bestEffortUnsuppress()
    }

    // Secondary geometry (plan R2-5). The shell mounted at feature-mount time
    // from the SINGLE top-level (initialOpen:false, single width) — after the
    // model restore it is stale. Gate: the slot says the second drawer was
    // open AND the open facet is on; the shell-exists check lives inside
    // applySecondaryGeometry (isSecondaryShellLive).
    if (slot.secondary?.open === true && facetOpen) {
      await applySecondaryGeometry(slot, facetWidth)
    }
  } catch (err) {
    dwarn('[mode-recovery] boot recovery failed:', err)
    await bestEffortUnsuppress()
  }
}

/**
 * Reconcile the already-mounted secondary shell with the slot geometry the
 * same way a normal dual cold-boot applies it (plan R2-5):
 *  - width: the `SECONDARY_WIDTH_VAR` CSS var on documentElement, clamped
 *    exactly like createDrawerShell does at mount (facet: persistDrawerWidth);
 *  - open: the public `openSecondarySidebar()` API (the same one dispatch and
 *    the tab buttons use) — it heals the shell, syncs the drawer state
 *    machine, persists the open intent (idempotent: the restored model already
 *    says open) and re-attaches tabs. Gated on the slot actually carrying
 *    detached tabs, mirroring mount's `hasTabsToRestore` initialOpen gate.
 *
 * The shell module comes in via dynamic import: mode-recovery must not join
 * the sidebar/mobile-exclusion load cycle at module-eval time (see header).
 */
async function applySecondaryGeometry(slot: LegacyLayout, facetWidth: boolean): Promise<void> {
  try {
    const sec = await import('../sidebar/secondary')
    if (!sec.isSecondaryShellLive()) {
      dlog('[mode-recovery] secondary shell not present; geometry skipped')
      return
    }
    if (facetWidth && typeof slot.secondary?.width === 'number') {
      const widthPx = Math.ceil(clampSidebarWidth(slot.secondary.width))
      document.documentElement.style.setProperty(sec.SECONDARY_WIDTH_VAR, `${widthPx}px`)
    }
    const hasTabsToRestore = Array.isArray(slot.detachedTabs) && slot.detachedTabs.length > 0
    if (hasTabsToRestore) {
      sec.openSecondarySidebar()
    }
    dlog('[mode-recovery] secondary geometry applied', {
      width: facetWidth ? slot.secondary?.width ?? null : null,
      opened: hasTabsToRestore,
    })
  } catch (err) {
    dwarn('[mode-recovery] secondary geometry failed:', err)
  }
}
