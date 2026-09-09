// S5: observe() primary open/width must read SHELL truth while the Canvas
// main shell owns the primary surface, and host-wrapper truth otherwise.
//
// Pre-S5, observe() always read the host wrapper (`isMainDrawerOpen()` /
// `getMainDrawerWidth()`). The host is store-open forever and headless in
// canvas-main mode, so the model's drawers.primary.open was pinned true —
// closing the Canvas shell NEVER persisted (restore reopened it after
// reload). S5 rewires observe() to read CANVAS_MAIN_OPEN_CLASS +
// MAIN_MIRROR_WIDTH_VAR while (a) canvas-main mode is active and (b) the
// boot restore guard has lifted (isMainDrawerRestorePending() == false).
// During the restore window the shell still shows its pre-restore (closed)
// state; keeping host reads there means boot persists stay byte-identical
// to pre-S5 behavior (no transient open:false clobber of the stored
// open:true).
//
// Discriminator for the restore-gate in a stub environment: the WIDTH.
// Host fallback width (no host store) = DEFAULT_WIDTH (420); shell width =
// MAIN_MIRROR_WIDTH_VAR (333px). So during the restore window the observed
// width must be 420 (host branch), after it lifts 333 (shell branch).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
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
let _fakeSidebar: any = null
;(globalThis as any).document = {
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _fakeSidebar
    return null
  },
  querySelectorAll(_s: string) { return [] },
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

import {
  CANVAS_MAIN_ACTIVE_CLASS,
  CANVAS_MAIN_OPEN_CLASS,
  MAIN_MIRROR_WIDTH_VAR,
} from '../../../sidebar/styles'
// Not exported: the restore-guard class literal (main-persist.ts:71).
const RESTORE_PENDING_CLASS = 'sidebar-ux-main-restore-pending'

const [{ LumiverseHost }] = await Promise.all([import('../implementation')])
const host = new LumiverseHost()

// ── 1. No canvas-main mode: host fallback ──
{
  const obs = host.observe()
  assertEqual(obs.primaryOpen, false, '1a: no canvas-main mode → host truth (store absent → closed)')
  assertEqual(obs.primaryWidth, 420, '1b: no canvas-main mode → host width fallback DEFAULT_WIDTH')
  assertEqual(_classes.has(CANVAS_MAIN_ACTIVE_CLASS), false, '1c: pre-clean state')
}

// ── 2. Shell active + settled: shell truth wins ──
_classes.add(CANVAS_MAIN_ACTIVE_CLASS)
_styles.set(MAIN_MIRROR_WIDTH_VAR, '333px')
_classes.add(CANVAS_MAIN_OPEN_CLASS)
{
  const obs = host.observe()
  assertEqual(obs.primaryOpen, true, '2a: shell active + open class → primaryOpen=true (SHELL truth)')
  assertEqual(obs.primaryWidth, 333, '2b: shell width from MAIN_MIRROR_WIDTH_VAR')
}

// ── 3. Close the shell (open class removed) — the S5 headline ──
_classes.delete(CANVAS_MAIN_OPEN_CLASS)
{
  const obs = host.observe()
  assertEqual(obs.primaryOpen, false, '3a: shell closed → primaryOpen=false (close persists via observation; host store-open would have pinned true)')
  assertEqual(obs.primaryWidth, 333, '3b: width still shell truth while open')
}

// ── 4. Restore window (RESTORE_PENDING_CLASS): host fallback, NOT shell ──
_classes.add(RESTORE_PENDING_CLASS)
{
  const obs = host.observe()
  assertEqual(obs.primaryWidth, 420, '4a: restore window → host width branch (420), NOT the shell var (333)')
  assertEqual(obs.primaryOpen, false, '4b: restore window → host open branch (host store absent → false)')
}
_classes.delete(RESTORE_PENDING_CLASS)

// ── 5. Shell active but width var unset → host width fallback chain ──
_styles.delete(MAIN_MIRROR_WIDTH_VAR)
{
  const obs = host.observe()
  assertEqual(obs.primaryOpen, false, '5a: still shell-truth branch for open (class governs)')
  assertEqual(obs.primaryWidth, 420, '5b: var unset → host width fallback → DEFAULT_WIDTH')
}

// ── 6. Guard lifts again → shell truth restored ──
_styles.set(MAIN_MIRROR_WIDTH_VAR, '333px')
{
  const obs = host.observe()
  assertEqual(obs.primaryWidth, 333, '6a: guard lifted → shell width again')
}
_classes.delete(CANVAS_MAIN_ACTIVE_CLASS)
_styles.delete(MAIN_MIRROR_WIDTH_VAR)

console.log(`observe-shell-truth tests: ${passed} passed, ${failed} failed`)
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exit(1) }
