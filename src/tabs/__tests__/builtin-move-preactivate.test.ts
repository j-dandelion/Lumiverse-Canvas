// Regression: built-in tabs moved into the second drawer must be
// pre-activated in the HOST main drawer BEFORE their registry root is
// created, so visibility-gated panel data loads fire.
//
// 2026-08-18 bug: the Lorebook selection dropdown stayed empty when the
// Lorebook tab lived in the second drawer. Lumiverse's WorldBookPanel only
// calls loadBooks() when the host's main drawer shows the tab
// (drawerOpen && drawerTab === 'lorebook'). getBuiltInTabRoot →
// ensureRegistryRoot CREATES the registry root and mounts the panel as a
// side effect, so the old code — which resolved the root before the
// pre-activation — mounted the panel while the host was on a different
// tab and the books list never loaded.
import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

const helperSrc = readFileSync(join(process.cwd(), 'src/tabs/builtin-move.ts'), 'utf8')
const secSrc = readFileSync(join(process.cwd(), 'src/sidebar/secondary-drawer.ts'), 'utf8')

// 1. In the helper, the FIRST root resolution (getBuiltInTabRoot) must come
//    AFTER the pre-activation (ensureBuiltInTabActiveInMain). Before the fix
//    an earlier `getBuiltInTabRoot` in the `if (!root)` branch mounted the
//    panel before the pre-activation could run.
const ensureIdx = helperSrc.indexOf('ensureBuiltInTabActiveInMain')
const firstGetRoot = (() => {
  const candidates = [
    helperSrc.indexOf('ui.getBuiltInTabRoot(tabId)'),
    helperSrc.indexOf('getBuiltInTabRoot(tabId)'),
  ].filter((i) => i !== -1)
  return candidates.length ? Math.min(...candidates) : -1
})()
ok(ensureIdx !== -1, 'T-PRE-1: helper calls ensureBuiltInTabActiveInMain')
ok(
  firstGetRoot !== -1 && ensureIdx < firstGetRoot,
  'T-PRE-1: pre-activation happens BEFORE the first getBuiltInTabRoot (no early root mount)',
)
// The pre-activation is not gated behind a root-null check: it must run for
// every fresh placement, not only when getBuiltInTabRoot returned undefined.
ok(
  /if \(!root\) \{[\s\S]*?ensureBuiltInTabActiveInMain/.test(helperSrc),
  'T-PRE-1: ensureBuiltInTabActiveInMain is the first thing inside the !root branch',
)

// 2. The pre-activation must restore the host main drawer's pre-click state:
//    the click opens the drawer (handleTabClick → openDrawer), so a closed
//    main drawer must be closed again (layout primary.open is authoritative).
ok(
  helperSrc.includes('prevMainOpen') && helperSrc.includes('isMainDrawerOpen'),
  'T-PRE-2: pre-activation captures the main drawer open state',
)
ok(
  /!prevMainOpen && isMainDrawerOpen\(\)/.test(helperSrc),
  'T-PRE-2: closed main drawer is re-closed after pre-activation',
)
ok(
  helperSrc.includes('findMainDrawerToggle'),
  'T-PRE-2: helper owns a main drawer toggle lookup',
)

// 3. The "already active in main" skip must be gated on the HOST main drawer
//    state (drawerOpen && drawerTab), not Canvas's own tracked active — the
//    default (resolvePrimaryActiveTabId) can report the tab active while the
//    host drawer would not fire the panel's visibility-gated load (taskbar
//    mirror key, or drawer closed). A wrong skip leaves loadBooks unfired and
//    the lorebook dropdown empty.
ok(
  helperSrc.includes('isTabActiveInMainDrawer:') &&
    helperSrc.includes('hostMainDrawerDomState'),
  'T-PRE-3: pre-activation skip is gated on the HOST drawer state',
)
ok(
  /return st != null && st\.open && st\.tab === tabId/.test(helperSrc),
  'T-PRE-3: skip only when host drawer has the tab active AND open',
)

// 4. assignBuiltInTabToSecondary must NOT pre-resolve the registry root via
//    getBuiltInTabRoot and pass it in — that bypassed the helper's
//    pre-activation on the boot-restore / observer path.
const builtinBranchStart = secSrc.indexOf('async function assignBuiltInTabToSecondary')
ok(builtinBranchStart !== -1, 'T-PRE-4: built-in branch present')
if (builtinBranchStart !== -1) {
  const branch = secSrc.slice(builtinBranchStart, builtinBranchStart + 12000)
  ok(
    branch.includes('moveBuiltInTabToSecondaryContainer'),
    'T-PRE-4: built-in branch still calls the shared helper',
  )
  ok(
    !/bridgeRoot\s*=\s*wSpindleUi\?\.ui/.test(branch) &&
    !/getBuiltInTabRoot\?\.\(tabId\)/.test(branch),
    'T-PRE-4: built-in branch does not pre-resolve the registry root (helper owns resolution)',
  )
  ok(
    !/root:\s*bridgeRoot/.test(branch),
    'T-PRE-4: built-in branch does not hand a pre-resolved root to the helper',
  )
}

// 5. Diagnostics are wired (debug-gated dlog) so a "still empty" report can
//    be attributed to the visibility gate or the mount.
ok(
  helperSrc.includes('ASSIGN_SEC_BUILTIN_PRE_ACTIVATE') &&
    helperSrc.includes('ASSIGN_SEC_BUILTIN_POST_ACTIVATE'),
  'T-PRE-5: pre/post pre-activation diagnostics wired',
)
ok(
  !helperSrc.includes('ASSIGN_SEC_BUILTIN_SETTLED'),
  'T-PRE-5: temporary settled-state diagnostic removed after verification',
)

// 6. The boot/restore placement loop must place tabs ONE AT A TIME. The
//    pre-activation click is per-tab; Promise.all ran every click back-to-back
//    and each overwrote the previous drawerTab, so each panel mounted while
//    the host was on a different tab and loadBooks never fired (the 2026-08-19
//    still-failing report). Serialization lets click → mount → move finish
//    before the next tab's click.
const secTsxSrc = readFileSync(join(process.cwd(), 'src/sidebar/secondary.tsx'), 'utf8')
const loopStart = secTsxSrc.indexOf('for (const [tabKey] of Array.from(getTabAssignments())')
ok(
  loopStart !== -1 &&
    /await assignToSecondary\(liveId, opts\)/.test(secTsxSrc.slice(loopStart, loopStart + 1200)),
  'T-PRE-6: reassignSecondaryTabsFromModel places tabs serially (no Promise.all click stomp)',
)
ok(
  !/await Promise\.all\(promises\)/.test(secTsxSrc.slice(loopStart - 200, loopStart + 2000)),
  'T-PRE-6: the serial loop does not fall back to Promise.all',
)
// drawer-sync's side-remount re-attach loop was serialized with the same
// rationale; pin it so a future refactor does not reintroduce the stomp.
const syncSrc = readFileSync(join(process.cwd(), 'src/sidebar/drawer-sync.ts'), 'utf8')
ok(
  /for \(const \[key\] of Array\.from\(getTabAssignments\(\)\)[\s\S]{0,300}await assignToSecondary\(liveId/.test(syncSrc),
  'T-PRE-6: drawer-sync remount loop places serially',
)

console.log(`builtin-move-preactivate: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
