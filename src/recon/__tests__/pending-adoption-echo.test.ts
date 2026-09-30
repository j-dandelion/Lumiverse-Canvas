// Pending-adoption echo guard (2026-09): clicking a pinned-strip secondary
// tab while the drawer is closed opened the LAST-OPENED tab instead of the
// clicked one.
//
// Root cause: the click handler activates in two steps — openSecondarySidebar
// dispatches setDrawer(open) FIRST (queued), then showSecondaryTab writes the
// tracked active (its syncActive adoption dispatch queued second). The
// setDrawer reconcile runs before the adoption and its diffActive echoes the
// STALE model active (the last-adopted tab) into the chrome via
// host.activate('secondary', …), clobbering the user's click. The adoption
// then lands, sees model == tracked, and never re-echoes — the DOM is the
// only thing left stale.
//
// Fix: diffActive suppresses the secondary model→chrome echo while the
// tracked active (getActiveSecondaryTabId) is non-null and differs from the
// model's (by resolved key) — that window is exactly "a tracked write is
// pending adoption; the syncActive dispatch is already queued". Invariant:
// silent reconcile echoes write the tracked cell to the model's value, and
// unassign clears it, so tracked ≠ model ⟺ pending adoption.
//
// These tests drive reconcile() DIRECTLY (real diffActive + real tracked
// cell) against the FakeHost — no dispatch queue, so the guard is isolated.

;(globalThis as any).document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({}),
  getElementById: () => null,
  documentElement: {
    classList: { add() {}, remove() {}, contains() { return false } },
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
  },
  body: { appendChild() {}, removeChild() {} },
}
;(globalThis as any).window = {
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
;(globalThis as any).requestAnimationFrame = (cb: any) => { cb(1); return 1 }
;(globalThis as any).cancelAnimationFrame = () => {}
;(globalThis as any).CSS = { escape: (s: string) => s }
;(globalThis as any).getComputedStyle = () => ({})

import { FakeHost, type LiveTab } from '../../host/fake/implementation'
import { reconcile } from '../reconcile'
import {
  createEmptyModel,
  builtinKey,
  extensionKey,
  type LayoutModel,
  type TabKey,
  type Side,
} from '../../core/model'
import { setActiveSecondaryTabId, getActiveSecondaryTabId } from '../../tabs/active-tab'

const PROFILE = builtinKey('profile')
const A = extensionKey('ext', 'a')
const B = extensionKey('ext', 'b')
const C = extensionKey('ext', 'c')

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

function makeLiveTab(key: TabKey, liveId: string, location: Side, overrides?: Partial<LiveTab>): LiveTab {
  return {
    key, liveId, location,
    hidden: false,
    activeInPrimary: false,
    activeInSecondary: false,
    hasContentRoot: true,
    isBuiltin: key.startsWith('builtin:'),
    ...overrides,
  }
}

// Simulate the click's effect on the observed world: B is NOT active (the
// tracked cell says C now), all tabs placed, order matches the model.
function clickWorldHost(): FakeHost {
  return new FakeHost([
    makeLiveTab(PROFILE, 'profile', 'primary', { activeInPrimary: true }),
    makeLiveTab(A, 'h:a', 'secondary'),
    makeLiveTab(B, 'h:b', 'secondary'),
    makeLiveTab(C, 'h:c', 'secondary'),
  ])
}

// Stale model: the last-ADOPTED active is B; the user's click (tracked=C)
// has not been adopted yet — the exact state when the setDrawer(open)
// dispatch's reconcile runs.
function staleModel(): LayoutModel {
  return {
    ...createEmptyModel(),
    primary: [PROFILE],
    secondary: [A, B, C],
    active: { primary: PROFILE, secondary: B },
  }
}

function secondaryActive(host: FakeHost, liveId: string): boolean {
  // Observed-world tabs carry isActiveInSecondary (a copy of the FakeHost's
  // internal activeInSecondary at observe time).
  return host.observe().tabs.find((t) => t.liveId === liveId)?.isActiveInSecondary ?? false
}

// ── G1: pending tracked write suppresses the stale echo ──
{
  const host = clickWorldHost()
  setActiveSecondaryTabId('h:c', { silent: true }) // the user's click
  const report = await reconcile(staleModel(), host)

  // No secondary activation write at all (the echo would have re-shown B).
  const activationStep = report.steps.find((s) => s.step === 'activation')
  assertEqual(activationStep?.ops ?? -1, 0, 'G1: no activation ops (echo suppressed)')
  assert(!secondaryActive(host, 'h:b'), 'G1: B not re-activated over the clicked tab')
  assert(!secondaryActive(host, 'h:c'), 'G1: C untouched (tracked, not echoed)')
}

// ── G2: control — tracked matches the model → echo still fires ──
{
  const host = clickWorldHost()
  setActiveSecondaryTabId('h:b', { silent: true }) // tracked == model (already adopted)
  const report = await reconcile(staleModel(), host)

  const activationStep = report.steps.find((s) => s.step === 'activation')
  assertEqual(activationStep?.ops ?? -1, 1, 'G2: echo fires when tracked == model')
  assert(secondaryActive(host, 'h:b'), 'G2: B activated (model authoritative)')
}

// ── G3: control — no tracked write (null) → echo fires (restore/legacy) ──
{
  const host = clickWorldHost()
  setActiveSecondaryTabId(null)
  const report = await reconcile(staleModel(), host)

  const activationStep = report.steps.find((s) => s.step === 'activation')
  assertEqual(activationStep?.ops ?? -1, 1, 'G3: echo fires when tracked is null')
  assert(secondaryActive(host, 'h:b'), 'G3: B activated (no pending adoption)')
}

// ── G4: guard is inert when the tracked tab is not resolvable ──
// (conservative: the diff degrades to the old echo behavior, never a crash)
{
  const host = clickWorldHost()
  setActiveSecondaryTabId('ghost-id', { silent: true }) // not in `resolved`
  const report = await reconcile(staleModel(), host)

  const activationStep = report.steps.find((s) => s.step === 'activation')
  assertEqual(activationStep?.ops ?? -1, 1, 'G4: unresolvable tracked does not suppress')
  assert(secondaryActive(host, 'h:b'), 'G4: B activated (echo proceeds)')
}

setActiveSecondaryTabId(null)

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)