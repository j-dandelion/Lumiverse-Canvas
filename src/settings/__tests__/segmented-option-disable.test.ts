// LUMI-44 UI half: the Drawer-layout segmented control must be able to
// disable a single option. On a mobile viewport (≤600px) Sides is never a
// valid active drawer location — the settings layer coerces it to the
// remembered Top/Bottom choice — so the panel disables the Sides option
// (setOptionDisabled) instead of offering a control that silently bounces
// back. This test pins buildSegmentedControl's per-option disable contract.

// Headless document stub: just enough element surface for
// buildSegmentedControl (createElement, classList.toggle, setAttribute,
// addEventListener, appendChild, textContent, disabled, tabIndex).
type AnyEl = any
function makeEl(tag: string): AnyEl {
  const listeners: Record<string, Array<(e: any) => void>> = {}
  const attrs: Record<string, string> = {}
  const classes = new Set<string>()
  const el: AnyEl = {
    tagName: tag.toUpperCase(),
    textContent: '',
    className: '',
    disabled: false,
    tabIndex: 0,
    type: '',
    children: [] as AnyEl[],
    parentElement: null as AnyEl | null,
    classList: {
      add: (...cs: string[]) => { for (const c of cs) classes.add(c) },
      remove: (...cs: string[]) => { for (const c of cs) classes.delete(c) },
      toggle: (c: string, force?: boolean) => {
        if (force === undefined) force = !classes.has(c)
        if (force) classes.add(c); else classes.delete(c)
        return force
      },
      contains: (c: string) => classes.has(c),
    },
    attrs,
    listeners,
    appendChild(child: AnyEl) {
      el.children.push(child)
      child.parentElement = el
      return child
    },
    setAttribute(k: string, v: string) { attrs[k] = String(v) },
    getAttribute(k: string) { return attrs[k] ?? null },
    addEventListener(type: string, fn: (e: any) => void) {
      (listeners[type] ||= []).push(fn)
    },
    removeEventListener() {},
    focus() {},
    click() {
      if (el.disabled) return
      for (const fn of listeners['click'] ?? []) fn({})
    },
  }
  return el
}
;(globalThis as any).document = {
  createElement: (tag: string) => makeEl(tag),
  getElementById: () => null,
  body: makeEl('body'),
  addEventListener() {},
  removeEventListener() {},
}

import { mock } from 'bun:test'
// render.ts's only import — mock to a leaf so no motion/DOM chain loads.
mock.module('../../os/start-menu-motion', () => ({
  getUiScale: () => 1,
}))

const { buildSegmentedControl } = await import('../render')

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

// ── Per-option disable contract ──
{
  const changes: string[] = []
  const ctl = buildSegmentedControl<'sides' | 'top' | 'bottom'>(
    [
      { value: 'sides' as const, label: 'Sides' },
      { value: 'top' as const, label: 'Top' },
      { value: 'bottom' as const, label: 'Bottom' },
    ],
    'top',
    (v) => { changes.push(v) },
  )
  const btns = ctl.root.children as AnyEl[]
  const sidesBtn = btns.find((b: AnyEl) => b.textContent === 'Sides')
  const topBtn = btns.find((b: AnyEl) => b.textContent === 'Top')

  // Baseline: everything enabled; clicking works.
  assertEqual(sidesBtn.disabled, false, 'baseline: Sides option enabled')
  sidesBtn.click()
  assertEqual(changes.length, 1, 'baseline: clicking Sides fires onChange')

  // Disable Sides only: click suppressed, other options unaffected.
  ctl.setOptionDisabled('sides', true)
  assertEqual(sidesBtn.disabled, true, 'disabled: Sides button disabled')
  assertEqual(sidesBtn.getAttribute('aria-disabled'), 'true', 'disabled: aria-disabled set on Sides')
  assertEqual(topBtn.disabled, false, 'disabled: Top unaffected')
  changes.length = 0
  sidesBtn.click()
  assertEqual(changes.length, 0, 'disabled: clicking Sides does not fire onChange')
  topBtn.click()
  assertEqual(changes.length, 1, 'disabled: clicking Top still fires onChange')

  // Re-enable: Sides clickable again.
  ctl.setOptionDisabled('sides', false)
  assertEqual(sidesBtn.disabled, false, 're-enabled: Sides clickable again')
  assertEqual(sidesBtn.getAttribute('aria-disabled'), 'false', 're-enabled: aria-disabled cleared')

  // Whole-control disable composes with the per-option set, and re-enabling
  // the control restores per-option state (Sides disabled again here).
  ctl.setOptionDisabled('sides', true)
  ctl.setDisabled(true)
  assertEqual(topBtn.disabled, true, 'control disable disables all options')
  ctl.setDisabled(false)
  assertEqual(topBtn.disabled, false, 'control re-enable restores enabled options')
  assertEqual(sidesBtn.disabled, true, 'control re-enable keeps per-option disabled state')

  // Refresh re-renders without losing per-option state (panel refresh path).
  ctl.refresh('bottom')
  assertEqual(sidesBtn.disabled, true, 'refresh preserves per-option disable')
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
