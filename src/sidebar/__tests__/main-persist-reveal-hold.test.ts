// Reveal hold (main-persist) — live-verify #4 (2026-09-10).
//
// The runtime second-drawer enable queues the boot PLACEMENT pass, which
// pre-activates each secondary builtin in the host main drawer (lazy panel
// load). With the main mirror already visible, every activation painted that
// panel for a frame or two — enabling the drawer showed the panels flashing
// one by one. Fix: a VISUAL-ONLY refcounted hold hides both Canvas shells +
// every panel body while the pass churns, and defers restore-path unsuppress
// until release. Deliberately NOT the restore-pending class (that gate drives
// observe() shell truth / setDrawer suppression).
//
// Verifies: hold adds the class (not restore-pending), injects the CSS,
// stamps panel bodies; unsuppress is deferred while held; nested holds;
// release clears; stopMainDrawerPersistence clears a stranded hold; the
// settle helper resolves.

import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

const RESTORE_PENDING = 'sidebar-ux-main-restore-pending'
const REVEAL_HOLD = 'sidebar-ux-main-reveal-hold'
const REVEAL_IN = 'sidebar-ux-main-reveal-in'
const REVEAL_IN_MAIN = 'sidebar-ux-main-reveal-in-host'
const SECONDARY_HOLD = 'sidebar-ux-secondary-placement-hold'
const SECONDARY_REVEAL = 'sidebar-ux-secondary-reveal-in'

// =====================================================================
// Minimal DOM stubs (before importing main-persist)
// =====================================================================

const classes = new Set<string>()

const docEl = {
  classList: {
    add(c: string) { classes.add(c) },
    remove(c: string) { classes.delete(c) },
    contains(c: string) { return classes.has(c) },
    toString() { return [...classes].join(' ') },
  },
  style: {
    getPropertyValue() { return '' },
    setProperty() {},
    removeProperty() {},
  },
}

let styleEl: { id: string; textContent: string } | null = null

function makePanelNode() {
  const props = new Map<string, string>()
  return {
    _props: props,
    style: {
      setProperty(k: string, v: string) { props.set(k, v) },
      removeProperty(k: string) { props.delete(k) },
    },
  }
}
const panelNodes = [makePanelNode()]

;(globalThis as any).document = {
  documentElement: docEl,
  head: {
    appendChild(el: { id: string; textContent: string }) { styleEl = el },
  },
  body: {},
  querySelector() { return null },
  querySelectorAll() { return panelNodes },
  getElementById() { return null },
  createElement() {
    return {
      id: '',
      textContent: '',
      style: { setProperty() {}, removeProperty() {} },
      setAttribute() {},
      classList: { add() {}, remove() {} },
    }
  },
}
;(globalThis as any).MutationObserver = class {
  observe() {}
  disconnect() {}
}
;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}

// Import after stubs (dynamic so the document stub is in place first).
const mp = await import('../main-persist')

export {}

// --- T1: hold adds the visual-only class + CSS + panel stamps ---
mp.holdMainDrawerReveal()
assert(classes.has(REVEAL_HOLD), 'T1: hold adds reveal-hold class')
assert(!classes.has(RESTORE_PENDING), 'T1: hold does NOT add restore-pending (gate must stay off)')
assert(mp.isMainDrawerRevealHeld() === true, 'T1: isMainDrawerRevealHeld true')
assert(mp.isMainDrawerVisualGuardActive() === true, 'T1: visual guard active')
assert(styleEl != null && styleEl!.textContent.includes(REVEAL_HOLD), 'T1: hold CSS injected')
assert(
  panelNodes.every((n) => n._props.get('visibility') === 'hidden' && n._props.get('opacity') === '0'),
  'T1: panel bodies inline-stamped while held',
)
// Live-verify #5: the pinned secondary strip lives on a body-level pin host
// OUTSIDE `.sidebar-ux-secondary-wrapper` — the hold must hide it too or the
// serial placement loop's button-by-button appends stay visible.
{
  const css = styleEl?.textContent ?? ''
  const holdStart = css.indexOf(REVEAL_HOLD)
  const restoreSection = css.slice(0, holdStart)
  const holdSection = css.slice(holdStart)
  assert(
    holdStart !== -1 && holdSection.includes('.sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"]'),
    'T1: reveal-hold CSS covers the pinned secondary strip',
  )
  assert(
    restoreSection.includes('.sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"]'),
    'T1: restore guard also covers the pinned secondary strip (boot parity)',
  )
  assert(
    restoreSection.includes('.sidebar-ux-secondary-wrapper'),
    'T1: restore guard hides the secondary shell during the boot window',
  )
  // Reveal fade (live-verify #5 polish): keyframes + the class selector for
  // shells + pinned secondary strip.
  assert(css.includes('@keyframes sidebar-ux-reveal-fade-in'), 'T1: reveal fade keyframes injected')
  assert(css.includes(`.${REVEAL_IN} .sidebar-ux-secondary-wrapper`), 'T1: reveal fade covers the secondary shell')
  // live-verify #12: the boot-only companion class fades the MAIN pin strip
  // (the only visible chrome when no drawers are open).
  assert(
    css.includes(`.${REVEAL_IN_MAIN} .sidebar-ux-tab-list-pin-host[data-pin-owner="main"]`),
    'T1: boot reveal fade covers the main pinned strip',
  )
  // Secondary placement gate (live-verify #5 final): a slow boot pass must
  // not let the panel paint before its tab strip.
  assert(
    css.includes(`.${SECONDARY_HOLD} .sidebar-ux-secondary-wrapper`) &&
    css.includes(`.${SECONDARY_HOLD} .sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"]`),
    'T1: secondary placement gate CSS covers shell + pinned strip',
  )
  assert(
    css.includes(`.${SECONDARY_REVEAL} .sidebar-ux-secondary-wrapper`),
    'T1: late-release secondary fade CSS present',
  )
}

// --- T2: restore-path unsuppress is deferred while held ---
mp.unsuppressMainDrawer()
assert(classes.has(REVEAL_HOLD), 'T2: unsuppress deferred — hold class survives')
assert(mp.isMainDrawerRevealHeld() === true, 'T2: still held after unsuppress')

// --- T3: nested holds stay held until the last release ---
mp.holdMainDrawerReveal()
assert(mp.isMainDrawerRevealHeld() === true, 'T3: nested hold active')
mp.releaseMainDrawerReveal()
assert(mp.isMainDrawerRevealHeld() === true, 'T3: one release of two — still held')
assert(classes.has(REVEAL_HOLD), 'T3: class still present while nested hold remains')

// --- T4: final release lifts everything + starts the one-shot reveal fade ---
mp.releaseMainDrawerReveal()
assert(mp.isMainDrawerRevealHeld() === false, 'T4: hold released')
assert(!classes.has(REVEAL_HOLD), 'T4: hold class removed')
assert(mp.isMainDrawerVisualGuardActive() === false, 'T4: visual guard inactive')
assert(
  panelNodes.every((n) => !n._props.has('visibility') && !n._props.has('opacity')),
  'T4: panel inline stamps cleared on release',
)
assert(classes.has(REVEAL_IN), 'T4: reveal fade class added on release')
// live-verify #12: a MID-SESSION release leaves the main strip visible
// throughout — the boot-only companion must NOT be added (it would restart
// a visible strip from opacity 0).
assert(!classes.has(REVEAL_IN_MAIN), 'T4: mid-session release does not fade the main strip')

// --- T4b: the reveal fade class auto-removes after the animation window ---
await new Promise((r) => setTimeout(r, 280))
assert(!classes.has(REVEAL_IN), 'T4b: reveal fade class auto-removed')
assert(!classes.has(REVEAL_IN_MAIN), 'T4b: main strip companion class absent')

// --- T5: release with no active hold is a no-op ---
mp.releaseMainDrawerReveal()
assert(mp.isMainDrawerRevealHeld() === false, 'T5: extra release no-op')
assert(!classes.has(REVEAL_IN), 'T5: no-op release does not start a fade')

// --- T6: settle helper resolves (stopped watcher fast-path) ---
{
  let resolved = false
  await mp.waitForMainContentSettled(100)
  resolved = true
  assert(resolved, 'T6: waitForMainContentSettled resolves')
}

// --- T7: teardown clears a stranded hold + a pending reveal fade ---
mp.startMainDrawerPersistence()
mp.holdMainDrawerReveal()
mp.holdMainDrawerReveal()
assert(mp.isMainDrawerRevealHeld() === true, 'T7: hold active before teardown')
mp.releaseMainDrawerReveal()
mp.releaseMainDrawerReveal()
assert(classes.has(REVEAL_IN), 'T7: reveal fade active before teardown')
mp.stopMainDrawerPersistence()
assert(mp.isMainDrawerRevealHeld() === false, 'T7: teardown cleared the hold')
assert(!classes.has(REVEAL_HOLD), 'T7: teardown removed the hold class')
assert(!classes.has(REVEAL_IN), 'T7: teardown removed the pending reveal fade class/timer')

// --- T8: the BOOT reveal (restore-guard lift) also plays the fade ---
// Hard refresh: drawers stay hidden behind sidebar-ux-main-restore-pending for
// the boot restore window, then unsuppressMainDrawer reveals them. That reveal
// must fade too (the earlier fix only covered the mid-session hold release).
mp.startMainDrawerPersistence()
mp.suppressMainDrawer()
assert(classes.has(RESTORE_PENDING), 'T8: restore guard active before reveal')
assert(!classes.has(REVEAL_IN), 'T8: no fade while the guard holds')
assert(!classes.has(REVEAL_IN_MAIN), 'T8: no main-strip fade while the guard holds')
mp.unsuppressMainDrawer()
assert(!classes.has(RESTORE_PENDING), 'T8: restore guard lifted')
assert(classes.has(REVEAL_IN), 'T8: boot reveal plays the fade')
// live-verify #12: the boot reveal also fades the MAIN pin strip (the guard
// had hidden it; with no drawers open it is the only visible chrome).
assert(classes.has(REVEAL_IN_MAIN), 'T8: boot reveal fades the main pin strip')
// Auto-remove, then prove an idempotent unsuppress (guard already gone) does
// NOT start a second fade.
await new Promise((r) => setTimeout(r, 280))
assert(!classes.has(REVEAL_IN), 'T8: boot fade auto-removes')
assert(!classes.has(REVEAL_IN_MAIN), 'T8: main-strip fade auto-removes')
mp.unsuppressMainDrawer()
assert(!classes.has(REVEAL_IN), 'T8: idempotent unsuppress does not restart the fade')
assert(!classes.has(REVEAL_IN_MAIN), 'T8: idempotent unsuppress does not restart the main-strip fade')
mp.stopMainDrawerPersistence()
assert(!classes.has(REVEAL_IN), 'T8: teardown clears the boot fade')
assert(!classes.has(REVEAL_IN_MAIN), 'T8: teardown clears the main-strip fade')

// --- T8b: teardown while the BOOT fade is still pending clears both classes ---
mp.startMainDrawerPersistence()
mp.suppressMainDrawer()
mp.unsuppressMainDrawer()
assert(classes.has(REVEAL_IN) && classes.has(REVEAL_IN_MAIN), 'T8b: boot fade active before teardown')
mp.stopMainDrawerPersistence()
assert(!classes.has(REVEAL_IN) && !classes.has(REVEAL_IN_MAIN), 'T8b: teardown clears both boot fade classes')

// --- T9: secondary placement gate (live-verify #5 final) ---
// The boot placement pass can outlive the capped main reveal; the second
// drawer + pinned strip stay hidden until it settles. A late release (main
// already visible) gets a secondary-only fade.
mp.startMainDrawerPersistence()
mp.holdSecondaryPlacementReveal()
mp.holdSecondaryPlacementReveal()
assert(classes.has(SECONDARY_HOLD), 'T9: gate class added (nested)')
mp.releaseSecondaryPlacementReveal()
assert(classes.has(SECONDARY_HOLD), 'T9: one release of two — still gated')
// Release while the boot restore guard owns visibility: drop the class, no
// secondary-only fade (the guard's reveal fades both drawers).
mp.suppressMainDrawer()
mp.releaseSecondaryPlacementReveal()
assert(!classes.has(SECONDARY_HOLD), 'T9: gate lifted at zero holds')
assert(!classes.has(SECONDARY_REVEAL), 'T9: no secondary fade while the boot guard owns visibility')
mp.unsuppressMainDrawer()
// Late release after the main is visible → secondary-only fade.
mp.holdSecondaryPlacementReveal()
mp.releaseSecondaryPlacementReveal()
assert(classes.has(SECONDARY_REVEAL), 'T9: late release plays the secondary-only fade')
await new Promise((r) => setTimeout(r, 280))
assert(!classes.has(SECONDARY_REVEAL), 'T9: secondary fade auto-removes')
mp.stopMainDrawerPersistence()
assert(!classes.has(SECONDARY_HOLD), 'T9: teardown clears the gate class')
assert(!classes.has(SECONDARY_REVEAL), 'T9: teardown clears a pending secondary fade')

// --- T10: boot primary re-assert suppresses the open side effect ---
// ensureRestoredPrimaryTab is a CONTENT re-assert run by the boot placement
// pass (and its +500ms retry) AFTER restoreMainDrawerFromDom honored the
// persisted open state. It must pass `open:false` through the mirror restore
// activation or a persisted-closed drawer reopens on every refresh.
{
  const src = readFileSync(join(process.cwd(), 'src/sidebar/main-persist.ts'), 'utf8')
  const start = src.indexOf('export function ensureRestoredPrimaryTab')
  const body = start !== -1 ? src.slice(start, start + 1200) : ''
  assert(start !== -1, 'T10: ensureRestoredPrimaryTab present')
  assert(
    /clickRestoredPrimaryTab\(\s*targetTabId,\s*isMainMirrorActive\(\),\s*\{\s*open:\s*false\s*\}\s*\)/.test(body),
    'T10: ensureRestoredPrimaryTab passes open:false (content re-assert never opens)',
  )
}

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
