// Tests for core/model.ts, intents.ts, select.ts, reduce.ts
// Invariants 1–6, 13 from the plan.
import {
  createEmptyModel,
  builtinKey,
  extensionKey,
  isBuiltinKey,
  isExtensionKey,
  parseBuiltinKey,
  parseExtensionKey,
  type LayoutModel,
  type TabKey,
  type Side,
} from '../model'
import type { Intent } from '../intents'
import {
  visibleKeys,
  isHidden,
  visibleToAbsoluteIndex,
  absoluteToVisibleIndex,
  activeAfterRemoval,
  keyExists,
  sideOfKey,
  visibleCount,
  listForSide,
} from '../select'
import { reduce, foldIntents } from '../reduce'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}
function assertArraysEqual(actual: readonly string[], expected: readonly string[], msg: string) {
  if (actual.length !== expected.length) {
    console.error(`FAIL: ${msg} — length mismatch (expected ${expected.length}, got ${actual.length})`)
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
    failed++
    return
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      console.error(`FAIL: ${msg} — diff at index ${i}: expected "${expected[i]}", got "${actual[i]}"`)
      console.error(`  expected: ${JSON.stringify(expected)}`)
      console.error(`  actual:   ${JSON.stringify(actual)}`)
      failed++
      return
    }
  }
  passed++
}

// ── Helpers ──

const PROFILE = builtinKey('profile')
const PRESETS = builtinKey('presets')
const LOOM = builtinKey('loom')
const WEAVER = builtinKey('weaver')
const CONNECTIONS = builtinKey('connections')
const CORTEX = builtinKey('cortex')
const EXT_A = extensionKey('a', 'tab')
const EXT_B = extensionKey('b', 'tab')

function modelWith(opts: {
  primary?: TabKey[]
  secondary?: TabKey[]
  hidden?: TabKey[]
  activePrimary?: TabKey | null
  activeSecondary?: TabKey | null
  side?: 'left' | 'right'
  primaryOpen?: boolean
  primaryWidth?: number
  secondaryOpen?: boolean
  secondaryWidth?: number
} = {}): LayoutModel {
  const base = createEmptyModel(opts.side ?? 'left')
  return {
    ...base,
    primary: opts.primary ?? base.primary,
    secondary: opts.secondary ?? base.secondary,
    hidden: opts.hidden ?? base.hidden,
    active: {
      primary: opts.activePrimary !== undefined ? opts.activePrimary : base.active.primary,
      secondary: opts.activeSecondary !== undefined ? opts.activeSecondary : base.active.secondary,
    },
    drawers: {
      primary: {
        open: opts.primaryOpen ?? base.drawers.primary.open,
        width: opts.primaryWidth ?? base.drawers.primary.width,
      },
      secondary: {
        open: opts.secondaryOpen ?? base.drawers.secondary.open,
        width: opts.secondaryWidth ?? base.drawers.secondary.width,
      },
    },
  }
}

// ═══════════════════════════════════════════════════════════════════
// TabKey construction / parsing
// ═══════════════════════════════════════════════════════════════════

function test_tabKeys() {
  assert(isBuiltinKey(builtinKey('profile')), 'builtinKey produces builtin key')
  assert(!isBuiltinKey(extensionKey('x', 'y')), 'extensionKey is not builtin')
  assert(isExtensionKey(extensionKey('x', 'y')), 'extensionKey produces extension key')
  assert(!isExtensionKey(builtinKey('profile')), 'builtinKey is not extension')

  assertEqual(parseBuiltinKey(builtinKey('profile')), 'profile', 'parseBuiltinKey round-trip')
  assertEqual(parseBuiltinKey(extensionKey('x', 'y')), null, 'parseBuiltinKey on ext returns null')

  const parsed = parseExtensionKey(extensionKey('myext', 'myTab'))
  assert(parsed !== null, 'parseExtensionKey returns non-null')
  assertEqual(parsed!.extensionId, 'myext', 'parseExtensionKey extensionId')
  assertEqual(parsed!.tabName, 'myTab', 'parseExtensionKey tabName')

  const keyWithSlashInName = extensionKey('a', 'b')
  assertEqual(parseExtensionKey(keyWithSlashInName)!.tabName, 'b', 'parseExtensionKey round-trips tabName')
}

test_tabKeys()

// ═══════════════════════════════════════════════════════════════════
// Model creation
// ═══════════════════════════════════════════════════════════════════

function test_modelCreation() {
  const m = createEmptyModel()
  assertEqual(m.version, 2, 'empty model version is 2')
  assertEqual(m.primary.length, 0, 'empty model primary empty')
  assertEqual(m.secondary.length, 0, 'empty model secondary empty')
  assertEqual(m.hidden.length, 0, 'empty model hidden empty')
  assertEqual(m.active.primary, null, 'empty model primary active null')
  assertEqual(m.active.secondary, null, 'empty model secondary active null')
  assertEqual(m.side, 'left', 'empty model side left')
  assertEqual(m.drawers.primary.open, false, 'empty model primary closed')
  assertEqual(m.drawers.primary.width, 420, 'empty model primary width 420')
}

test_modelCreation()

// ═══════════════════════════════════════════════════════════════════
// Invariant 1: A key appears in at most one of primary / secondary.
// ═══════════════════════════════════════════════════════════════════

function test_invariant1_noDuplicateKeys() {
  const m = modelWith({
    primary: [PROFILE, PRESETS, LOOM],
    secondary: [EXT_A],
  })
  assert(!m.primary.includes(EXT_A), 'key not in both lists (primary)')
  assert(!m.secondary.includes(PROFILE), 'key not in both lists (secondary)')

  const moved = reduce(m, { t: 'move', key: PROFILE, to: 'secondary', index: 0, activateDest: false })
  assert(!moved.primary.includes(PROFILE), 'moved key removed from primary')
  assert(moved.secondary.includes(PROFILE), 'moved key in secondary')
  assert(!moved.primary.includes(PROFILE) || !moved.secondary.includes(PROFILE), 'no duplicate after move')
}

test_invariant1_noDuplicateKeys()

// ── Dedup guard for malformed host snapshots (Task 2) ──
// A duplicate TabKey with different `location` values would violate
// invariant 1 (one side per key) if naively inserted. Last-write-wins.
function test_syncFromHost_dedupesDuplicateKey() {
  const m = modelWith({
    primary: [PROFILE, PRESETS, LOOM],
    secondary: [EXT_A],
  })

  // Same key PROFILE in both primary and secondary in the snapshot.
  const observed = {
    tabs: [
      { key: PROFILE, liveId: 'h:p1', isBuiltin: true, location: 'primary' as Side, isHidden: false, isActiveInPrimary: true, isActiveInSecondary: false, hasContentRoot: true },
      { key: PROFILE, liveId: 'h:p1', isBuiltin: true, location: 'secondary' as Side, isHidden: false, isActiveInPrimary: true, isActiveInSecondary: false, hasContentRoot: true },
      { key: PRESETS, liveId: 'h:pr', isBuiltin: true, location: 'primary' as Side, isHidden: false, isActiveInPrimary: false, isActiveInSecondary: false, hasContentRoot: true },
      { key: LOOM, liveId: 'h:l', isBuiltin: true, location: 'primary' as Side, isHidden: false, isActiveInPrimary: false, isActiveInSecondary: false, hasContentRoot: true },
      { key: EXT_A, liveId: 'h:a', isBuiltin: false, location: 'secondary' as Side, isHidden: false, isActiveInPrimary: false, isActiveInSecondary: true, hasContentRoot: true },
    ],
    drawerSide: 'left' as const,
    primaryOpen: true,
    primaryWidth: 420,
    secondaryOpen: false,
    secondaryWidth: 420,
  }
  const next = reduce(m, { t: 'syncFromHost', observed: observed as any })
  // Last-write-wins: PROFILE ends up in secondary (where the second copy said).
  assert(next.secondary.includes(PROFILE), 'D1: last placement wins (PROFILE in secondary)')
  assert(!next.primary.includes(PROFILE), 'D2: previous placement removed (PROFILE not in primary)')
  // Invariant 1 must still hold.
  for (const k of next.primary) {
    assert(!next.secondary.includes(k), `D3: ${k} not in both lists`)
  }
  assertEqual(next.primary.length + next.secondary.length, 4, 'D4: total keys preserved after dedup')
}
test_syncFromHost_dedupesDuplicateKey()

// ═══════════════════════════════════════════════════════════════════
// Invariant 2: hidden ⊆ primary ∪ secondary.
// ═══════════════════════════════════════════════════════════════════

function test_invariant2_hiddenSubset() {
  const m = modelWith({
    primary: [PROFILE, PRESETS],
    secondary: [EXT_A],
    hidden: [PROFILE],
  })
  assert(m.primary.includes(PROFILE), 'hidden key in primary')
  assert(m.hidden.includes(PROFILE), 'hidden tracks key')

  const valid = reduce(m, { t: 'setHidden', key: EXT_A, hidden: true })
  assert(valid.hidden.includes(EXT_A), 'hidden added for existing key')
}

test_invariant2_hiddenSubset()

// ═══════════════════════════════════════════════════════════════════
// Invariant 3: active[side] is null or a member of that side's list,
//              and never hidden.
// ═══════════════════════════════════════════════════════════════════

function test_invariant3_activeMembership() {
  const m = modelWith({
    primary: [PROFILE, PRESETS, LOOM],
    secondary: [EXT_A],
    activePrimary: PROFILE,
  })
  assert(m.primary.includes(PROFILE), 'active primary in primary list')
  assert(!m.hidden.includes(PROFILE), 'active primary not hidden')

  const hid = reduce(m, { t: 'setHidden', key: PROFILE, hidden: true })
  assert(hid.active.primary !== PROFILE, 'active cleared when tab hidden')
  const newActive = hid.active.primary
  if (newActive !== null) {
    assert(!hid.hidden.includes(newActive), 'new active not hidden')
    assert(hid.primary.includes(newActive), 'new active in list')
  }
}

test_invariant3_activeMembership()

// ═══════════════════════════════════════════════════════════════════
// Invariant 4: Visible-index insert/reorder preserves the positions
//              of hidden neighbours.
// ═══════════════════════════════════════════════════════════════════

function test_invariant4_visibleIndexPreservesHidden() {
  const m = modelWith({
    primary: [PROFILE, PRESETS, CORTEX, LOOM],
    hidden: [CORTEX],
  })
  const vis = visibleKeys(m, 'primary')
  assertArraysEqual(vis, [PROFILE, PRESETS, LOOM], 'visible order skips hidden')

  const reordered = reduce(m, { t: 'reorder', key: LOOM, side: 'primary', index: 0 })
  assertArraysEqual(reordered.primary, [LOOM, PROFILE, PRESETS, CORTEX], 'reorder: LOOM to front, hidden CORTEX stays at end')
}

test_invariant4_visibleIndexPreservesHidden()

// ═══════════════════════════════════════════════════════════════════
// Invariant 5: activeAfterRemoval prefers above, else below, skipping
//              hidden; returns null only when no selectable tab remains.
// ═══════════════════════════════════════════════════════════════════

function test_invariant5_activeAfterRemoval() {
  const m = modelWith({
    primary: [PROFILE, PRESETS, CORTEX, LOOM],
    hidden: [CORTEX],
  })

  assertEqual(activeAfterRemoval(m, 'primary', PRESETS), PROFILE, 'removing middle: prefer above')
  assertEqual(activeAfterRemoval(m, 'primary', PROFILE), PRESETS, 'removing first: pick below')
  assertEqual(activeAfterRemoval(m, 'primary', LOOM), PRESETS, 'removing last after hidden: pick above (skip hidden)')
  assertEqual(activeAfterRemoval(m, 'primary', CORTEX), PRESETS, 'hidden tab removed: neighbor above is visible')
  assertEqual(activeAfterRemoval(m, 'primary', builtinKey('nonexistent')), null, 'nonexistent returns null')

  const solo = modelWith({ primary: [PROFILE], activePrimary: PROFILE })
  assertEqual(activeAfterRemoval(solo, 'primary', PROFILE), null, 'only tab removed: null')

  const twoHidden = modelWith({
    primary: [PROFILE, PRESETS, LOOM],
    hidden: [PROFILE, PRESETS],
  })
  assertEqual(activeAfterRemoval(twoHidden, 'primary', LOOM), null, 'all visible removed: null')
}

test_invariant5_activeAfterRemoval()

// ═══════════════════════════════════════════════════════════════════
// Move intent
// ═══════════════════════════════════════════════════════════════════

function test_move() {
  const m = modelWith({
    primary: [PROFILE, PRESETS, LOOM],
    secondary: [EXT_A],
    activePrimary: PRESETS,
  })

  // Cross-side move, activateDest: false
  const moved = reduce(m, { t: 'move', key: PRESETS, to: 'secondary', index: 0, activateDest: false })
  assertArraysEqual(moved.primary, [PROFILE, LOOM], 'moved: source loses tab')
  assertArraysEqual(moved.secondary, [PRESETS, EXT_A], 'moved: target gains tab at index 0')
  assertEqual(moved.active.primary, PROFILE, 'moved: active replaced with above neighbor')
  assertEqual(moved.active.secondary, null, 'moved: activateDest false leaves secondary active null')

  // Cross-side move, activateDest: true
  const moved2 = reduce(m, { t: 'move', key: PRESETS, to: 'secondary', index: 1, activateDest: true })
  assertEqual(moved2.active.secondary, PRESETS, 'moved: activateDest true sets secondary active')

  // Same-side move (reorder) with activateDest
  const reordered = reduce(m, { t: 'move', key: PRESETS, to: 'primary', index: 2, activateDest: true })
  assertArraysEqual(reordered.primary, [PROFILE, LOOM, PRESETS], 'same-side move: reorders at visible index')
  assertEqual(reordered.active.primary, PRESETS, 'same-side move: activateDest keeps active on moved tab')

  // Move with hidden tabs
  const mh = modelWith({
    primary: [PROFILE, CORTEX, PRESETS, LOOM],
    hidden: [CORTEX],
  })
  const mhMoved = reduce(mh, { t: 'move', key: LOOM, to: 'primary', index: 1, activateDest: false })
  assertArraysEqual(mhMoved.primary, [PROFILE, CORTEX, LOOM, PRESETS], 'same-side move through visible index with hidden')
}

test_move()

// Hidden placement must survive a cross-side move, and hidden tabs must not
// become active merely because a move requested destination activation.
function test_hiddenCrossSideMove() {
  const m = modelWith({
    primary: [PROFILE, CORTEX],
    hidden: [CORTEX],
    activePrimary: PROFILE,
  })

  const moved = reduce(m, {
    t: 'move', key: CORTEX, to: 'secondary', index: 0, activateDest: true,
  })
  assertArraysEqual(moved.primary, [PROFILE], 'hidden move: source loses tab')
  assertArraysEqual(moved.secondary, [CORTEX], 'hidden move: destination gains tab')
  assert(moved.hidden.includes(CORTEX), 'hidden move: hidden membership follows tab')
  assertEqual(moved.active.secondary, null, 'hidden move: hidden destination is not activated')
}

test_hiddenCrossSideMove()

// ═══════════════════════════════════════════════════════════════════
// Reorder intent
// ═══════════════════════════════════════════════════════════════════

function test_reorder() {
  const m = modelWith({ primary: [PROFILE, PRESETS, LOOM] })

  const r1 = reduce(m, { t: 'reorder', key: LOOM, side: 'primary', index: 0 })
  assertArraysEqual(r1.primary, [LOOM, PROFILE, PRESETS], 'reorder: last to front')

  const r2 = reduce(m, { t: 'reorder', key: PROFILE, side: 'primary', index: -1 })
  assertArraysEqual(r2.primary, [PRESETS, LOOM, PROFILE], 'reorder: index -1 appends')

  assertEqual(r2.active.primary, m.active.primary, 'reorder does not change active')

  const mh = modelWith({
    primary: [PROFILE, CORTEX, PRESETS, LOOM],
    hidden: [CORTEX],
  })
  const rh = reduce(mh, { t: 'reorder', key: LOOM, side: 'primary', index: 0 })
  assertArraysEqual(rh.primary, [LOOM, PROFILE, CORTEX, PRESETS], 'reorder with hidden at visible index 0')
}

test_reorder()

// ═══════════════════════════════════════════════════════════════════
// setHidden intent
// ═══════════════════════════════════════════════════════════════════

function test_setHidden() {
  const m = modelWith({
    primary: [PROFILE, PRESETS, LOOM],
    activePrimary: PRESETS,
  })

  const hid = reduce(m, { t: 'setHidden', key: PRESETS, hidden: true })
  assert(hid.hidden.includes(PRESETS), 'setHidden adds to hidden')
  assert(hid.primary.includes(PRESETS), 'hidden tab stays in list')
  assert(hid.active.primary !== PRESETS, 'hiding active tab clears it')

  const unhid = reduce(hid, { t: 'setHidden', key: PRESETS, hidden: false })
  assert(!unhid.hidden.includes(PRESETS), 'setHidden false removes from hidden')
  assert(unhid.primary.includes(PRESETS), 'unhidden tab still in list')

  // No-op when tab doesn't exist
  const noop = reduce(m, { t: 'setHidden', key: builtinKey('nonexistent'), hidden: true })
  assertArraysEqual(noop.hidden, m.hidden, 'setHidden nonexistent no-op')
}

test_setHidden()

// ═══════════════════════════════════════════════════════════════════
// activate intent
// ═══════════════════════════════════════════════════════════════════

function test_activate() {
  const m = modelWith({ primary: [PROFILE, PRESETS] })

  const a = reduce(m, { t: 'activate', key: PROFILE, side: 'primary' })
  assertEqual(a.active.primary, PROFILE, 'activate sets active')

  const a2 = reduce(m, { t: 'activate', key: EXT_A, side: 'primary' })
  assertEqual(a2.active.primary, null, 'activate nonexistent key no-ops')

  const mh = modelWith({ primary: [PROFILE, PRESETS], hidden: [PROFILE] })
  const ah = reduce(mh, { t: 'activate', key: PROFILE, side: 'primary' })
  assertEqual(ah.active.primary, null, 'activate hidden tab no-ops')
}

test_activate()

// ═══════════════════════════════════════════════════════════════════
// setDrawer intent
// ═══════════════════════════════════════════════════════════════════

function test_setDrawer() {
  const m = createEmptyModel()

  const o = reduce(m, { t: 'setDrawer', side: 'primary', open: true })
  assertEqual(o.drawers.primary.open, true, 'setDrawer opens primary')
  assertEqual(o.drawers.primary.width, 420, 'setDrawer: width unchanged when omitted')

  const w = reduce(m, { t: 'setDrawer', side: 'secondary', width: 500 })
  assertEqual(w.drawers.secondary.open, false, 'setDrawer: open unchanged when omitted')
  assertEqual(w.drawers.secondary.width, 500, 'setDrawer sets width')

  const both = reduce(m, { t: 'setDrawer', side: 'primary', open: true, width: 600 })
  assertEqual(both.drawers.primary.open, true, 'setDrawer: both open and width')
  assertEqual(both.drawers.primary.width, 600, 'setDrawer: both open and width')

  // Identity-preserving: a no-op setDrawer returns the original reference so
  // dispatch's `next === _model` gate short-circuits (the secondary shell
  // re-dispatches its own open state on every open/close, including echo
  // restores from host.setDrawer — no-op rounds must not reconcile/persist).
  const noop = reduce(m, { t: 'setDrawer', side: 'secondary', open: false, width: 420 })
  assert(noop === m, 'setDrawer no-op returns same reference (identity-preserving)')
}

test_setDrawer()

// ═══════════════════════════════════════════════════════════════════
// swapSides intent
// ═══════════════════════════════════════════════════════════════════

function test_swapSides() {
  const m = createEmptyModel('left')
  const s = reduce(m, { t: 'swapSides' })
  assertEqual(s.side, 'right', 'swapSides left→right')

  const s2 = reduce(s, { t: 'swapSides' })
  assertEqual(s2.side, 'left', 'swapSides right→left')
}

test_swapSides()

// ═══════════════════════════════════════════════════════════════════
// syncFromHost intent
// ═══════════════════════════════════════════════════════════════════

function test_syncFromHost() {
  const m = modelWith({ primary: [PROFILE], activePrimary: PROFILE })

  const synced = reduce(m, {
    t: 'syncFromHost',
    observed: {
      tabs: [
        { key: PROFILE, liveId: 'profile', isBuiltin: true, location: 'primary', isHidden: false, isActiveInPrimary: false, isActiveInSecondary: false, hasContentRoot: true },
        { key: PRESETS, liveId: 'presets', isBuiltin: true, location: 'primary', isHidden: false, isActiveInPrimary: true, isActiveInSecondary: false, hasContentRoot: true },
      ],
      drawerSide: 'right',
      primaryOpen: false,
      primaryWidth: 420,
      secondaryOpen: false,
      secondaryWidth: 420,
    },
  })

  assertArraysEqual(synced.primary, [PROFILE, PRESETS], 'syncFromHost adopts new tab')
  assertEqual(synced.side, 'right', 'syncFromHost updates side')
  // Host is the source of truth for the active tab. The model had PROFILE
  // active, but the host snapshot reports PRESETS as the active tab on
  // primary — adopt the host's active. This prevents the flicker where
  // reconcile's diffActive would otherwise dispatch host.activate(modelActive)
  // and revert the user's just-clicked tab.
  assertEqual(synced.active.primary, PRESETS, 'syncFromHost adopts host active (host leads)')

  const reordered = reduce(synced, {
    t: 'syncFromHost',
    observed: {
      tabs: [
        { key: PRESETS, liveId: 'presets', isBuiltin: true, location: 'primary', isHidden: false, isActiveInPrimary: true, isActiveInSecondary: false, hasContentRoot: true },
        { key: PROFILE, liveId: 'profile', isBuiltin: true, location: 'primary', isHidden: false, isActiveInPrimary: false, isActiveInSecondary: false, hasContentRoot: true },
      ],
      drawerSide: 'right',
      primaryOpen: false,
      primaryWidth: 420,
      secondaryOpen: false,
      secondaryWidth: 420,
    },
  })
  assertArraysEqual(reordered.primary, [PRESETS, PROFILE], 'syncFromHost adopts external host order')
  // Same reasoning as above: host says PRESETS is active, adopt it.
  assertEqual(reordered.active.primary, PRESETS, 'syncFromHost adopts host active after reorder (host leads)')

  const movedAcrossSides = reduce(reordered, {
    t: 'syncFromHost',
    observed: {
      tabs: [
        { key: PROFILE, liveId: 'profile', isBuiltin: true, location: 'secondary', isHidden: false, isActiveInPrimary: false, isActiveInSecondary: true, hasContentRoot: true },
        { key: PRESETS, liveId: 'presets', isBuiltin: true, location: 'primary', isHidden: false, isActiveInPrimary: true, isActiveInSecondary: false, hasContentRoot: true },
      ],
      drawerSide: 'right',
      primaryOpen: false,
      primaryWidth: 420,
      secondaryOpen: false,
      secondaryWidth: 420,
    },
  })
  assertEqual(movedAcrossSides.active.primary, PRESETS, 'syncFromHost does not keep active key on wrong side')
  assertEqual(movedAcrossSides.active.secondary, PROFILE, 'syncFromHost adopts active key on new side')

  // Identity-preserving sync (2026-08-16 freeze fix): re-syncing an
  // UNCHANGED world returns the SAME model reference. Without this, every
  // no-op host-sync produced a new object → dispatch's `next === _model`
  // guard never hit → reconcileAndPersist re-wrote the identical layout to
  // disk + IPC forever during a mutation storm (infinite SAVE_LAYOUT).
  const echo = reduce(movedAcrossSides, {
    t: 'syncFromHost',
    observed: {
      tabs: [
        { key: PROFILE, liveId: 'profile', isBuiltin: true, location: 'secondary', isHidden: false, isActiveInPrimary: false, isActiveInSecondary: true, hasContentRoot: true },
        { key: PRESETS, liveId: 'presets', isBuiltin: true, location: 'primary', isHidden: false, isActiveInPrimary: true, isActiveInSecondary: false, hasContentRoot: true },
      ],
      drawerSide: 'right',
      primaryOpen: false,
      primaryWidth: 420,
      secondaryOpen: false,
      secondaryWidth: 420,
    },
  })
  assert(echo === movedAcrossSides, 'syncFromHost: unchanged world returns the SAME reference (no cascade)')

  // Stale host-flagged active on the wrong side (2026-07-31 rClick fix):
  // taskbar mode keeps the host drawer's DOM active flag on a tab that was
  // just moved to the secondary (profile). The observed world flags it
  // active, but its location is 'secondary'. The reducer must NOT adopt it
  // as the primary active — otherwise model.active.primary points at a
  // secondary tab and the main mirror shows no highlight at all.
  // The model's current primary active (branches) is still validly on the
  // primary side and must be kept.
  const BRANCHES = builtinKey('branches')
  const staleFlagKept = reduce(modelWith({
    primary: [PROFILE, BRANCHES],
    secondary: [],
    activePrimary: BRANCHES,
  }), {
    t: 'syncFromHost',
    observed: {
      tabs: [
        { key: PROFILE, liveId: 'profile', isBuiltin: true, location: 'secondary', isHidden: false, isActiveInPrimary: true, isActiveInSecondary: false, hasContentRoot: true },
        { key: BRANCHES, liveId: 'branches', isBuiltin: true, location: 'primary', isHidden: false, isActiveInPrimary: false, isActiveInSecondary: false, hasContentRoot: true },
      ],
      drawerSide: 'left',
      primaryOpen: true,
      primaryWidth: 420,
      secondaryOpen: true,
      secondaryWidth: 420,
    },
  })
  assertEqual(staleFlagKept.active.primary, BRANCHES, 'syncFromHost keeps current primary active when the flagged tab is on the other side')

  // When the moved tab WAS the current primary active, it must clear (the
  // key is no longer on the primary side), not stay adopted.
  const movedActiveCleared = reduce(modelWith({
    primary: [PROFILE, BRANCHES],
    secondary: [],
    activePrimary: PROFILE,
  }), {
    t: 'syncFromHost',
    observed: {
      tabs: [
        { key: PROFILE, liveId: 'profile', isBuiltin: true, location: 'secondary', isHidden: false, isActiveInPrimary: true, isActiveInSecondary: false, hasContentRoot: true },
        { key: BRANCHES, liveId: 'branches', isBuiltin: true, location: 'primary', isHidden: false, isActiveInPrimary: false, isActiveInSecondary: false, hasContentRoot: true },
      ],
      drawerSide: 'left',
      primaryOpen: true,
      primaryWidth: 420,
      secondaryOpen: true,
      secondaryWidth: 420,
    },
  })
  assertEqual(movedActiveCleared.active.primary, null, 'syncFromHost clears primary active when the flagged tab moved to the other side')

  // Remove gone tabs
  const gone = reduce(m, {
    t: 'syncFromHost',
    observed: {
      tabs: [],
      drawerSide: 'left',
      primaryOpen: false,
      primaryWidth: 420,
      secondaryOpen: false,
      secondaryWidth: 420,
    },
  })
  assertArraysEqual(gone.primary, [], 'syncFromHost removes gone tabs')
  assertEqual(gone.active.primary, null, 'syncFromHost clears active when tab gone')
}

test_syncFromHost()

// ═══════════════════════════════════════════════════════════════════
// foldIntents
// ═══════════════════════════════════════════════════════════════════

function test_foldIntents() {
  const m = modelWith({ primary: [PROFILE, PRESETS, LOOM] })
  const intents: Intent[] = [
    { t: 'move', key: LOOM, to: 'secondary', index: 0, activateDest: false },
    { t: 'setHidden', key: PRESETS, hidden: true },
  ]
  const result = foldIntents(m, intents)
  assertArraysEqual(result.primary, [PROFILE, PRESETS], 'fold: move removed from primary')
  assertArraysEqual(result.secondary, [LOOM], 'fold: move added to secondary')
  assert(result.hidden.includes(PRESETS), 'fold: hide applied')
}

test_foldIntents()

// ═══════════════════════════════════════════════════════════════════
// Invariant 6: Property test — every intent maps a valid model to a
// valid model (invariants 1–3 hold after each step).
// ═══════════════════════════════════════════════════════════════════

function checkInvariants(model: LayoutModel): string | null {
  // 1: no key in both primary and secondary
  const inBoth = model.primary.filter(k => model.secondary.includes(k))
  if (inBoth.length > 0) return `key in both lists: ${inBoth[0]}`

  // 2: hidden ⊆ primary ∪ secondary
  const allKeys = new Set([...model.primary, ...model.secondary])
  for (const h of model.hidden) {
    if (!allKeys.has(h)) return `hidden key not in any list: ${h}`
  }

  // 3: active[side] is null or a member + not hidden
  for (const side of ['primary', 'secondary'] as const) {
    const active = model.active[side]
    if (active !== null) {
      if (!listForSide(model, side).includes(active)) return `active ${side} ${active} not in list`
      if (model.hidden.includes(active)) return `active ${side} ${active} is hidden`
    }
  }

  // All keys in primary or secondary (no orphans)
  const allTabKeys = new Set([...model.primary, ...model.secondary])
  for (const h of model.hidden) {
    if (!allTabKeys.has(h)) return `hidden key not in lists: ${h}`
  }

  // primary + secondary = disjoint (already checked)

  return null
}

function generatePropertyIntents(): Intent[][] {
  const keys = [PROFILE, PRESETS, LOOM, EXT_A]
  const sides: Side[] = ['primary', 'secondary']
  const sequences: Intent[][] = []

  const moveIntents: Intent[] = []
  for (const key of keys) {
    for (const to of sides) {
      for (const index of [0, 1, 2, -1]) {
        for (const activateDest of [false, true]) {
          moveIntents.push({ t: 'move', key, to, index, activateDest })
        }
      }
    }
  }

  const reorderIntents: Intent[] = []
  for (const key of keys) {
    for (const side of sides) {
      for (const index of [0, 1, 2, -1]) {
        reorderIntents.push({ t: 'reorder', key, side, index })
      }
    }
  }

  const hideIntents: Intent[] = []
  for (const key of keys) {
    for (const hidden of [true, false]) {
      hideIntents.push({ t: 'setHidden', key, hidden })
    }
  }

  // New: cover the 4 intent types that the original property test missed.
  // `activate` is a no-op on hidden / unknown keys; both branches need
  // coverage so the test exercises the reducer's silent-ignore paths too.
  const activateIntents: Intent[] = []
  for (const key of [...keys, EXT_B]) {
    for (const side of sides) {
      activateIntents.push({ t: 'activate', key, side })
    }
  }

  // `setDrawer` accepts open/width optionally; cover each combination
  // shape (open only, width only, both, neither).
  const setDrawerIntents: Intent[] = []
  for (const side of sides) {
    setDrawerIntents.push({ t: 'setDrawer', side, open: true, width: 500 })
    setDrawerIntents.push({ t: 'setDrawer', side, open: false })
    setDrawerIntents.push({ t: 'setDrawer', side, width: 320 })
    setDrawerIntents.push({ t: 'setDrawer', side })
  }

  const swapSidesIntents: Intent[] = [{ t: 'swapSides' }]

  // `syncFromHost` — the most complex reducer. Build a small random
  // observed world from a synthetic model so the property test exercises
  // the dedup path from Task 2 as well.
  const syncFromHostIntents: Intent[] = []
  // Helper to build an observed snapshot mirroring the current model
  // shape (used as the "world matches model" baseline).
  const matchedObserved = (m: any) => ({
    tabs: [
      ...m.primary.map((k: string, i: number) => ({
        key: k, liveId: `h:${k}-p${i}`, isBuiltin: k.startsWith('builtin:'),
        location: 'primary' as Side, isHidden: m.hidden.includes(k),
        isActiveInPrimary: m.active.primary === k, isActiveInSecondary: false,
        hasContentRoot: true,
      })),
      ...m.secondary.map((k: string, i: number) => ({
        key: k, liveId: `h:${k}-s${i}`, isBuiltin: k.startsWith('builtin:'),
        location: 'secondary' as Side, isHidden: m.hidden.includes(k),
        isActiveInPrimary: false, isActiveInSecondary: m.active.secondary === k,
        hasContentRoot: true,
      })),
    ],
    drawerSide: m.side,
    primaryOpen: m.drawers.primary.open,
    primaryWidth: m.drawers.primary.width,
    secondaryOpen: m.drawers.secondary.open,
    secondaryWidth: m.drawers.secondary.width,
  })
  // We do not have a `m` in scope here; create a small fixed set of
  // syncFromHost payloads that cover the common shapes. The reducer
  // test for these is in `test_syncFromHost_dedupesDuplicateKey` and
  // the existing syncFromHost coverage; this only needs to prove the
  // reducer does not produce an invalid model.
  const observedEmpty = { tabs: [], drawerSide: 'left' as const, primaryOpen: false, primaryWidth: 420, secondaryOpen: false, secondaryWidth: 420 }
  syncFromHostIntents.push({ t: 'syncFromHost', observed: observedEmpty as any })
  const observedReady = {
    ...observedEmpty,
    tabs: [
      { key: PROFILE, liveId: 'h:profile', isBuiltin: true, location: 'primary' as Side, isHidden: false, isActiveInPrimary: true, isActiveInSecondary: false, hasContentRoot: true },
      { key: PRESETS, liveId: 'h:presets', isBuiltin: true, location: 'primary' as Side, isHidden: false, isActiveInPrimary: false, isActiveInSecondary: false, hasContentRoot: true },
      { key: EXT_A, liveId: 'h:a', isBuiltin: false, location: 'secondary' as Side, isHidden: false, isActiveInPrimary: false, isActiveInSecondary: true, hasContentRoot: true },
    ],
  }
  syncFromHostIntents.push({ t: 'syncFromHost', observed: observedReady as any })
  // Reference `matchedObserved` so the optimizer keeps the helper in
  // scope (we will likely extend this in Task 8 with random models).
  void matchedObserved

  const allSingle = [
    ...moveIntents,
    ...reorderIntents,
    ...hideIntents,
    ...activateIntents,
    ...setDrawerIntents,
    ...swapSidesIntents,
    ...syncFromHostIntents,
  ]

  for (const intent of allSingle) {
    sequences.push([intent])
  }

  for (let i = 0; i < allSingle.length; i++) {
    for (let j = 0; j < allSingle.length; j++) {
      if (i === j) continue
      sequences.push([allSingle[i]!, allSingle[j]!])
    }
  }

  return sequences
}

function test_invariant6_property() {
  let seqCount = 0
  let failCount = 0
  let lastFail = ''

  const seqs = generatePropertyIntents()
  for (const seq of seqs) {
    let m = modelWith({
      primary: [PROFILE, PRESETS, LOOM],
      secondary: [EXT_A],
    })
    for (const intent of seq) {
      m = reduce(m, intent)
    }
    const err = checkInvariants(m)
    if (err) {
      failCount++
      lastFail = `${JSON.stringify(seq)}: ${err}`
      if (failCount <= 5) console.error('FAIL:', lastFail)
    }
    seqCount++
  }

  assert(failCount === 0, `property test: ${failCount} failures out of ${seqCount} sequences (last: ${lastFail || 'none'})`)
}

test_invariant6_property()

// ═══════════════════════════════════════════════════════════════════
// Invariant 13: Save → load → reconcile is identity (round-trip).
//               Model → JSON → Model preserves all data.
// ═══════════════════════════════════════════════════════════════════

function test_invariant13_roundTrip() {
  const original = modelWith({
    primary: [PROFILE, PRESETS, LOOM, EXT_A],
    secondary: [EXT_B],
    hidden: [LOOM],
    activePrimary: PROFILE,
    activeSecondary: EXT_B,
    side: 'right',
    primaryOpen: true,
    primaryWidth: 500,
    secondaryOpen: false,
    secondaryWidth: 350,
  })

  const json = JSON.stringify(original)
  const parsed: LayoutModel = JSON.parse(json)

  assertArraysEqual(parsed.primary, original.primary, 'roundtrip: primary')
  assertArraysEqual(parsed.secondary, original.secondary, 'roundtrip: secondary')
  assertArraysEqual(parsed.hidden, original.hidden, 'roundtrip: hidden')
  assertEqual(parsed.active.primary, original.active.primary, 'roundtrip: active primary')
  assertEqual(parsed.active.secondary, original.active.secondary, 'roundtrip: active secondary')
  assertEqual(parsed.side, original.side, 'roundtrip: side')
  assertEqual(parsed.drawers.primary.open, original.drawers.primary.open, 'roundtrip: primary open')
  assertEqual(parsed.drawers.primary.width, original.drawers.primary.width, 'roundtrip: primary width')
  assertEqual(parsed.drawers.secondary.open, original.drawers.secondary.open, 'roundtrip: secondary open')
  assertEqual(parsed.drawers.secondary.width, original.drawers.secondary.width, 'roundtrip: secondary width')

  const invErr = checkInvariants(parsed)
  assert(invErr === null, `roundtrip: invariants hold: ${invErr || ''}`)
}

test_invariant13_roundTrip()

// ═══════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════

function test_edge_cases() {
  // Move nonexistent key
  const m = createEmptyModel()
  const r = reduce(m, { t: 'move', key: PROFILE, to: 'secondary', index: 0, activateDest: false })
  assertArraysEqual(r.primary, [], 'move nonexistent no-ops on primary')
  assertArraysEqual(r.secondary, [], 'move nonexistent no-ops on secondary')

  // Reorder last tab to itself
  const m2 = modelWith({ primary: [PROFILE] })
  const r2 = reduce(m2, { t: 'reorder', key: PROFILE, side: 'primary', index: 0 })
  assertArraysEqual(r2.primary, [PROFILE], 'reorder single item no change')

  // setHidden on already hidden tab (idempotent)
  const m3 = modelWith({ primary: [PROFILE], hidden: [PROFILE] })
  const r3 = reduce(m3, { t: 'setHidden', key: PROFILE, hidden: true })
  assertEqual(r3.hidden.length, 1, 'setHidden on already hidden is idempotent')

  // unhide non-hidden tab
  const r4 = reduce(m, { t: 'setHidden', key: PROFILE, hidden: false })
  assert(!r4.hidden.includes(PROFILE), 'unhide non-hidden tab no-ops')

  // visibleKeys on empty side
  const v = visibleKeys(m, 'secondary')
  assertEqual(v.length, 0, 'visibleKeys empty side')

  // visibleToAbsoluteIndex edge cases
  assertEqual(visibleToAbsoluteIndex(m, 'primary', -1), 0, 'visibleToAbs -1 returns length (0 for empty)')

  // activeAfterRemoval on secondary
  const m4 = modelWith({ secondary: [EXT_A, EXT_B], activeSecondary: EXT_A })
  assertEqual(activeAfterRemoval(m4, 'secondary', EXT_A), EXT_B, 'activeAfterRemoval on secondary')

  // sideOfKey
  assertEqual(sideOfKey(m4, EXT_A), 'secondary', 'sideOfKey secondary')
  assertEqual(sideOfKey(m4, PROFILE), null, 'sideOfKey null for missing')

  // visibleCount
  assertEqual(visibleCount(m4, 'secondary'), 2, 'visibleCount counts non-hidden')
  const m5 = modelWith({ primary: [PROFILE, PRESETS, LOOM], hidden: [PRESETS] })
  assertEqual(visibleCount(m5, 'primary'), 2, 'visibleCount skips hidden')

  // absoluteToVisibleIndex
  assertEqual(absoluteToVisibleIndex(m5, 'primary', 0), 0, 'absToVis: first visible')
  assertEqual(absoluteToVisibleIndex(m5, 'primary', 1), -1, 'absToVis: hidden returns -1')
  assertEqual(absoluteToVisibleIndex(m5, 'primary', 2), 1, 'absToVis: after hidden')

  // keyExists
  assert(keyExists(m4, EXT_A), 'keyExists true')
  assert(!keyExists(m4, PROFILE), 'keyExists false')
}

test_edge_cases()

// ═══════════════════════════════════════════════════════════════════
// Report
// ═══════════════════════════════════════════════════════════════════

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}/${passed + failed}`)
