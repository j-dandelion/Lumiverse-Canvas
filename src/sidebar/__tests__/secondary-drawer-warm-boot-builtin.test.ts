// src/sidebar/__tests__/secondary-drawer-warm-boot-builtin.test.ts
//
// Wiring test: assignToSecondary's built-in branch must call
// ensureBuiltInTabPanelLoaded(tabId) BEFORE getBuiltInTabRoot(tabId).
// This pins the call ordering so the Lorebook panel's loadBooks() fires
// on warm-boot restore (the panel's fetch is gated on drawerOpen=true,
// which is at its initial false on warm-boot).
//
// The cold-boot right-click path uses assignTab (in src/tabs/assignment.ts)
// and calls ensureBuiltInTabActiveInMain — that's the existing
// assign-tab-wiring.test.ts. This test is the warm-boot sibling,
// verifying the SecondaryDrawer.assignToSecondary path.
//
// The source-text scan is the same pattern as assign-tab-wiring.test.ts.
// A real DOM integration test would need the full Lumiverse bundle;
// the source-text scan is sufficient to pin the order regression.
import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

const src = readFileSync(
  join(process.cwd(), 'src/sidebar/secondary-drawer.ts'),
  'utf8',
)

// Locate the LAZY_MOUNT_OK branch (the warm-boot built-in restore path).
// That branch is the one the original diagnostic in aab95ad identified,
// so it's the right place to inject the panel-load helper. We match the
// dlog breadcrumb specifically (not the string "LAZY_MOUNT_OK" in any
// comment) so the test isn't confused by documentation references.
const lazyMountOkIdx = src.indexOf('branch=LAZY_MOUNT_OK')
ok(
  lazyMountOkIdx !== -1,
  'T-WARM-WIRE-1: LAZY_MOUNT_OK branch exists in secondary-drawer.ts',
)

if (lazyMountOkIdx !== -1) {
  // The window of interest: from the lazy-mount branch's outer `if`
  // gate to the closing `} else {` of the BRIDGE_MISSING branch. We
  // search both ensureBuiltInTabPanelLoaded and requestTabLocation
  // anywhere in that window. ensureBuiltInTabPanelLoaded should be
  // before requestTabLocation so the panel's books are populated
  // before the root is moved to the container.
  const branchStart = src.lastIndexOf('if (_secondaryContent && !_root', lazyMountOkIdx)
  const branchEnd = src.indexOf('} else {', lazyMountOkIdx)
  ok(
    branchStart !== -1 && branchEnd !== -1 && branchStart < branchEnd,
    'T-WARM-WIRE-1: lazy-mount branch has a defined body',
  )

  if (branchStart !== -1 && branchEnd !== -1) {
    const slice = src.slice(branchStart, branchEnd)
    const ensureIdx = slice.indexOf('ensureBuiltInTabPanelLoaded(')
    const requestIdx = slice.indexOf('requestTabLocation(')
    ok(
      ensureIdx !== -1,
      'T-WARM-WIRE-1: ensureBuiltInTabPanelLoaded is called inside the LAZY_MOUNT_OK branch',
    )
    ok(
      requestIdx !== -1,
      'T-WARM-WIRE-1: requestTabLocation is called inside the LAZY_MOUNT_OK branch',
    )
    ok(
      ensureIdx !== -1 && requestIdx !== -1 && ensureIdx < requestIdx,
      'T-WARM-WIRE-1: ensureBuiltInTabPanelLoaded runs BEFORE requestTabLocation ' +
      '(so the panel is loaded before the root is moved to the container)',
    )
  }
}

console.log(`secondary-drawer-warm-boot-builtin: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
