// Panel-header sync: keep the secondary drawer's panel header in step
// with the main drawer's panel header (height, padding, title font-size,
// border, background).
//
// Extracted from secondary.tsx to reduce file size. The module-level
// state (observers + cache key) lives here; secondary.tsx imports the
// public functions.

import { getMainPanelHeader } from '../dom/lumiverse'
import { registerCleanup } from './cleanup'

// Module-level state
let _lastWrittenHeaderVars: string | null = null
let _mainPanelHeaderResizeObserver: ResizeObserver | null = null
let _mainPanelHeaderAttrObserver: MutationObserver | null = null
let _syncPanelHeaderPending = false

/**
 * Public, coalesced entry point. Call this after the secondary wrapper
 * mounts, opens/closes, or whenever the main drawer's panel header
 * might have changed. Internally routes through requestAnimationFrame
 * to dedupe rapid back-to-back calls (the ResizeObserver, the
 * MutationObserver, openSecondarySidebar, mountSecondarySidebar, and
 * the side-flip remount can all fire in the same tick).
 *
 * No-op if the secondary wrapper isn't mounted or if the main panel
 * header can't be found (e.g. cold start before Lumiverse mounted its
 * panel). The CSS variables on the wrapper stay at their initial
 * empty state, and the secondary header falls back to its inline
 * defaults (`min-height: 48px`, `padding: 12px 16px`, etc.).
 */
export function syncPanelHeaderFromMain(
  getWrapper: () => HTMLElement | null,
): void {
  if (_syncPanelHeaderPending) return
  _syncPanelHeaderPending = true
  requestAnimationFrame(() => {
    _syncPanelHeaderPending = false
    _runSyncPanelHeaderFromMain(getWrapper)
  })
}

function _runSyncPanelHeaderFromMain(
  getWrapper: () => HTMLElement | null,
): void {
  const secondaryWrapper = getWrapper()
  if (!secondaryWrapper) return
  const mainHeader = getMainPanelHeader()
  // Missing main header → keep current CSS var values (empty or stale).
  if (!mainHeader) return

  // Lazy-attach the observers on the FIRST successful run. We watch:
  //   1. ResizeObserver → fires on size changes.
  //   2. MutationObserver (class + style) → fires when Lumiverse
  //      toggles a class or rewrites inline style.
  // Both observers are attached to the main header (which survives
  // across secondary wrapper remounts), so we only ever attach once.
  if (!_mainPanelHeaderResizeObserver) {
    _mainPanelHeaderResizeObserver = new ResizeObserver(() => {
      syncPanelHeaderFromMain(getWrapper)
    })
    _mainPanelHeaderResizeObserver.observe(mainHeader)
    registerCleanup(stopPanelHeaderObservers)
  }
  if (!_mainPanelHeaderAttrObserver) {
    _mainPanelHeaderAttrObserver = new MutationObserver(() => {
      syncPanelHeaderFromMain(getWrapper)
    })
    _mainPanelHeaderAttrObserver.observe(mainHeader, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    registerCleanup(stopPanelHeaderObservers)
  }

  // Read the six mirrored values.
  const headerStyle = getComputedStyle(mainHeader)
  const titleEl = findHeaderTitleElement(mainHeader)
  const titleStyle = titleEl ? getComputedStyle(titleEl) : null

  const height = `${mainHeader.offsetHeight}px`
  const paddingTop = headerStyle.paddingTop
  const paddingBottom = headerStyle.paddingBottom
  const fontSize = titleStyle?.fontSize || ''
  const borderBottom = headerStyle.borderBottomWidth === '0px'
    ? '0px'
    : `${headerStyle.borderBottomWidth} ${headerStyle.borderBottomStyle} ${headerStyle.borderBottomColor}`
  const background = headerStyle.backgroundColor

  const cacheKey = [height, paddingTop, paddingBottom, fontSize, borderBottom, background].join('|')
  if (cacheKey === _lastWrittenHeaderVars) return
  _lastWrittenHeaderVars = cacheKey

  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-h', height)
  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-pt', paddingTop)
  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-pb', paddingBottom)
  if (fontSize) {
    secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-font-size', fontSize)
  }
  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-border-bottom', borderBottom)
  secondaryWrapper.style.setProperty('--sidebar-ux-panel-header-bg', background)
}

/**
 * Locate the title element inside the main panel header. Tries, in order:
 *   1. `<h1>` / `<h2>` / `<h3>` direct child
 *   2. A descendant with a class containing "title" or "Title"
 *   3. Any direct child (fallback — at least we'll get a font-size)
 * Returns `null` only if the header has no children at all.
 */
function findHeaderTitleElement(header: HTMLElement): HTMLElement | null {
  for (const tag of ['H1', 'H2', 'H3']) {
    const byTag = header.querySelector(tag) as HTMLElement | null
    if (byTag) return byTag
  }
  const byClass = header.querySelector('[class*="title"], [class*="Title"]') as HTMLElement | null
  if (byClass) return byClass
  if (header.children.length > 0) return header.children[0] as HTMLElement
  return null
}

/**
 * Disconnect both panel-header observers and null the handles so the
 * next syncPanelHeaderFromMain call rebuilds them. Idempotent — safe
 * to call when no observers are attached.
 */
export function stopPanelHeaderObservers(): void {
  if (_mainPanelHeaderResizeObserver) {
    _mainPanelHeaderResizeObserver.disconnect()
    _mainPanelHeaderResizeObserver = null
  }
  if (_mainPanelHeaderAttrObserver) {
    _mainPanelHeaderAttrObserver.disconnect()
    _mainPanelHeaderAttrObserver = null
  }
}

/**
 * Reset the panel-header sync cache. Call when the secondary wrapper
 * is remounted (e.g. side-change) so the next sync writes all six
 * CSS variables unconditionally.
 */
export function resetPanelHeaderSyncCache(): void {
  _lastWrittenHeaderVars = null
}
