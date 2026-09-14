// Custom assertion harness — see Chronicle testing-conventions.md
// Pure-derivation tests for os/start-menu.ts: entry derivation (strip order,
// F7 hidden exclusion, state glyphs, unresolvable skip) + glyph mapping.
let passed = 0
let failed = 0
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

import {
  deriveStartMenuEntries,
  glyphFor,
  type StartMenuEntry,
} from '../start-menu'

const KEY_A = 'builtin:a'
const KEY_B = 'builtin:b'
const KEY_C = 'ext:x/c'
const KEY_HIDDEN = 'builtin:hidden'
const KEY_GONE = 'ext:x/gone'

const liveIds = new Map<string, string>([
  [KEY_A, 'a:2'],
  [KEY_B, 'b:2'],
  [KEY_C, 'c:2'],
])
const storeTabs = [
  { id: 'a:2', title: 'Alpha', iconSvg: '<svg/>' },
  { id: 'b:2', title: 'Beta' },
  { id: 'c:2', title: 'Gamma' },
]

// getDrawerTabs is consumed inside deriveStartMenuEntries — bun:test mock.
import { mock } from 'bun:test'
mock.module('../../store', () => ({
  getDrawerTabs: () => storeTabs,
  // Other store exports are not referenced by start-menu's derive path.
  getMainDrawerSide: () => 'right',
  callHostStoreAction: () => {},
}))

function makeModel() {
  return {
    primary: [KEY_A, KEY_B],
    secondary: [KEY_C],
    hidden: [KEY_HIDDEN],
    closed: [KEY_B],
    active: { primary: KEY_A, secondary: null },
  }
}

const resolve = (key: string) => liveIds.get(key) ?? null

// ── deriveStartMenuEntries ──
{
  const entries = deriveStartMenuEntries('primary', makeModel(), resolve)
  assertEqual(entries.length, 2, 'hidden tabs excluded (F7), unresolvable skipped')
  assertEqual(entries[0]?.liveId, 'a:2', 'strip order preserved')
  assertEqual(entries[0]?.state, 'open', 'active tab → open')
  assertEqual(entries[1]?.liveId, 'b:2', 'second entry present')
  assertEqual(entries[1]?.state, 'closed', 'closed-set membership → closed')
  assertEqual(entries[0]?.iconSvg, '<svg/>', 'icon from the store')
  assertEqual(entries[0]?.title, 'Alpha', 'title from the store')
}
{
  const entries = deriveStartMenuEntries('secondary', makeModel(), resolve)
  assertEqual(entries.length, 1, 'secondary side derives its own tabs')
  assertEqual(entries[0]?.liveId, 'c:2', 'secondary entry')
  assertEqual(entries[0]?.state, 'minimized', 'inactive in-drawer → minimized')
}
{
  // Unresolvable keys are skipped (cannot open this session).
  const entries = deriveStartMenuEntries(
    'primary',
    { ...makeModel(), primary: [KEY_A, KEY_GONE] },
    resolve,
  )
  assertEqual(entries.length, 1, 'unresolvable key skipped')
  assertEqual(entries[0]?.liveId, 'a:2', 'only the resolvable entry')
}
{
  // Empty drawer → empty entries (the menu shows the empty-state row).
  assertEqual(
    deriveStartMenuEntries('secondary', makeModel(), resolve).length,
    1,
    'secondary keeps its one entry',
  )
  const emptyPrimary = deriveStartMenuEntries(
    'primary',
    { ...makeModel(), primary: [] },
    resolve,
  )
  assertEqual(emptyPrimary.length, 0, 'fully-hidden drawer → empty entries')
}

// ── glyphFor (D18) ──
assertEqual(glyphFor('open'), '●', 'open glyph')
assertEqual(glyphFor('minimized'), '–', 'minimized glyph')
assertEqual(glyphFor('closed'), '○', 'closed glyph')

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
