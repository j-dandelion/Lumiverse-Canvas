// src/sidebar/__tests__/secondary-drawer-warm-boot-builtin.test.ts
//
// Wiring test: assignToSecondary's built-in branch (the LAZY_MOUNT_OK
// path) must call ensureBuiltInTabActiveInMain(tabId) BEFORE
// getBuiltInTabRoot(tabId). This pins the call ordering so the
// Lorebook panel's loadBooks() fires on warm-boot restore.
//
// The Lorebook React component (frontend/src/components/panels/
// world-book/WorldBookPanel.tsx:165-178) gates its books-list fetch
// on `isVisible = drawerOpen && drawerTab === 'lorebook'`. The
// Lumiverse store starts at drawerOpen=false on every page load, so
// the panel's first useEffect runs with isVisible=false and the
// dropdown stays empty unless we pre-activate the tab in main first.
//
// The cold-boot right-click "Move to second drawer" path uses the
// same helper (see src/tabs/assignment.ts assignTab →
// ensureBuiltInTabActiveInMain). This test pins the warm-boot
// sibling's call ordering. The source-text scan is the same pattern
// as assign-tab-wiring.test.ts.
import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

const secDrawerSrc = readFileSync(
  join(process.cwd(), 'src/sidebar/secondary-drawer.ts'),
  'utf8',
)

// Locate the LAZY_MOUNT_OK branch via the dlog breadcrumb (not the
// string in any comment).
const lazyMountOkIdx = secDrawerSrc.indexOf('branch=LAZY_MOUNT_OK')
ok(
  lazyMountOkIdx !== -1,
  'T-WARM-WIRE-1: LAZY_MOUNT_OK branch exists in secondary-drawer.ts',
)

if (lazyMountOkIdx !== -1) {
  // The window of interest: from the lazy-mount branch's outer `if`
  // gate to the closing `} else {` of the BRIDGE_MISSING branch.
  const branchStart = secDrawerSrc.lastIndexOf(
    'if (_secondaryContent && !_root', lazyMountOkIdx,
  )
  const branchEnd = secDrawerSrc.indexOf('} else {', lazyMountOkIdx)
  ok(
    branchStart !== -1 && branchEnd !== -1 && branchStart < branchEnd,
    'T-WARM-WIRE-1: lazy-mount branch has a defined body',
  )

  if (branchStart !== -1 && branchEnd !== -1) {
    const slice = secDrawerSrc.slice(branchStart, branchEnd)
    const ensureIdx = slice.indexOf('ensureBuiltInTabActiveInMain(')
    const getRootIdx = slice.indexOf('getBuiltInTabRoot(')
    const requestIdx = slice.indexOf('requestTabLocation(')
    // Count the number of rAF awaits inside the LAZY_MOUNT_OK branch.
    // The fix (plan 2026-07-01_175400 Option A) inserts two:
    //   1. after ensureBuiltInTabActiveInMain — lets the detached
    //      React root commit so WorldBookPanel's first useEffect runs
    //      with isVisible=true (loadBooks fires).
    //   2. before requestTabLocation — defers moveTabTo's
    //      pendingActiveTabReset until AFTER that first effect.
    // A purely textual test would pass even if these were silently
    // removed; pin the count so a regression is caught.
    const rafPattern = /requestAnimationFrame\(\(\)\s*=>\s*r\(\)\)/g
    const rafMatches = slice.match(rafPattern) ?? []
    ok(
      ensureIdx !== -1,
      'T-WARM-WIRE-1: ensureBuiltInTabActiveInMain is called inside the LAZY_MOUNT_OK branch',
    )
    ok(
      getRootIdx !== -1,
      'T-WARM-WIRE-1: getBuiltInTabRoot is called inside the LAZY_MOUNT_OK branch',
    )
    ok(
      requestIdx !== -1,
      'T-WARM-WIRE-1: requestTabLocation is called inside the LAZY_MOUNT_OK branch',
    )
    ok(
      ensureIdx !== -1 && getRootIdx !== -1 && ensureIdx < getRootIdx,
      'T-WARM-WIRE-1: ensureBuiltInTabActiveInMain runs BEFORE getBuiltInTabRoot ' +
      '(so the panel is pre-activated before the root is read)',
    )
    ok(
      ensureIdx !== -1 && requestIdx !== -1 && ensureIdx < requestIdx,
      'T-WARM-WIRE-1: ensureBuiltInTabActiveInMain runs BEFORE requestTabLocation ' +
      '(so the panel is pre-activated before the root is moved to the container)',
    )
    ok(
      rafMatches.length >= 2,
      `T-WARM-WIRE-1: LAZY_MOUNT_OK branch awaits requestAnimationFrame at least twice (found ${rafMatches.length})`,
    )
  }
}

console.log(`secondary-drawer-warm-boot-builtin: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
