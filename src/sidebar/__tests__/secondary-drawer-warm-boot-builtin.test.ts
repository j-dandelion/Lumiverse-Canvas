// Wiring: builtin-move LAZY_MOUNT + secondary-drawer no raw reparent.
import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

const helperSrc = readFileSync(join(process.cwd(), 'src/tabs/builtin-move.ts'), 'utf8')
const secDrawerSrc = readFileSync(join(process.cwd(), 'src/sidebar/secondary-drawer.ts'), 'utf8')

// After finalizeAssignToSecondary refactor, built-in placement lives in
// assignBuiltInTabToSecondary (was an inline `=== BUILT-IN TAB PATH ===` block).
const builtinIdx = secDrawerSrc.indexOf('async function assignBuiltInTabToSecondary')
ok(builtinIdx !== -1, 'T-WARM-WIRE-0: built-in branch marker present')
if (builtinIdx !== -1) {
  const after = secDrawerSrc.slice(builtinIdx, builtinIdx + 10000)
  ok(
    after.includes('moveBuiltInTabToSecondaryContainer'),
    'T-WARM-WIRE-0: built-in branch calls moveBuiltInTabToSecondaryContainer',
  )
  // Host path must not scrape panelContent by title text (crash class).
  ok(
    !/textContent\?\.includes\(tab\.title/.test(after),
    'T-WARM-WIRE-0: no textContent title scrape for built-in roots',
  )
  ok(
    after.includes('STORE_ROOT') || after.includes('storeTab?.root'),
    'T-WARM-WIRE-0: store-root fallback retained for dock-panel / LumiScript',
  )
}

ok(helperSrc.includes('branch=LAZY_MOUNT_OK'), 'T-WARM-WIRE-1: LAZY_MOUNT_OK breadcrumb')
ok(helperSrc.includes('ensureBuiltInTabActiveInMain'), 'T-WARM-WIRE-1: ensureBuiltInTabActiveInMain present')
ok(helperSrc.includes('getBuiltInTabRoot'), 'T-WARM-WIRE-1: getBuiltInTabRoot present')
ok(helperSrc.includes('requestTabLocation'), 'T-WARM-WIRE-1: requestTabLocation present')

// Order in helper source: ensure appears before the post-mount getBuiltInTabRoot
// assignment and before requestTabLocation.
const ensureIdx = helperSrc.indexOf('await ensureBuiltInTabActiveInMain(')
const getRootAfterEnsure = helperSrc.indexOf('ui.getBuiltInTabRoot(tabId)', ensureIdx)
const requestIdx = helperSrc.indexOf('ui.requestTabLocation(', ensureIdx)
ok(ensureIdx !== -1, 'T-WARM-WIRE-1: await ensureBuiltInTabActiveInMain call site')
ok(
  getRootAfterEnsure !== -1 && ensureIdx < getRootAfterEnsure,
  'T-WARM-WIRE-1: ensure before getBuiltInTabRoot(tabId) re-read',
)
ok(
  requestIdx !== -1 && ensureIdx < requestIdx,
  'T-WARM-WIRE-1: ensure before requestTabLocation',
)

const rafMatches = helperSrc.match(/requestAnimationFrame\(\(\)\s*=>\s*r\(\)\)/g) ?? []
ok(rafMatches.length >= 2, `T-WARM-WIRE-1: ≥2 rAF awaits (found ${rafMatches.length})`)

console.log(`secondary-drawer-warm-boot-builtin: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
