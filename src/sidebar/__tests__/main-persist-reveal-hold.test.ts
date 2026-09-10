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

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

const RESTORE_PENDING = 'sidebar-ux-main-restore-pending'
const REVEAL_HOLD = 'sidebar-ux-main-reveal-hold'

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

// --- T4: final release lifts everything ---
mp.releaseMainDrawerReveal()
assert(mp.isMainDrawerRevealHeld() === false, 'T4: hold released')
assert(!classes.has(REVEAL_HOLD), 'T4: hold class removed')
assert(mp.isMainDrawerVisualGuardActive() === false, 'T4: visual guard inactive')
assert(
  panelNodes.every((n) => !n._props.has('visibility') && !n._props.has('opacity')),
  'T4: panel inline stamps cleared on release',
)

// --- T5: release with no active hold is a no-op ---
mp.releaseMainDrawerReveal()
assert(mp.isMainDrawerRevealHeld() === false, 'T5: extra release no-op')

// --- T6: settle helper resolves (stopped watcher fast-path) ---
{
  let resolved = false
  await mp.waitForMainContentSettled(100)
  resolved = true
  assert(resolved, 'T6: waitForMainContentSettled resolves')
}

// --- T7: teardown clears a stranded hold ---
mp.startMainDrawerPersistence()
mp.holdMainDrawerReveal()
assert(mp.isMainDrawerRevealHeld() === true, 'T7: hold active before teardown')
mp.stopMainDrawerPersistence()
assert(mp.isMainDrawerRevealHeld() === false, 'T7: teardown cleared the hold')
assert(!classes.has(REVEAL_HOLD), 'T7: teardown removed the hold class')

// ── Summary ──
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
