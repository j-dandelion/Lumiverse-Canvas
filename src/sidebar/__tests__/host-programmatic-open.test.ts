// Source pins for the 2026-09-12 mobile follow-up:
//
// Canvas's built-in pre-activation clicks (`hostBtn.click()` in
// builtin-move) run the host's `handleTabClick → openDrawer()` as a side
// effect, opening the HEADLESS host main drawer. Two guards must exist:
//
//  1. main-persist's `_classObserver` must ignore host wrapper class churn
//     while the Canvas main shell owns the surface. Falling through closes
//     the second drawer (enforceExclusionOnOpen) and stamps
//     `canvas-ux-mobile-primary-open` for a drawer the user never opened.
//
//  2. The host mobile backdrop (rendered as a SIBLING of the host wrapper,
//     z 9991 > Canvas shells' 9990) must be hidden while Canvas main is
//     active — otherwise it sits over the Canvas drawers and swallows taps.

import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

// ── 1: classObserver is gated on shell ownership ──
{
  const src = readFileSync(join(process.cwd(), 'src/sidebar/main-persist.ts'), 'utf8')
  const obsStart = src.indexOf('_classObserver = new MutationObserver')
  assert(obsStart >= 0, 'main-persist has a wrapper classObserver')
  const obs = src.slice(obsStart, obsStart + 2600)
  const guardIdx = obs.indexOf('if (isMainMirrorActive())')
  const enforceIdx = obs.indexOf("enforceExclusionOnOpen('primary')")
  const classIdx = obs.indexOf("setMobileOpenClass('primary', isOpen)")
  assert(guardIdx >= 0, 'classObserver checks isMainMirrorActive()')
  assert(
    guardIdx >= 0 && enforceIdx > guardIdx,
    'classObserver returns/skips before enforceExclusionOnOpen when the shell owns the surface',
  )
  assert(
    guardIdx >= 0 && classIdx > guardIdx,
    'classObserver skips setMobileOpenClass when the shell owns the surface',
  )
}

// ── 2: host mobile backdrop hidden while Canvas main is active ──
{
  const src = readFileSync(join(process.cwd(), 'src/sidebar/main-mirror-drawer.ts'), 'utf8')
  const selector = 'div:has(> [class*="_wrapper_"] [data-spindle-mount="sidebar"]) > [class*="_backdrop_"]'
  const selIdx = src.indexOf(selector)
  assert(selIdx >= 0, 'host-hide CSS hides the wrapper-sibling host backdrop (scoped)')
  if (selIdx >= 0) {
    const open = src.indexOf('{', selIdx)
    const close = src.indexOf('}', open)
    const block = src.slice(open, close)
    assert(block.includes('display: none !important'), 'host backdrop is display:none')
    assert(block.includes('pointer-events: none !important'), 'host backdrop has pointer-events:none')
  }
}

// ── 3: mobile active-tab taps must not toggle-close (target-swap guard) ──
//
// Tapping the active tab on desktop toggles the drawer closed. On mobile the
// drawer is full-bleed, so its rightmost tab row sits exactly where the
// opposite drawer's edge handle appears on close — the same tap region then
// opens the other drawer (live report 2026-09-12). Both toggle-close paths
// must be gated off on plain mobile; the X button + handles remain the close
// affordances.
//
// Exceptions (both user-requested):
//   - OS mode (2026-09-15): every strip click is the D4 window-state toggle on
//     EVERY viewport — tapping the displayed window's tab minimizes it.
//   - Effective taskbar mode (2026-09-15): the mobile gate is lifted too — the
//     pinned strip keeps the drawer reopenable, so the tap-toggle-close is
//     live on both strips.
{
  const buttons = readFileSync(join(process.cwd(), 'src/tabs/buttons.ts'), 'utf8')
  assert(
    buttons.includes('if (isOsModeEnabled()) {'),
    'secondary OS strip toggle is NOT mobile-gated (D4 tab-tap parity)',
  )
  assert(
    !buttons.includes('isOsModeEnabled() && !_isMobileViewport()'),
    'the S6 #5 mobile gate must not return to the OS strip toggle',
  )
  assert(
    /if \(!_isMobileViewport\(\) \|\| isTaskbarModeEnabled\(\)\) closeSecondarySidebar\(\)/.test(buttons),
    'secondary non-OS active-tab close is gated off on plain mobile (taskbar exception)',
  )
  const renderer = readFileSync(join(process.cwd(), 'src/sidebar/main-renderer.ts'), 'utf8')
  assert(
    renderer.includes('toggleWindowByLiveId(osLiveId,'),
    'main mirror OS strip clicks route through the D4 toggle (all viewports)',
  )
  assert(
    !renderer.includes('isOsModeEnabled() && !_isMobileRenderer()'),
    'the main OS strip toggle is not mobile-gated',
  )
  assert(
    renderer.includes('const activeTabClose = !_isMobileRenderer() || isTaskbarModeEnabled()'),
    'main non-OS active-tab close is gated off on plain mobile (taskbar exception)',
  )
  assert(
    renderer.includes('isCanvasMainOpen() && activeTabClose'),
    'the main close branch consumes the mobile/taskbar predicate',
  )
  assert(
    renderer.includes('function _isMobileRenderer()'),
    'main-renderer has its local mobile viewport check',
  )
}

console.log(`PASS: ${passed}`)
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exit(1) }
