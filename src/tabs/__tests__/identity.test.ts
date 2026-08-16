// Resolver unit suite (REFACTOR-PLAN v2 §4.2 / Phase 2).
//
// Every representation of a tab resolves through tabs/identity.ts — the
// ONLY fallback logic in the codebase. This suite pins the precedence tables
// of liveIdForKey / keyForLiveId / liveIdForTitle against the same scenarios
// extension-resolve.test.ts drives through the REAL host, plus the cases
// that only the pure functions can reach (@2 disambiguation, title rename,
// DOM-placed builtins without an entry).

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

import {
  liveIdForKey,
  keyForLiveId,
  liveIdForTitle,
  type TabShape,
} from '../identity'

const UNTAGGED_HONE: TabShape = {
  id: 'Hone',
  extensionId: '',
  title: 'Hone',
  key: 'ext:unknown/Hone',
  titles: new Set(['Hone']),
}
const TAGGED_HONE: TabShape = {
  id: 'spindle:hone:tab:hone_tab:1',
  extensionId: 'hone',
  title: 'Hone',
  key: 'ext:unknown/Hone',   // frozen from the untagged era
  titles: new Set(['Hone']),
}
const TAGGED_LUMI: TabShape = {
  id: 'spindle:lumi:tab:lumi_books_tab:1',
  extensionId: 'lumi',
  title: 'LumiBooks',
  key: 'ext:lumi/LumiBooks',
  titles: new Set(['LumiBooks']),
}
const LOOM: TabShape = {
  id: 'loom',
  extensionId: '',
  title: 'Loom',
  key: 'builtin:loom',
  titles: new Set(['Loom']),
}

// ── liveIdForKey: key → live id ────────────────────────────────────────────

{
  // Untagged extension round trip.
  assertEqual(liveIdForKey('ext:unknown/Hone', [UNTAGGED_HONE]), 'Hone',
    'R1: untagged ext key → title id')
  // Tagged extension round trip (frozen key from the untagged era resolves
  // to the CURRENT address).
  assertEqual(liveIdForKey('ext:unknown/Hone', [TAGGED_HONE]), 'spindle:hone:tab:hone_tab:1',
    'R2: frozen pre-tag key → tagged spindle id')
  assertEqual(liveIdForKey('ext:lumi/LumiBooks', [TAGGED_LUMI]), 'spindle:lumi:tab:lumi_books_tab:1',
    'R3: canonical tagged key → tagged id')
  // Legacy builtin-masquerade key resolves by title after tagging.
  assertEqual(liveIdForKey('builtin:LumiBooks', [TAGGED_LUMI]), 'spindle:lumi:tab:lumi_books_tab:1',
    'R4: builtin:{title} masquerade → tagged id (title fallback)')
  // 'unknown'/'' extensionId normalization (both directions).
  assertEqual(liveIdForKey('ext:unknown/Hone', [TAGGED_HONE]), 'spindle:hone:tab:hone_tab:1',
    'R5: ext:unknown key resolves against a tagged entry (title-only)')
  // Stale extensionId (pre-parts[1]-fix) resolves by title alone.
  assertEqual(liveIdForKey('ext:oldExt/Hone', [TAGGED_HONE]), 'spindle:hone:tab:hone_tab:1',
    'R6: stale extId key → title-only match')
  // Builtins: exact, and TOTAL for DOM-placed builtins with no live entry.
  assertEqual(liveIdForKey('builtin:loom', [LOOM]), 'loom', 'R7: builtin key → bare id')
  assertEqual(liveIdForKey('builtin:wallpaper', [LOOM]), 'wallpaper',
    'R8: DOM-placed builtin with no entry still resolves to its bare id')
  // Unresolvable extension key → null.
  assertEqual(liveIdForKey('ext:nope/Missing', [LOOM]), null,
    'R9: unresolvable ext key → null')
}

// ── keyForLiveId: live id → frozen key ─────────────────────────────────────

{
  // Untagged extension → the ext:unknown key (never builtin:).
  assertEqual(keyForLiveId('Hone', [UNTAGGED_HONE]), 'ext:unknown/Hone',
    'K1: untagged ext id → ext:unknown key')
  // Tagged → the frozen key.
  assertEqual(keyForLiveId('spindle:lumi:tab:lumi_books_tab:1', [TAGGED_LUMI]), 'ext:lumi/LumiBooks',
    'K2: tagged id → frozen ext key')
  // Suffix drift (:N) resolves in both directions.
  assertEqual(keyForLiveId('spindle:lumi:tab:lumi_books_tab:2', [TAGGED_LUMI]), 'ext:lumi/LumiBooks',
    'K3: suffix-drifted live id → frozen key')
  // Title input (pre-tag era / saved layouts).
  assertEqual(keyForLiveId('LumiBooks', [TAGGED_LUMI]), 'ext:lumi/LumiBooks',
    'K4: title id → frozen key (re-key survivor)')
  // Builtin.
  assertEqual(keyForLiveId('loom', [LOOM]), 'builtin:loom', 'K5: builtin id → builtin key')
  // NEVER invents keys: key-shaped input and unknowns → null.
  assertEqual(keyForLiveId('builtin:loom', [LOOM]), null,
    'K6: key-shaped input is NOT a live id (host wrapper handles that direction)')
  assertEqual(keyForLiveId('nope', [LOOM]), null, 'K7: unknown id → null')
}

// ── @2 disambiguation (frozen-first is the only path that resolves it) ─────

{
  const HONE_2: TabShape = {
    id: 'spindle:hone:tab:hone_b:1',
    extensionId: 'hone',
    title: 'Hone',
    key: 'ext:hone/Hone@2',
    titles: new Set(['Hone']),
  }
  assertEqual(liveIdForKey('ext:hone/Hone@2', [TAGGED_HONE, HONE_2]), 'spindle:hone:tab:hone_b:1',
    'A1: @2 key resolves to the second tab via frozen-key match')
  assertEqual(liveIdForKey('ext:hone/Hone', [TAGGED_HONE, HONE_2]), 'spindle:hone:tab:hone_tab:1',
    'A2: base key resolves to the first tab')
  assertEqual(keyForLiveId('spindle:hone:tab:hone_b:1', [TAGGED_HONE, HONE_2]), 'ext:hone/Hone@2',
    'A3: second tab id → its @2 key')
}

// ── Title rename (titles set) ──────────────────────────────────────────────

{
  const RENAMED: TabShape = {
    id: 'spindle:hone:tab:hone_tab:1',
    extensionId: 'hone',
    title: 'Hone v2',
    key: 'ext:unknown/Hone',     // frozen at birth
    titles: new Set(['Hone', 'Hone v2']),
  }
  assertEqual(keyForLiveId('Hone v2', [RENAMED]), 'ext:unknown/Hone',
    'N1: current title → frozen key')
  assertEqual(keyForLiveId('Hone', [RENAMED]), 'ext:unknown/Hone',
    'N2: FIRST-SEEN title still resolves (legacy layouts)')
  assertEqual(liveIdForTitle('Hone', [RENAMED]), 'spindle:hone:tab:hone_tab:1',
    'N3: liveIdForTitle consults the titles set')
}

// ── Button-attribute bridge (legacy stale-entry input) ─────────────────────

{
  const staleEntry: TabShape = {
    id: 'Hone',
    extensionId: '',
    title: 'Hone',
    key: 'ext:unknown/Hone',
    root: { getAttribute: (n: string) => n === 'data-tab-id' ? 'spindle:hone:tab:hone_tab:1' : null } as any,
  }
  assertEqual(keyForLiveId('spindle:hone:tab:hone_tab:1', [staleEntry]), 'ext:unknown/Hone',
    'B1: newer button data-tab-id resolves through the stale entry')
}

// ── liveIdForTitle ─────────────────────────────────────────────────────────

{
  assertEqual(liveIdForTitle('Hone', [TAGGED_HONE]), 'spindle:hone:tab:hone_tab:1',
    'L1: title → current live id')
  assertEqual(liveIdForTitle('Missing', [TAGGED_HONE]), null, 'L2: unknown title → null')
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) process.exit(1)
