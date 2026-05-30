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
let _drawerTabsCache: Array<{ id: string; extensionId: string; title: string; root: HTMLElement }> | null = null
let _storeSnapshotCache: Record<string, unknown> | null = null
let _cacheTimestamp = 0
const CACHE_TTL_MS = 3000 // Re-walk fiber tree every 3 seconds max

function scanForStoreData(fiber: any, depth: number, maxDepth: number, visited: Set<any>): void {
  if (!fiber || depth > maxDepth || visited.has(fiber)) return
  visited.add(fiber)

  let hook = fiber.memoizedState
  let hookIdx = 0
  while (hook && hookIdx < 30) {
    const state = hook.memoizedState

    // Check for drawerTabs array (array of objects with id+title+root)
    if (!_drawerTabsCache && Array.isArray(state) && state.length > 0 && state[0] && typeof state[0] === 'object') {
      const firstKeys = Object.keys(state[0])
      if (firstKeys.includes('id') && firstKeys.includes('title') && firstKeys.includes('root')) {
        _drawerTabsCache = state as any
      }
    }

    // Check for objects with drawerOpen (full store snapshot)
    if (!_storeSnapshotCache && state && typeof state === 'object' && !Array.isArray(state)) {
      const keys = Object.keys(state)
      if (keys.includes('drawerOpen') || keys.includes('drawerTabs')) {
        _storeSnapshotCache = state as Record<string, unknown>
      }
    }

    if (_drawerTabsCache && _storeSnapshotCache) {
      _cacheTimestamp = Date.now()
      return // found both, stop early
    }

    hook = hook.next
    hookIdx++
  }

  scanForStoreData(fiber.child, depth + 1, maxDepth, visited)
  scanForStoreData(fiber.sibling, depth, maxDepth, visited)
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

  // Scan DOWN from the top ancestors (the root covers the whole tree)
  const visited = new Set<any>()
  for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 5); i--) {
    scanForStoreData(ancestors[i], 0, 30, visited)
    if (_drawerTabsCache && _storeSnapshotCache) {
      _cacheTimestamp = Date.now()
      break
    }
  }
}

function getDrawerTabs(): Array<{ id: string; extensionId: string; title: string; root: HTMLElement }> {
  findStoreData()
  if (_drawerTabsCache) return _drawerTabsCache
  console.warn('[SidebarUX] Could not find drawerTabs in fiber tree')
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

// --- Secondary Sidebar ---

const SECONDARY_WIDTH_VAR = '--sidebar-ux-secondary-w'

// Boolean flag for secondary sidebar open state (replaces style transform check)
let _secondarySidebarOpen = false
function createSecondarySidebar(): HTMLElement {
  const side = getMainDrawerSide() === 'left' ? 'right' : 'left'

  // Wrapper: mirrors main sidebar .wrapper exactly
  // The WRAPPER translates — drawerTab and drawer are both children, moving as one unit.
  const wrapper = document.createElement('div')
  wrapper.className = 'sidebar-ux-secondary-wrapper'
  const initWidth = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
  // Closed state: translate by drawer width so drawer is off-screen, drawerTab stays at viewport edge
  const initWrapperTransform = `translateX(${initWidth}px)`
  wrapper.style.cssText = `
    position: fixed;
    top: 0; bottom: 0;
    z-index: 99990;
    display: flex;
    align-items: stretch;
    pointer-events: none;
    transform: ${initWrapperTransform};
    ${side === 'left'
      ? `left: 0; flex-direction: row-reverse;`
      : `right: 0; flex-direction: row;`};
  `

  // Drawer tab — flex child of wrapper, NOT position: fixed.
  // When the wrapper translates, the drawerTab moves with it as a unit.
  const drawerTab = document.createElement('button')
  drawerTab.className = 'sidebar-ux-drawer-tab'
  drawerTab.style.cssText = `
    flex-shrink: 0;
    align-self: flex-start;
    width: 48px;
    display: none;
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
    border-${side === 'left' ? 'left' : 'right'}: none;
    border-radius: ${side === 'left' ? '0 12px 12px 0' : '12px 0 0 12px'};
  `
  drawerTab.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`
  drawerTab.addEventListener('mouseenter', () => {
    drawerTab.style.background = 'var(--lumiverse-bg-hover, var(--lumiverse-bg))'
    drawerTab.style.borderColor = 'var(--lumiverse-primary-050)'
    drawerTab.style.color = 'var(--lumiverse-text)'
  })
  drawerTab.addEventListener('mouseleave', () => {
    drawerTab.style.background = ''
    drawerTab.style.borderColor = ''
    drawerTab.style.color = ''
  })
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
}

function closeSecondarySidebar() {
  if (!_secondaryWrapper || !_secondaryDrawer) return
  const side = getMainDrawerSide() === 'left' ? 'right' : 'left'
  const width = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
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

  saveLayout()
}

function mountSecondarySidebar() {
  if (_secondaryWrapper) return
  _secondaryWrapper = createSecondarySidebar()
  document.body.appendChild(_secondaryWrapper)
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

  return () => observer.disconnect()
}

// --- Tab Assignment System (CSS Transform Approach) ---

// Maps tab ID → which sidebar it belongs to
const _tabAssignments: Map<string, 'primary' | 'secondary'> = new Map()

// Saved original styles for repositioned elements (for restoration)
const _savedStyles = new Map<HTMLElement, { cssText: string; overflow: string }>()

function getTabSidebar(tabId: string): 'primary' | 'secondary' {
  return _tabAssignments.get(tabId) || 'primary'
}

function assignTab(tabId: string, sidebar: 'primary' | 'secondary') {
  console.log(`[SidebarUX] assignTab: ${tabId} → ${sidebar}`)
  _tabAssignments.set(tabId, sidebar)

  // Hide/show main sidebar tab buttons
  if (sidebar === 'secondary') {
    hideMainTabButton(tabId)
  } else {
    showMainTabButton(tabId)
  }

  // Manage secondary sidebar tab buttons
  if (sidebar === 'secondary') {
    const tabs = getDrawerTabs()
    const tab = tabs.find(t => t.id === tabId)
    if (tab) addSecondaryTabButton(tab)
  } else {
    removeSecondaryTabButton(tabId)
  }
  updateDrawerTabVisibility()

  // Open secondary sidebar if assigning to it
  if (sidebar === 'secondary' && !_secondarySidebarOpen) {
    // Defer open to next animation frame.
    // updateDrawerTabVisibility() just set display: none → flex. The wrapper's initial
    // transform must be painted before we start animating it, otherwise the browser
    // renders the FINAL state without transitioning from the initial position.
    requestAnimationFrame(() => {
      openSecondarySidebar()
      setTimeout(() => {
        repositionAssignedTabs()
        showSecondaryTab(tabId)
      }, 400)
    })
  } else if (sidebar === 'secondary') {
    // Secondary already open — reposition immediately
    repositionTabToSecondary(tabId)
    showSecondaryTab(tabId)
  } else {
    // Moving back to primary — restore immediately
    restoreTabToPrimary(tabId)

    // If no more tabs assigned to secondary, close it
    const hasRemaining = [..._tabAssignments.values()].some(v => v === 'secondary')
    if (!hasRemaining && _secondarySidebarOpen) {
      closeSecondarySidebar()
    }
  }

  saveLayout()
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
 * Move a tab's root element into the secondary sidebar's content area.
 * The removeChild guard blocks React from reclaiming the node.
 */
function repositionTabToSecondary(tabId: string) {
  const tabs = getDrawerTabs()
  const tab = tabs.find(t => t.id === tabId)
  if (!tab || !tab.root) {
    console.warn(`[SidebarUX] repositionTabToSecondary: tab not found for id=${tabId}`)
    return
  }

  const secondaryContent = _secondaryWrapper?.querySelector('.sidebar-ux-panel-content') as HTMLElement
  if (!secondaryContent) {
    console.warn('[SidebarUX] repositionTabToSecondary: no secondary content area')
    return
  }

  // Install node guards on the original container so React can't reclaim this node
  const mainContent = getMainPanelContent()
  if (mainContent) {
    installNodeGuard(mainContent)
  }

  // Save original parent for restoration
  if (!(tab.root as any).__sidebarUxOriginalParent) {
    (tab.root as any).__sidebarUxOriginalParent = tab.root.parentElement
  }

  // Append to secondary sidebar content area
  secondaryContent.appendChild(tab.root)
  tab.root.style.setProperty('width', '100%', 'important')
  tab.root.style.setProperty('height', '100%', 'important')
  tab.root.style.setProperty('display', '', 'important')
}

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

  // Restore to original parent
  const originalParent = (tab.root as any).__sidebarUxOriginalParent as HTMLElement | null
  if (originalParent && tab.root.parentElement !== originalParent) {
    originalParent.appendChild(tab.root)
  }
  delete (tab.root as any).__sidebarUxOriginalParent

  // Restore overflow on ancestors
  restoreOverflow(tab.root)
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
    console.warn('[SidebarUX] findMainTabButton: no sidebar found')
    return null
  }
  // Tab buttons after .tabDivider are extension tabs
  // Match by title from the store (dt.title), not tabId
  const tabs = getDrawerTabs()
  const tab = tabs.find(t => t.id === tabId)
  const title = tab?.title
  if (!title) {
    console.warn(`[SidebarUX] findMainTabButton: no tab found for id="${tabId}", tabs=`, tabs.map(t => ({ id: t.id, title: t.title })))
    return null
  }

  const buttons = sidebar.querySelectorAll('button')
  for (const btn of buttons) {
    const btnTitle = btn.getAttribute('title')
    if (btnTitle === title) return btn
  }
  console.warn(`[SidebarUX] findMainTabButton: no button with title="${title}" found among ${buttons.length} buttons`)
  return null
}

function addSecondaryTabButton(tab: { id: string; title: string; root: HTMLElement }) {
  const tabList = _secondaryWrapper?.querySelector('.sidebar-ux-tab-list')
  if (!tabList || tabList.querySelector(`[data-tab-id="${tab.id}"]`)) return

  const btn = document.createElement('button')
  btn.setAttribute('data-tab-id', tab.id)
  btn.setAttribute('title', tab.title)
  btn.style.cssText = `
    width: 100%;
    height: 48px;
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
  btn.textContent = tab.title.charAt(0).toUpperCase()
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'var(--lumiverse-primary-015)'
    btn.style.color = 'var(--lumiverse-text)'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.background = ''
    btn.style.color = ''
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
  side: 'left' | 'right',
  onResize: (startWidth: number, deltaPx: number) => void,
  onResizeEnd: () => void
): HTMLElement {
  const handle = document.createElement('div')
  handle.className = 'sidebar-ux-resize-handle'
  handle.style.cssText = `
    position: absolute;
    top: 0; bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 99999;
    touch-action: none;
    ${side === 'left' ? 'left: -3px' : 'right: -3px'};
  `

  let startX = 0
  let startWidth = 0

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startX = e.clientX
    startWidth = handle.parentElement?.getBoundingClientRect().width || 420

    const onMove = (e: PointerEvent) => {
      const delta = side === 'left' ? startX - e.clientX : e.clientX - startX
      onResize(startWidth, delta)
    }

    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onResizeEnd()
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  })

  return handle
}

function mountResizeHandles() {
  if (isMobile()) return // Skip resize handles on mobile

  // Main sidebar resize handle — use a wrapper div, don't set position:relative on the panel
  const mainPanel = getMainPanel()
  if (mainPanel && !mainPanel.querySelector('.sidebar-ux-resize-handle')) {
    const handleWrapper = document.createElement('div')
    handleWrapper.className = 'sidebar-ux-resize-handle-wrapper'
    handleWrapper.style.cssText = `
      position: absolute;
      top: 0; bottom: 0;
      width: 0;
      pointer-events: none;
    `
    const mainSide = getMainDrawerSide()
    if (mainSide === 'left') {
      handleWrapper.style.left = '0'
    } else {
      handleWrapper.style.right = '0'
    }

    const handle = createResizeHandle(
      mainSide,
      (startWidth, delta) => {
        const newWidth = Math.max(200, Math.min(window.innerWidth * 0.8, startWidth + delta))
        const drawer = getMainDrawer()
        if (drawer) {
          drawer.style.width = `${newWidth}px`
          drawer.style.setProperty('--drawer-panel-w', `${newWidth}px`, 'important')
        }
        scheduleReflow()
      },
      () => {
        const width = getMainDrawerWidth()
        const vw = Math.round((width / window.innerWidth) * 100)
        persistMainWidth(vw)
      }
    )
    handleWrapper.appendChild(handle)

    // Insert handle wrapper as first child so it overlays the panel edge
    mainPanel.insertBefore(handleWrapper, mainPanel.firstChild)
  }

  // Secondary sidebar resize handle
  if (_secondaryWrapper) {
    const secondaryPanel = _secondaryWrapper.querySelector('.sidebar-ux-panel') as HTMLElement
    if (secondaryPanel && !secondaryPanel.querySelector('.sidebar-ux-resize-handle')) {
      const handleWrapper = document.createElement('div')
      handleWrapper.className = 'sidebar-ux-resize-handle-wrapper'
      handleWrapper.style.cssText = `
        position: absolute;
        top: 0; bottom: 0;
        width: 0;
        pointer-events: none;
      `
      const secondarySide = getMainDrawerSide() === 'left' ? 'right' : 'left'
      if (secondarySide === 'left') {
        handleWrapper.style.left = '0'
      } else {
        handleWrapper.style.right = '0'
      }

      const handle = createResizeHandle(
        secondarySide,
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
        }
      )
      handleWrapper.appendChild(handle)
      secondaryPanel.insertBefore(handleWrapper, secondaryPanel.firstChild)
    }
  }
}

function persistMainWidth(vw: number) {
  // The Zustand store snapshot doesn't expose setSetting (that's on the store API).
  // Persist via our own layout storage instead.
  saveLayout()
}

function persistSecondaryWidth(vw: number) {
  saveLayout()
}

// --- Backend Persistence ---

let _backendCtx: any = null

// Debounce timer for saveLayout
let _saveLayoutTimer: ReturnType<typeof setTimeout> | null = null

function saveLayout() {
  if (!_backendCtx) return

  // Debounce: wait 500ms after last change before persisting
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
  }
  _saveLayoutTimer = setTimeout(() => {
    _saveLayoutTimer = null
    const layout = {
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
    _backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout })
  }, 500)
}

function loadSavedLayout() {
  if (!_backendCtx) return
  _backendCtx.sendToBackend({ type: 'LOAD_LAYOUT' })
}

function applyLayout(layout: any) {
  if (!layout) return

  // Restore secondary sidebar width
  if (layout.secondary?.width) {
    document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${layout.secondary.width}px`)
  }

  // Restore tab assignments
  if (layout.detachedTabs?.length) {
    // Wait for extension tabs to register, then restore
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      const tabs = getDrawerTabs()
      for (const dt of layout.detachedTabs) {
        if (_tabAssignments.has(dt.tabId)) continue
        // Match by tabId first, then fall back to title from store
        const tab = tabs.find(t => t.id === dt.tabId || t.title === dt.tabTitle)
        if (tab) {
          assignTab(tab.id, 'secondary')
        }
      }
      if (attempts > 20 || layout.detachedTabs.every((dt: any) => _tabAssignments.has(dt.tabId))) {
        clearInterval(interval)
        // assignTab() already calls openSecondarySidebar() when sidebar is closed.
        // No redundant call here — it caused the drawerTab to desync on auto-open.
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

  if (_lastKnownCompact !== isCompact) {
    drawerTab.style.width = isCompact ? '32px' : '48px'
    drawerTab.style.padding = isCompact ? '8px 6px' : '16px 8px 20px'
    drawerTab.style.gap = isCompact ? '0' : '8px'
    _lastKnownCompact = isCompact
  }

  if (_lastKnownVerticalPos !== posVh) {
    drawerTab.style.marginTop = `${posVh}vh`
    _lastKnownVerticalPos = posVh
  }

  // Sync active state
  const isActive = _secondarySidebarOpen
  if (isActive) {
    drawerTab.style.background = 'var(--lumiverse-bg-hover, var(--lumiverse-bg))'
    drawerTab.style.borderColor = 'var(--lumiverse-primary-050)'
    drawerTab.style.color = 'var(--lumiverse-text)'
  } else {
    drawerTab.style.background = ''
    drawerTab.style.borderColor = ''
    drawerTab.style.color = ''
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
    const currentTabs = getDrawerTabs()
    const currentIds = new Set(currentTabs.map(t => t.id))

    // Check for removed tabs
    for (const oldId of previousTabIds) {
      if (!currentIds.has(oldId) && _tabAssignments.has(oldId)) {
        console.log(`[SidebarUX] Extension tab ${oldId} was removed, cleaning up`)
        _tabAssignments.delete(oldId)
        removeSecondaryTabButton(oldId)
        saveLayout()
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

  // Mount secondary sidebar
  mountSecondarySidebar()

  // Start features
  startReflowObserver()
  mountResizeHandles()
  startContextMenuListener()
  startSideChangeWatcher()
  startTabRegistrationWatcher()

  // Load persisted layout
  ctx.onBackendMessage((payload: any) => {
    if (payload.type === 'LAYOUT_DATA') {
      applyLayout(payload.layout)
    }
  })
  loadSavedLayout()

  // Return teardown — called when extension is disabled
  return cleanupAll
}
