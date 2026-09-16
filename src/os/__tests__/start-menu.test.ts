// Custom assertion harness — see Chronicle testing-conventions.md
// Pure-derivation tests for os/start-menu.ts: entry derivation (both drawers,
// hidden + closed included, alphabetical by title, per-entry side, state
// glyphs, dedupe, unresolvable skip) + glyph mapping.
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
  [KEY_HIDDEN, 'h:2'],
])
// Deliberately NOT in alphabetical order — the derivation must sort.
const storeTabs = [
  { id: 'h:2', title: 'Hidden' },
  { id: 'c:2', title: 'Gamma' },
  { id: 'a:2', title: 'Alpha', iconSvg: '<svg/>' },
  { id: 'b:2', title: 'Beta' },
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
    secondary: [KEY_C, KEY_HIDDEN],
    hidden: [KEY_HIDDEN],
    closed: [KEY_B],
    active: { primary: KEY_A, secondary: null as string | null },
  }
}

const resolve = (key: string) => liveIds.get(key) ?? null

// ── deriveStartMenuEntries: both drawers, hidden included, alphabetical ──
{
  const entries = deriveStartMenuEntries(makeModel(), resolve)
  assertEqual(entries.length, 4, 'both drawers listed, hidden included, unresolvable skipped')
  assertEqual(
    entries.map((e) => e.title).join(','),
    'Alpha,Beta,Gamma,Hidden',
    'alphabetized by title (not strip order)',
  )
  assertEqual(entries[0]?.liveId, 'a:2', 'alpha entry first')
  assertEqual(entries[0]?.side, 'primary', 'entry carries its own drawer (primary)')
  assertEqual(entries[0]?.state, 'open', 'active tab → open')
  assertEqual(entries[1]?.state, 'closed', 'closed-set membership → closed')
  assertEqual(entries[2]?.side, 'secondary', 'secondary entry carries secondary')
  assertEqual(entries[2]?.state, 'minimized', 'inactive in-drawer → minimized')
  assertEqual(entries[3]?.liveId, 'h:2', 'hidden tab is listed (recovery path)')
  assertEqual(entries[3]?.side, 'secondary', 'hidden tab keeps its drawer')
  assertEqual(entries[3]?.state, 'minimized', 'hidden non-active tab → minimized')
  assertEqual(entries[0]?.iconSvg, '<svg/>', 'icon from the store')
  assertEqual(entries[0]?.title, 'Alpha', 'title from the store')
}

// ── case-insensitive collation, stable on ties ──
{
  const mixed = [
    { id: 'g:2', title: 'gamma' },
    { id: 'b:2', title: 'Beta' },
    { id: 'a:2', title: 'alpha' },
  ]
  const mixedResolve = (key: string) =>
    key === KEY_A ? 'a:2' : key === KEY_B ? 'b:2' : key === KEY_C ? 'g:2' : null
  const saved = storeTabs.slice()
  storeTabs.length = 0
  storeTabs.push(...mixed)
  const entries = deriveStartMenuEntries(makeModel(), mixedResolve)
  assertEqual(
    entries.map((e) => e.title).join(','),
    'alpha,Beta,gamma',
    'case-insensitive alphabetical order',
  )
  storeTabs.length = 0
  storeTabs.push(...saved)
}

// ── unresolvable keys are skipped (cannot open this session) ──
{
  const entries = deriveStartMenuEntries(
    { ...makeModel(), primary: [KEY_A, KEY_GONE] },
    resolve,
  )
  assertEqual(entries.length, 3, 'unresolvable key skipped')
  assertEqual(entries[0]?.liveId, 'a:2', 'resolvable entry kept')
}

// ── dedupe: a key listed on both sides appears once ──
{
  const entries = deriveStartMenuEntries(
    { ...makeModel(), secondary: [KEY_A, KEY_C] },
    resolve,
  )
  assertEqual(
    entries.filter((e) => e.liveId === 'a:2').length,
    1,
    'duplicate key deduped by resolved liveId',
  )
}

// ── empty inventory → empty entries (menu shows the empty-state row) ──
{
  const empty = deriveStartMenuEntries(
    { ...makeModel(), primary: [], secondary: [] },
    resolve,
  )
  assertEqual(empty.length, 0, 'no tabs → no entries')
}

// ── glyphFor (D18) ──
assertEqual(glyphFor('open'), '●', 'open glyph')
assertEqual(glyphFor('minimized'), '–', 'minimized glyph')
assertEqual(glyphFor('closed'), '○', 'closed glyph')

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
