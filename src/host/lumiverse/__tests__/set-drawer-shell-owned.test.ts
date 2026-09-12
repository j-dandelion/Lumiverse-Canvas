// live-verify #1 regression (2026-09): LumiverseHost.setDrawer('primary')
// must NOT toggle the Canvas main shell while the shell owns the primary
// surface.
//
// User report (taskbar ON, second drawer disabled, drawer closed): clicking
// the Connect mirror tab froze the page in an alternating SAVE_LAYOUT loop
// (bytes=4520/4518). Root cause: the shell open/close burst interleaves with
// the async intent queue — the activate-intent's reconcile observed world
// open=true (the click had already opened the shell) against model
// open=false, and setDrawer FORCED closeCanvasMainDrawer; that toggle
// re-persisted open:false through its own setDrawer intent, the next queued
// task re-opened per the model, and the two writers ping-ponged forever.
// The ±2-byte oscillation = the open boolean written twice (top-level
// layout + the duplicated singleLayout slot in single mode).
//
// Contract being pinned:
//   A. mainShellOwnsPrimarySurface() = CANVAS_MAIN_ACTIVE_CLASS on <html>
//      AND the restore guard lifted — the same condition observe() uses to
//      read shell truth for primary open/width.
//   B. Shell-owned → setDrawer('primary') is a SUPPRESSED echo: no shell
//      toggle, no --canvas-main-mirror-width stamp. Shell truth converges
//      into the model via observe() on the next host-sync instead.
//   C. Restore window + mirror inactive keep the toggle path: the shell
//      does not own the surface there (boot seeding / host fallback).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

// ── Global DOM stubs (before imports) — stateful documentElement ──
const _classes = new Set<string>()
const _styles = new Map<string, string>()
;(globalThis as any).HTMLElement = class HTMLElement {
  hasAttribute(_n: string) { return false }
  getAttribute(_n: string) { return null }
  setAttribute() {}
  removeAttribute() {}
  querySelectorAll(_s: string) { return [] as any[] }
  textContent: string | null = null
}
;(globalThis as any).document = {
  querySelector() { return null },
  querySelectorAll() { return [] },
  documentElement: {
    classList: {
      contains(c: string) { return _classes.has(c) },
      add(c: string) { _classes.add(c) },
      remove(c: string) { _classes.delete(c) },
    },
    style: {
      getPropertyValue(k: string) { return _styles.get(k) ?? '' },
      setProperty(k: string, v: string) { _styles.set(k, v) },
      removeProperty(k: string) { _styles.delete(k) },
    },
  },
  body: { querySelector: () => null, appendChild() {}, removeChild() {} },
}
;(globalThis as any).MutationObserver = class MutationObserver {
  constructor(_cb: (m: any[]) => void) {}
  observe() {}
  disconnect() {}
}
;(globalThis as any).CSS = { escape(s: string) { if (s == null) return ''; return s.replace(/([^\w-])/g, '\\$1') } }
;(globalThis as any).getComputedStyle = () => ({ display: '', visibility: '' })
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}

import { mock } from 'bun:test'
// Spread the real module so newly-imported exports keep linking; the stubs
// below only neutralize what this test isolates.
import * as actualMainMirror from '../../../sidebar/main-mirror-drawer'

// ── Recording toggle mock — the exact seam the guard suppresses ──
const state = {
  toggleCalls: [] as string[],
  hostSettings: null as null | { tabOrder: unknown[]; hiddenTabIds: string[] },
  widthVarStamped: [] as string[],
}

mock.module('../../../sidebar/main-mirror-drawer', () => ({
  ...actualMainMirror,
  getMainMirrorDrawer: () => null,
  getMainMirrorTabList: () => null,
  getMainMirrorPanel: () => null,
  isMainMirrorActive: () => false,
  onMainMirrorTabActivated: () => {},
  applyMainMirrorDrawer: () => {},
  openCanvasMainDrawer: () => { state.toggleCalls.push('open') },
  closeCanvasMainDrawer: () => { state.toggleCalls.push('close') },
}))

mock.module('../../../dom/host-settings', () => ({
  getHostDrawerSettings: () => state.hostSettings,
  patchHostDrawerSettings: (partial: Record<string, unknown>) => {
    state.hostSettings = { tabOrder: [], hiddenTabIds: [], ...(state.hostSettings ?? {}), ...partial } as {
      tabOrder: unknown[]
      hiddenTabIds: string[]
    }
    return true
  },
  writeHostDrawerSettingsViaApi: async () => true,
}))

const [{ LumiverseHost, mainShellOwnsPrimarySurface }] = await Promise.all([import('../implementation')])
const { CANVAS_MAIN_ACTIVE_CLASS, MAIN_MIRROR_WIDTH_VAR } = await import('../../../sidebar/styles')
// Not exported: the restore-guard class literal (main-persist.ts:71).
const RESTORE_PENDING_CLASS = 'sidebar-ux-main-restore-pending'

// The var implementation.setDrawer actually writes (Batch 2 fixed the dead
// '--canvas-main-mirror-width' literal).
const HOST_WIDTH_VAR = MAIN_MIRROR_WIDTH_VAR
const host = () => new LumiverseHost()

// ── 1. mainShellOwnsPrimarySurface truth table ──
{
  assertEqual(mainShellOwnsPrimarySurface(), false, '1a: no canvas-main mode → false')
  _classes.add(CANVAS_MAIN_ACTIVE_CLASS)
  assertEqual(mainShellOwnsPrimarySurface(), true, '1b: shell active + guard lifted → owns')
  _classes.add(RESTORE_PENDING_CLASS)
  assertEqual(mainShellOwnsPrimarySurface(), false, '1c: restore window → does NOT own')
  _classes.delete(RESTORE_PENDING_CLASS)
}

// ── 2. Shell-owned: setDrawer('primary') is a suppressed stale echo ──
{
  state.toggleCalls = []
  _styles.delete(HOST_WIDTH_VAR)
  const h = host()

  const closeReq = await h.setDrawer('primary', { open: false, width: 420 })
  assertEqual(closeReq, 'ok', '2a: suppressed echo returns ok')
  assertEqual(state.toggleCalls.length, 0, '2b: shell NOT toggled while it owns the surface')

  const openReq = await h.setDrawer('primary', { open: true, width: 420 })
  assertEqual(openReq, 'ok', '2c: suppressed echo (open) returns ok')
  assertEqual(state.toggleCalls.length, 0, '2d: still no toggle')
  assertEqual(_styles.get(HOST_WIDTH_VAR), undefined, '2e: width var NOT stamped from the model echo')
}

// ── 3. Restore window: toggle path still reached (boot seeding semantics) ──
{
  state.toggleCalls = []
  _styles.delete(HOST_WIDTH_VAR)
  _classes.add(RESTORE_PENDING_CLASS)
  const h = host()

  const closeReq = await h.setDrawer('primary', { open: false, width: 0 })
  assertEqual(closeReq, 'ok', '3a: restore window → write goes through')
  assert(state.toggleCalls.includes('close'), '3b: close toggle reached the seam during the restore window')
  assertEqual(_styles.get(HOST_WIDTH_VAR), undefined, '3c: width 0 → no stamp')

  const openReq = await h.setDrawer('primary', { open: true, width: 300 })
  assertEqual(openReq, 'ok', '3d: open write goes through')
  assert(state.toggleCalls.includes('open'), '3e: open toggle reached the seam')
  assertEqual(_styles.get(HOST_WIDTH_VAR), '300px', '3f: width stamped on the host path')
  _classes.delete(RESTORE_PENDING_CLASS)
}

// ── 4. Mirror inactive: toggle path still reached (host fallback) ──
{
  state.toggleCalls = []
  _styles.delete(HOST_WIDTH_VAR)
  _classes.delete(CANVAS_MAIN_ACTIVE_CLASS)
  const h = host()

  const res = await h.setDrawer('primary', { open: true, width: 260 })
  assertEqual(res, 'ok', '4a: mirror-inactive write returns ok')
  assert(state.toggleCalls.includes('open'), '4b: toggle reached the seam (no shell mounted → recording mock only)')
  assertEqual(_styles.get(HOST_WIDTH_VAR), '260px', '4c: width stamped on the host path')
}

assertEqual(_classes.has(CANVAS_MAIN_ACTIVE_CLASS), false, '5: cleanup — active class removed')
assertEqual(_classes.size, 0, '5b: cleanup — no stray classes')

console.log(`set-drawer-shell-owned tests: ${passed} passed, ${failed} failed`)
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exit(1) }
void MAIN_MIRROR_WIDTH_VAR
