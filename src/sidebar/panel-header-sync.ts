// Panel-header sync: keep Canvas drawer panel headers in step with the
// host main drawer's panel header (height, padding, title font-size,
// border, background). Targets secondary AND main-mirror shells.
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
/** Last getWrapper callback — observers re-use it for secondary primary target. */
let _getPrimaryWrapper: (() => HTMLElement | null) | null = null

/**
 * Public, coalesced entry point. Call after secondary or main-mirror
 * mounts, opens/closes, or whenever the host panel header might have
 * changed. Internally routes through requestAnimationFrame to dedupe
 * rapid back-to-back calls.
 *
 * Stamps CSS vars onto every live Canvas shell (`.sidebar-ux-secondary-wrapper`
 * and `.sidebar-ux-main-mirror-wrapper`) so both match host header geometry.
 * Optional `getWrapper` is kept as a primary target (secondary module state).
 *
 * No-op if no Canvas shell is mounted or the host panel header can't be
 * found. Shells fall back to drawer-shell defaults (`min-height: 48px`,
 * `padding: 12px 16px`, CloseButton-md-sized close control).
 */
export function syncPanelHeaderFromMain(
  getWrapper?: () => HTMLElement | null,
): void {
  if (getWrapper) _getPrimaryWrapper = getWrapper
  if (_syncPanelHeaderPending) return
  _syncPanelHeaderPending = true
  requestAnimationFrame(() => {
    _syncPanelHeaderPending = false
    _runSyncPanelHeaderFromMain()
  })
}

/** Shells that consume --sidebar-ux-panel-header-* vars on the wrapper. */
function collectHeaderVarTargets(primary: HTMLElement | null): HTMLElement[] {
  const out: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  const add = (el: HTMLElement | null | undefined) => {
    if (!el || seen.has(el)) return
    seen.add(el)
    out.push(el)
  }
  add(primary)
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    document
      .querySelectorAll(
        '.sidebar-ux-secondary-wrapper, .sidebar-ux-main-mirror-wrapper',
      )
      .forEach((n) => add(n as HTMLElement))
  }
  return out
}

function applyHeaderVars(
  target: HTMLElement,
  vars: {
    height: string
    paddingTop: string
    paddingBottom: string
    fontSize: string
    borderBottom: string
    background: string
  },
): void {
  target.style.setProperty('--sidebar-ux-panel-header-h', vars.height)
  target.style.setProperty('--sidebar-ux-panel-header-pt', vars.paddingTop)
  target.style.setProperty('--sidebar-ux-panel-header-pb', vars.paddingBottom)
  if (vars.fontSize) {
    target.style.setProperty('--sidebar-ux-panel-header-font-size', vars.fontSize)
  }
  target.style.setProperty('--sidebar-ux-panel-header-border-bottom', vars.borderBottom)
  target.style.setProperty('--sidebar-ux-panel-header-bg', vars.background)
}

function _runSyncPanelHeaderFromMain(): void {
  const primary = _getPrimaryWrapper ? _getPrimaryWrapper() : null
  const targets = collectHeaderVarTargets(primary)
  if (targets.length === 0) return

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
      syncPanelHeaderFromMain()
    })
    _mainPanelHeaderResizeObserver.observe(mainHeader)
    registerCleanup(stopPanelHeaderObservers)
  }
  if (!_mainPanelHeaderAttrObserver) {
    _mainPanelHeaderAttrObserver = new MutationObserver(() => {
      syncPanelHeaderFromMain()
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

  const vars = { height, paddingTop, paddingBottom, fontSize, borderBottom, background }
  const cacheKey = [height, paddingTop, paddingBottom, fontSize, borderBottom, background].join('|')

  // Always stamp onto any target missing vars (new main-mirror mount after
  // an earlier secondary-only sync). Skip only when cache matches AND every
  // target already has the height var.
  const allStamped =
    cacheKey === _lastWrittenHeaderVars &&
    targets.every((t) => !!t.style.getPropertyValue('--sidebar-ux-panel-header-h'))
  if (allStamped) return
  _lastWrittenHeaderVars = cacheKey

  for (const target of targets) {
    applyHeaderVars(target, vars)
  }
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
