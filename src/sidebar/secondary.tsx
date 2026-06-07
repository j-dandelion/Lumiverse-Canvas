// Secondary sidebar — the mirror of Lumiverse's main drawer, anchored to
// the opposite edge. Hosts the moved extension tab roots + their
// per-tab buttons.
//
// Animation: a single `translateX` on the wrapper; both the drawerTab
// and the drawer are children, so they move as one unit. The wrapper
// animates with requestAnimationFrame + easeOutCubic (350ms); no CSS
// transitions, no counter-translate.
//
// Direction-aware: when the main drawer is on the LEFT, the secondary
// is anchored at `right: 0` (close transform is +width). When the main
// is on the RIGHT, the secondary is anchored at `left: 0` (close
// transform is -width). getClosedTransformPx() centralizes this.
import { getMainSidebar } from '../dom/lumiverse'
import { getDrawerTabs, getMainDrawerSide } from '../store'
import { updateChatReflow } from '../chat/reflow'
import { syncDrawerTabSettings } from './polish'
import { mountResizeHandles } from '../resize/handles'
import { repositionAssignedTabs, repositionTab, isTabActiveInMainDrawer } from '../tabs/assignment'
import { showMainTabButton } from '../tabs/buttons'
import { persistOpenState } from '../layout/persist'
import { injectStyles } from '../debug/styles'

// CSS variable holding the saved width in pixels. The drawer reads it
// via `width: var(SECONDARY_WIDTH_VAR, 420px)` and snapshotLayout reads
// it for persistence.
export const SECONDARY_WIDTH_VAR = '--sidebar-ux-secondary-w'

// Standalone Puzzle icon SVG (lucide-react fallback for extensions without icons)
export const PUZZLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>`

let _secondarySidebarOpen = false
let _secondaryWrapper: HTMLElement | null = null
let _secondaryDrawer: HTMLElement | null = null

// Accessors used by other modules (resize/handles, sidebar/polish,
// tabs/buttons, context-menu, layout/persist). All read; setSecondarySidebarOpen
// and unmountSecondarySidebar mutate.
export function getSecondaryWrapper(): HTMLElement | null { return _secondaryWrapper }
export function isSecondarySidebarOpen(): boolean { return _secondarySidebarOpen }
export function setSecondarySidebarOpen(open: boolean): void { _secondarySidebarOpen = open }
// Consolidates the "remove + null + open=false" pattern used by
// tearDownSecondarySidebar, checkSideChanged, and cleanupAll.
export function unmountSecondarySidebar(): void {
  if (_secondaryWrapper) {
    _secondaryWrapper.remove()
    _secondaryWrapper = null
  }
  _secondarySidebarOpen = false
}

export function injectDrawerTabStyles(): void {
  injectStyles('sidebar-ux-drawer-tab-styles', `
    .sidebar-ux-drawer-tab {
      flex-shrink: 0;
      align-self: flex-start;
      width: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px 8px 20px;
      background: var(--lcs-glass-bg, var(--lumiverse-bg));
      border: 1px solid var(--lumiverse-border-hover);
      color: var(--lumiverse-text-muted);
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    }
    .sidebar-ux-drawer-tab:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--compact {
      width: 32px;
      padding: 8px 6px;
      gap: 0;
    }
    .sidebar-ux-drawer-tab-icon {
      color: var(--lumiverse-primary);
    }
    /* Force a 20×20 size on the tab-list SVG icons. Extensions that
       provide iconSvg without intrinsic width/height attributes (e.g. Hone)
       render at 0×0 by default — Lumiverse's main sidebar gets around this
       via its own CSS, but Canvas's tab list doesn't inherit that rule.
       Sizing via CSS catches all current and future extensions, and matches
       the existing CSS-injection pattern. */
    .sidebar-ux-tab-list button[data-tab-id] > span > svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
  `)
}

export function createSecondarySidebar(options?: { initialWidth?: number; initialOpen?: boolean }): HTMLElement {
  const side = getMainDrawerSide() === 'left' ? 'right' : 'left'

  // Wrapper: mirrors main sidebar .wrapper exactly
  // The WRAPPER translates — drawerTab and drawer are both children, moving as one unit.
  const wrapper = document.createElement('div')
  wrapper.className = 'sidebar-ux-secondary-wrapper'
  // Phase 3 (finding #13): prefer the layout-supplied width on first mount so the
  // initial paint matches the saved state — no 420px fallback flash.
  const cssVarWidth = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR))
  const rawWidth = options?.initialWidth && options.initialWidth > 0
    ? options.initialWidth
    : (isFinite(cssVarWidth) ? cssVarWidth : 420)
  // Clamp to viewport so the closed transform fully hides the sidebar
  // on narrow screens. Same bounds as resize handles and applyLayout.
  const initWidth = Math.ceil(Math.max(200, Math.min(window.innerWidth * 0.8, rawWidth)))
  // Set the CSS var to the clamped value so the drawer's width matches
  // the wrapper. Without this, the drawer (width: var(SECONDARY_WIDTH_VAR))
  // is wider than the wrapper's flex container, and the overflow pokes
  // into the viewport even when the wrapper's transform hides it.
  document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${initWidth}px`)
  // Phase 3: if the saved layout says open, translate to 0 so the drawer is
  // visible from the very first frame. Otherwise stay off-screen. The
  // closed transform's sign is direction-aware (see getClosedTransformPx):
  // +width when the secondary is anchored on the right (main on left), and
  // -width when anchored on the left (main on right).
  const initialOpen = options?.initialOpen === true
  const initWrapperTransform = initialOpen
    ? 'translateX(0)'
    : `translateX(${
        getMainDrawerSide() === 'right' ? -initWidth : initWidth
      }px)`
  wrapper.style.cssText = `
    position: fixed;
    top: 0; bottom: 0;
    z-index: 9990;
    display: flex;
    align-items: stretch;
    pointer-events: none;
    transform: ${initWrapperTransform};
    ${side === 'left'
      ? `left: 0; flex-direction: row-reverse;`
      : `right: 0; flex-direction: row;`};
  `

  // Inject CSS rules for drawer tab (default, hover, active, compact states)
  injectDrawerTabStyles()

  // Drawer tab — flex child of wrapper, NOT position: fixed.
  // When the wrapper translates, the drawerTab moves with it as a unit.
  // Visual state managed via CSS classes (sidebar-ux-drawer-tab--active, --compact).
  // Only layout properties (width, padding, gap, marginTop) use inline styles.
  const drawerTab = document.createElement('button')
  drawerTab.className = 'sidebar-ux-drawer-tab'
  drawerTab.style.cssText = `
    display: none;
    border-${side === 'left' ? 'left' : 'right'}: none;
    border-radius: ${side === 'left' ? '0 12px 12px 0' : '12px 0 0 12px'};
  `
  const iconWrapper = document.createElement('div')
  iconWrapper.className = 'sidebar-ux-drawer-tab-icon'
  iconWrapper.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`
  drawerTab.appendChild(iconWrapper)
  drawerTab.addEventListener('click', () => {
    if (_secondarySidebarOpen) closeSecondarySidebar()
    else openSecondarySidebar()
  })

  // Drawer (contains tab strip + panel, mirrors main sidebar .drawer)
  const drawer = document.createElement('div')
  drawer.className = 'sidebar-ux-drawer'
  // No initial transform — the wrapper handles all positioning via translateX.
  // `position: relative` makes the drawer a positioning context so the
  // resize handle (inserted by mountResizeHandles) offsets from the
  // drawer itself rather than from the wrapper. Without this, the handle's
  // position is computed relative to the wrapper's full translated width,
  // which corrupts the position when the drawerTab sibling's visibility
  // changes (e.g. when no tabs are assigned). The wrapper is at 100%
  // viewport height via top:0/bottom:0; the drawer's height is 100% of
  // that.
  drawer.style.cssText = `
    width: var(${SECONDARY_WIDTH_VAR}, 420px);
    height: 100%;
    position: relative;
    display: flex;
    background: var(--lumiverse-bg-deep);
    box-shadow: var(--lumiverse-shadow-xl);
    pointer-events: auto;
    overflow: hidden;
    isolation: isolate;
    flex-direction: ${side === 'left' ? 'row-reverse' : 'row'};
  `

  // Sidebar (tab list, matches main sidebar .sidebar exactly)
  const sidebar = document.createElement('div')
  sidebar.className = 'sidebar-ux-tab-list'
  sidebar.style.cssText = `
    width: 56px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 6px 0;
    gap: 4px;
    overflow-y: auto;
    scrollbar-width: none;
    border-${side === 'left' ? 'left' : 'right'}: 1px solid var(--lumiverse-primary-020);
    background: color-mix(in srgb, var(--lumiverse-primary) 6%, var(--lumiverse-bg-deep));
  `

  // Panel (content area, mirrors main sidebar .panel)
  const panel = document.createElement('div')
  panel.className = 'sidebar-ux-panel'
  panel.style.cssText = `
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  `

  // Panel header (matches .panelHeader)
  const header = document.createElement('div')
  header.className = 'sidebar-ux-panel-header'
  header.style.cssText = `
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--lumiverse-primary-015);
    background: var(--lumiverse-primary-008, rgba(255, 255, 255, 0.02));
    flex-shrink: 0;
  `

  const title = document.createElement('h2')
  title.className = 'sidebar-ux-panel-title'
  title.style.cssText = `
    margin: 0;
    font-size: calc(15px * var(--lumiverse-font-scale, 1));
    font-weight: 600;
    color: var(--lumiverse-text);
  `
  title.textContent = 'Second Sidebar'

  const closeBtn = document.createElement('button')
  closeBtn.className = 'sidebar-ux-close-btn'
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: var(--lumiverse-text-dim);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  `
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`
  closeBtn.addEventListener('click', () => closeSecondarySidebar())

  header.appendChild(title)
  header.appendChild(closeBtn)

  // Panel content (where extension tab roots are appended)
  const content = document.createElement('div')
  content.className = 'sidebar-ux-panel-content'
  content.style.cssText = `
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior-y: contain;
    padding: 12px 12px 40px;
  `

  panel.appendChild(header)
  panel.appendChild(content)
  drawer.appendChild(sidebar)
  drawer.appendChild(panel)
  wrapper.appendChild(drawerTab)
  wrapper.appendChild(drawer)

  _secondaryDrawer = drawer
  return wrapper
}

// Collect all ancestor elements that need overflow: visible override
function getAncestorsToOverride(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = []
  let el = element.parentElement
  while (el && el !== document.body) {
    const computed = getComputedStyle(el)
    if (computed.overflow === 'hidden' || computed.overflowX === 'hidden' || computed.overflowY === 'hidden') {
      ancestors.push(el)
    }
    el = el.parentElement
  }
  return ancestors
}

// Map from element → Map of ancestor → original overflow value
const _savedOverflow = new Map<HTMLElement, Map<HTMLElement, string>>()

function enableOverflowVisible(element: HTMLElement) {
  const ancestors = getAncestorsToOverride(element)
  if (ancestors.length === 0) return
  const saved = new Map<HTMLElement, string>()
  for (const ancestor of ancestors) {
    if (!saved.has(ancestor)) {
      saved.set(ancestor, ancestor.style.overflow || '')
    }
    ancestor.style.setProperty('overflow', 'visible', 'important')
  }
  _savedOverflow.set(element, saved)
}

export function restoreOverflow(element: HTMLElement) {
  const saved = _savedOverflow.get(element)
  if (!saved) return
  for (const [ancestor, original] of saved) {
    ancestor.style.overflow = original
  }
  _savedOverflow.delete(element)
}

// --- JS-based animation (replaces CSS transitions for drawer + drawerTab sync) ---
// The WRAPPER translates — both drawer and drawerTab are children, so they move as one unit.
// No counter-translate. No position: fixed on drawerTab. Just a single translateX on the wrapper.
const ANIM_DURATION_MS = 350
let _animRaf: number | null = null
let _animStart: number | null = null
let _animFrom = 0
let _animTo = 0

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function animFrame(now: number) {
  if (_animStart === null) _animStart = now
  const elapsed = now - _animStart
  const progress = Math.min(elapsed / ANIM_DURATION_MS, 1)
  const eased = easeOutCubic(progress)

  if (_secondaryWrapper) {
    const val = _animFrom + (_animTo - _animFrom) * eased
    _secondaryWrapper.style.transform = `translateX(${val}px)`
  }

  if (progress < 1) {
    _animRaf = requestAnimationFrame(animFrame)
  } else {
    _animRaf = null
    _animStart = null
  }
}

export function animateWrapper(targetPx: number) {
  const current = _secondaryWrapper
    ? (parseFloat(_secondaryWrapper.style.transform?.match(/-?[\d.]+/)?.[0] || '0'))
    : 0
  _animFrom = current
  _animTo = targetPx
  _animStart = null
  if (_animRaf !== null) cancelAnimationFrame(_animRaf)
  _animRaf = requestAnimationFrame(animFrame)
}

export function openSecondarySidebar() {
  if (!_secondaryWrapper || !_secondaryDrawer) return
  if (_secondarySidebarOpen) return
  // Animate wrapper to translateX(0) — both drawerTab and drawer slide in as one unit
  animateWrapper(0)
  _secondarySidebarOpen = true
  syncDrawerTabSettings()
  updateChatReflow()
  repositionAssignedTabs()
  persistOpenState()
}

export function closeSecondarySidebar() {
  if (!_secondaryWrapper || !_secondaryDrawer) return
  // Animate wrapper back to its closed transform — direction-aware via
  // getClosedTransformPx: secondary on the right closes at +width, on the
  // left at -width.
  animateWrapper(getClosedTransformPx())
  _secondarySidebarOpen = false
  syncDrawerTabSettings()
  updateChatReflow()

  for (const [tabId, sidebar] of getTabAssignmentsTransient()) {
    if (sidebar === 'secondary') {
      const tabs = getDrawerTabs()
      const tab = tabs.find(t => t.id === tabId)
      if (tab?.root) tab.root.style.setProperty('display', 'none', 'important')
    }
  }

  persistOpenState()
}

// Transient local accessor for the tabAssignments map. Re-imported from
// the entry file until tabs/assignment.ts owns it. Removed in
// a future refactor by re-pointing to '../tabs/assignment'.
import { getTabAssignments as getTabAssignmentsTransient } from '../tabs/assignment'

/**
 * Return the wrapper's `translateX` value (in px) that fully hides the
 * secondary sidebar, accounting for which edge it's anchored to.
 *
 * The secondary wrapper is anchored to one edge of the viewport (the edge
 * opposite the main drawer). Closing the sidebar slides the wrapper off
 * its anchor edge so only the drawerTab remains visible. The sign of the
 * translation depends on which edge the wrapper is anchored to:
 *   - main on the LEFT, secondary on the RIGHT (anchored at `right: 0`)
 *     → close transform is +width (pushes wrapper right, off the right edge)
 *   - main on the RIGHT, secondary on the LEFT (anchored at `left: 0`)
 *     → close transform is -width (pushes wrapper left, off the left edge)
 *
 * Centralizing this in one helper avoids the sign-inversion bug that
 * recurred when the close transform was hardcoded at multiple call sites
 * (the open-source repo was developed with the main on the left, so
 * `+width` worked by accident for the dev case but flipped the wrong way
 * when the user moved the main to the right).
 */
export function getClosedTransformPx(): number {
  const w = Math.ceil(
    parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
  )
  // `getMainDrawerSide()` returns the MAIN drawer's side. The secondary
  // lives on the opposite side. When the main is on the LEFT, the
  // secondary is on the RIGHT (anchored at `right: 0`) → close transform
  // is +w (pushes wrapper right, off the right edge). When the main is
  // on the RIGHT, the secondary is on the LEFT (anchored at `left: 0`)
  // → close transform is -w (pushes wrapper left, off the left edge).
  return getMainDrawerSide() === 'right' ? -w : w
}

export function mountSecondarySidebar(options?: { initialWidth?: number; initialOpen?: boolean }) {
  if (_secondaryWrapper) return
  _secondaryWrapper = createSecondarySidebar(options)
  document.body.appendChild(_secondaryWrapper)
  // Phase 3: sync the in-flight state to the initial layout so a hard-refresh
  // with secondary open doesn't trip the "no transition needed" check inside
  // openSecondarySidebar() on the first user click.
  if (options?.initialOpen === true) {
    _secondarySidebarOpen = true
  }
  syncDrawerTabSettings()
  // Mount the resize handles. The main handle is short-circuited by its
  // own querySelector check inside mountResizeHandles, so this is safe to
  // call from both the initial setup path (which already calls it once via
  // setup()) and from checkSideChanged()'s wrapper-remount path. Without
  // this, the secondary handle disappears for the rest of the session
  // whenever the wrapper is recreated (e.g. after a drawer-side flip).
  mountResizeHandles()
}

/**
 * Tear down the secondary sidebar wrapper, restoring every assigned tab to
 * the primary drawer first so we don't leak DOM nodes. Used by the master
 * toggle's "off" path. Does NOT touch the layout blob — that's a separate
 * decision (the user may flip the master back on and want the layout back).
 */
export function tearDownSecondarySidebar(): void {
  if (_secondaryWrapper) {
    // If the main drawer is currently showing a tab that lives in the
    // secondary sidebar, switch to a built-in fallback first. Otherwise
    // restoreTabToPrimary's click() won't re-render React (the DOM node
    // was physically in the secondary sidebar and React never unmounted it).
    const sidebar = getMainSidebar()
    if (sidebar) {
      const allButtons = Array.from(sidebar.querySelectorAll('button[class*="tabBtn"]')) as HTMLElement[]
      const fallbackBtn = allButtons.find(
        b => b.style.display !== 'none' && b.className.includes('tabBtn') && !b.className.includes('tabBtnExtension')
      )
      if (fallbackBtn) {
        // Check if any secondary tab is currently active in the main drawer.
        for (const [tabId, side] of getTabAssignmentsTransient()) {
          if (side === 'secondary' && isTabActiveInMainDrawer(tabId)) {
            fallbackBtn.click()
            break
          }
        }
      }
    }
    // Restore all secondary tabs to primary — just reposition the DOM
    // nodes back, don't activate them (the fallback above handles that).
    for (const [tabId] of Array.from(getTabAssignmentsTransient())) {
      repositionTab(tabId, 'primary')
      showMainTabButton(tabId)
    }
    _secondaryWrapper.remove()
    _secondaryWrapper = null
  }
  _secondarySidebarOpen = false
  // Drop any in-flight resize handle bound to the wrapper, so a re-mount
  // creates a fresh one.
  const handles = document.querySelectorAll('.sidebar-ux-resize-handle')
  for (const h of Array.from(handles)) {
    if (h.parentElement && h.parentElement.classList.contains('sidebar-ux-drawer')) {
      h.remove()
    }
  }
  updateChatReflow()
}