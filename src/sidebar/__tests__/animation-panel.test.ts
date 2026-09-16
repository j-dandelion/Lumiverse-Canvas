// Horizontal-strip panel bloom (src/sidebar/animation.ts) — controllable rAF
// clock. Covers the wrapper's structural snap, the drawer/panel channel
// end-states and cleanup, interruption continuity, duplicate-close
// idempotence, cancel semantics and the reduced-motion instant path.
//
// Custom assertion harness — run by scripts/test-runner.sh via `bun run`
// (no bun:test here on purpose).
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual === expected) {
    passed++
  } else {
    console.error(`FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}
function assertNear(actual: number, expected: number, message: string, eps = 1e-6) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= eps) {
    passed++
  } else {
    console.error(`FAIL: ${message} — expected ~${expected}, got ${actual}`)
    failed++
  }
}

import {
  PANEL_ANIMATING_ATTR,
  PANEL_CLOSE_MS,
  PANEL_ENTER_PX,
  PANEL_EXIT_PX,
  PANEL_OPEN_MS,
  PANEL_SCALE,
  PANEL_UI_FROM,
  __getAnimState,
  __getPanelAnimState,
  animatePanelToggle,
  animateWrapper,
  cancelWrapperAnimation,
  computePanelAnchor,
  isPanelAnimating,
  whenPanelMotionSettles,
} from '../animation'

// ── Controllable rAF clock ──
let rafId = 0
const rafCbs = new Map<number, (t: number) => void>()
;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => {
  rafId++
  rafCbs.set(rafId, cb)
  return rafId
}
;(globalThis as any).cancelAnimationFrame = (id: number) => {
  rafCbs.delete(id)
}
/** Run the callbacks scheduled so far at timestamp `t`. */
function flush(t: number) {
  const cbs = [...rafCbs.values()]
  rafCbs.clear()
  for (const cb of cbs) cb(t)
}

// ── Env ──
;(globalThis as any).window = { matchMedia: () => ({ matches: false }) }

interface FakeDrawer {
  drawer: HTMLElement
  panel: Record<string, string>
}
function makeDrawer(withPanel = true): FakeDrawer {
  const panel: Record<string, string> = {}
  const style: Record<string, string> = {}
  const drawer = {
    style,
    querySelector: (sel: string) => (withPanel && sel === '.sidebar-ux-panel' ? { style: panel } : null),
  } as unknown as HTMLElement
  return { drawer, panel }
}
function makeWrapper(transform = ''): HTMLElement {
  const attrs = new Set<string>()
  return {
    style: { transform },
    setAttribute: (name: string) => { attrs.add(name) },
    removeAttribute: (name: string) => { attrs.delete(name) },
    hasAttribute: (name: string) => attrs.has(name),
  } as unknown as HTMLElement
}
function px(v: string): number {
  return parseFloat(v)
}

// ── 1. Tokens ──
assert(PANEL_OPEN_MS >= 180, 'open stays deliberate')
assert(PANEL_CLOSE_MS >= 180, 'close fade is no longer rushed (user feedback 2026-09-15)')
assert(PANEL_ENTER_PX > PANEL_EXIT_PX, 'enter tuck is larger than the exit tuck')
assert(PANEL_SCALE < 1 && PANEL_SCALE > 0.95, 'scale stays a subtle shrink')
assert(PANEL_UI_FROM > 0 && PANEL_UI_FROM < 1, 'UI lag channel starts partially visible')

// ── 2. Open: structural snap + full cleanup after settle (top rail) ──
{
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer, panel } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: true, edge: 'top' })

  assertEqual(wrapper.style.transform, 'translateX(0)', 'open snaps the wrapper structurally pre-paint')
  assertEqual(drawer.style.opacity, '0', 'open starts transparent')
  assertEqual(
    drawer.style.transform,
    `translateY(${-PANEL_ENTER_PX}px) scale(${PANEL_SCALE})`,
    'top rail: panel starts tucked UNDER the strip',
  )
  assertEqual(drawer.style.transformOrigin, '50% 0%', 'top origin is the rail edge')
  assertEqual(panel.opacity, String(PANEL_UI_FROM), 'UI layer starts dimmer (resolves last)')
  assertEqual(drawer.style.pointerEvents, 'none', 'no clicks mid-bloom')
  assertEqual(drawer.style.willChange, 'opacity, transform', 'compositor hint set')
  assert(__getPanelAnimState(wrapper).panelRaf !== null, 'bloom frame scheduled')

  flush(0)
  flush(PANEL_OPEN_MS / 2)
  flush(PANEL_OPEN_MS)

  assertEqual(__getPanelAnimState(wrapper).panelRaf, null, 'settled after the open duration')
  assertEqual(drawer.style.opacity, '', 'opacity reset at settle')
  assertEqual(drawer.style.transform, '', 'transform reset at settle')
  assertEqual(drawer.style.transformOrigin, '', 'origin reset at settle')
  assertEqual(drawer.style.willChange, '', 'will-change cleared (no fixed-containing-block leak)')
  assertEqual(drawer.style.pointerEvents, 'auto', 'interaction restored to the construction value')
  assertEqual(panel.opacity, '', 'UI lag channel cleared')
  assertEqual(wrapper.style.transform, 'translateX(0)', 'wrapper stays open after settle')
  assertEqual(__getAnimState(wrapper).animRaf, null, 'no translate tween ran')
}

// ── 3. Bottom rail: mirrored sign + origin ──
{
  const wrapper = makeWrapper('translateX(0)')
  const { drawer } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: true, edge: 'bottom' })
  assertEqual(
    drawer.style.transform,
    `translateY(${PANEL_ENTER_PX}px) scale(${PANEL_SCALE})`,
    'bottom rail mirrors the tuck direction',
  )
  assertEqual(drawer.style.transformOrigin, '50% 100%', 'bottom origin is the rail edge')
  cancelWrapperAnimation(wrapper)
}

// ── 4. Close WITHOUT an anchor: pure fade, no transform movement (OS close) ──
{
  const wrapper = makeWrapper('translateX(0)')
  const { drawer, panel } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: false, edge: 'top', closedPx: 420 })
  assertEqual(wrapper.style.transform, 'translateX(0)', 'close keeps the wrapper in place during the fade')
  assertEqual(drawer.style.pointerEvents, 'none', 'closing panel is non-interactive')
  assertEqual(
    drawer.style.transform,
    'translateY(0px) scale(1)',
    'no associated button → no transform movement',
  )
  flush(0)
  flush(PANEL_CLOSE_MS / 2)
  assertEqual(drawer.style.transform, 'translateY(0px) scale(1)', 'still no movement mid-fade')
  flush(PANEL_CLOSE_MS)
  assertEqual(wrapper.style.transform, 'translateX(420px)', 'settle applies the structural closed transform')
  assertEqual(drawer.style.opacity, '', 'close resets inline styles')
  assertEqual(drawer.style.transform, '', 'close resets the transform')
  assertEqual(drawer.style.pointerEvents, 'auto', 'interaction restored')
  assertEqual(panel.opacity, '', 'panel channel reset')
  assertEqual(__getPanelAnimState(wrapper).panelRaf, null, 'no frame left')
}

// ── 4b. Anchored close: origin at the button, movement toward it ──
{
  const anchor = { x: 22, y: -4 }
  const wrapper = makeWrapper('translateX(0)')
  const { drawer } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: false, edge: 'bottom', closedPx: 420, anchor })
  assertEqual(drawer.style.transformOrigin, '22% -4%', 'anchored close uses the button origin')
  flush(0)
  flush(PANEL_CLOSE_MS / 2)
  assert(drawer.style.transform.startsWith('translateY('), 'anchored close moves')
  assert(
    !drawer.style.transform.includes('translateY(0px)'),
    'anchored close is not a pure fade',
  )
  assert(drawer.style.transform.includes('scale(0.9'), 'anchored close shrinks toward the button')
  flush(PANEL_CLOSE_MS)
  assertEqual(wrapper.style.transform, 'translateX(420px)', 'anchored close settles closed')
  assertEqual(drawer.style.transformOrigin, '', 'origin reset at settle')

  // Anchored open mirrors: origin at the button, grow out of the rail.
  const wrapper2 = makeWrapper('translateX(420px)')
  const d2 = makeDrawer()
  animatePanelToggle(wrapper2, d2.drawer, { open: true, edge: 'top', anchor })
  assertEqual(d2.drawer.style.transformOrigin, '22% -4%', 'anchored open uses the button origin')
  assertEqual(
    d2.drawer.style.transform,
    `translateY(${-PANEL_ENTER_PX}px) scale(${PANEL_SCALE})`,
    'anchored open still tucks under the rail',
  )
  flush(0)
  flush(PANEL_OPEN_MS)
  assertEqual(d2.drawer.style.transformOrigin, '', 'origin reset after the anchored open')
}

// ── 4c. computePanelAnchor — percentages, external points, zero-size guard ──
{
  const drawer = { left: 0, top: 56, width: 420, height: 800 }
  const button = { left: 100, top: 8, width: 48, height: 48 }
  const a = computePanelAnchor(button, drawer)
  assert(a !== null, 'anchor computed for a measurable drawer')
  assertNear(a!.x, ((124 - 0) / 420) * 100, 'anchor x = button center relative to the drawer')
  assertNear(a!.y, ((32 - 56) / 800) * 100, 'anchor y may be negative (button on the rail)')
  assertEqual(
    computePanelAnchor(button, { left: 0, top: 0, width: 0, height: 0 }),
    null,
    'zero-size drawer → no anchor',
  )
}

// ── 5. Interruption: close mid-open continues from the current pose ──
{
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: true, edge: 'top' })
  flush(0)
  flush(100) // t = 0.5 of 200ms → easeOutCubic(.5) = .875
  const mid = px(drawer.style.opacity)
  assert(mid > 0 && mid < 1, 'mid-bloom opacity is fractional')

  animatePanelToggle(wrapper, drawer, { open: false, edge: 'top', closedPx: 420 })
  flush(100) // first close frame at the same clock → t = 0, pose must equal the capture
  assertNear(px(drawer.style.opacity), mid, 'close continues from the captured opacity (no pop)')

  flush(100 + PANEL_CLOSE_MS)
  assertEqual(wrapper.style.transform, 'translateX(420px)', 'interrupted close still settles closed')
  assertEqual(drawer.style.opacity, '', 'interrupted close resets styles')
}

// ── 6. Duplicate close: close-during-close is a no-op; settled close never slides ──
{
  const wrapper = makeWrapper('translateX(0)')
  const { drawer } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: false, edge: 'top', closedPx: 420 })
  flush(0)
  flush(PANEL_CLOSE_MS / 2)
  const mid = drawer.style.opacity
  animatePanelToggle(wrapper, drawer, { open: false, edge: 'top', closedPx: 420 })
  assertEqual(drawer.style.opacity, mid, 'close during close leaves the live frame untouched')
  flush(PANEL_CLOSE_MS)
  assertEqual(wrapper.style.transform, 'translateX(420px)', 'first close settled')

  // The killer regression: a redundant close on a settled-closed drawer must
  // NOT fall through to animateWrapper (350ms slide of an off-screen shell).
  animatePanelToggle(wrapper, drawer, { open: false, edge: 'top', closedPx: 420 })
  assertEqual(__getPanelAnimState(wrapper).panelRaf, null, 'no bloom for a settled close')
  assertEqual(__getAnimState(wrapper).animRaf, null, 'no translate slide for a settled close')
  assertEqual(wrapper.style.transform, 'translateX(420px)', 'settled transform untouched')
}

// ── 7. Cancel resets both channels and stops writing ──
{
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer, panel } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: true, edge: 'bottom' })
  flush(0)
  flush(80)
  cancelWrapperAnimation(wrapper)
  assertEqual(drawer.style.opacity, '', 'cancel resets opacity')
  assertEqual(drawer.style.transform, '', 'cancel resets transform')
  assertEqual(drawer.style.transformOrigin, '', 'cancel resets origin')
  assertEqual(drawer.style.willChange, '', 'cancel clears will-change')
  assertEqual(drawer.style.pointerEvents, 'auto', 'cancel restores interaction')
  assertEqual(panel.opacity, '', 'cancel resets the UI channel')
  assertEqual(__getPanelAnimState(wrapper).panelRaf, null, 'cancel clears the frame')

  const before = drawer.style.opacity
  flush(999)
  assertEqual(drawer.style.opacity, before, 'no writes after cancel')
}

// ── 8. Translate entry settles a live bloom (cross-mode safety) ──
{
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: true, edge: 'top' })
  flush(0)
  animateWrapper(wrapper, 420)
  assertEqual(drawer.style.opacity, '', 'translate tween entry settles the live bloom')
  assertEqual(drawer.style.pointerEvents, 'auto', 'interaction restored on the cross-mode settle')
  assert(__getAnimState(wrapper).animRaf !== null, 'translate tween runs')
  flush(0)
  flush(350)
}

// ── 9. Reduced motion: instant end states, no rAF, no leftovers ──
{
  ;(globalThis as any).window = { matchMedia: () => ({ matches: true }) }
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer, panel } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: true, edge: 'top' })
  assertEqual(wrapper.style.transform, 'translateX(0)', 'RM open is instant')
  assertEqual(drawer.style.opacity, '', 'RM open has no inline leftovers')
  assertEqual(drawer.style.pointerEvents, 'auto', 'RM open restores interaction')
  assertEqual(panel.opacity, '', 'RM open leaves no UI channel')
  assertEqual(drawer.style.willChange, '', 'RM open sets no will-change')
  assertEqual(__getPanelAnimState(wrapper).panelRaf, null, 'RM open schedules no rAF')

  const wrapper2 = makeWrapper('translateX(0)')
  const d2 = makeDrawer()
  animatePanelToggle(wrapper2, d2.drawer, { open: false, edge: 'bottom', closedPx: 420 })
  assertEqual(wrapper2.style.transform, 'translateX(420px)', 'RM close is instant')
  assertEqual(d2.drawer.style.opacity, '', 'RM close resets inline styles')
  assertEqual(__getPanelAnimState(wrapper2).panelRaf, null, 'RM close schedules no rAF')
  ;(globalThis as any).window = { matchMedia: () => ({ matches: false }) }
}

// ── 10. Drawer without a panel element is safe ──
{
  const wrapper = makeWrapper('translateX(0)')
  const { drawer } = makeDrawer(false)
  animatePanelToggle(wrapper, drawer, { open: true, edge: 'top' })
  assert(__getPanelAnimState(wrapper).panelRaf !== null, 'bloom runs without a panel node')
  cancelWrapperAnimation(wrapper)
  assertEqual(drawer.style.opacity, '', 'reset is safe without a panel node')
}

// ── 11. Animating hook + settle listeners (OS parking deferral) ──
{
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer } = makeDrawer()
  let immediate = 0
  whenPanelMotionSettles(wrapper, () => immediate++)
  assertEqual(immediate, 1, 'settle listener with no motion runs immediately')

  assertEqual(isPanelAnimating(wrapper), false, 'no motion initially')
  animatePanelToggle(wrapper, drawer, { open: true, edge: 'top' })
  assertEqual(isPanelAnimating(wrapper), true, 'motion in flight')
  assertEqual(wrapper.hasAttribute(PANEL_ANIMATING_ATTR), true, 'animating attribute set')

  let settled = 0
  whenPanelMotionSettles(wrapper, () => settled++)
  assertEqual(settled, 0, 'settle listener waits for the motion')
  flush(0)
  flush(PANEL_OPEN_MS)
  assertEqual(isPanelAnimating(wrapper), false, 'motion settled')
  assertEqual(settled, 1, 'settle listener fired exactly once')
  assertEqual(wrapper.hasAttribute(PANEL_ANIMATING_ATTR), false, 'animating attribute cleared')

  // Cancel also notifies (parking callbacks re-check the live state).
  const w2 = makeWrapper('translateX(0)')
  const d2 = makeDrawer()
  animatePanelToggle(w2, d2.drawer, { open: false, edge: 'top', closedPx: 420 })
  let cancelled = 0
  whenPanelMotionSettles(w2, () => cancelled++)
  cancelWrapperAnimation(w2)
  assertEqual(cancelled, 1, 'cancel notifies settle listeners')
  assertEqual(w2.hasAttribute(PANEL_ANIMATING_ATTR), false, 'cancel clears the animating attribute')
}

// ── 12. Interruption drops the superseded settle listeners ──
{
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer } = makeDrawer()
  animatePanelToggle(wrapper, drawer, { open: true, edge: 'top' })
  let stale = 0
  whenPanelMotionSettles(wrapper, () => stale++)
  flush(0)
  flush(PANEL_OPEN_MS / 2)
  animatePanelToggle(wrapper, drawer, { open: false, edge: 'top', closedPx: 420 })
  flush(PANEL_OPEN_MS / 2)
  flush(PANEL_OPEN_MS / 2 + PANEL_CLOSE_MS)
  assertEqual(stale, 0, 'a superseded motion never fires its listeners')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
