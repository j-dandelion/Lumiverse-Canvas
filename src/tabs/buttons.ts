// Main- and secondary-sidebar tab button management.
//
// - hideMainTabButton / showMainTabButton: toggle the main sidebar button's
//   visibility (when a tab moves to the secondary, we hide its main entry;
//   when it moves back, we show it).
// - findMainTabButton: id-based match via data-tab-id, with a title-match
//   fallback for the brief pre-tag window. The id-based match is the
//   canonical lookup; the title-fallback is the v1.3.0 design intent and
//   should be deleted once the tagger is unconditionally run (deferred
//   per the plan's startTagObserver open question).
// - addSecondaryTabButton / removeSecondaryTabButton / updateDrawerTabVisibility
//   / showSecondaryTab: secondary sidebar's per-tab buttons and visibility.
// - reorderSecondaryTabButtons / applyHiddenTabIdsToSecondary: configure-tabs
//   commit helpers.
// - deriveShortName: short name adapter matching Lumiverse's logic.
import { getMainSidebar } from '../dom/lumiverse'
import { getDrawerTabs } from '../store'
import { dlog, dwarn } from '../debug/log'
import { isShowTabLabels } from '../sidebar/drawer-sync'
import {
  closeSecondarySidebar,
  getSecondaryTabList,
  getSecondaryWrapper,
  isSecondarySidebarOpen,
  openSecondarySidebar,
  PUZZLE_ICON_SVG,
} from '../sidebar/secondary'
import { getSettings } from '../settings/state'
import { isHideDrawerOpenCloseButtonsEnabled } from '../settings/state'
import { getActiveSecondaryTabId, getTabAssignments, setActiveSecondaryTabId } from '../tabs/assignment'
import { showAssignmentMenu } from './tab-context-menu'
import { persistLayout } from '../layout/persist'

// Test seams for hideMainTabButton / showMainTabButton — allows tests to override the real implementations
let _hideMainTabButtonOverride: ((tabId: string) => void) | null = null
let _showMainTabButtonOverride: ((tabId: string) => void) | null = null
export function __setHideMainTabButtonForTest(fn: typeof _hideMainTabButtonOverride): void {
  _hideMainTabButtonOverride = fn
}
export function __setShowMainTabButtonForTest(fn: typeof _showMainTabButtonOverride): void {
  _showMainTabButtonOverride = fn
}

export function hideMainTabButton(tabId: string): void {
  if (_hideMainTabButtonOverride) { _hideMainTabButtonOverride(tabId); return }
  const btn = findMainTabButton(tabId)
  if (btn) (btn as HTMLElement).style.display = 'none'
}

export function showMainTabButton(tabId: string): void {
  if (_showMainTabButtonOverride) { _showMainTabButtonOverride(tabId); return }
  const btn = findMainTabButton(tabId)
  if (btn) (btn as HTMLElement).style.display = ''
}

export function findMainTabButton(tabId: string): Element | null {
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

  // LumiScript interference fallback: direct title-based lookup. When the
  // store is broken (returns only LumiScript's dock panel), tagMainSidebarButtons
  // can't tag extension tab buttons with data-tab-id, and the store-based
  // title lookup also fails. But Canvas's context-menu falls back to setting
  // tabId = title when matchedTab is null, so for extension tabs the
  // right-clicked button's title literally matches the tabId we're looking up.
  const byTitle = sidebar.querySelector(`button[title="${cssEscape(tabId)}"]`)
  if (byTitle) {
    // Backfill data-tab-id so future lookups hit the fast path. Use the
    // tabId-as-title as a stable id for this session (we don't know the
    // real id since the store is broken).
    byTitle.setAttribute('data-tab-id', tabId)
    return byTitle
  }

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
export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/(["\\])/g, '\\$1')
}

/**
 * Heuristic: does this sidebar button represent the Lumiverse Settings tab?
 * Used to exclude the Settings tab from fallback-button picks in
 * tearDownSecondarySidebar — clicking the Settings tab when the only
 * extension tab is being moved opens the Settings panel and leaves a
 * ghost panel in the main sidebar.
 *
 * The predicate is intentionally multi-pronged because Lumiverse's CSS
 * class names are module-hashed in production builds and the Settings
 * tab's human-readable identifier may move between aria-label, title,
 * and className across versions:
 *
 *   - className includes `tabBtnSettings`  (CSS-module prefix convention,
 *     mirrors the `tabBtnExtension` we already filter on)
 *   - aria-label / title contains "settings" or "preferences"
 *     (case-insensitive; covers i18n where the human label differs but
 *     a substring like "Settings" still appears)
 *
 * If Lumiverse renames the tab in a way none of these match, the worst
 * case is the original bug regresses — never worse than the pre-fix
 * behavior. Update the predicate if that happens.
 */
export function isSettingsButton(btn: HTMLElement): boolean {
  const cls = (btn.className || '').toString()
  if (cls.includes('tabBtnSettings')) return true
  const aria = (btn.getAttribute('aria-label') || '').toLowerCase()
  const title = (btn.getAttribute('title') || '').toLowerCase()
  if (aria.includes('settings') || aria.includes('preferences')) return true
  if (title.includes('settings') || title.includes('preferences')) return true
  return false
}

/**
 * Pick a safe built-in (non-extension, non-settings) button to click when
 * we need to swap the main drawer's active tab away from a tab we're
 * about to move or remove. Returns the first such button, or null if
 * none is visible.
 *
 * "Safe" means: not an extension tab (we don't want to click another
 * extension tab and trigger a different state change) AND not the
 * Settings tab (clicking Settings opens the Settings panel and leaves
 * a ghost panel behind).
 *
 * Used by:
 *   - sidebar/secondary.tsx tearDownSecondarySidebar  (the
 *     fallback when the secondary sidebar is torn down with an
 *     active secondary tab)
 */
export function findSafeFallbackButton(sidebar: HTMLElement): HTMLElement | null {
  const allButtons = Array.from(
    sidebar.querySelectorAll('button[class*="tabBtn"]'),
  ) as HTMLElement[]
  return (
    allButtons.find(
      (b) =>
        b.style.display !== 'none' &&
        b.className.includes('tabBtn') &&
        !b.className.includes('tabBtnExtension') &&
        !isSettingsButton(b),
    ) ?? null
  )
}


// Derive shortName matching Lumiverse's adaptExtensionTabs logic.
export function deriveShortName(title: string, shortName?: string): string {
  if (shortName) return shortName
  return title.length > 8 ? title.slice(0, 7) + '…' : title
}

/**
 * Read the short name from a main sidebar button's label span.
 * The main drawer renders a <span> with class containing "tabLabel"
 * inside each tab button (ViewportDrawer.tsx:236). Returns undefined
 * if no label is found (e.g., showTabLabels is off, or button not found).
 */
export function readMainButtonShortName(mainBtn: Element | null): string | undefined {
  if (!mainBtn) return undefined
  const label = mainBtn.querySelector('span[class*="tabLabel"]') as HTMLElement | null
  if (label && label.textContent) return label.textContent.trim()
  return undefined
}

interface SecondaryTabDescriptor {
  id: string
  title: string
  shortName?: string
  iconSvg?: string
  iconUrl?: string
  root: HTMLElement
}

export function addSecondaryTabButton(tab: SecondaryTabDescriptor): void {
  // Use getSecondaryTabList() so this works when taskbarMode has
  // reparented the list onto the body-level pin host (outside the wrapper).
  const tabList = getSecondaryTabList()
  const _bareId = tab.id.includes(':')
    ? (tab.id.replace(/:\d+$/, '').split(':').pop() ?? tab.id)
    : tab.id
  const alreadyHasButton = !!(tabList && (
    tabList.querySelector(`[data-tab-id="${CSS.escape(tab.id)}"]`) ||
    tabList.querySelector(`[data-tab-id="${CSS.escape(_bareId)}"]`)
  ))
  if (!tabList || alreadyHasButton) return
  const showLabels = isShowTabLabels()
  dlog(`addSecondaryTabButton: id=${tab.id} title="${tab.title}" iconSvg=${!!tab.iconSvg} iconUrl=${!!tab.iconUrl} shortName="${tab.shortName}" showLabels=${showLabels}`)

  const btn = document.createElement('button')
  btn.setAttribute('data-tab-id', tab.id)
  btn.setAttribute('title', tab.title)
  if (showLabels) btn.classList.add('sidebar-ux-tab-labeled')
  btn.style.cssText = `
    width: 100%;
    height: ${showLabels ? '56px' : '48px'};
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
  `

  // Render icon from store data (matches ViewportDrawer.tsx rendering)
  const iconWrap = document.createElement('span')
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

  // Render label (visibility matches host showTabLabels; host unmounts the
  // span when off — we keep the node and collapse via display/opacity so
  // syncSecondaryTabLabels can toggle without recreating buttons).
  const labelSpan = document.createElement('span')
  labelSpan.className = 'sidebar-ux-tab-label'
  labelSpan.textContent = deriveShortName(tab.title, tab.shortName)
  labelSpan.style.cssText = showLabels
    ? `opacity:1;height:auto;margin-top:1px;transition:opacity 0.2s ease, height 0.2s ease, margin 0.2s ease`
    : `display:none;visibility:hidden;opacity:0;height:0;min-height:0;margin-top:0;transition:opacity 0.2s ease, height 0.2s ease, margin 0.2s ease`
  btn.appendChild(labelSpan)

  btn.addEventListener('click', () => {
    if (isSecondarySidebarOpen()) {
      if (getActiveSecondaryTabId() === tab.id) {
        closeSecondarySidebar()
      } else {
        showSecondaryTab(tab.id)
      }
    } else {
      openSecondarySidebar()
      showSecondaryTab(tab.id)
    }
  })
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    showAssignmentMenu(e.clientX, e.clientY, tab.id, tab.title, btn)
  })

  tabList.appendChild(btn)
  // Taskbar pin tracks secondary assignment count — re-evaluate after first tab.
  void import('../sidebar/tab-position').then((m) => m.reconcileTabListPin())
}

export function removeSecondaryTabButton(tabId: string): void {
  // Prefer the tab list (works pinned or unpinned). Fall back to wrapper
  // for any stray buttons that might still live under the drawer chrome.
  const btn =
    getSecondaryTabList()?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`) ??
    getSecondaryWrapper()?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`)
  btn?.remove()
  // Last tab removed: unpin empty secondary strip under taskbar mode.
  void import('../sidebar/tab-position').then((m) => m.reconcileTabListPin())
}

/**
 * Reorder secondary tab buttons to match the given id order.
 * Uses DOM appendChild (which moves existing nodes) — creates nothing if
 * a button for an id is missing. This is a separate path from
 * addSecondaryTabButton; the alreadyHasButton guard in that function does
 * NOT block this reorder.
 */
export function reorderSecondaryTabButtons(ids: string[]): void {
  const tabList = getSecondaryTabList()
  if (!tabList) return
  for (const id of ids) {
    const btn = tabList.querySelector(`[data-tab-id="${CSS.escape(id)}"]`) as HTMLElement | null
    if (btn) {
      // appendChild moves an existing node to the end of the parent's
      // children list. Iterating ids in order and appending each yields
      // the desired sequence.
      tabList.appendChild(btn)
    }
  }
}

/**
 * Reorder main-mirror primary strip buttons to match the given id order.
 * Targets `.sidebar-ux-tab-list-main` only (Settings stays in bottom dock).
 * Missing ids are skipped. Used by configure-commit so primary reorder
 * sticks even when host React has not yet re-rendered host button order.
 */
export function reorderMainMirrorTabButtons(ids: string[]): void {
  const main = document.querySelector(
    '.sidebar-ux-main-tab-list-mirror .sidebar-ux-tab-list-main',
  ) as HTMLElement | null
  if (!main) return
  for (const id of ids) {
    const btn = main.querySelector(
      `button[data-tab-id="${cssEscape(id)}"]`,
    ) as HTMLElement | null
    if (btn && btn.parentElement === main) {
      main.appendChild(btn)
    }
  }
}

/**
 * Reorder host React main tab-list buttons to match the given id order.
 * Targets the host `.tabList` under `.tabListWrap` (not Settings bottom).
 * React may re-render later from tabOrder; when tabOrder matches this
 * order the visual is stable. Used so primary DnD sticks immediately.
 */
export function reorderHostMainTabButtons(ids: string[]): void {
  const sidebar = getMainSidebar()
  if (!sidebar) return
  // Prefer the scrollable tab list (sibling of sidebarBottom), not the wrap.
  const tabList =
    (sidebar.querySelector(
      '[class*="tabListWrap"] > [class*="tabList"]',
    ) as HTMLElement | null) ||
    (sidebar.querySelector('[class*="tabList"]') as HTMLElement | null)
  if (!tabList) return
  for (const id of ids) {
    const btn = tabList.querySelector(
      `button[data-tab-id="${cssEscape(id)}"]`,
    ) as HTMLElement | null
    if (btn && btn.parentElement === tabList) {
      tabList.appendChild(btn)
    }
  }
}

/**
 * Apply the hidden set to secondary tab buttons.
 * Buttons whose data-tab-id is in hiddenIds get `display: none`;
 * those not in the set (but still assigned and present) are shown.
 */
export function applyHiddenTabIdsToSecondary(hiddenIds: ReadonlySet<string>): void {
  const tabList = getSecondaryTabList()
  if (!tabList) return
  for (const btn of Array.from(tabList.querySelectorAll('button[data-tab-id]')) as HTMLElement[]) {
    const tid = btn.getAttribute('data-tab-id') || ''
    if (hiddenIds.has(tid)) {
      btn.style.display = 'none'
    } else {
      btn.style.display = ''
    }
  }
}

/**
 * Apply the hidden set to main-mirror tab buttons.
 * Uses getMainMirrorTabList from the mirror module.
 */
export function applyHiddenTabIdsToMirror(hiddenIds: ReadonlySet<string>): void {
  // Lazy-import to avoid circular dependency at module level.
  void import('../sidebar/main-mirror-drawer').then((m) => {
    const list = m.getMainMirrorTabList()
    if (!list) return
    for (const btn of Array.from(list.querySelectorAll('button[data-tab-id]')) as HTMLElement[]) {
      const tid = btn.getAttribute('data-tab-id') || ''
      if (hiddenIds.has(tid)) {
        btn.style.display = 'none'
      } else {
        btn.style.display = ''
      }
    }
  })
}

// Local wrapper to avoid a static import cycle with sidebar/mobile-exclusion
// (mobile-exclusion → secondary → buttons → mobile-exclusion).
function _isMobileViewport(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(max-width: 600px)').matches
}

/**
 * Update the secondary drawer's edge toggle button visibility.
 *
 * Desktop logic:
 *   - If hideDrawerOpenCloseButtons is on AND taskbar mode is on → always hidden.
 *     (Without taskbar mode the edge button is the only reopen affordance.)
 *   - Otherwise → visible when at least one tab is assigned to secondary.
 *
 * Mobile logic (never affected by hideDrawerOpenCloseButtons):
 *   - Visible when at least one secondary tab (has-tabs).
 *   - Mutual-exclusion body classes (canvas-ux-mobile-*) handle the
 *     actual desktop-vs-secondary toggle — managed by mobile-exclusion.ts.
 */
export function updateDrawerTabVisibility(): void {
  const drawerTab = getSecondaryWrapper()?.querySelector(
    '.sidebar-ux-drawer-tab',
  ) as HTMLElement | null
  if (!drawerTab) return

  const hasSecondaryTabs = [...getTabAssignments()].some(([, s]) => s === 'secondary')

  // Mobile: never apply hide setting; clear any stale desktop inline hide.
  if (_isMobileViewport()) {
    drawerTab.style.display = hasSecondaryTabs ? 'flex' : 'none'
    return
  }

  if (isHideDrawerOpenCloseButtonsEnabled()) {
    drawerTab.style.display = 'none'
    return
  }

  drawerTab.style.display = hasSecondaryTabs ? 'flex' : 'none'
}

/**
 * Remove the visual active highlight from all secondary tab buttons.
 * Does not clear `getActiveSecondaryTabId()` — memory of the last active
 * tab is retained for reopen / restore. Used when the drawer closes and
 * after layout restore finishes with the drawer closed (finishRestore
 * calls showSecondaryTab then applySecondaryOpenState; the open-state
 * path is a no-op when already closed, so highlight would otherwise stick).
 */
export function clearSecondaryTabButtonActive(): void {
  const tabList = getSecondaryTabList()
  if (!tabList) return
  for (const btn of tabList.querySelectorAll('button.sidebar-ux-tab-active')) {
    btn.classList.remove('sidebar-ux-tab-active')
  }
}

export function showSecondaryTab(tabId: string): void {
  // Record which tab is now active.
  setActiveSecondaryTabId(tabId)
  // Persist the new active tab so layout restore brings back the same tab.
  // persistLayout is 500ms debounced; multiple clicks coalesce to one write.
  persistLayout()

  const secondaryContent = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-content') as HTMLElement | null

  // Iterate moved roots in the secondary content. Each root's
  // data-canvas-moved attribute carries the tabId; we activate the
  // matching root and deactivate all others. Works even when
  // getDrawerTabs is broken (LumiScript interference).
  const movedRoots = secondaryContent
    ? Array.from(secondaryContent.querySelectorAll('[data-canvas-moved]')) as HTMLElement[]
    : []
  let activeTitle = findMainTabButton(tabId)?.getAttribute('title') || ''
  for (const root of movedRoots) {
    const tid = root.getAttribute('data-canvas-moved') || ''
    if (tid === tabId) {
      root.setAttribute('data-canvas-active', '')
      // The main tab button is always in the DOM after a move (hidden via
      // display:none by hideMainTabButton), so findMainTabButton resolves
      // it. Read the title from the main button — the store's tab.title
      // is missing when LumiScript is installed.
      const mainBtn = findMainTabButton(tid)
      if (mainBtn) activeTitle = mainBtn.getAttribute('title') || ''
    } else {
      root.removeAttribute('data-canvas-active')
    }
  }

  // Update header title.
  if (activeTitle) {
    const title = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-title')
    if (title) title.textContent = activeTitle
  }

  // Update active state on tab buttons. CSS drives the active visual
  // via .sidebar-ux-tab-active — matches Lumiverse's .tabBtnActive
  // (ViewportDrawer.module.css:227-237). No inline style needed.
  //
  // Query via getSecondaryTabList() so the highlight still updates when
  // taskbarMode has reparented the list onto the pin host (outside
  // the secondary wrapper — wrapper.querySelector would miss the buttons).
  const allBtns = getSecondaryTabList()?.querySelectorAll(
    'button[data-tab-id]',
  ) as NodeListOf<HTMLElement> | undefined
  if (allBtns) {
    for (const btn of allBtns) {
      const isActive = btn.getAttribute('data-tab-id') === tabId
      btn.classList.toggle('sidebar-ux-tab-active', isActive)
      // Clear any leftover inline styles so CSS takes over.
      btn.style.color = ''
      btn.style.background = ''
      btn.style.boxShadow = ''
      btn.style.borderRadius = ''
      const label = btn.querySelector('.sidebar-ux-tab-label') as HTMLElement
      if (label) label.style.color = ''
    }
  }
}
