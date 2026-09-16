// Drawer motion router (src/sidebar/panel-motion.ts) — verifies the mode
// branch: Sides runs the translate tween; Top/Bottom run the rail bloom
// (structural wrapper snap + drawer/panel inline motion). No model/document
// in this harness → anchors resolve to null, which exercises the documented
// fallbacks: rail-centered open, fade-only close.
//
// Custom assertion harness — run by scripts/test-runner.sh via `bun run`.
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

import { hydrateSettings } from '../../settings/state'
import { __getAnimState, __getPanelAnimState, cancelWrapperAnimation } from '../animation'
import {
  __setAnchorForTest,
  animateDrawerClose,
  animateDrawerOpen,
  suppressNextCloseAnchor,
} from '../panel-motion'

// ── rAF / env stubs ──
;(globalThis as any).window = { matchMedia: () => ({ matches: false }) }
let rafId = 0
;(globalThis as any).requestAnimationFrame = () => {
  rafId++
  return rafId
}
;(globalThis as any).cancelAnimationFrame = () => {}

function makeDrawer() {
  const panel: Record<string, string> = {}
  const drawer = {
    style: {} as Record<string, string>,
    querySelector: (sel: string) => (sel === '.sidebar-ux-panel' ? { style: panel } : null),
    getBoundingClientRect: () => ({ left: 0, top: 56, width: 420, height: 800 }),
  } as unknown as HTMLElement
  return { drawer, panel }
}
function makeWrapper(transform = '') {
  const attrs = new Set<string>()
  return {
    style: { transform },
    setAttribute: (name: string) => { attrs.add(name) },
    removeAttribute: (name: string) => { attrs.delete(name) },
  } as unknown as HTMLElement
}

// ── 1. Sides: open uses the translate tween, never the bloom ──
{
  hydrateSettings({ drawerLocation: 'sides' })
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer, panel } = makeDrawer()
  animateDrawerOpen(wrapper, drawer, 'primary')
  assertEqual(__getPanelAnimState(wrapper).panelRaf, null, 'sides open does not bloom')
  assert(__getAnimState(wrapper).animRaf !== null, 'sides open runs the translate tween')
  assertEqual(panel.opacity, undefined, 'sides open never writes the panel channel')
  cancelWrapperAnimation(wrapper)
}

// ── 2. Sides: close uses the translate tween ──
{
  hydrateSettings({ drawerLocation: 'sides' })
  const wrapper = makeWrapper('translateX(0)')
  const { drawer } = makeDrawer()
  animateDrawerClose(wrapper, drawer, 420, 'secondary')
  assertEqual(__getPanelAnimState(wrapper).panelRaf, null, 'sides close does not bloom')
  assert(__getAnimState(wrapper).animRaf !== null, 'sides close runs the translate tween')
  cancelWrapperAnimation(wrapper)
}

// ── 3. Top: open snaps the wrapper and blooms the panel (rail-centered
//      fallback — no model active in this harness) ──
{
  hydrateSettings({ drawerLocation: 'top' })
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer, panel } = makeDrawer()
  animateDrawerOpen(wrapper, drawer, 'primary')
  assertEqual(wrapper.style.transform, 'translateX(0)', 'top open snaps the wrapper structurally')
  assertEqual(drawer.style.opacity, '0', 'top open starts the bloom')
  assertEqual(drawer.style.transformOrigin, '50% 0%', 'unanchored top open uses the rail center')
  assertEqual(panel.opacity, '0.55', 'top open drives the UI lag channel')
  assert(__getPanelAnimState(wrapper).panelRaf !== null, 'top open schedules the bloom')
  assertEqual(__getAnimState(wrapper).animRaf, null, 'top open runs no translate tween')
  cancelWrapperAnimation(wrapper)
}

// ── 4. Bottom: unanchored close is a pure fade (no transform movement) ──
{
  hydrateSettings({ drawerLocation: 'bottom' })
  const wrapper = makeWrapper('translateX(0)')
  const { drawer } = makeDrawer()
  animateDrawerClose(wrapper, drawer, 420, 'secondary')
  assertEqual(drawer.style.transformOrigin, '50% 100%', 'unanchored bottom close uses the rail center')
  assertEqual(
    drawer.style.transform,
    'translateY(0px) scale(1)',
    'no associated button → fade out without moving',
  )
  assert(__getPanelAnimState(wrapper).panelRaf !== null, 'bottom close schedules the fade')
  assertEqual(__getAnimState(wrapper).animRaf, null, 'bottom close runs no translate tween')
  cancelWrapperAnimation(wrapper)
}

// ── 5. Duplicate close in Top mode never starts a translate slide ──
{
  hydrateSettings({ drawerLocation: 'top' })
  const wrapper = makeWrapper('translateX(420px)')
  const { drawer } = makeDrawer()
  animateDrawerClose(wrapper, drawer, 420, 'primary')
  assertEqual(__getPanelAnimState(wrapper).panelRaf, null, 'settled-closed wrapper takes no bloom')
  assertEqual(__getAnimState(wrapper).animRaf, null, 'settled-closed wrapper takes no slide')
}

// ── 6. Anchored close (displayed window's strip button) vs suppressed (OS
//      close: no associated button) ──
{
  hydrateSettings({ drawerLocation: 'top' })
  const button = {
    isConnected: true,
    getAttribute: (name: string) => (name === 'data-tab-id' ? 'live-a' : null),
    closest: () => ({
      getAttribute: (name: string) => (name === 'data-pin-owner' ? 'secondary' : null),
    }),
    getBoundingClientRect: () => ({ left: 100, top: 8, width: 48, height: 48 }),
  }
  ;(globalThis as any).document = { querySelectorAll: () => [button] }

  __setAnchorForTest('secondary', 'key-a', 'live-a')
  const wrapper = makeWrapper('translateX(0)')
  const { drawer } = makeDrawer()
  animateDrawerClose(wrapper, drawer, 420, 'secondary')
  assert(
    drawer.style.transformOrigin.startsWith('29.52'),
    'anchored close uses the button x (button center / drawer width)',
  )
  assert(drawer.style.transformOrigin.endsWith('% -3%'), 'anchored close uses the button y')
  cancelWrapperAnimation(wrapper)

  // suppressNextCloseAnchor (OS close) → the next close fades in place …
  const d2 = makeDrawer()
  const w2 = makeWrapper('translateX(0)')
  suppressNextCloseAnchor('secondary')
  animateDrawerClose(w2, d2.drawer, 420, 'secondary')
  assertEqual(d2.drawer.style.transformOrigin, '50% 0%', 'suppressed close falls back to the rail center')
  assertEqual(
    d2.drawer.style.transform,
    'translateY(0px) scale(1)',
    'suppressed close fades without moving',
  )
  cancelWrapperAnimation(w2)

  // … and the hint is one-shot: the next close anchors again.
  const d3 = makeDrawer()
  const w3 = makeWrapper('translateX(0)')
  animateDrawerClose(w3, d3.drawer, 420, 'secondary')
  assert(d3.drawer.style.transformOrigin.startsWith('29.52'), 'suppression hint is one-shot')
  cancelWrapperAnimation(w3)

  // Opens use the current active window's button.
  __setAnchorForTest('secondary', null, null)
  __setAnchorForTest('primary', 'key-b', 'live-b')
  ;(globalThis as any).document = { querySelectorAll: () => [{
    ...button,
    getAttribute: (name: string) => (name === 'data-tab-id' ? 'live-b' : null),
    closest: () => ({
      getAttribute: (name: string) => (name === 'data-pin-owner' ? 'main' : null),
    }),
  }] }
  const d4 = makeDrawer()
  const w4 = makeWrapper('translateX(420px)')
  animateDrawerOpen(w4, d4.drawer, 'primary')
  assert(d4.drawer.style.transformOrigin.startsWith('29.52'), 'anchored open uses the button origin')
  cancelWrapperAnimation(w4)
  ;(globalThis as any).document = undefined
}

// Reset the shared settings singleton so later suites see defaults.
hydrateSettings(null)

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
