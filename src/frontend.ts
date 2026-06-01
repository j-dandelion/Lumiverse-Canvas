// --- Debug Logging ---
// Background-event logs go through dlog()/dwarn(), which are no-ops when
// DEBUG is false. To enable verbose logging in the running extension:
//
//   localStorage.setItem('sidebarUxDebug', '1');   // then hard-refresh
//   localStorage.removeItem('sidebarUxDebug');     // to turn it off
//
// Note: in some sandboxed/iframe contexts, `localStorage` access throws a
// SecurityError. The try/catch below treats that as "DEBUG off" — the safe
// default. The user-invoked `window.__sidebarUxDebug()` escape hatch
// (defined in setup()) intentionally uses console.log directly; it's a
// deliberate console escape hatch, not background noise.
const DEBUG: boolean = (() => {
  try {
    return localStorage.getItem('sidebarUxDebug') === '1'
  } catch {
    return false
  }
})()

function dlog(...args: unknown[]): void {
  if (!DEBUG) return
  // eslint-disable-next-line no-console
  console.log('[SidebarUX]', ...args)
}

function dwarn(...args: unknown[]): void {
  if (!DEBUG) return
  // eslint-disable-next-line no-console
  console.warn('[SidebarUX]', ...args)
}

// --- DOM Helpers ---

function getMainSidebar(): HTMLElement | null {
  return document.querySelector('[data-spindle-mount="sidebar"]')
}

function getMainDrawer(): HTMLElement | null {
  const sidebar = getMainSidebar()
  return sidebar?.parentElement as HTMLElement | null
}

function getMainPanel(): HTMLElement | null {
  const sidebar = getMainSidebar()
  return sidebar?.parentElement?.querySelector('[class*="_panel_"]') as HTMLElement | null
}

function getMainPanelContent(): HTMLElement | null {
  const panel = getMainPanel()
  return panel?.querySelector('[class*="_panelContent_"]') as HTMLElement | null
}

function getMainWrapper(): HTMLElement | null {
  const sidebar = getMainSidebar()
  return sidebar?.closest('[class*="_wrapper_"]') as HTMLElement | null
}

function getAppElement(): HTMLElement | null {
  return document.querySelector('.app') || document.querySelector('[class*="app"]')
}

function getChatColumn(): HTMLElement | null {
  // .chatColumn is the flex child of .body that contains .chatColumnInner
  // .body has data-chat-constrained when a max-width is active
  const body = document.querySelector('[class*="_body_"][data-chat-constrained]')
    || document.querySelector('[class*="_body_"]')
  if (!body) return null
  // .chatColumn is the flex child that contains the chat content
  // It's identifiable by having align-items: center and containing .chatColumnInner
  const candidates = body.querySelectorAll('[class*="_chatColumn_"]')
  if (candidates.length === 1) return candidates[0] as HTMLElement
  // Fallback: find by structure — it contains the chat toolbar
  for (const el of body.children) {
    if ((el as HTMLElement).querySelector('[class*="_chatToolbar_"]')) {
      return el as HTMLElement
    }
  }
  return null
}

function getMainDrawerWidth(): number {
  const drawer = getMainDrawer()
  if (!drawer) return 420
  return drawer.getBoundingClientRect().width
}

// --- Store Access ---

// The Zustand store is NOT reachable by walking UP from the sidebar.
// Strategy: walk UP to root ancestor, then scan DOWN to find drawerTabs array.
let _drawerTabsCache: Array<{ id: string; extensionId: string; title: string; shortName?: string; iconSvg?: string; iconUrl?: string; root: HTMLElement }> | null = null
let _storeSnapshotCache: Record<string, unknown> | null = null
let _cacheTimestamp = 0
const CACHE_TTL_MS = 3000 // Re-walk fiber tree every 3 seconds max

function scanForStoreData(fiber: any, depth: number, maxDepth: number, visited: Set<any>, force: boolean): void {
  if (!fiber || depth > maxDepth || visited.has(fiber)) return
  visited.add(fiber)

  let hook = fiber.memoizedState
  let hookIdx = 0
  while (hook && hookIdx < 30) {
    const state = hook.memoizedState

    // Check for drawerTabs array (array of objects with id+title+root).
    // When force=true (called from tagMainSidebarButtons to re-tag missed
    // buttons), we overwrite the cache with a fresh result even if the
    // cache was non-null. Without this, a stale partial snapshot from the
    // first call (e.g., 1 of 3 tabs visible) would persist indefinitely.
    if ((force || !_drawerTabsCache) && Array.isArray(state) && state.length > 0 && state[0] && typeof state[0] === 'object') {
      const firstKeys = Object.keys(state[0])
      if (firstKeys.includes('id') && firstKeys.includes('title') && firstKeys.includes('root')) {
        _drawerTabsCache = state as any
      }
    }

    // Check for objects with drawerOpen (full store snapshot)
    if ((force || !_storeSnapshotCache) && state && typeof state === 'object' && !Array.isArray(state)) {
      const keys = Object.keys(state)
      if (keys.includes('drawerOpen') || keys.includes('drawerTabs')) {
        _storeSnapshotCache = state as Record<string, unknown>
      }
    }

    if (!force && _drawerTabsCache && _storeSnapshotCache) {
      _cacheTimestamp = Date.now()
      return // found both, stop early
    }

    hook = hook.next
    hookIdx++
  }

  scanForStoreData(fiber.child, depth + 1, maxDepth, visited, force)
  scanForStoreData(fiber.sibling, depth, maxDepth, visited, force)
}

function findStoreData(force = false) {
  const now = Date.now()
  if (!force && _drawerTabsCache && _storeSnapshotCache && (now - _cacheTimestamp) < CACHE_TTL_MS) return // cached and fresh

  const sidebar = getMainSidebar()
  if (!sidebar) return

  const fiberKey = Object.keys(sidebar).find(k => k.startsWith('__reactFiber$'))
  if (!fiberKey) return

  // Walk UP to root ancestor
  let fiber: any = (sidebar as any)[fiberKey]
  const ancestors: any[] = []
  while (fiber) {
    ancestors.push(fiber)
    fiber = fiber.return
  }

  // When forcing, we want a complete walk (not an early-out) so the cache
  // is fully refreshed. Pass force through to the recursive walker.
  if (force) {
    const visited = new Set<any>()
    for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 5); i--) {
      scanForStoreData(ancestors[i], 0, 30, visited, true)
    }
    _cacheTimestamp = Date.now()
    return
  }

  // Scan DOWN from the top ancestors (the root covers the whole tree)
  const visited = new Set<any>()
  for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 5); i--) {
    scanForStoreData(ancestors[i], 0, 30, visited, false)
    if (_drawerTabsCache && _storeSnapshotCache) {
      _cacheTimestamp = Date.now()
      break
    }
  }
}

function getDrawerTabs(): Array<{ id: string; extensionId: string; title: string; shortName?: string; iconSvg?: string; iconUrl?: string; root: HTMLElement }> {
  findStoreData()
  if (_drawerTabsCache) return _drawerTabsCache
  dwarn('Could not find drawerTabs in fiber tree')
  return []
}

function getStoreSnapshot(): Record<string, unknown> | null {
  findStoreData()
  return _storeSnapshotCache
}

function isMainDrawerOpen(): boolean {
  // Try store snapshot first
  const store = getStoreSnapshot()
  if (store && typeof (store as any).drawerOpen === 'boolean') {
    return (store as any).drawerOpen
  }
  // Fallback to CSS class check
  const wrapper = getMainWrapper()
  if (!wrapper) return false
  return wrapper.classList.toString().includes('wrapperOpen')
}

function getMainDrawerSide(): 'left' | 'right' {
  // Try store snapshot first
  const store = getStoreSnapshot()
  if (store && (store as any).drawerSettings) {
    return (store as any).drawerSettings.side || 'right'
  }
  // Fallback to CSS class check
  const wrapper = getMainWrapper()
  if (!wrapper) return 'right'
  return wrapper.classList.toString().includes('wrapperLeft') ? 'left' : 'right'
}

function setChatMargin(side: 'left' | 'right', px: number) {
  const chat = getChatColumn()
  if (!chat) return
  const varName = side === 'left' ? '--sidebar-ux-chat-ml' : '--sidebar-ux-chat-mr'
  chat.style.setProperty(varName, `${px}px`)
}

function injectReflowStyles() {
  if (document.getElementById('sidebar-ux-reflow')) return
  const style = document.createElement('style')
  style.id = 'sidebar-ux-reflow'
  style.textContent = `
    [class*="_chatColumn_"] {
      margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
      margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
      transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
  `
  document.head.appendChild(style)
}

function injectDrawerTabStyles() {
  if (document.getElementById('sidebar-ux-drawer-tab-styles')) return
  const style = document.createElement('style')
  style.id = 'sidebar-ux-drawer-tab-styles'
  style.textContent = `
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
  `
  document.head.appendChild(style)
}

// --- Secondary Sidebar ---

const SECONDARY_WIDTH_VAR = '--sidebar-ux-secondary-w'

// Standalone Puzzle icon SVG (lucide-react fallback for extensions without icons)
const PUZZLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>`

/** Read showTabLabels from the store snapshot or main sidebar DOM. */
function isShowTabLabels(): boolean {
  // Try store snapshot first
  const store = getStoreSnapshot()
  if (store && typeof (store as any).drawerSettings === 'object' && (store as any).drawerSettings !== null) {
    return !!(store as any).drawerSettings.showTabLabels
  }
  // Fallback: check if main sidebar buttons have the labeled class
  const sidebar = getMainSidebar()
  if (sidebar) {
    const labeledBtn = sidebar.querySelector('button[class*="tabBtnLabeled"]')
    if (labeledBtn) return true
  }
  return false
}

/** Derive shortName matching Lumiverse's adaptExtensionTabs logic. */
function deriveShortName(title: string, shortName?: string): string {
  if (shortName) return shortName
  return title.length > 8 ? title.slice(0, 7) + '\u2026' : title
}

// Boolean flag for secondary sidebar open state (replaces style transform check)
let _secondarySidebarOpen = false
function createSecondarySidebar(options?: { initialWidth?: number; initialOpen?: boolean }): HTMLElement {
  const side = getMainDrawerSide() === 'left' ? 'right' : 'left'

  // Wrapper: mirrors main sidebar .wrapper exactly
  // The WRAPPER translates — drawerTab and drawer are both children, moving as one unit.
  const wrapper = document.createElement('div')
  wrapper.className = 'sidebar-ux-secondary-wrapper'
  // Phase 3 (finding #13): prefer the layout-supplied width on first mount so the
  // initial paint matches the saved state — no 420px fallback flash.
  const cssVarWidth = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR))
  const initWidth = Math.ceil(
    options?.initialWidth && options.initialWidth > 0
      ? options.initialWidth
      : (isFinite(cssVarWidth) ? cssVarWidth : 420)
  )
  // Phase 3: if the saved layout says open, translate to 0 so the drawer is
  // visible from the very first frame. Otherwise stay off-screen.
  const initialOpen = options?.initialOpen === true
  const initWrapperTransform = initialOpen ? 'translateX(0)' : `translateX(${initWidth}px)`
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
  drawer.style.cssText = `
    width: var(${SECONDARY_WIDTH_VAR}, 420px);
    height: 100%;
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

// Save original overflow values so we can restore them
const _savedOverflow = new Map<HTMLElement, string>()

function enableOverflowVisible(element: HTMLElement) {
  const ancestors = getAncestorsToOverride(element)
  for (const ancestor of ancestors) {
    if (!_savedOverflow.has(ancestor)) {
      _savedOverflow.set(ancestor, ancestor.style.overflow || '')
    }
    ancestor.style.setProperty('overflow', 'visible', 'important')
  }
}

function restoreOverflow(element: HTMLElement) {
  for (const [ancestor, original] of _savedOverflow) {
    ancestor.style.overflow = original
  }
  _savedOverflow.clear()
}

let _secondaryWrapper: HTMLElement | null = null
let _secondaryDrawer: HTMLElement | null = null

// Phase 4 (finding #2): centralized WeakMap tracking each tab's original
// parent in the main sidebar, replacing the per-node __sidebarUxOriginalParent
// property. WeakMap auto-cleans when the tab root is GC'd, and isolates the
// extension's metadata from any future extension that also wants to track
// its own per-node state.
const _originalParents: WeakMap<HTMLElement, HTMLElement> = new WeakMap()

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

function animateWrapper(targetPx: number) {
  const current = _secondaryWrapper
    ? (parseFloat(_secondaryWrapper.style.transform?.match(/-?[\d.]+/)?.[0] || '0'))
    : 0
  _animFrom = current
  _animTo = targetPx
  _animStart = null
  if (_animRaf !== null) cancelAnimationFrame(_animRaf)
  _animRaf = requestAnimationFrame(animFrame)
}

function openSecondarySidebar() {
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

function closeSecondarySidebar() {
  if (!_secondaryWrapper || !_secondaryDrawer) return
  const side = getMainDrawerSide() === 'left' ? 'right' : 'left'
  const width = Math.ceil(parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420)
  // Animate wrapper back to translateX(width) — both drawerTab and drawer slide out as one unit
  animateWrapper(width)
  _secondarySidebarOpen = false
  syncDrawerTabSettings()
  updateChatReflow()

  for (const [tabId, sidebar] of _tabAssignments) {
    if (sidebar === 'secondary') {
      const tabs = getDrawerTabs()
      const tab = tabs.find(t => t.id === tabId)
      if (tab?.root) tab.root.style.setProperty('display', 'none', 'important')
    }
  }

  persistOpenState()
}

function mountSecondarySidebar(options?: { initialWidth?: number; initialOpen?: boolean }) {
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
}

// --- Chat Reflow ---

let _reflowRaf: number | null = null

function scheduleReflow() {
  if (_reflowRaf !== null) return
  _reflowRaf = requestAnimationFrame(() => {
    _reflowRaf = null
    updateChatReflow()
  })
}

function updateChatReflow() {
  const mainSide = getMainDrawerSide()
  const mainOpen = isMainDrawerOpen()
  const mainWidth = mainOpen ? getMainDrawerWidth() : 0

  // Secondary sidebar is on the opposite side
  const secondaryWidth = _secondarySidebarOpen
    ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
    : 0

  // Set CSS variables for chat column margins (centering)
  if (mainSide === 'left') {
    setChatMargin('left', mainWidth)
    setChatMargin('right', secondaryWidth)
  } else {
    setChatMargin('right', mainWidth)
    setChatMargin('left', secondaryWidth)
  }
}

function startReflowObserver() {
  injectReflowStyles()

  const observer = new MutationObserver(() => scheduleReflow())
  const waitForWrapper = () => {
    const wrapper = getMainWrapper()
    if (wrapper) {
      observer.observe(wrapper, { attributes: true, attributeFilter: ['class', 'style'] })
      updateChatReflow()
      return
    }
    requestAnimationFrame(waitForWrapper)
  }
  waitForWrapper()

  // Separate observer on the main sidebar for child-list changes. When a tab
  // is added or replaced (e.g., after a Spindle extension reloads), we need
  // to re-tag its button with data-tab-id so the id-based match in
  // findMainTabButton / switchMainDrawerToFallback works. Without this, we'd
  // fall back to title-matching, which is the bug class Finding #7 fixes.
  const sidebarObserver = new MutationObserver(() => scheduleTagMainSidebarButtons())
  const waitForSidebar = () => {
    const sidebar = getMainSidebar()
    if (sidebar) {
      sidebarObserver.observe(sidebar, { childList: true, subtree: true })
      // Initial tag pass — sidebar exists, but buttons may already be rendered.
      tagMainSidebarButtons()
      return
    }
    requestAnimationFrame(waitForSidebar)
  }
  waitForSidebar()

  return () => {
    observer.disconnect()
    sidebarObserver.disconnect()
  }
}

let _tagMainSidebarButtonsRaf: number | null = null
function scheduleTagMainSidebarButtons() {
  if (_tagMainSidebarButtonsRaf !== null) return
  _tagMainSidebarButtonsRaf = requestAnimationFrame(() => {
    _tagMainSidebarButtonsRaf = null
    tagMainSidebarButtons()
  })
}

/**
 * Tag every extension tab button in the main sidebar with a `data-tab-id`
 * attribute. Walks the store's drawerTabs and matches each by title.
 * Idempotent — skips buttons that are already tagged.
 *
 * Returns the number of buttons tagged in this pass.
 */
function tagMainSidebarButtons(): number {
  const sidebar = getMainSidebar()
  if (!sidebar) return 0

  // Force a fresh fiber walk — the cached snapshot may predate the latest
  // tab registration (e.g., LumiBooks registers after Prompt Viewer). The
  // cache TTL is 3s, but sidebar mutations can fire well inside that window
  // with an incomplete view of the store.
  findStoreData(true)
  const tabs = getDrawerTabs()
  if (tabs.length === 0) return 0

  let tagged = 0
  // Iterate buttons, not tabs, because the title-match is the *initial*
  // identity. A button's title is set by Lumiverse and is what the user sees.
  const buttons = sidebar.querySelectorAll('button[title]')
  for (const btn of buttons) {
    const existing = btn.getAttribute('data-tab-id')
    if (existing) continue  // already tagged
    const btnTitle = btn.getAttribute('title')
    if (!btnTitle) continue
    const tab = tabs.find(t => t.title === btnTitle)
    if (tab) {
      btn.setAttribute('data-tab-id', tab.id)
      tagged++
    }
  }
  if (tagged > 0) dlog(`tagMainSidebarButtons: tagged ${tagged} button(s)`)
  return tagged
}

// --- Tab Assignment System (CSS Transform Approach) ---

// Maps tab ID → which sidebar it belongs to
const _tabAssignments: Map<string, 'primary' | 'secondary'> = new Map()

// Saved original styles for repositioned elements (for restoration)
const _savedStyles = new Map<HTMLElement, { cssText: string; overflow: string }>()

function getTabSidebar(tabId: string): 'primary' | 'secondary' {
  return _tabAssignments.get(tabId) || 'primary'
}

/**
 * Detect whether `tabId` is the currently-active tab in the main drawer.
 *
 * The store's `drawerTab` value is the source of truth, but the Zustand store
 * is not always reachable via fiber walk (the spinner race or the way the
 * store is referenced from the active component tree). Fall back to a
 * DOM-based check: find the main sidebar button with the `tabBtnActive` class
 * and compare its `title` attribute to the moved tab's title.
 *
 * For extension tabs, the title is the extension tab's `title` from the store
 * (e.g. "LumiBooks"), NOT the internal `tabId`. For built-in tabs, the title
 * is the translated `tabName` (also discoverable via the store).
 */
/**
 * Discriminated union describing the active-tab state of the main drawer.
 * Replaces the 3-deep nested-if + DOM-fallthrough of the old `isTabActiveInMainDrawer`.
 *
 * - `closed`   — drawer is not open
 * - `active`   — drawer is open, and the active tab is `id`
 * - `other`    — drawer is open, but a different tab (`id`) is active
 * - `unknown`  — store is unreachable AND DOM is unreachable (defensive)
 */
type ActiveTabState =
  | { state: 'closed' }
  | { state: 'active'; id: string }
  | { state: 'other'; id: string }
  | { state: 'unknown' }

function getActiveTabId(): ActiveTabState {
  // Primary: store snapshot
  findStoreData(true)
  const store = _storeSnapshotCache as { drawerTab?: string | null; drawerOpen?: boolean } | null
  if (store && typeof store.drawerOpen === 'boolean') {
    if (!store.drawerOpen) return { state: 'closed' }
    if (typeof store.drawerTab === 'string') {
      return { state: 'active', id: store.drawerTab }
    }
    // drawerOpen is true but drawerTab is null/undefined — store is in a
    // transitional state. Fall through to the DOM check rather than
    // reporting "unknown" prematurely; DOM is usually in sync here.
  }

  // Fallback: DOM-based check
  const sidebar = getMainSidebar()
  if (!sidebar) return { state: 'unknown' }
  const activeBtn = sidebar.querySelector('button[class*="tabBtnActive"]') as HTMLElement | null
  if (!activeBtn) return { state: 'unknown' }
  const activeTitle = activeBtn.getAttribute('title') || ''
  if (!activeTitle) return { state: 'unknown' }

  // Resolve the title back to a tabId via the store
  const tabs = _drawerTabsCache || []
  const tab = tabs.find((t: any) => t.title === activeTitle)
  if (tab) return { state: 'active', id: tab.id }
  // Active button is a built-in (no matching extension tab). Report the title
  // as the active id so callers can compare against built-in tab keys if needed.
  return { state: 'active', id: activeTitle }
}

/**
 * Thin boolean wrapper over getActiveTabId() for callers that only need
 * a yes/no. Prefer getActiveTabId() for new code — the sentinel shape is
 * the authoritative contract.
 */
function isTabActiveInMainDrawer(tabId: string): boolean {
  const active = getActiveTabId()
  if (active.state === 'active') return active.id === tabId
  return false
}

/**
 * Switch the main drawer to a fallback tab before moving the active extension
 * tab to the secondary sidebar. Without this, the previous ExtensionTabContent
 * stays mounted with an empty container (its useEffect dep [tab] is unchanged
 * after a DOM-move, so it doesn't re-fire), and the main panel renders a
 * stale header + empty body.
 *
 * Strategy: find the button immediately before the moved tab's button in the
 * main sidebar DOM, and click it. This is the user's expected behavior —
 * "the next panel whose tab was above or beneath" — and triggers Lumiverse's
 * real onClick → setDrawerTab + openDrawer flow.
 *
 * If the moved tab is the FIRST tab in the sidebar, fall back to the button
 * immediately after. If no neighbor exists (degenerate case), fall back to
 * the first built-in tab button. If even that fails, proceed without
 * switching (preserves the original buggy behavior rather than dead-locking).
 */
/**
 * Phase 4 (finding #10): unified drawer-fallback switcher. Replaces the
 * separate `switchMainDrawerToFallback` and the (as-yet-unwritten) secondary
 * counterpart. The two-RAF wait is only needed for `'main'` because React
 * unmounts the old `ExtensionTabContent` asynchronously there. For `'secondary'`
 * the call is synchronous — the moved tab's node guard and the panel's
 * synchronous state update are enough to detach the node.
 */
function switchDrawerToFallback(side: 'main' | 'secondary', tabId: string, then: () => void): void {
  if (side === 'secondary') {
    // Phase 4 (finding #2): when the moved tab is the active secondary tab,
    // there is no fallback drawer to switch — restoreTabToPrimary already
    // handles the neighbor-tab fall-through via _activeSecondaryTabId.
    // Just invoke then() synchronously.
    then()
    return
  }
  // side === 'main' — legacy logic, preserved verbatim from the previous
  // switchMainDrawerToFallback implementation.
  const sidebar = getMainSidebar()
  if (!sidebar) {
    dwarn('switchDrawerToFallback(main): no main sidebar found')
    then()
    return
  }

  const allButtons = Array.from(sidebar.querySelectorAll('button[class*="tabBtn"]')) as HTMLElement[]

  let movedBtnIdx = allButtons.findIndex((b) => b.getAttribute('data-tab-id') === tabId)
  if (movedBtnIdx === -1) {
    const movedTab = (_drawerTabsCache || []).find((t: any) => t.id === tabId)
    const movedTitle = movedTab?.title
    if (movedTitle) {
      movedBtnIdx = allButtons.findIndex((b) => b.getAttribute('title') === movedTitle)
      if (movedBtnIdx === -1) {
        dwarn(`switchDrawerToFallback(main): no button for id="${tabId}" (title="${movedTitle}") found, proceeding without switching`)
        then()
        return
      }
      dwarn(`switchDrawerToFallback(main): id-match missed for ${tabId}, fell back to title-match — tagMainSidebarButtons may not have run yet`)
    } else {
      dwarn(`switchDrawerToFallback(main): no tab in store for id=${tabId}, proceeding without switching`)
      then()
      return
    }
  }

  // Prefer the previous button (the one rendered immediately above the moved
  // tab in the tab list). If the moved tab is the first, use the next button.
  let fallbackBtn: HTMLElement | undefined = allButtons[movedBtnIdx - 1]
  if (!fallbackBtn || fallbackBtn.style.display === 'none') {
    fallbackBtn = allButtons[movedBtnIdx + 1]
  }
  if (!fallbackBtn || fallbackBtn.style.display === 'none') {
    fallbackBtn = allButtons.find(
      (b) => b.style.display !== 'none' && b.className.includes('tabBtn') && !b.className.includes('tabBtnExtension')
    )
  }
  if (!fallbackBtn) {
    dwarn('switchDrawerToFallback(main): no fallback button found, proceeding without switching')
    then()
    return
  }

  fallbackBtn.click()

  // Wait two animation frames before performing the move. The first RAF lets
  // React commit the setState (drawerTab change). The second RAF lets the
  // ExtensionTabContent unmount complete and detach tab.root from the DOM.
  // In rare cases React's commit is batched/deferred — if the node is still
  // attached to the main panel after two RAFs, the repositionTab call will
  // see parentElement !== secondaryContent and appendChild will still move
  // it (appendChild implicitly removes from previous parent). The triple
  // guard is what prevents the old container from reclaiming it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      then()
    })
  })
}

/**
 * @deprecated Use switchDrawerToFallback('main', tabId, then) instead.
 * Thin alias kept so any out-of-tree caller (or future debug code) still works.
 */
function switchMainDrawerToFallback(tabId: string, then: () => void): void {
  switchDrawerToFallback('main', tabId, then)
}

/**
 * Phase 4 (finding #1): the policy layer for tab assignment. Wraps the pure
 * DOM move (repositionTab) with state updates, button affordances, optional
 * drawer open/close, optional active-tab switching, and optional save.
 *
 * Defaults are tuned for the context-menu call site (user-initiated move):
 *   open: true, switchActive: true, save: true
 * applyLayout uses different defaults (open: false, switchActive: false, save: false)
 * to avoid double-animating the drawer or rewriting a layout we just loaded.
 */
function applyAssignment(tabId: string, target: 'primary' | 'secondary', options: {
  open?: boolean
  switchActive?: boolean
  save?: boolean
} = {}): void {
  const opts = { open: true, switchActive: true, save: true, ...options }
  dlog(`applyAssignment: ${tabId} → ${target} (open=${opts.open}, switchActive=${opts.switchActive}, save=${opts.save})`)

  // 1. State: record the assignment
  _tabAssignments.set(tabId, target)

  // 2. Button affordances: hide in main / show in secondary
  if (target === 'secondary') {
    hideMainTabButton(tabId)
    const tabs = getDrawerTabs()
    const tab = tabs.find(t => t.id === tabId)
    if (tab) addSecondaryTabButton(tab)
  } else {
    showMainTabButton(tabId)
    removeSecondaryTabButton(tabId)
  }
  updateDrawerTabVisibility()

  // 3. The main-drawer-fallback trick: if we're moving a tab that's
  // currently rendered in the main drawer, switch the drawer to a
  // neighboring tab first (after two RAFs) so React unmounts the old
  // ExtensionTabContent and tab.root detaches from the main panel.
  // Otherwise the main panel would render a header with the moved tab's
  // name and an empty body (the bug Solution C fixed).
  const doMove = () => {
    repositionTab(tabId, target)
    if (target === 'secondary') {
      if (opts.switchActive) {
        showSecondaryTab(tabId)
      }
    }
    // For target === 'primary', restoreTabToPrimary handles the neighbor
    // fall-through via _activeSecondaryTabId.
  }

  if (target === 'secondary' && opts.switchActive && isTabActiveInMainDrawer(tabId)) {
    switchDrawerToFallback('main', tabId, doMove)
  } else if (target === 'primary' && opts.switchActive) {
    // For 'primary', the chain is: reposition → if was active, neighbor
    // fall-through happens in restoreTabToPrimary.
    restoreTabToPrimary(tabId)
    // If no more tabs in secondary, close it
    const hasRemaining = [..._tabAssignments.values()].some(v => v === 'secondary')
    if (!hasRemaining && _secondarySidebarOpen) {
      closeSecondarySidebar()
    }
  } else {
    // Direct call: no active-tab dance needed. For primary, still need
    // restoreTabToPrimary to clean up saved styles + overflow.
    if (target === 'primary') {
      restoreTabToPrimary(tabId)
    } else {
      doMove()
    }
  }

  // 4. Open the drawer if requested. Skip if the drawer is already open
  // or the user is closing it.
  if (target === 'secondary' && opts.open && !_secondarySidebarOpen) {
    openSecondarySidebar()
  }

  // 5. Save (debounced via persistLayout).
  if (opts.save) {
    persistLayout()
  }
}

/**
 * Phase 4 (finding #1): one-line wrapper around applyAssignment with the
 * defaults for a user-initiated context-menu move. Kept as a stable public
 * API — any caller (current or future) that just wants "move this tab to
 * that sidebar" doesn't need to know about the options.
 */
function assignTab(tabId: string, sidebar: 'primary' | 'secondary') {
  return applyAssignment(tabId, sidebar, { open: true, switchActive: true, save: true })
}

// Guard against React reclaiming moved tab nodes.
// ExtensionTabContent.useEffect calls containerRef.replaceChildren(tab.root) when
// it detects the node is missing. We intercept removeChild + replaceChildren on
// the original parent to block this.
function isTabMovedToSecondary(node: Node): boolean {
  for (const [tabId, sidebar] of _tabAssignments) {
    if (sidebar === 'secondary') {
      const tabs = _drawerTabsCache || []
      const tab = tabs.find((t: any) => t.id === tabId)
      if (tab && tab.root === node) return true
    }
  }
  return false
}

function installNodeGuard(container: Node) {
  if ((container as any).__sidebarUxGuarded) return
  ;(container as any).__sidebarUxGuarded = true

  const origRemoveChild = container.removeChild.bind(container)
  container.removeChild = function(child: Node) {
    if (isTabMovedToSecondary(child)) return child as any
    return origRemoveChild(child)
  } as any

  // Guard replaceChildren — this is what ExtensionTabContent.useEffect calls
  const origReplaceChildren = (container as any).replaceChildren?.bind(container)
  if (origReplaceChildren) {
    ;(container as any).replaceChildren = function(...nodes: Node[]) {
      const filtered = nodes.filter(n => !isTabMovedToSecondary(n))
      return origReplaceChildren(...filtered)
    }
  }

  // Guard appendChild — React may also use this to re-add nodes
  const origAppendChild = container.appendChild.bind(container)
  container.appendChild = function(child: Node) {
    if (isTabMovedToSecondary(child)) return child
    return origAppendChild(child)
  } as any
}

/**
 * Phase 4 (finding #1): pure DOM move — moves a tab's root element between
 * sidebars WITHOUT touching state, buttons, save, or open/close. The policy
 * layer (applyAssignment) wraps this with the side effects.
 *
 * Returns true on success, false if the tab or target container is missing.
 * The original parent is tracked in the centralized _originalParents
 * WeakMap (replacing the per-node __sidebarUxOriginalParent property).
 */
function repositionTab(tabId: string, target: 'primary' | 'secondary'): boolean {
  const tabs = getDrawerTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab?.root) {
    dwarn(`repositionTab: tab not found for id=${tabId}`)
    return false
  }

  if (target === 'secondary') {
    const secondaryContent = _secondaryWrapper?.querySelector('.sidebar-ux-panel-content') as HTMLElement
    if (!secondaryContent) {
      dwarn('repositionTab: no secondary content area')
      return false
    }
    // Install the React node guard on the main panel content so React can't
    // reclaim the moved node. installNodeGuard is idempotent.
    const mainContent = getMainPanelContent()
    if (mainContent) installNodeGuard(mainContent)
    // Save the original parent in the WeakMap (only if not already recorded
    // — a tab moved twice should keep its first original parent so the
    // second restore still finds the right target).
    if (!_originalParents.has(tab.root)) {
      _originalParents.set(tab.root, tab.root.parentElement as HTMLElement)
    }
    if (tab.root.parentElement !== secondaryContent) {
      secondaryContent.appendChild(tab.root)
    }
    tab.root.style.setProperty('width', '100%', 'important')
    tab.root.style.setProperty('height', '100%', 'important')
    tab.root.style.setProperty('display', '', 'important')
    return true
  } else {
    // target === 'primary' — restore from secondary back to the original
    // parent in the main sidebar. If the recorded parent has been detached
    // (React re-mounted the tab while it was in secondary), fall back to
    // the current main panel content so the tab is still reachable.
    const orig = _originalParents.get(tab.root)
    const targetEl = (orig && orig.isConnected) ? orig : getMainPanelContent()
    if (!targetEl) {
      dlog(`repositionTab: no original parent and no main panel content for tabId=${tabId} — tab will be detached`)
      return false
    }
    if (tab.root.parentElement !== targetEl) {
      targetEl.appendChild(tab.root)
    }
    // Clear the WeakMap entry — the tab is back home, no need to remember
    // the original parent. The next move-to-secondary will record the
    // (possibly new) parent again.
    _originalParents.delete(tab.root)
    return true
  }
}

/**
 * @deprecated Use repositionTab(tabId, 'secondary') instead. Kept as a
 * thin wrapper for callers that haven't been migrated yet.
 */
function repositionTabToSecondary(tabId: string) {
  repositionTab(tabId, 'secondary')
}

// Phase 4 (finding #2): state tracking which secondary tab is currently
// visible in the secondary panel content area. Updated by showSecondaryTab.
// Used by restoreTabToPrimary to fall through to a neighbor tab when the
// active secondary tab is moved back to primary, preventing the "ghost tab"
// (header still showing the moved tab's name with an empty body).
let _activeSecondaryTabId: string | null = null

/**
 * Restore a tab's root element to its original parent in the primary sidebar.
 */
function restoreTabToPrimary(tabId: string) {
  const tabs = getDrawerTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab || !tab.root) return

  // Remove resize handler
  const resizeHandler = (tab.root as any).__sidebarUxResizeHandler
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
    delete (tab.root as any).__sidebarUxResizeHandler
  }
  delete (tab.root as any).__sidebarUxPositionUpdate

  // Restore original styles
  const saved = _savedStyles.get(tab.root)
  if (saved) {
    tab.root.style.cssText = saved.cssText
    _savedStyles.delete(tab.root)
  }

  // Phase 4 (finding #2): use the centralized repositionTab which now also
  // handles the WeakMap-based original parent tracking. Falls back to
  // getMainPanelContent() if the original parent was detached.
  repositionTab(tabId, 'primary')

  // Phase 4 (finding #2): if the restored tab was the active secondary tab,
  // fall through to a neighbor so the secondary panel doesn't end up
  // showing the moved tab's name in an empty content area.
  if (_activeSecondaryTabId === tabId) {
    // Find the next visible secondary tab in the assignment list, skipping
    // the one we just moved. Iterate _tabAssignments in insertion order to
    // keep a stable "next" pick.
    let neighborId: string | null = null
    for (const [tid, side] of _tabAssignments) {
      if (side === 'secondary' && tid !== tabId) {
        neighborId = tid
        break
      }
    }
    if (neighborId) {
      dlog(`restoreTabToPrimary: falling through to neighbor tab ${neighborId}`)
      showSecondaryTab(neighborId)
    } else {
      dlog('restoreTabToPrimary: no neighbor tab in secondary; clearing panel header')
      clearSecondaryTab()
    }
  }

  // Restore overflow on ancestors
  restoreOverflow(tab.root)
}

/**
 * Phase 4 (finding #2): hide the secondary panel header and content when
 * no tab is assigned. Used by restoreTabToPrimary when the last secondary
 * tab is moved out. Mirrors the empty-state behavior of Lumiverse's
 * main drawer when no tab is active.
 */
function clearSecondaryTab() {
  const title = _secondaryWrapper?.querySelector('.sidebar-ux-panel-title')
  if (title) title.textContent = ''
  const allBtns = _secondaryWrapper?.querySelectorAll('.sidebar-ux-tab-list button[data-tab-id]') as NodeListOf<HTMLElement>
  if (allBtns) {
    for (const btn of allBtns) {
      btn.classList.remove('sidebar-ux-tab-active')
      btn.style.color = ''
      btn.style.background = ''
      btn.style.boxShadow = ''
      btn.style.borderRadius = ''
      const label = btn.querySelector('.sidebar-ux-tab-label') as HTMLElement
      if (label) label.style.color = ''
    }
  }
  // Hide all tab roots in the panel content
  for (const [, sidebar] of _tabAssignments) {
    if (sidebar !== 'secondary') continue
    const tabs = getDrawerTabs()
    for (const t of tabs) {
      if (t.root) t.root.style.setProperty('display', 'none', 'important')
    }
  }
  _activeSecondaryTabId = null
}

/**
 * Reposition all assigned tabs (called after secondary sidebar opens/resizes).
 */
function repositionAssignedTabs() {
  for (const [tabId, sidebar] of _tabAssignments) {
    if (sidebar === 'secondary') {
      repositionTabToSecondary(tabId)
    }
  }
}

/**
 * Hide all repositioned tabs (called when secondary sidebar closes).
 */
function hideRepositionedTabs() {
  for (const [tabId, sidebar] of _tabAssignments) {
    if (sidebar === 'secondary') {
      const tabs = getDrawerTabs()
      const tab = tabs.find(t => t.id === tabId)
      if (tab && tab.root) {
        tab.root.style.setProperty('display', 'none', 'important')
      }
    }
  }
}

// --- Tab Button Management ---

function hideMainTabButton(tabId: string) {
  const btn = findMainTabButton(tabId)
  if (btn) (btn as HTMLElement).style.display = 'none'
}

function showMainTabButton(tabId: string) {
  const btn = findMainTabButton(tabId)
  if (btn) (btn as HTMLElement).style.display = ''
}

function findMainTabButton(tabId: string): Element | null {
  const sidebar = getMainSidebar()
  if (!sidebar) {
    dwarn('findMainTabButton: no sidebar found')
    return null
  }

  // Fast path: id-based match via data-tab-id (set by tagMainSidebarButtons).
  // This is the canonical match — stable across title changes, translations,
  // and version-suffix drift. Skips the store lookup entirely.
  const byId = sidebar.querySelector(`button[data-tab-id="${cssEscape(tabId)}"]`)
  if (byId) return byId

  // Fallback: title-based match via the store. Used only when the button
  // hasn't been tagged yet (very brief window after mount) or when a stale
  // tabId is being looked up.
  const tabs = getDrawerTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab) {
    dwarn(`findMainTabButton: no tab in store for id="${tabId}", known tabs=`, tabs.map(t => ({ id: t.id, title: t.title })))
    return null
  }

  const buttons = sidebar.querySelectorAll('button[title]')
  for (const btn of buttons) {
    if (btn.getAttribute('title') === tab.title) {
      // Backfill data-tab-id so future lookups hit the fast path.
      btn.setAttribute('data-tab-id', tab.id)
      return btn
    }
  }
  dwarn(`findMainTabButton: no button for id="${tabId}" (title="${tab.title}") found among ${buttons.length} buttons`)
  return null
}

/**
 * Escape a string for safe inclusion inside a CSS attribute selector value.
 * CSS.escape() exists in all modern browsers but the type isn't always
 * available in TS lib.dom depending on target. This is a minimal escape for
 * the characters that can actually appear in our tabIds.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/(["\\])/g, '\\$1')
}

function addSecondaryTabButton(tab: { id: string; title: string; shortName?: string; iconSvg?: string; iconUrl?: string; root: HTMLElement }) {
  const tabList = _secondaryWrapper?.querySelector('.sidebar-ux-tab-list')
  if (!tabList || tabList.querySelector(`[data-tab-id="${tab.id}"]`)) return
  const showLabels = isShowTabLabels()
  dlog(`addSecondaryTabButton: id=${tab.id} title="${tab.title}" iconSvg=${!!tab.iconSvg} iconUrl=${!!tab.iconUrl} shortName="${tab.shortName}" showLabels=${showLabels}`)

  const btn = document.createElement('button')
  btn.setAttribute('data-tab-id', tab.id)
  btn.setAttribute('title', tab.title)
  btn.style.cssText = `
    width: 100%;
    height: ${showLabels ? '56px' : '48px'};
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    border-radius: 8px;
    background: transparent;
    border: none;
    color: var(--lumiverse-text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
  `

  // Render icon from store data (matches ViewportDrawer.tsx rendering)
  const iconWrap = document.createElement('span')
  iconWrap.style.cssText = 'display: flex; align-items: center; justify-content: center; flex-shrink: 0;'
  if (tab.iconSvg) {
    iconWrap.innerHTML = tab.iconSvg
  } else if (tab.iconUrl) {
    const img = document.createElement('img')
    img.src = tab.iconUrl
    img.alt = ''
    img.width = 20
    img.height = 20
    img.style.borderRadius = '2px'
    iconWrap.appendChild(img)
  } else {
    iconWrap.innerHTML = PUZZLE_ICON_SVG
  }
  btn.appendChild(iconWrap)

  // Render label
  const labelSpan = document.createElement('span')
  labelSpan.className = 'sidebar-ux-tab-label'
  labelSpan.textContent = deriveShortName(tab.title, tab.shortName)
  labelSpan.style.cssText = `
    font-size: calc(9px * var(--lumiverse-font-scale, 1));
    font-weight: 500;
    line-height: 1;
    color: var(--lumiverse-text-dim);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 48px;
    opacity: ${showLabels ? '1' : '0'};
    height: ${showLabels ? 'auto' : '0'};
    margin-top: ${showLabels ? '1px' : '0'};
    transition: opacity 0.2s ease, height 0.2s ease, margin 0.2s ease;
  `
  btn.appendChild(labelSpan)

  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'var(--lumiverse-primary-015)'
    btn.style.color = 'var(--lumiverse-text)'
    dlog(`mouseenter: tab=${tab.id} btn.style.color=var(--lumiverse-text)`)
  })
  btn.addEventListener('mouseleave', () => {
    // Restore label color (label has its own color rule, unaffected by parent hover)
    const isActive = btn.classList.contains('sidebar-ux-tab-active')
    btn.style.background = isActive ? 'var(--lumiverse-primary-020)' : ''
    btn.style.color = isActive ? 'var(--lumiverse-primary)' : 'var(--lumiverse-text-muted)'
    labelSpan.style.color = isActive ? 'var(--lumiverse-primary)' : 'var(--lumiverse-text-dim)'
    // Restore active box-shadow/border-radius if needed
    if (isActive) {
      const secondarySide = getMainDrawerSide() === 'left' ? 'right' : 'left'
      const indicatorOnRight = secondarySide === 'left'
      btn.style.boxShadow = `inset ${indicatorOnRight ? '-' : ''}3px 0 0 var(--lumiverse-primary)`
      btn.style.borderRadius = indicatorOnRight ? '8px 0 0 8px' : '0 8px 8px 0'
    }
    dlog(`mouseleave: tab=${tab.id} isActive=${isActive} btn.style.color=${btn.style.color}`)
  })
  btn.addEventListener('click', () => {
    if (!_secondarySidebarOpen) openSecondarySidebar()
    showSecondaryTab(tab.id)
  })
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    showAssignmentMenu(e.clientX, e.clientY, tab.id, tab.title)
  })

  tabList.appendChild(btn)
}

function removeSecondaryTabButton(tabId: string) {
  const btn = _secondaryWrapper?.querySelector(`[data-tab-id="${tabId}"]`)
  btn?.remove()
}

function updateDrawerTabVisibility() {
  const drawerTab = _secondaryWrapper?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement
  if (!drawerTab) return
  const hasSecondaryTabs = [..._tabAssignments].some(([, s]) => s === 'secondary')
  drawerTab.style.display = hasSecondaryTabs ? 'flex' : 'none'
}

function showSecondaryTab(tabId: string) {
  // Phase 4 (finding #2): record which tab is now the active secondary tab.
  // restoreTabToPrimary reads this to decide whether to fall through to a
  // neighbor when the active tab is moved out.
  _activeSecondaryTabId = tabId

  const secondaryContent = _secondaryWrapper?.querySelector('.sidebar-ux-panel-content')
  // Show the requested tab, hide others
  for (const [tid, sidebar] of _tabAssignments) {
    if (sidebar !== 'secondary') continue
    const tabs = getDrawerTabs()
    const tab = tabs.find(t => t.id === tid)
    if (!tab || !tab.root) continue

    if (tid === tabId) {
      tab.root.style.setProperty('display', '', 'important')
    } else {
      tab.root.style.setProperty('display', 'none', 'important')
    }
  }

  // Update header title
  const tabs = getDrawerTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (tab) {
    const title = _secondaryWrapper?.querySelector('.sidebar-ux-panel-title')
    if (title) title.textContent = tab.title
  }

  // Update active state on tab buttons
  const secondarySide = getMainDrawerSide() === 'left' ? 'right' : 'left'
  const indicatorOnRight = secondarySide === 'left' // indicator faces content
  const allBtns = _secondaryWrapper?.querySelectorAll('.sidebar-ux-tab-list button[data-tab-id]') as NodeListOf<HTMLElement>
  if (allBtns) {
    for (const btn of allBtns) {
      const isActive = btn.getAttribute('data-tab-id') === tabId
      btn.classList.toggle('sidebar-ux-tab-active', isActive)
      // Icon color: active = primary, default = muted
      btn.style.color = isActive ? 'var(--lumiverse-primary)' : 'var(--lumiverse-text-muted)'
      // Background + border indicator (matches .tabBtnActive from ViewportDrawer.module.css)
      btn.style.background = isActive ? 'var(--lumiverse-primary-020)' : ''
      btn.style.boxShadow = isActive
        ? `inset ${indicatorOnRight ? '-' : ''}3px 0 0 var(--lumiverse-primary)`
        : 'none'
      btn.style.borderRadius = isActive
        ? (indicatorOnRight ? '8px 0 0 8px' : '0 8px 8px 0')
        : ''
      // Label color: active = primary, default = dim
      const label = btn.querySelector('.sidebar-ux-tab-label') as HTMLElement
      if (label) {
        label.style.color = isActive ? 'var(--lumiverse-primary)' : 'var(--lumiverse-text-dim)'
      }
      dlog(`showSecondaryTab: tab=${btn.getAttribute('data-tab-id')} isActive=${isActive} btn.color=${btn.style.color} computed=${getComputedStyle(btn).color}`)
    }
  }
}

// --- Context Menu ---

function createContextMenu(): HTMLElement {
  const menu = document.createElement('div')
  menu.style.cssText = `
    position: fixed;
    z-index: 999999;
    min-width: 180px;
    padding: 4px;
    background: var(--lumiverse-bg-deep);
    border: 1px solid var(--lumiverse-border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04);
    display: none;
  `
  return menu
}

function createContextMenuItem(label: string, onClick: () => void, opts?: { danger?: boolean }): HTMLElement {
  const item = document.createElement('button')
  item.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: none;
    color: ${opts?.danger ? 'var(--lumiverse-error, #e54545)' : 'var(--lumiverse-text)'};
    font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
    font-family: inherit;
    cursor: pointer;
    transition: background 120ms ease;
    text-align: left;
  `
  item.textContent = label
  item.addEventListener('mouseenter', () => {
    item.style.background = opts?.danger ? 'var(--lumiverse-danger-015)' : 'var(--lumiverse-fill, rgba(255, 255, 255, 0.06))'
  })
  item.addEventListener('mouseleave', () => {
    item.style.background = 'none'
  })
  item.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
    hideContextMenu()
  })
  return item
}

let _contextMenu: HTMLElement | null = null

function showAssignmentMenu(x: number, y: number, tabId: string, tabTitle: string) {
  if (!_contextMenu) {
    _contextMenu = createContextMenu()
    document.body.appendChild(_contextMenu)
  }

  _contextMenu.innerHTML = ''
  const currentSidebar = getTabSidebar(tabId)
  let label: string
  let targetSidebar: 'primary' | 'secondary'
  if (currentSidebar === 'secondary' && _secondarySidebarOpen) {
    label = 'Move to Main Sidebar'
    targetSidebar = 'primary'
  } else if (currentSidebar === 'secondary' && !_secondarySidebarOpen) {
    label = 'Open in Second Sidebar'
    targetSidebar = 'secondary'
  } else {
    label = 'Move to Second Sidebar'
    targetSidebar = 'secondary'
  }

  const item = createContextMenuItem(label, () => assignTab(tabId, targetSidebar))
  _contextMenu.appendChild(item)
  _contextMenu.style.left = `${x}px`
  _contextMenu.style.top = `${y}px`
  _contextMenu.style.display = 'block'

  // Adjust if off-screen
  requestAnimationFrame(() => {
    const rect = _contextMenu!.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      _contextMenu!.style.left = `${window.innerWidth - rect.width - 8}px`
    }
    if (rect.bottom > window.innerHeight) {
      _contextMenu!.style.top = `${window.innerHeight - rect.height - 8}px`
    }
  })
}

function hideContextMenu() {
  if (_contextMenu) _contextMenu.style.display = 'none'
}

function startContextMenuListener() {
  const sidebar = getMainSidebar()
  if (!sidebar) return

  sidebar.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement
    const tabBtn = target.closest('button[title]') as HTMLElement
    if (!tabBtn) return

    // Only for extension tabs (after .tabDivider)
    const isExtension = tabBtn.classList.toString().includes('Extension')
      || tabBtn.previousElementSibling?.classList.toString().includes('Divider')
    if (!isExtension) return

    e.preventDefault()
    e.stopPropagation()

    const title = tabBtn.getAttribute('title') || ''
    // Force fresh fiber walk — cache may be stale from Zustand state changes
    findStoreData(true)
    const tabs = getDrawerTabs()
    const matchedTab = tabs.find(t => t.title === title)
    const tabId = matchedTab?.id || title

    showAssignmentMenu(e.clientX, e.clientY, tabId, title)
  })

  document.addEventListener('click', hideContextMenu)
  document.addEventListener('scroll', hideContextMenu, true)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu()
  })
}

// --- Drag-to-Resize ---

function isMobile(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

function createResizeHandle(
  direction: 'left' | 'right',
  onResize: (startWidth: number, deltaPx: number) => void,
  onResizeEnd: () => void,
  enabled?: () => boolean
): HTMLElement {
  const handle = document.createElement('div')
  handle.className = 'sidebar-ux-resize-handle'
  handle.style.cssText = `
    position: absolute;
    top: 0; bottom: 0;
    width: 8px;
    cursor: col-resize;
    z-index: 99999;
    touch-action: none;
    background: transparent;
    transition: background 0.15s ease;
  `
  // Hover feedback
  handle.addEventListener('mouseenter', () => {
    handle.style.background = 'var(--lumiverse-primary-015, rgba(255, 255, 255, 0.06))'
  })
  handle.addEventListener('mouseleave', () => {
    if (!_resizeDragging) handle.style.background = 'transparent'
  })

  let startX = 0
  let startWidth = 0

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (enabled && !enabled()) return
    e.preventDefault()
    e.stopPropagation()
    startX = e.clientX
    startWidth = handle.parentElement?.getBoundingClientRect().width || 420
    _resizeDragging = true
    handle.style.background = 'var(--lumiverse-primary-020, rgba(255, 255, 255, 0.1))'

    const onMove = (e: PointerEvent) => {
      // Direction-based delta: 'right' = expand on rightward drag, 'left' = expand on leftward drag
      const delta = direction === 'right' ? e.clientX - startX : startX - e.clientX
      onResize(startWidth, delta)
    }

    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      _resizeDragging = false
      handle.style.background = 'transparent'
      onResizeEnd()
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  })

  return handle
}

let _resizeDragging = false

function mountResizeHandles() {
  if (isMobile()) return // Skip resize handles on mobile

  // Main sidebar resize handle — insert into the drawer (not panel, to avoid overflow: hidden clipping)
  const mainDrawer = getMainDrawer()
  if (mainDrawer && !mainDrawer.querySelector('.sidebar-ux-resize-handle')) {
    const mainSide = getMainDrawerSide()
    // Handle direction: 'right' means expand on rightward drag (drawer is on left, handle at right edge)
    //                   'left' means expand on leftward drag (drawer is on right, handle at left edge)
    const mainDirection = mainSide === 'left' ? 'right' : 'left'

    const handle = createResizeHandle(
      mainDirection,
      (startWidth, delta) => {
        const newWidth = Math.max(200, Math.min(window.innerWidth * 0.8, startWidth + delta))
        const drawer = getMainDrawer()
        const wrapper = getMainWrapper()
        if (drawer) {
          drawer.style.width = `${newWidth}px`
        }
        // Set --drawer-panel-w on the WRAPPER (React sets it there for the close transform)
        if (wrapper) {
          wrapper.style.setProperty('--drawer-panel-w', `${newWidth}px`, 'important')
        }
        scheduleReflow()
      },
      () => {
        const width = getMainDrawerWidth()
        const vw = Math.round((width / window.innerWidth) * 100)
        persistMainWidth(vw)
      },
      () => isMainDrawerOpen()
    )

    // Position at the drawer's inner edge (facing content area)
    // Uses CSS variable so handle tracks the correct edge if tab strip position changes
    handle.style.cssText += `
      ${mainSide === 'left'
        ? `left: calc(var(--drawer-panel-w, 420px) - 4px);`
        : `right: calc(var(--drawer-panel-w, 420px) - 4px);`}
    `

    // Insert handle as sibling of panel inside the drawer
    mainDrawer.appendChild(handle)
  }

  // Secondary sidebar resize handle — insert into the secondary drawer
  if (_secondaryWrapper) {
    const secondaryDrawer = _secondaryWrapper.querySelector('.sidebar-ux-drawer') as HTMLElement
    if (secondaryDrawer && !secondaryDrawer.querySelector('.sidebar-ux-resize-handle')) {
      const secondaryDirection = 'left' // Secondary sidebar handle is at inner (left) edge — drag left to expand toward content

      const handle = createResizeHandle(
        secondaryDirection,
        (startWidth, delta) => {
          const newWidth = Math.max(200, Math.min(window.innerWidth * 0.8, startWidth + delta))
          document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${newWidth}px`)
          scheduleReflow()
          // Reposition tabs after resize
          repositionAssignedTabs()
        },
        () => {
          const width = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
          const vw = Math.round((width / window.innerWidth) * 100)
          persistSecondaryWidth(vw)
        },
        () => _secondarySidebarOpen
      )

      // Position at the drawer's inner edge (facing content area)
      // Uses CSS variable so handle tracks the correct edge if tab strip position changes
      handle.style.cssText += `
        right: calc(var(${SECONDARY_WIDTH_VAR}, 420px) - 4px);
      `

      secondaryDrawer.appendChild(handle)
    }
  }
}

function persistMainWidth(vw: number) {
  // The Zustand store snapshot doesn't expose setSetting (that's on the store API).
  // Persist via our own layout storage instead.
  persistLayout()
}

function persistSecondaryWidth(vw: number) {
  persistLayout()
}

// --- Backend Persistence ---

let _backendCtx: any = null

// Debounce timer for persistLayout (tab assignments, width)
let _saveLayoutTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Build the current layout snapshot from in-memory state. Pure — no side effects.
 */
function snapshotLayout(): any {
  return {
    primary: {
      open: isMainDrawerOpen(),
      width: getMainDrawerWidth(),
    },
    secondary: {
      open: _secondarySidebarOpen,
      width: parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420,
    },
    detachedTabs: Array.from(_tabAssignments.entries())
      .filter(([_, side]) => side === 'secondary')
      .map(([tabId, side]) => {
        const tabs = getDrawerTabs()
        const tab = tabs.find(t => t.id === tabId)
        return { tabId, tabTitle: tab?.title || tabId, sidebar: side }
      }),
  }
}

/**
 * Persist the drawer's open/closed state + width synchronously. No debounce —
 * called from openSecondarySidebar / closeSecondarySidebar / the resize handle,
 * so a user opening then immediately closing the drawer (within the 500ms
 * debounce window of persistLayout) still records the final state. The
 * verification case from the plan: "open, immediately close within 100ms —
 * final state on hard-refresh is closed."
 */
function persistOpenState(): void {
  if (!_backendCtx) return
  if (_saveLayoutTimer !== null) {
    // A debounced persistLayout is in flight; cancel it so we don't double-write.
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
  _backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout: snapshotLayout() })
}

/**
 * Persist the tab-assignment list + drawer width, debounced 500ms. Called
 * from assignTab and from the resize handle (the width change is frequent
 * during drag; the debounce coalesces to a single write at drag end).
 */
function persistLayout(): void {
  if (!_backendCtx) return
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
  }
  _saveLayoutTimer = setTimeout(() => {
    _saveLayoutTimer = null
    _backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout: snapshotLayout() })
  }, 500)
}

/**
 * @deprecated Use persistOpenState() for open/close events and persistLayout()
 * for tab-assignment / width changes. Kept as a single-call alias for any
 * code path that genuinely needs to save the whole layout synchronously.
 */
function saveLayout() {
  persistLayout()
}

function loadSavedLayout(): Promise<any> {
  if (!_backendCtx) return Promise.resolve(null)
  return new Promise((resolve) => {
    // Phase 3 (finding #13): register a one-shot handler that resolves the
    // promise when LAYOUT_DATA arrives. The handler is replaced by the
    // permanent ctx.onBackendMessage listener in setup() before any other
    // LAYOUT_DATA could come through.
    const handler = (payload: any) => {
      if (payload.type === 'LAYOUT_DATA') {
        resolve(payload.layout)
      }
    }
    _backendCtx.onBackendMessage(handler)
    _backendCtx.sendToBackend({ type: 'LOAD_LAYOUT' })
    // Safety timeout: if the backend never responds (e.g. corrupt storage),
    // resolve with null so the mount proceeds with defaults rather than
    // hanging the extension. 2s is enough for the file I/O round-trip on
    // a warm cache; longer waits mask real bugs.
    setTimeout(() => resolve(null), 2000)
  })
}

function applyLayout(layout: any) {
  if (!layout) return

  // Restore secondary sidebar width
  if (layout.secondary?.width) {
    document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${layout.secondary.width}px`)
    // Phase 3 (finding #13): createSecondarySidebar already initialized the
    // wrapper transform with the right width on mount (see the options
    // parameter). No animateWrapper call needed here — that would re-trigger
    // the close animation and cause a flicker. The conditional animateWrapper
    // below is kept as a safety net for the case where applyLayout is called
    // without a prior mountSecondarySidebar(layout) (e.g. from a future
    // "reload layout" debug action that runs after setup).
    if (_secondaryWrapper && !_secondarySidebarOpen) {
      const currentTransform = _secondaryWrapper.style.transform?.match(/-?[\d.]+/)?.[0]
      if (currentTransform !== String(layout.secondary.width)) {
        animateWrapper(layout.secondary.width)
      }
    }
  }

  // Restore tab assignments
  if (layout.detachedTabs?.length) {
    // Wait for extension tabs to register, then restore.
    // Phase 2: match by stable tabId only. Title fallback was removed because
    // tabTitle can drift across sessions (e.g. "LumiBooks" → "LumiBooks v2")
    // and was the source of the "Hone / Prompt Inspector unreliable" symptom.
    // If a stored tabId is no longer in the store (extension uninstalled or
    // id schema changed), we warn and skip — the user can clean up via the
    // future "reset layout" action.
    //
    // Phase 3 (finding #5): polling loop now calls the lighter restore path
    // (set state + update buttons + DOM move) directly, NOT assignTab. This
    // avoids the policy-layer side effects: assignTab would call
    // switchMainDrawerToFallback (which manipulates the main drawer that's
    // already in its saved state) and persistLayout (we just LOADED this
    // layout, no need to write it back).
    //
    // Phase 4.0 (suffix-drift fallback): Lumiverse assigns a session-variant
    // suffix (`:1`, `:2`, `:3`) to extension tab ids in the order they're
    // registered. The suffix in the live DOM is NOT the same as the one in
    // layout.json after a session restart — e.g. layout says
    // `prompt-viewer:2` but live is `prompt-viewer:1`. An exact-match-only
    // restore leaves the user with empty secondary panels after a restart.
    // Fix: if an exact match fails, strip the last `:N` from both the stored
    // id and each live id, and match by the stripped prefix. If exactly one
    // live id matches, use it AND rewrite the stored id in the in-memory
    // layout (so the next persistLayout write self-heals). If multiple live
    // ids match, the stripped prefix is too coarse — warn and skip.
    const stripSuffix = (id: string): string => {
      const lastColon = id.lastIndexOf(':')
      if (lastColon <= 0) return id
      const tail = id.slice(lastColon + 1)
      return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id
    }
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      const tabs = getDrawerTabs()
      for (let i = 0; i < layout.detachedTabs.length; i++) {
        const dt = layout.detachedTabs[i]
        if (_tabAssignments.has(dt.tabId)) continue
        // Try exact match first
        let tab = tabs.find(t => t.id === dt.tabId)
        let usedFallback = false
        if (!tab) {
          // Exact match missed — try stripped-suffix match
          const storedPrefix = stripSuffix(dt.tabId)
          const candidates = tabs.filter(t => stripSuffix(t.id) === storedPrefix)
          if (candidates.length === 1) {
            tab = candidates[0]
            usedFallback = true
            dlog(`applyLayout: suffix-drift fallback matched stored "${dt.tabId}" → live "${tab.id}"`)
            // Self-heal: rewrite the in-memory layout so the next persistLayout
            // call stores the live id. No additional save here — the rewrite
            // only takes effect when the user makes another change that
            // triggers persistLayout (open/close, move another tab, etc.).
            layout.detachedTabs[i] = { ...dt, tabId: tab.id }
          } else if (candidates.length > 1) {
            // Ambiguous — multiple live tabs share this stripped prefix.
            // This shouldn't happen in practice (the prefix includes the
            // extension uuid), but log defensively.
            dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" is ambiguous (${candidates.length} candidates). Skipping.`)
          }
        }
        if (tab) {
          // Lightweight restore: state + button affordances + DOM move.
          // No save (we just loaded). No open/close cascade (mount handled it).
          _tabAssignments.set(tab.id, 'secondary')
          hideMainTabButton(tab.id)
          addSecondaryTabButton(tab)
          updateDrawerTabVisibility()
          repositionTabToSecondary(tab.id)
        } else if (!usedFallback) {
          // Once we've tried a few times and the id is still missing, surface
          // a visible warning. The first few attempts may simply be racing
          // the store's tab registration.
          if (attempts === 5) {
            const knownIds = tabs.map(t => t.id)
            dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store (and no suffix-drift match). Known ids: ${knownIds.join(', ')}. Layout may be stale.`)
          }
        }
      }
      if (attempts > 20 || layout.detachedTabs.every((dt: any) => _tabAssignments.has(dt.tabId))) {
        clearInterval(interval)
        // Phase 4 (finding #2): if at least one tab was restored, pick the
        // first one as the active secondary tab. Without this, the
        // secondary panel header stays empty when the user opens the
        // drawer (showSecondaryTab was never called from the lightweight
        // restore path to avoid double-animating the active tab).
        // The first-tab pick is a reasonable default — the user can click
        // any tab button to switch. Future work: persist the active
        // secondary tab id in layout.json so we restore the exact one.
        const restored = layout.detachedTabs.find((dt: any) => _tabAssignments.has(dt.tabId))
        if (restored) {
          showSecondaryTab(restored.tabId)
        }
        // Phase 3 (finding #5): the end-of-interval open/close block is gone.
        // The drawer's open/closed state was set at mount time via the
        // initialOpen option on createSecondarySidebar, so by the time we get
        // here the wrapper is already in the correct position. This is the
        // "fully open from the first paint" requirement.
        //
        // Safety net kept for the case where applyLayout is called WITHOUT a
        // prior mountSecondarySidebar(layout) — e.g. a future "reload layout"
        // debug action that re-applies after a session tweak.
        if (layout.secondary?.open === true && !_secondarySidebarOpen) {
          openSecondarySidebar()
        } else if (layout.secondary?.open === false && _secondarySidebarOpen) {
          closeSecondarySidebar()
        }
      }
    }, 500)
  }
}

// --- Polish & Cleanup ---

// Collect all cleanup functions
const _cleanupFns: Array<() => void> = []

function registerCleanup(fn: () => void) {
  _cleanupFns.push(fn)
}

function cleanupAll() {
  // Run all registered cleanup functions
  for (const fn of _cleanupFns) {
    try { fn() } catch (err: unknown) {
      console.error('[SidebarUX] Cleanup error:', err)
    }
  }
  _cleanupFns.length = 0

  // Restore all repositioned tabs to primary
  for (const [tabId] of Array.from(_tabAssignments)) {
    restoreTabToPrimary(tabId)
    showMainTabButton(tabId)
  }
  _tabAssignments.clear()
  _savedStyles.clear()

  // Remove secondary sidebar DOM
  if (_secondaryWrapper) {
    _secondaryWrapper.remove()
    _secondaryWrapper = null
  }
  _secondarySidebarOpen = false

  // Remove context menu
  if (_contextMenu) {
    _contextMenu.remove()
    _contextMenu = null
  }

  // Remove injected styles
  const reflowStyle = document.getElementById('sidebar-ux-reflow')
  if (reflowStyle) reflowStyle.remove()
  const drawerTabStyle = document.getElementById('sidebar-ux-drawer-tab-styles')
  if (drawerTabStyle) drawerTabStyle.remove()

  // Remove chat margin variables
  const chat = getChatColumn()
  if (chat) {
    chat.style.removeProperty('--sidebar-ux-chat-ml')
    chat.style.removeProperty('--sidebar-ux-chat-mr')
  }

  // Clear save debounce timer
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
}

// Side change watcher
let _lastKnownSide: 'left' | 'right' | null = null
let _lastKnownCompact: boolean | null = null
let _lastKnownVerticalPos: number | null = null

function syncDrawerTabSettings() {
  const drawerTab = _secondaryWrapper?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement
  if (!drawerTab) return

  // Read settings from the main sidebar's drawer tab DOM directly
  const mainDrawerTab = document.querySelector('[class*="_drawerTab_"]:not(.sidebar-ux-drawer-tab)') as HTMLElement
  if (!mainDrawerTab) return

  // Detect compact from main drawer tab width
  const mainWidth = mainDrawerTab.offsetWidth
  const isCompact = mainWidth <= 36

  // Detect vertical position from main drawer tab margin
  const mainParent = mainDrawerTab.parentElement
  const verticalPos = mainParent ? parseFloat(getComputedStyle(mainDrawerTab).marginTop) / window.innerHeight * 100 : 0
  // Use the raw vh value from the style attribute if available
  const mainMarginStyle = mainDrawerTab.style.marginTop
  const posVh = mainMarginStyle ? parseFloat(mainMarginStyle) : 0

  // Sync compact state via CSS class (width/padding/gap handled by CSS rules)
  if (_lastKnownCompact !== isCompact) {
    drawerTab.classList.toggle('sidebar-ux-drawer-tab--compact', isCompact)
    _lastKnownCompact = isCompact
  }

  if (_lastKnownVerticalPos !== posVh) {
    drawerTab.style.marginTop = `${posVh}vh`
    _lastKnownVerticalPos = posVh
  }

  // Sync active state via CSS class (background/border/color handled by CSS rules)
  drawerTab.classList.toggle('sidebar-ux-drawer-tab--active', _secondarySidebarOpen)

  // Sync tab labels with showTabLabels setting
  syncSecondaryTabLabels()
}

/** Update all secondary tab buttons' label visibility to match showTabLabels. */
function syncSecondaryTabLabels() {
  const showLabels = isShowTabLabels()
  const labels = _secondaryWrapper?.querySelectorAll('.sidebar-ux-tab-label') as NodeListOf<HTMLElement>
  if (!labels) return
  for (const label of labels) {
    label.style.opacity = showLabels ? '1' : '0'
    label.style.height = showLabels ? 'auto' : '0'
    label.style.marginTop = showLabels ? '1px' : '0'
  }
}

function checkSideChanged() {
  const currentSide = getMainDrawerSide()
  if (_lastKnownSide !== null && _lastKnownSide !== currentSide) {
    // Side changed — need to recreate secondary sidebar
    if (_secondaryWrapper) {
      _secondaryWrapper.remove()
      _secondaryWrapper = null
    }
    _secondarySidebarOpen = false
    mountSecondarySidebar()
    repositionAssignedTabs()
  }
  _lastKnownSide = currentSide
  syncDrawerTabSettings()
}

let _sideCheckInterval: ReturnType<typeof setInterval> | null = null

function startSideChangeWatcher() {
  _lastKnownSide = getMainDrawerSide()
  _sideCheckInterval = setInterval(checkSideChanged, 2000)
  registerCleanup(() => {
    if (_sideCheckInterval !== null) {
      clearInterval(_sideCheckInterval)
      _sideCheckInterval = null
    }
  })
}

// Tab registration watcher (handles extension unregistration)
function startTabRegistrationWatcher() {
  let previousTabIds = new Set<string>()

  const check = () => {
    // Re-tag any main sidebar buttons that weren't tagged on the first pass.
    // This catches the case where the store's drawerTabs array was still
    // being populated when tagMainSidebarButtons() first ran from the
    // MutationObserver — the watcher's 3s poll gives the store time to
    // settle.
    tagMainSidebarButtons()

    const currentTabs = getDrawerTabs()
    const currentIds = new Set(currentTabs.map(t => t.id))

    // Check for removed tabs
    for (const oldId of previousTabIds) {
      if (!currentIds.has(oldId) && _tabAssignments.has(oldId)) {
        dlog(`Extension tab ${oldId} was removed, cleaning up`)
        _tabAssignments.delete(oldId)
        removeSecondaryTabButton(oldId)
        persistLayout()
      }
    }

    previousTabIds = currentIds
  }

  const interval = setInterval(check, 3000)
  registerCleanup(() => clearInterval(interval))
}

// --- Setup ---

export function setup(ctx: any) {
  _backendCtx = ctx

  // Global debug function — call from browser console: window.__sidebarUxDebug()
  ;(window as any).__sidebarUxDebug = function() {
    console.log('=== SidebarUX Fiber Scan ===')

    const sidebar = document.querySelector('[data-spindle-mount="sidebar"]')
    if (!sidebar) { console.log('No sidebar found'); return }

    const fiberKey = Object.keys(sidebar).find(k => k.startsWith('__reactFiber$'))
    if (!fiberKey) { console.log('No fiber key'); return }

    const visited = new Set<any>()
    function scan(fiber: any, depth: number, maxDepth: number): void {
      if (!fiber || depth > maxDepth || visited.has(fiber)) return
      visited.add(fiber)

      let hook = fiber.memoizedState
      let hookIdx = 0
      while (hook && hookIdx < 30) {
        const state = hook.memoizedState

        // Check for drawerTabs array (array of objects with id+title+root)
        if (Array.isArray(state) && state.length > 0 && state[0] && typeof state[0] === 'object') {
          const firstKeys = Object.keys(state[0])
          if (firstKeys.includes('id') && firstKeys.includes('title') && firstKeys.includes('root')) {
            console.log(`*** FOUND drawerTabs at depth=${depth} hook=${hookIdx}: ${state.length} tabs ***`)
            state.forEach((t: any, i: number) => console.log(`  [${i}] id=${t.id} title=${t.title}`))
          }
        }

        // Check for objects with drawerOpen/drawerTab (full store snapshot)
        if (state && typeof state === 'object' && !Array.isArray(state)) {
          const keys = Object.keys(state)
          if (keys.includes('drawerOpen') || keys.includes('drawerTabs')) {
            console.log(`*** FOUND store snapshot at depth=${depth} hook=${hookIdx}: ${keys.length} keys ***`)
            console.log(keys.slice(0, 25))
          }
        }

        hook = hook.next
        hookIdx++
      }

      scan(fiber.child, depth + 1, maxDepth)
      scan(fiber.sibling, depth, maxDepth)
    }

    // Strategy: walk UP from sidebar to find common ancestor, then DOWN into all children
    console.log('Walking UP from sidebar to find ancestors...')
    let fiber: any = (sidebar as any)[fiberKey]
    const ancestors: any[] = []
    while (fiber) {
      ancestors.push(fiber)
      fiber = fiber.return
    }
    console.log(`Found ${ancestors.length} ancestors`)

    // Now walk DOWN from each ancestor (the higher ones cover more tree)
    for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 5); i--) {
      console.log(`Scanning down from ancestor at position ${i}...`)
      scan(ancestors[i], 0, 30)
    }
    console.log('Done')
  }

  // Phase 3 (finding #13): load the persisted layout BEFORE mounting the
  // secondary sidebar so its initial position matches the saved state on the
  // first paint — no 68px sliver, no 500ms flicker. The previous order
  // (mount first, then load + applyLayout) caused a race where the wrapper
  // was at translateX(420px) for one frame before applyLayout re-animated it.
  loadSavedLayout().then((layout) => {
    const initialWidth = layout?.secondary?.width
    const initialOpen = layout?.secondary?.open === true

    // Mount with the saved initial state. If layout is null (corrupt storage,
    // safety timeout fired, first-ever run), mount with defaults.
    mountSecondarySidebar({ initialWidth, initialOpen })

    // Start features — observers, listeners, watchers
    startReflowObserver()
    mountResizeHandles()
    startContextMenuListener()
    startSideChangeWatcher()
    startTabRegistrationWatcher()

    // Apply the rest of the layout (tab assignments + width delta if any).
    // applyLayout is now safe to call after mount: it won't double-animate
    // the wrapper (the width-restore guard checks currentTransform), and
    // the polling loop uses the lightweight restore path (state + buttons
    // + DOM move) instead of assignTab.
    if (layout) {
      applyLayout(layout)
    }
  })

  // Register the permanent backend message handler for any future LAYOUT_DATA
  // (the one-shot handler in loadSavedLayout resolved and detached, but
  // ctx.onBackendMessage implementations typically accumulate handlers, so
  // this is just a no-op safety belt).
  ctx.onBackendMessage((payload: any) => {
    if (payload.type === 'LAYOUT_DATA') {
      dlog('setup: late LAYOUT_DATA received after initial load — ignoring (already applied)')
    }
  })

  // Return teardown — called when extension is disabled
  return cleanupAll
}
