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
// - deriveShortName: short name adapter matching Lumiverse's logic.
import { getMainSidebar } from '../dom/lumiverse'
import { getDrawerTabs, getMainDrawerSide } from '../store'
import { dlog, dwarn } from '../debug/log'
import { isShowTabLabels } from '../sidebar/polish'
import { getSecondaryWrapper, isSecondarySidebarOpen, openSecondarySidebar, PUZZLE_ICON_SVG } from '../sidebar/secondary'
import { getTabAssignments, setActiveSecondaryTabId } from '../tabs/assignment'
import { showAssignmentMenu } from './tab-context-menu'



export function hideMainTabButton(tabId: string): void {
  const btn = findMainTabButton(tabId)
  if (btn) (btn as HTMLElement).style.display = 'none'
}

export function showMainTabButton(tabId: string): void {
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
 * switchDrawerToFallback and tearDownSecondarySidebar — clicking the
 * Settings tab when the only extension tab is being moved opens the
 * Settings panel and leaves a ghost panel in the main sidebar.
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
 *   - tabs/assignment.ts switchDrawerToFallback  (the "last extension
 *     tab moved out" path — the bug this fixes)
 *   - sidebar/secondary.tsx tearDownSecondarySidebar  (the same
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

interface SecondaryTabDescriptor {
  id: string
  title: string
  shortName?: string
  iconSvg?: string
  iconUrl?: string
  root: HTMLElement
}

export function addSecondaryTabButton(tab: SecondaryTabDescriptor): void {
  const tabList = getSecondaryWrapper()?.querySelector('.sidebar-ux-tab-list')
  if (!tabList || tabList.querySelector(`[data-tab-id="${tab.id}"]`)) return
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
    if (!isSecondarySidebarOpen()) openSecondarySidebar()
    showSecondaryTab(tab.id)
  })
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    showAssignmentMenu(e.clientX, e.clientY, tab.id, tab.title, btn)
  })

  tabList.appendChild(btn)
}

export function removeSecondaryTabButton(tabId: string): void {
  const btn = getSecondaryWrapper()?.querySelector(`[data-tab-id="${tabId}"]`)
  btn?.remove()
}

export function updateDrawerTabVisibility(): void {
  const drawerTab = getSecondaryWrapper()?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement
  if (!drawerTab) return
  const hasSecondaryTabs = [...getTabAssignments()].some(([, s]) => s === 'secondary')
  drawerTab.style.display = hasSecondaryTabs ? 'flex' : 'none'
}

export function showSecondaryTab(tabId: string): void {
  // Record which tab is now active so restoreTabToPrimary can fall through
  // to a neighbor when the active tab is moved out.
  setActiveSecondaryTabId(tabId)

  // Show the requested tab, hide others
  for (const [tid, sidebar] of getTabAssignments()) {
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
    const title = getSecondaryWrapper()?.querySelector('.sidebar-ux-panel-title')
    if (title) title.textContent = tab.title
  }

  // Update active state on tab buttons
  const secondarySide = getMainDrawerSide() === 'left' ? 'right' : 'left'
  const indicatorOnRight = secondarySide === 'left' // indicator faces content
  const allBtns = getSecondaryWrapper()?.querySelectorAll('.sidebar-ux-tab-list button[data-tab-id]') as NodeListOf<HTMLElement>
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

