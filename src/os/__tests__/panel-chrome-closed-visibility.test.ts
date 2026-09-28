// OS closed-set visibility re-apply (2026-09-15).
//
// Symptom: enabling the second drawer in OS mode placed tabs after the last
// model commit, so `refreshOsVisibility` had already run — a tab in the
// entering slot's closed set (presets) kept its strip button visible until
// the next commit. `reapplyOsClosedVisibility` (called from the reassign
// drain tail) must merge Canvas-hidden + the OS closed set and hand it to
// the secondary applicator; it must not run when OS mode is off.
// LUMI-26: the host hiddenTabIds list is never merged (Canvas copy is the
// sole hidden-truth input — pitfalls §23).

import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.error('FAIL:', msg)
  }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) passed++
  else {
    failed++
    console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`)
  }
}

let osOn = true
const appliedSets: Array<Set<string>> = []

import * as actualSettings from '../../settings/state'
import * as actualDispatch from '../../recon/dispatch'
import * as actualHostSettings from '../../dom/host-settings'
import * as actualCanvasHidden from '../../tabs/canvas-hidden'
import * as actualButtons from '../../tabs/buttons'

const { mock } = await import('bun:test')

// Spread the real modules so the whole import graph keeps linking; only the
// functions this test isolates are overridden.
mock.module('../../settings/state', () => ({
  ...actualSettings,
  isOsModeEnabled: () => osOn,
}))
mock.module('../../recon/dispatch', () => ({
  ...actualDispatch,
  getHost: () => ({ resolve: (key: string) => (key === 'builtin:presets' ? 'presets' : null) }),
  getModel: () => ({ closed: ['builtin:presets'] }),
  onModelChanged: () => () => {},
}))
mock.module('../../dom/host-settings', () => ({
  ...actualHostSettings,
  getHostDrawerSettings: () => ({ hiddenTabIds: ['multiplayer'] }),
}))
mock.module('../../tabs/canvas-hidden', () => ({
  ...actualCanvasHidden,
  getCanvasHiddenTabIds: () => ['regex'],
}))
mock.module('../../tabs/buttons', () => ({
  ...actualButtons,
  applyHiddenTabIdsToSecondary: (ids: Set<string>) => { appliedSets.push(ids) },
}))

const { reapplyOsClosedVisibility } = await import('../panel-chrome')

// ── V1: OS on → Canvas-hidden + OS closed set handed to the applicator ──
// LUMI-26: the HOST hiddenTabIds list is never merged into a Canvas-owned
// surface apply — vanilla-made hides must not reach the strips (§23).
{
  osOn = true
  appliedSets.length = 0
  reapplyOsClosedVisibility()
  assertEqual(appliedSets.length, 1, 'V1: applicator called once')
  const set = appliedSets[0]!
  assert(set.has('presets'), 'V1: OS closed live id in the effective hidden set')
  assert(set.has('regex'), 'V1: Canvas-hidden id preserved')
  assert(!set.has('multiplayer'), 'V1: host-hidden id NOT merged (Canvas copy is sole truth)')
  assertEqual(set.size, 2, 'V1: exactly canvas + closed')
}

// ── V2: OS off → no-op ──
{
  osOn = false
  appliedSets.length = 0
  reapplyOsClosedVisibility()
  assertEqual(appliedSets.length, 0, 'V2: no applicator call when OS mode is off')
}

// ── V3: source-pin — the reassign drain tail calls it while OS is on ──
{
  const src = readFileSync(join(process.cwd(), 'src/sidebar/secondary.tsx'), 'utf8')
  const idx = src.indexOf('osChrome.reapplyOsClosedVisibility()')
  assert(idx >= 0, 'V3: drain tail calls reapplyOsClosedVisibility')
  const guardIdx = src.lastIndexOf('if (isOsModeEnabled())', idx)
  assert(guardIdx >= 0, 'V3: call is gated on isOsModeEnabled()')
}

console.log(`panel-chrome closed-visibility tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
export {}
