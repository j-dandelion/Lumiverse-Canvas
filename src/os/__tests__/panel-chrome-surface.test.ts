// OS panel-header chrome — surface-ownership + lifecycle conventions.
//
// Regression context (2026-09-15 live report): the minimize button was
// injected into the HOST main `_panelHeader_` (invisible — the host main
// drawer is force-hidden while Canvas owns the surface), and the Canvas main
// header's X was not recognized by the document-capture interceptor, so it
// collapsed the drawer instead of closing the OS window. The fix targets the
// Canvas shells only and wires the X through each shell's own close callback
// + the os/header-close.ts seam.
//
// Source-pin assertions follow the repo's convention-test precedent
// (sidebar/__tests__/os-start-button-css.test.ts).

import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertIncludes(haystack: string, needle: string, msg: string) {
  if (haystack.includes(needle)) passed++
  else { failed++; console.error(`FAIL: ${msg} — expected to find "${needle}"`) }
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

const panelChrome = read('src/os/panel-chrome.ts')
const drawerShell = read('src/sidebar/drawer-shell.ts')
const mainMirror = read('src/sidebar/main-mirror-drawer.ts')
const secondary = read('src/sidebar/secondary.tsx')
const styles = read('src/sidebar/styles.ts')
const headerClose = read('src/os/header-close.ts')
const actions = read('src/os/actions.ts')
const drawerCommand = read('src/os/drawer-command.ts')
const mainRenderer = read('src/sidebar/main-renderer.ts')
const tabButtons = read('src/tabs/buttons.ts')

// ── 1. Chrome resolves Canvas-owned surfaces only ──
{
  assertIncludes(panelChrome, "from '../sidebar/main-mirror-drawer'",
    'primary surface comes from the main mirror module')
  assertIncludes(panelChrome, 'getMainMirrorWrapper', 'primary header uses the mirror wrapper getter')
  assertIncludes(panelChrome, 'getSecondaryWrapper', 'secondary header uses the secondary wrapper getter')
  assert(!panelChrome.includes('getMainPanelHeader'),
    'host _panelHeader_ lookup must not return (invisible host drawer)')
  assert(!panelChrome.includes('class*="_panelHeader_"'),
    'no host CSS-module header selector')
  assert(!panelChrome.includes("document.addEventListener('click'"),
    'document-capture interception is retired (target-phase listeners win registration order)')
  assert(!panelChrome.includes('findCloseButton'),
    'close-button heuristics replaced by the shell actions cluster')
}

// ── 2. X→close via the shell callback + header-close seam ──
{
  assertIncludes(panelChrome, 'setPanelHeaderCloseHandler(',
    'chrome installs the OS close policy on mount')
  assertIncludes(panelChrome, 'setPanelHeaderCloseHandler(null)',
    'teardown clears the close policy')
  assertIncludes(mainMirror, "handlePanelHeaderClose('primary')",
    'main shell routes onHeaderClose through the OS policy')
  assertIncludes(mainMirror, 'closeCanvasMainDrawer()',
    'main shell keeps its plain close as the fallback')
  assertIncludes(secondary, "handlePanelHeaderClose('secondary')",
    'secondary shell routes onHeaderClose through the OS policy')
  assertIncludes(secondary, 'closeSecondarySidebar()',
    'secondary shell keeps its plain close as the fallback')
  assertIncludes(headerClose, 'export function handlePanelHeaderClose',
    'leaf seam exports the policy entry point')
}

// ── 3. Header actions cluster contract ──
{
  assertIncludes(drawerShell, "HEADER_ACTIONS_CLASS = 'sidebar-ux-panel-header-actions'",
    'cluster class is a named DOM contract')
  assertIncludes(drawerShell, 'headerActions',
    'shell surface exposes the actions cluster')
  assertIncludes(drawerShell, 'headerActions.appendChild(closeBtn)',
    'close button is a cluster child')
  assertIncludes(panelChrome, 'HEADER_ACTIONS_CLASS',
    'chrome injects into the cluster (not as a bare header child)')
  assertIncludes(styles, '.sidebar-ux-panel-header-actions',
    'cluster CSS keeps minimize adjacent to X under space-between')
}

// ── 4. D17 hide via attribute + sheet (no inline display clobbering) ──
{
  assertIncludes(panelChrome, "HIDDEN_ATTR = 'data-canvas-os-hidden'",
    'presence hook is the hidden attribute')
  assertIncludes(styles, '[data-canvas-os-hidden]', 'sheet owns the hide rule')
  assertIncludes(styles, 'display: none !important', 'hide rule wins over inline button geometry')
  assert(!panelChrome.includes('.style.display'),
    'no inline display writes — teardown must not clobber shell button chrome')
}

// ── 5. Lifecycle: shell-created signal re-ensures after remounts ──
{
  assertIncludes(drawerShell, "DRAWER_SHELL_CREATED_EVENT = 'canvas:drawer-shell-created'",
    'shell factory emits a created signal')
  assertIncludes(drawerShell, 'CustomEvent(DRAWER_SHELL_CREATED_EVENT',
    'signal carries the owner in its detail')
  assertIncludes(panelChrome, 'addEventListener(DRAWER_SHELL_CREATED_EVENT, scheduleEnsure)',
    'chrome re-ensures on shell creation')
  assertIncludes(panelChrome, 'removeEventListener(DRAWER_SHELL_CREATED_EVENT, scheduleEnsure)',
    'chrome detaches the listener on teardown')
  assertIncludes(panelChrome, 'ensureHeaderObserved',
    'resolved headers are observed (WeakSet) for rewrite re-ensures')
}

// ── 6. Primary drawer collapse is a shell command (echo-suppression safe) ──
{
  assertIncludes(actions, "from './drawer-command'",
    'actions route shell-owned drawer open/close through the command seam')
  assertIncludes(actions, 'commandDrawerOpen(side, false)',
    'close/minimize command the drawer closed')
  assertIncludes(actions, 'if (drawerClosed) commandDrawerOpen(side, true)',
    'D19 closed-drawer auto-open commands the shell open')
  assertIncludes(mainMirror, 'setDrawerCommandHandler((commandSide, open)',
    'the main mirror registers its shell command handler on mount')
  assertIncludes(mainMirror, 'setDrawerCommandHandler(null)',
    'teardown clears the shell command handler')
  assertIncludes(drawerCommand, 'export function commandDrawerOpen',
    'command leaf exports the seam entry point')
  assert(!drawerCommand.includes("from '../recon/dispatch'") &&
    !drawerCommand.includes("from './actions'"),
    'command leaf must not import the dispatch/actions graph (cycle safety)')
}

// ── 8. Primary content follows activation (diffActive is model-derived) ──
{
  assertIncludes(actions, 'host.activate(side, liveId)',
    'activation clicks the host content on both sides (reconcile cannot detect it)')
  assertIncludes(mainRenderer, 'toggleWindowByLiveId(osLiveId,',
    'OS strip clicks route through the one window-state toggle (every viewport)')
  assertIncludes(mainRenderer, "dlog('[main-renderer] click → OS window toggle'",
    'the OS route is explicit and diagnosable')
  assertIncludes(actions, "host.activate(side, liveId)",
    'secondary activation clicks its content too (tracked active is stale-equal after a minimize)')
}

// ── 9. D4 strip click is a model-derived toggle (secondary included) ──
{
  assertIncludes(actions, 'export function toggleWindowByLiveId',
    'one toggle action owns the D4 state machine')
  assertIncludes(actions, 'model.drawers[side].open && model.active[side] === key',
    'the toggle predicate is the MODEL displayed state')
  assertIncludes(tabButtons, 'm.toggleWindowByLiveId(tab.id,',
    'secondary strip clicks route through the OS toggle')
  assert(!tabButtons.includes('m.minimizeWindowByLiveId(tab.id'),
    'the tracked-active predicate minimize call must not return (stale reopen memory)')
}

// ── 7. D17 no-active parking (stale content + title + controls) ──
{
  assertIncludes(mainMirror, 'export function setCanvasMainNoActive',
    'main shell exposes the D17 parking hook')
  assertIncludes(mainMirror, "setAttribute('data-canvas-os-no-active', '1')",
    'parking is an attribute (display suppression, never unmount)')
  assertIncludes(mainMirror, "_shell.title.textContent = ''",
    'parking clears the stale header title')
  assertIncludes(panelChrome, 'whenPanelParkingReady(side,',
    'chrome defers parking until the close motion settles (content must fade, not vanish)')
  assertIncludes(panelChrome, 'function applyNoActiveParking(',
    'one parking body owns title/content/control hiding')
  assertIncludes(panelChrome, 'if (!_active || !isOsModeEnabled()) return',
    'the deferred parking no-ops after teardown / OS-off mid-motion')
  assertIncludes(panelChrome, 'if (getDisplayedLiveId(side)) return',
    'the deferred parking re-checks the live displayed-window state (reopen race)')
  assert(!panelChrome.includes('setHeaderHidden(surface.closeBtn, !displayed)'),
    'the header controls must NOT hide synchronously — they hide with the parking pass')
  assertIncludes(panelChrome, 'setHeaderHidden(surface.closeBtn, true)',
    'the deferred parking hides the close control')
  assertIncludes(panelChrome, 'setHeaderHidden(minBtn, true)',
    'the deferred parking hides the minimize control')
  assertIncludes(panelChrome, 'setCanvasMainNoActive(false)',
    'a displayed window un-parks the content slot synchronously')
  assertIncludes(styles, '[data-canvas-os-no-active]',
    'sheet owns the no-active content hide')
  assertIncludes(styles, 'data-canvas-panel-animating',
    'sheet keeps the content visible while a panel motion is in flight')
  // The settle gate must recognize the Sides translate tween, not only the
  // bloom — the 2026-09-17 bug: Sides parking landed at the slide's frame 1.
  const animation = read('src/sidebar/animation.ts')
  assertIncludes(animation, '_panelAnims.has(wrapper) || _liveTranslateWrappers.has(wrapper)',
    'isPanelAnimating covers the Sides translate tween')
  assertIncludes(animation, 'tween.settleCallbacks.push(cb)',
    'whenPanelMotionSettles registers on a live translate tween')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
