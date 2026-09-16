// Start-menu lifecycle pins (2026-09-15 animation round).
//
// Source pins for the invariants the leaf behavior tests cannot reach without
// a disproportionate DOM harness: the identity-guarded position rAF, the
// capture → cancel → measure ordering that keeps an interrupted open from
// popping, immediate teardown paths, pointer-events during the close, and the
// approved adjacent fixes (location-change dismissal + dead-anchor reconcile).
//
// Custom assertion harness — run by scripts/test-runner.sh via `bun run`.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertIncludes(haystack: string, needle: string, msg: string) {
  if (haystack.includes(needle)) {
    passed++
  } else {
    console.error(`FAIL: ${msg} — expected to find "${needle}"`)
    failed++
  }
}
function countOf(haystack: string, needle: string): number {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

import { readFileSync } from 'fs'
import { join } from 'path'

const startMenu = readFileSync(join(process.cwd(), 'src/os/start-menu.ts'), 'utf8')
const motion = readFileSync(join(process.cwd(), 'src/os/start-menu-motion.ts'), 'utf8')
const registry = readFileSync(join(process.cwd(), 'src/features/registry.ts'), 'utf8')

// ── 1. Position rAF is identity-guarded (a superseded open must not win) ──
assertIncludes(
  startMenu,
  'if (_menu !== menu) return',
  'position rAF bails when a newer menu superseded it',
)
assertIncludes(startMenu, 'cancelMenuRaf()', 'rAF handle is cancellable')

// ── 2. Capture → cancel → measure ordering (interrupted open continuity) ──
{
  const captureIdx = startMenu.indexOf('captureMenuVisualState(menu)')
  const cancelIdx = startMenu.indexOf('_menuAnim?.cancel()', captureIdx)
  const originIdx = startMenu.indexOf('computeGrowthOrigin(', cancelIdx)
  assert(captureIdx >= 0, 'close captures the visual state')
  assert(cancelIdx > captureIdx, 'open animation is cancelled AFTER the capture')
  assert(originIdx > cancelIdx, 'origin is measured AFTER the cancel (settled rects)')
}

// ── 3. Close hygiene ──
assertIncludes(
  startMenu,
  "menu.style.pointerEvents = 'none'",
  'a closing menu must not swallow clicks',
)
assertIncludes(
  startMenu,
  '_closing?.menu === menu',
  'close bookkeeping clears by identity',
)
assertIncludes(startMenu, 'if (anim) _closing = { menu, anim }', '_closing only when an animation began')

// ── 4. Immediate paths ──
{
  const start = startMenu.indexOf('export function teardownStartMenu')
  assert(start >= 0, 'teardownStartMenu present')
  const body = startMenu.substring(start, startMenu.indexOf('\n}', start))
  assertIncludes(
    body,
    'hideStartMenu({ immediate: true })',
    'teardown removes the menu without a visible exit',
  )
}
assertIncludes(
  startMenu,
  "if (_menuOpenFor === 'secondary') hideStartMenu({ immediate: true })",
  'second-drawer disable hides immediately (anchor is about to leave)',
)
assertIncludes(
  startMenu,
  'reconcileStartMenuPresence()',
  'ensure pass reconciles a menu stranded on a dead anchor',
)

// ── 5. Toggle needs a live anchor; entry click never delays the action ──
assertIncludes(
  startMenu,
  '_menuOpenFor === side && _menuButton?.isConnected',
  'same-side toggle only while the anchor is connected',
)
assertIncludes(
  startMenu,
  'void openWindowInDrawerByLiveId(entry.liveId, entry.side)',
  'entry click routes to the entry OWN drawer (drawer-agnostic launcher, no D13 move)',
)

// ── 6. Motion module contracts ──
assertIncludes(
  motion,
  'if (!canAnimateMenu(menu) || prefersReducedMotion())',
  'both runners take the instant path under reduced-motion / no WAAPI',
)
assert(
  countOf(motion, 'if (!canAnimateMenu(menu) || prefersReducedMotion())') === 2,
  'the instant-path guard exists in playMenuIn AND playMenuOut',
)
assertIncludes(motion, 'menu.style.transformOrigin', 'origin is applied to the element')
assertIncludes(motion, 'captureMenuVisualState', 'mid-flight visual state capture exported')
assertIncludes(motion, '--lumiverse-ui-scale', 'ui-scale coordinate contract is explicit')
{
  // Live bug 2026-09-15: the origin used the menu's pre-position rect (a fixed
  // box with auto insets sits at its static position), which doubled the
  // anchor distance in Bottom mode and the open frame started far too low.
  const leftIdx = startMenu.indexOf('menu.style.left =')
  const placedIdx = startMenu.indexOf('const placedRect = menu.getBoundingClientRect()')
  const playIdx = startMenu.indexOf('computeGrowthOrigin(rect, placedRect, uiScale)')
  assert(leftIdx >= 0, 'open sets the placed left before measuring')
  assert(placedIdx > leftIdx, 'origin rect is measured AFTER left/top are set')
  assert(playIdx > placedIdx, 'open passes the zoom-aware origin for the placed box')
  assert(
    !startMenu.includes('computeGrowthOrigin(rect, mRect, uiScale)'),
    'the pre-position (static) rect must never anchor the growth origin',
  )
}

// ── 7. Approved adjacent fixes ──
assertIncludes(
  registry,
  "import { hideStartMenu, mountStartMenu, teardownStartMenu } from '../os/start-menu'",
  'registry imports the Start-menu dismissal',
)
assertIncludes(
  registry,
  'hideStartMenu({ immediate: true })',
  'drawerLocation flip dismisses the Start menu immediately (spec §4.5)',
)

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
