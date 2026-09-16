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
function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL: ${message}`)
    failed++
  }
}

import {
  builtinBaseId,
  deriveStartMenuEntries,
  entryMonogram,
  extractButtonIcon,
  resolveEntryIcon,
  STATE_LABEL,
  STATE_MARK_SVG,
  STATE_VERB,
} from '../start-menu'
import { BUILTIN_ICON_SVGS } from '../../tabs/builtin-icons'
import { PUZZLE_ICON_SVG } from '../../sidebar/secondary'

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

// ── State contract (user direction 2026-09-15: ● open / ○ minimized / none closed) ──
assertEqual(
  Object.keys(STATE_LABEL).sort().join(','),
  'closed,minimized,open',
  'labels cover exactly the three states',
)
assertEqual(STATE_VERB.open, 'Focus', 'open verb')
assertEqual(STATE_VERB.minimized, 'Restore', 'minimized verb')
assertEqual(STATE_VERB.closed, 'Launch', 'closed verb')
assert(
  STATE_MARK_SVG.open.includes('fill="currentColor"') &&
    STATE_MARK_SVG.open.includes('r="4"'),
  'open mark is a filled dot',
)
assert(
  STATE_MARK_SVG.minimized.includes('stroke="currentColor"') &&
    !STATE_MARK_SVG.minimized.includes('fill="currentColor"'),
  'minimized mark is a hollow circle',
)
assertEqual(STATE_MARK_SVG.closed, '', 'closed has no mark at all')

// ── Icon resolution (plan §3.5) ──
assertEqual(builtinBaseId('profile:2'), 'profile', 'builtin suffix stripped')
assertEqual(builtinBaseId('ext:foo'), 'ext:foo', 'extension address passes through')
assertEqual(builtinBaseId('ext:foo:2'), 'ext:foo', 'numeric suffix drift stripped')
assertEqual(entryMonogram('alpha'), 'A', 'monogram uppercases')
assertEqual(entryMonogram('  '), '?', 'empty title guarded')
assertEqual(entryMonogram('🧵 loom'), '🧵', 'non-ascii first code point')

const stubSvg = (outerHTML: string, classes: string[] = []) =>
  ({ outerHTML, classList: { contains: (c: string) => classes.includes(c) } }) as unknown as Element
const stubRoot = (opts: { svg?: Element; img?: string }) =>
  ({
    querySelector: (sel: string) =>
      sel === 'svg'
        ? opts.svg ?? null
        : sel === 'img' && opts.img
          ? { getAttribute: (attr: string) => (attr === 'src' ? opts.img : null) }
          : null,
  }) as unknown as HTMLElement

assertEqual(
  extractButtonIcon(stubRoot({ svg: stubSvg('<svg data-x="1"></svg>') })).svg,
  '<svg data-x="1"></svg>',
  'live button svg cloned',
)
assertEqual(
  extractButtonIcon(
    stubRoot({ svg: stubSvg('<svg class="lucide lucide-puzzle"></svg>', ['lucide-puzzle']) }),
  ).svg,
  undefined,
  'host puzzle placeholder is a miss',
)
assertEqual(
  extractButtonIcon(stubRoot({ svg: stubSvg(PUZZLE_ICON_SVG) })).svg,
  undefined,
  'canvas puzzle placeholder is a miss',
)
assertEqual(
  extractButtonIcon(stubRoot({ img: 'https://x/i.png' })).url,
  'https://x/i.png',
  'live button img url cloned',
)
assertEqual(extractButtonIcon(undefined).svg, undefined, 'missing root is a miss')
assertEqual(
  resolveEntryIcon({ iconSvg: '<svg id="s"/>' }, 'ext:foo').svg,
  '<svg id="s"/>',
  'store svg used when the live button yields nothing',
)
assertEqual(
  resolveEntryIcon(undefined, 'profile').svg,
  BUILTIN_ICON_SVGS.profile,
  'builtin map fallback',
)
assertEqual(
  resolveEntryIcon({}, 'profile:2').svg,
  BUILTIN_ICON_SVGS.profile,
  'builtin suffix resolves through the map',
)
assertEqual(
  resolveEntryIcon({}, 'ext:unknown').svg,
  undefined,
  'unknown extension falls through to the monogram',
)

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
