// S8 Drawer location (Sides | Top | Bottom) — presentation/orchestration.
//
// This module is deliberately NOT a geometry writer. All strip host/list
// geometry (zone split, anchors, width/height, list chrome, spacers) is
// owned by sidebar/tab-position.ts (secondary) and its main-path callers
// (main-tab-pin.ts / main-mirror-drawer.ts). drawer-location owns only:
//
//   - html location classes + --sidebar-ux-strip-h (before any mount)
//   - shell wrapper edge offsets (strip reserve)
//   - handle visibility + consumer knobs (gutters/reflow)
//   - presence subscription (onModelChanged, rAF-coalesced)
//   - reconcile fan-out (sync, generation-guarded, coalesced)
//   - teardown (clearDrawerLocation, idempotent across the FIFO chain)
//
// Reconcile contract (plan v4 §3.2): synchronous — static imports only, no
// async fan-out; re-entrant calls coalesce into one follow-up pass; a
// monotonic generation guards every deferred segment. Unit tests need no
// microtask/timer flush.

import {
  getDrawerLocation,
  getSettings,
  isHorizontalStrip,
} from '../settings/state'
import { onModelChanged } from '../recon/dispatch'
import { hasSecondaryAssignedTabs } from '../tabs/assignment'
import { getMainDrawerSide } from '../store'
import { isMobileViewport } from './mobile-exclusion'
import type { DrawerLocation } from '../types'
import {
  HORIZONTAL_STRIP_CSS,
  LOCATION_CLASS_BOTTOM,
  LOCATION_CLASS_SIDES,
  LOCATION_CLASS_TOP,
  STRIP_HEIGHT_PX,
  STRIP_HEIGHT_VAR,
  injectHorizontalStripStyles,
} from './styles'
import {
  applyWrapperStripEdge,
  type StripEdge,
} from './drawer-shell'
import {
  getMainMirrorWrapper,
  updateMainMirrorDrawerTabVisibility,
} from './main-mirror-drawer'
import { getSecondaryWrapper, isSecondaryShellLive } from './secondary'
import {
  clearHorizontalSplit,
  reconcileTabListPin,
  syncHorizontalSplit,
} from './tab-position'
import { reconcileMainTabListPin } from './main-tab-pin'
import { updateStripGutters } from './strip-gutter'
import { updateChatReflow } from '../chat/reflow'
import { updateDrawerTabVisibility } from '../tabs/buttons'
import { invalidateDndGeometry, isDndDragActive } from '../tabs/tab-list-dnd'

// ── Module state ──

/** Re-entrancy coalescing: a reconcile triggered while one is running. */
let _pending = false
let _dirty = false

/** Monotonic generation — deferred segments re-check before applying. */
let _locGen = 0

/** Skip-cache key (location + viewport + side + presence + shell liveness). */
let _lastKey: string | null = null

/** onModelChanged subscription (presence changes). */
let _unsubModel: (() => void) | null = null

/** rAF handle for the presence check. */
let _presenceRaf: number | null = null

// ── Presentation helpers ──

function stripEdgeFor(loc: DrawerLocation): StripEdge | null {
  return loc === 'top' ? 'top' : loc === 'bottom' ? 'bottom' : null
}

/**
 * Write the html location classes + strip-height var and re-offset both
 * shell wrappers. Idempotent; safe before any shell exists (wrappers null).
 */
export function applyLocationPresentation(loc: DrawerLocation): void {
  if (typeof document === 'undefined' || !document.documentElement) return
  const root = document.documentElement
  const cl = root.classList
  if (typeof cl?.toggle === 'function') {
    cl.toggle(LOCATION_CLASS_TOP, loc === 'top')
    cl.toggle(LOCATION_CLASS_BOTTOM, loc === 'bottom')
    cl.toggle(LOCATION_CLASS_SIDES, loc === 'sides')
  }
  root.style?.setProperty?.(STRIP_HEIGHT_VAR, `${STRIP_HEIGHT_PX}px`)
  const edge = stripEdgeFor(loc)
  applyWrapperStripEdge(getSecondaryWrapper(), edge)
  applyWrapperStripEdge(getMainMirrorWrapper(), edge)
}

/** Runtime flip in place: classes/var + wrapper offsets (no remount). */
export function restyleShellLocation(): void {
  applyLocationPresentation(getDrawerLocation())
}

/** Force-hide both edge handles while horizontal (strip is the affordance). */
function hideHandles(): void {
  const secondary = getSecondaryWrapper()?.querySelector?.('.sidebar-ux-drawer-tab') as
    | HTMLElement
    | null
    | undefined
  if (secondary?.style) secondary.style.display = 'none'
  const main = getMainMirrorWrapper()?.querySelector?.('.sidebar-ux-drawer-tab') as
    | HTMLElement
    | null
    | undefined
  if (main?.style) main.style.display = 'none'
}

// ── Presence ──

/** Zone presence: secondary enabled + shell live + at least one tab. */
function secondaryZonePresent(): boolean {
  return (
    !!getSettings().secondSidebarEnabled
    && isSecondaryShellLive()
    && hasSecondaryAssignedTabs()
  )
}

function computeKey(loc: DrawerLocation): string {
  return [
    loc,
    isMobileViewport() ? 'mobile' : 'desktop',
    getMainDrawerSide(),
    getSettings().secondSidebarEnabled ? '1' : '0',
    isSecondaryShellLive() ? '1' : '0',
    secondaryZonePresent() ? '1' : '0',
  ].join('|')
}

// ── Reconcile ──

/**
 * Single entry point. Synchronous, coalesced, generation-guarded.
 *
 * Re-entrant calls (e.g. a consumer triggers another reconcile mid-pass)
 * set the dirty flag; one follow-up pass runs after the current one.
 */
export function reconcileDrawerLocation(opts?: { force?: boolean }): void {
  if (_pending) {
    _dirty = true
    return
  }
  _pending = true
  try {
    runReconcile(opts?.force === true)
    if (_dirty) {
      _dirty = false
      runReconcile(true)
    }
  } finally {
    _pending = false
  }
}

function runReconcile(force: boolean): void {
  const gen = ++_locGen
  const loc = getDrawerLocation()
  const horizontal = isHorizontalStrip()

  // Top/Bottom split var: sync BEFORE the skip-cache. The var depends on the
  // strict secondary-zone predicate (list node included) which `computeKey`
  // intentionally does not track; a list-node transition must still apply.
  // Cheap + idempotent; drag-owned values are respected inside.
  syncHorizontalSplit()

  const key = computeKey(loc)
  if (!force && key === _lastKey) return
  _lastKey = key

  // 1. Presentation (classes/var + shell offsets) before any geometry pass.
  applyLocationPresentation(loc)

  // 2. Geometry fan-out — single writer (tab-position) owns all strip
  //    geometry; these are no-ops when the pin state does not change.
  reconcileTabListPin()
  reconcileMainTabListPin()

  // A teardown/fresh reconcile during the fan-out supersedes this pass.
  if (gen !== _locGen) return

  // The fan-out above re-chromes both hosts to the new axis AFTER the
  // pass-opening sync computed its basis. Re-sync now so the value this pass
  // leaves behind uses the settled post-flip geometry. Without it a
  // Sides→Top/Bottom flip retained a negative var from the stale vertical
  // main host (56px basis → -14.29%) and the secondary overlay stayed
  // collapsed at 0 width until the next model commit — the reported "second
  // drawer does not render until a main tab is clicked" (live bug
  // 2026-09-17). Idempotent; drag-owned values are respected inside.
  syncHorizontalSplit()

  // S8: mid-drag layout churn invalidates cached DnD container geometry.
  if (isDndDragActive()) invalidateDndGeometry()

  // 3. Handles + consumers (axis-aware in the consumer modules).
  updateDrawerTabVisibility()
  updateMainMirrorDrawerTabVisibility()
  if (horizontal) hideHandles()

  updateStripGutters()
  updateChatReflow()
}

/**
 * rAF-coalesced presence check. The model subscription fires on every
 * commit; the skip-cache inside runReconcile makes unchanged commits cheap.
 */
function schedulePresenceReconcile(): void {
  if (_presenceRaf !== null) return
  const run = () => {
    _presenceRaf = null
    reconcileDrawerLocation()
  }
  if (typeof requestAnimationFrame === 'function') {
    _presenceRaf = requestAnimationFrame(run)
  } else {
    run()
  }
}

// ── Lifecycle ──

/**
 * Boot: html classes/var + styles BEFORE any shell mount (no boot flash),
 * first reconcile, then subscribe to model presence changes.
 * Returns an unsubscribe teardown (clearDrawerLocation also unsubscribes).
 */
export function mountDrawerLocation(): () => void {
  initDrawerLocation()
  reconcileDrawerLocation({ force: true })
  if (!_unsubModel) {
    _unsubModel = onModelChanged(() => schedulePresenceReconcile())
  }
  return () => {
    if (_unsubModel) {
      _unsubModel()
      _unsubModel = null
    }
    if (_presenceRaf !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(_presenceRaf)
    }
    _presenceRaf = null
  }
}

/** Init hook: classes + var + stylesheet (idempotent, no shells needed). */
export function initDrawerLocation(): void {
  injectHorizontalStripStyles()
  applyLocationPresentation(getDrawerLocation())
}

/**
 * Teardown. Idempotent: registered in alwaysCleanups AND the feature
 * teardown, and runs before feature teardowns in the FIFO cleanup chain.
 * Pure DOM + raw module state — never touches ctx (generation-gated).
 */
export function clearDrawerLocation(): void {
  _locGen++
  _pending = false
  _dirty = false
  _lastKey = null

  if (_presenceRaf !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(_presenceRaf)
  }
  _presenceRaf = null

  if (_unsubModel) {
    _unsubModel()
    _unsubModel = null
  }

  // Module state first — safe without a document (test resets).
  clearHorizontalSplit()

  if (typeof document === 'undefined' || !document.documentElement) return
  const root = document.documentElement
  root.classList?.remove?.(LOCATION_CLASS_SIDES)
  root.classList?.remove?.(LOCATION_CLASS_TOP)
  root.classList?.remove?.(LOCATION_CLASS_BOTTOM)
  root.style?.removeProperty?.(STRIP_HEIGHT_VAR)

  applyWrapperStripEdge(getSecondaryWrapper(), null)
  applyWrapperStripEdge(getMainMirrorWrapper(), null)
}

/** Test-only: reset module state without a live document. */
export function __resetDrawerLocationForTest(): void {
  clearDrawerLocation()
  _pending = false
  _dirty = false
  _lastKey = null
}

/** Dev/test assertion: the desired location is fully applied to the DOM. */
export function assertLocationApplied(desired: DrawerLocation): boolean {
  if (typeof document === 'undefined' || !document.documentElement) return true
  const cl = document.documentElement.classList
  const wantClass =
    desired === 'top'
      ? LOCATION_CLASS_TOP
      : desired === 'bottom'
        ? LOCATION_CLASS_BOTTOM
        : LOCATION_CLASS_SIDES
  return cl.contains(wantClass)
}

/** Re-export for consumers that already import location helpers here. */
export { HORIZONTAL_STRIP_CSS }
