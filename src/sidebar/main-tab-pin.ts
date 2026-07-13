// Main-drawer "keep tab controls visible" — mirror buttons + orchestration.
//
// When taskbarMode is on (desktop), Canvas owns the full main drawer
// chrome via main-mirror-drawer.ts (headless host + shell + portal). This
// module:
//
//   1. Enables/tears down that mirror mode (apply/reconcile entrypoints).
//   2. Syncs *mirrored* tab buttons into the Canvas main tab list (host
//      React nodes stay under Lumiverse; clicks forward via .click()).
//   3. Never hides the pin strip when the host drawer is "open" — visual
//      open/close is Canvas-owned.
//
// Mobile: always force-off (matches secondary pin).

import { getMainSidebar } from '../dom/lumiverse'
import { getMainDrawerSide } from '../store'
import { getSettings } from '../settings/state'
import { dlog, dwarn } from '../debug/log'
import { isMobileViewport } from './mobile-exclusion'
import { isShowTabLabels } from './drawer-sync'
import {
  applyMainMirrorDrawer,
  closeCanvasMainDrawer,
  getMainMirrorTabList,
  isCanvasMainOpen,
  isMainMirrorActive,
  onMainMirrorTabActivated,
  reconcileMainMirrorDrawer,
  setCanvasMainTitle,
  __resetMainMirrorForTest,
} from './main-mirror-drawer'
import {
  destroyMainPinHost,
  ensureMainPinHost,
  TAB_LIST_PINNED_CLASS,
} from './tab-position'
import { deriveShortName, isSettingsButton } from '../tabs/buttons'

/** Canvas-owned tab list class (also on shell tab list when pinned). */
export const MAIN_MIRROR_LIST_CLASS = 'sidebar-ux-main-tab-list-mirror'

/** Mirror button class (also carries data-tab-id for shared pin-host CSS). */
export const MAIN_MIRROR_BTN_CLASS = 'sidebar-ux-main-tab-mirror-btn'

/**
 * Scrollable upper section of the main-mirror strip (built-in + extension tabs).
 * Matches Lumiverse `.tabListWrap` / `.tabList` — flex:1 so Settings can pin
 * to the bottom of the strip.
 */
export const MAIN_MIRROR_LIST_MAIN_CLASS = 'sidebar-ux-tab-list-main'

/**
 * Bottom section for the Settings mirror — matches Lumiverse `.sidebarBottom`
 * (margin-top auto via flex parent + border-top separator).
 */
export const MAIN_MIRROR_LIST_BOTTOM_CLASS = 'sidebar-ux-tab-list-bottom'

let _enabled = false
let _sidebarObserver: MutationObserver | null = null
let _reconcileRaf: number | null = null
/** Observed host sidebar element (re-attach if Lumiverse replaces it). */
let _observedSidebar: HTMLElement | null = null

/**
 * Last mirror tab the user activated while Canvas owns main UX.
 * Keyed like hostButtonKey (`id__` / `title__`). Survives host
 * tabBtnActive loss (headless host / repark); not cleared on drawer
 * close (secondary `_activeSecondaryTabId` parity for toggle-close).
 */
let _activeMainMirrorKey: string | null = null

/** Mirror button → host button. WeakMap so host GC is free. */
const _mirrorToHost = new WeakMap<HTMLElement, HTMLElement>()

/**
 * Enable or disable the main-drawer Canvas mirror mode + tab button sync.
 * `force: true` re-applies even when already in the target state.
 */
export function applyMainTabListPin(
  enabled: boolean,
  opts?: { force?: boolean },
): void {
  if (isMobileViewport()) {
    if (enabled && !opts?.force) return
    teardownMainPin()
    return
  }

  if (!enabled) {
    teardownMainPin()
    return
  }

  // Mount Canvas main shell + hide host (soft apply unless force).
  applyMainMirrorDrawer(true, { force: !!opts?.force })

  if (_enabled && !opts?.force) {
    scheduleReconcile()
    return
  }

  _enabled = true
  ensureObservers()
  reconcileMainMirror()
}

/**
 * Re-apply main pin from current settings + live DOM.
 * Safe on mount, side-change, viewport cross-up, and settings apply.
 */
export function reconcileMainTabListPin(): void {
  if (isMobileViewport()) {
    applyMainTabListPin(false, { force: true })
    void import('./strip-gutter').then((m) => m.updateStripGutters())
    return
  }
  reconcileMainMirrorDrawer()
  const on = !!getSettings().taskbarMode
  if (!on) {
    teardownMainPin()
    void import('./strip-gutter').then((m) => m.updateStripGutters())
    return
  }
  _enabled = true
  ensureObservers()
  reconcileMainMirror()
  // Side-change remaps main/secondary strip gutters to left/right.
  void import('./strip-gutter').then((m) => m.updateStripGutters())
}

/** True when main pin / mirror mode is enabled (setting applied, not mobile). */
export function isMainTabListPinActive(): boolean {
  return _enabled && isMainMirrorActive()
}

/** Test-only: reset module state without requiring a full document. */
export function __resetMainTabPinForTest(): void {
  stopObservers()
  _enabled = false
  _reconcileRaf = null
  _observedSidebar = null
  _activeMainMirrorKey = null
  __resetMainMirrorForTest()
  destroyMainPinHost()
}

/** Test / restore: last Canvas-owned active mirror key (or null). */
export function getActiveMainMirrorKey(): string | null {
  return _activeMainMirrorKey
}

/**
 * User-visible primary active tab id when taskbar main-mirror owns chrome.
 *
 * Host `tabBtnActive` often lags or stays on a parked tab (e.g. Profile)
 * while Canvas `_activeMainMirrorKey` is exclusive for the strip/header.
 * Quiet DnD / handoff must prefer this over host DOM or panel content jumps
 * to the top-most host tab on every primary→secondary drop.
 *
 * Returns bare `data-tab-id` or title fallback from the key, or null when
 * pin is off / no key is set (callers fall back to host).
 */
export function getMainMirrorActiveTabId(): string | null {
  // Pin enabled is enough — shell may be mid-mount; exclusive key is still truth.
  if (!_enabled) return null
  const key = _activeMainMirrorKey
  if (!key) return null
  if (key.startsWith('id__')) return key.slice(4) || null
  if (key.startsWith('title__')) return key.slice(7) || null
  return null
}

/** Test seam: set Canvas-owned mirror active key without host click. */
export function __setActiveMainMirrorKeyForTest(key: string | null): void {
  _activeMainMirrorKey = key
}

/** Test seam: mark main-tab pin enabled so getMainMirrorActiveTabId reads the key. */
export function __setMainTabPinEnabledForTest(on: boolean): void {
  _enabled = on
}

/**
 * Activate a main tab for layout restore without going through
 * onMirrorClick (which would toggle-close if the drawer is already open
 * on that tab). Clicks the host button for React content, sets the
 * Canvas active key, and opens the mirror drawer.
 */
export function activateMainMirrorFromRestore(
  hostBtn: HTMLElement | null,
  title?: string,
): void {
  const resolvedTitle =
    title ||
    hostBtn?.getAttribute('title') ||
    hostBtn?.getAttribute('aria-label') ||
    undefined
  if (hostBtn && hostBtn.isConnected) {
    _activeMainMirrorKey = hostButtonKey(hostBtn)
    try {
      hostBtn.click()
    } catch {
      /* host may throw during teardown */
    }
  } else if (resolvedTitle) {
    _activeMainMirrorKey = `title__${resolvedTitle}`
  }
  onMainMirrorTabActivated(resolvedTitle)
}

/**
 * Align Canvas main-mirror chrome with a host primary activation that
 * did not go through onMirrorClick (handoff, host-driven, heal).
 * No-op when main pin/mirror mode is off.
 *
 * @param opts.open default true — opens drawer + parks via onMainMirrorTabActivated.
 *   Pass false for reconcile heal (title only; do not force-open mid-reconcile).
 */
export function adoptMainMirrorHostActivation(
  hostBtn: HTMLElement | null,
  title?: string,
  opts?: { open?: boolean },
): void {
  // Stamp exclusive key whenever pin is enabled — quiet DnD / handoff need
  // the key even if the shell is mid-mount or briefly inactive. Skip open /
  // park chrome until the mirror shell is live.
  if (!_enabled) return

  const resolvedTitle =
    title ||
    hostBtn?.getAttribute('title') ||
    hostBtn?.getAttribute('aria-label') ||
    undefined

  if (hostBtn && hostBtn.isConnected) {
    _activeMainMirrorKey = hostButtonKey(hostBtn)
  } else if (resolvedTitle) {
    _activeMainMirrorKey = `title__${resolvedTitle}`
  }

  if (!isMainMirrorActive()) {
    dlog('[main-mirror] adopt host activation (key only; shell inactive)', {
      key: _activeMainMirrorKey,
      title: resolvedTitle,
    })
    return
  }

  const shouldOpen = opts?.open !== false
  if (shouldOpen) {
    onMainMirrorTabActivated(resolvedTitle)
  } else if (resolvedTitle) {
    setCanvasMainTitle(resolvedTitle)
  }

  scheduleReconcile()
  dlog('[main-mirror] adopt host activation', {
    key: _activeMainMirrorKey,
    title: resolvedTitle,
    open: shouldOpen,
  })
}

function teardownMainPin(): void {
  _enabled = false
  _activeMainMirrorKey = null
  stopObservers()
  applyMainMirrorDrawer(false, { force: true })
  destroyMainPinHost()
}

function scheduleReconcile(): void {
  if (_reconcileRaf !== null) return
  _reconcileRaf = requestAnimationFrame(() => {
    _reconcileRaf = null
    if (_enabled) reconcileMainMirror()
  })
}

function reconcileMainMirror(): void {
  if (!_enabled) return

  const side = getMainDrawerSide()
  // Ensure pin host exists (shell mount also creates it).
  ensureMainPinHost(side)

  const list = resolveMirrorList()
  if (!list) return

  // Mark as main mirror list for tests / CSS.
  if (!list.classList.contains(MAIN_MIRROR_LIST_CLASS)) {
    list.classList.add(MAIN_MIRROR_LIST_CLASS)
  }
  if (!list.classList.contains(TAB_LIST_PINNED_CLASS)) {
    list.classList.add(TAB_LIST_PINNED_CLASS)
  }

  // Pin host is ALWAYS visible while mode is active — never hide when
  // host wrapperOpen flips (Canvas owns open/close).
  const host = ensureMainPinHost(side)
  if (host && host.style.display === 'none') {
    host.style.display = ''
  }

  const sidebar = getMainSidebar()
  if (!sidebar) {
    while (list.firstChild) list.removeChild(list.firstChild)
    return
  }

  if (sidebar !== _observedSidebar) {
    attachSidebarObserver(sidebar)
  }

  const { main: mainSection, bottom: bottomSection } = ensureMirrorListStructure(list)

  const hostButtons = collectHostTabButtons(sidebar)
  const regularButtons = hostButtons.filter((b) => !isSettingsButton(b))
  const settingsButtons = hostButtons.filter((b) => isSettingsButton(b))
  const wantedKeys = new Set(hostButtons.map((b) => hostButtonKey(b)))

  // When the Canvas-owned active key is missing or no longer maps to any
  // host button, adopt host tabBtnActive (or clear). Covers:
  //   - first enable of taskbar mode (key starts null; shell title is 'Drawer')
  //   - tab moved off primary (stale key)
  // Does not run while a restored key still exists in wantedKeys
  // (preserves exclusive dual-active guard). Settings is host chrome only.
  if (_activeMainMirrorKey == null || !wantedKeys.has(_activeMainMirrorKey)) {
    const hostActiveBtn =
      hostButtons.find((b) => hostHasTabBtnActive(b)) ?? null
    const prevKey = _activeMainMirrorKey
    if (hostActiveBtn && !isSettingsButton(hostActiveBtn)) {
      _activeMainMirrorKey = hostButtonKey(hostActiveBtn)
      const t =
        hostActiveBtn.getAttribute('title') ||
        hostActiveBtn.getAttribute('aria-label') ||
        ''
      if (t) setCanvasMainTitle(t)
    } else if (prevKey != null) {
      _activeMainMirrorKey = null
    }
    if (prevKey !== _activeMainMirrorKey) {
      dlog('[main-mirror] active key healed/seeded', {
        prevKey,
        nextKey: _activeMainMirrorKey,
      })
    }
  }

  // Drop stale mirrors anywhere under the list (main + bottom + legacy flat).
  for (const btn of Array.from(
    list.querySelectorAll(`button.${MAIN_MIRROR_BTN_CLASS}`),
  ) as HTMLElement[]) {
    const key = btn.getAttribute('data-mirror-key') || ''
    if (!wantedKeys.has(key)) {
      btn.remove()
    }
  }

  // Built-in / extension tabs: scrollable top section (host .tabListWrap).
  syncMirrorButtonsInto(mainSection, regularButtons, list)

  // Settings: pinned to strip bottom with separator (host .sidebarBottom).
  if (settingsButtons.length > 0) {
    bottomSection.style.display = 'flex'
    syncMirrorButtonsInto(bottomSection, settingsButtons, list)
  } else {
    bottomSection.style.display = 'none'
    while (bottomSection.firstChild) bottomSection.removeChild(bottomSection.firstChild)
  }

  // Re-stamp header title from active key. mountMainMirror always creates
  // the shell with title 'Drawer'; seed/heal above covers first-enable and
  // stale keys; this path re-stamps when the key survived a remount.
  if (_activeMainMirrorKey != null) {
    const activeMirror = list.querySelector(
      `button.${MAIN_MIRROR_BTN_CLASS}[data-mirror-key="${cssAttrEscape(_activeMainMirrorKey)}"]`,
    ) as HTMLElement | null
    const title =
      activeMirror?.getAttribute('title') ||
      activeMirror?.getAttribute('aria-label') ||
      ''
    if (title) {
      setCanvasMainTitle(title)
    }
  }

  dlog('[main-mirror] reconcile tabs', {
    hostCount: hostButtons.length,
    regularCount: regularButtons.length,
    settingsCount: settingsButtons.length,
    mirrorCount: list.querySelectorAll(`button.${MAIN_MIRROR_BTN_CLASS}`).length,
    open: isCanvasMainOpen(),
    activeKeys: hostButtons
      .filter((b) => String(b.className || '').includes('tabBtnActive'))
      .map((b) => hostButtonKey(b)),
  })
}

/** Direct child with class (no CSS :scope — works under test stubs). */
function directChildByClass(parent: HTMLElement, className: string): HTMLElement | null {
  for (const child of Array.from(parent.children)) {
    const el = child as HTMLElement
    if (el.classList?.contains?.(className) || String(el.className || '').includes(className)) {
      return el
    }
  }
  return null
}

/**
 * Host-shaped strip: scrollable main + bottom Settings dock.
 * Outer list is flex column / full height (pinned top+bottom); main takes
 * remaining space; bottom stays at the end with a top border separator.
 */
function ensureMirrorListStructure(list: HTMLElement): {
  main: HTMLElement
  bottom: HTMLElement
} {
  let main = directChildByClass(list, MAIN_MIRROR_LIST_MAIN_CLASS)
  let bottom = directChildByClass(list, MAIN_MIRROR_LIST_BOTTOM_CLASS)

  if (!main) {
    main = document.createElement('div')
    main.className = MAIN_MIRROR_LIST_MAIN_CLASS
    list.insertBefore(main, list.firstChild)
  }
  if (!bottom) {
    bottom = document.createElement('div')
    bottom.className = MAIN_MIRROR_LIST_BOTTOM_CLASS
    list.appendChild(bottom)
  }

  // Adopt any legacy flat mirror buttons into main before reordering sections.
  for (const child of Array.from(list.children)) {
    if (
      child !== main &&
      child !== bottom &&
      (child as HTMLElement).classList?.contains(MAIN_MIRROR_BTN_CLASS)
    ) {
      main.appendChild(child)
    }
  }

  // Canonical order: main then bottom (only structural children).
  if (list.firstChild !== main) list.insertBefore(main, list.firstChild)
  if (main.nextSibling !== bottom) list.appendChild(bottom)

  // Outer list fills the pin host; scroll lives in main so Settings stays docked.
  if (list.style.overflowY !== 'hidden') list.style.overflowY = 'hidden'
  if (list.style.minHeight !== '0') list.style.minHeight = '0'

  if (main.style.flex !== '1 1 auto') main.style.flex = '1 1 auto'
  if (main.style.minHeight !== '0') main.style.minHeight = '0'
  if (main.style.display !== 'flex') main.style.display = 'flex'
  if (main.style.flexDirection !== 'column') main.style.flexDirection = 'column'
  // Host .tabList uses gap: 2px (ViewportDrawer.module.css) — not the
  // outer .sidebar gap of 4px (that only spaces tabListWrap vs bottom).
  if (main.style.gap !== '2px') main.style.gap = '2px'
  if (main.style.overflowY !== 'auto') main.style.overflowY = 'auto'
  if (main.style.overflowX !== 'hidden') main.style.overflowX = 'hidden'
  if (main.style.scrollbarWidth !== 'none') main.style.scrollbarWidth = 'none'

  if (bottom.style.flexShrink !== '0') bottom.style.flexShrink = '0'
  if (bottom.style.flexDirection !== 'column') bottom.style.flexDirection = 'column'
  if (bottom.style.gap !== '2px') bottom.style.gap = '2px'
  // Match ViewportDrawer.module.css .sidebarBottom
  if (bottom.style.marginTop !== 'auto') bottom.style.marginTop = 'auto'
  if (bottom.style.paddingTop !== '8px') bottom.style.paddingTop = '8px'
  if (bottom.style.borderTop !== '1px solid var(--lumiverse-primary-020)') {
    bottom.style.borderTop = '1px solid var(--lumiverse-primary-020)'
  }

  return { main, bottom }
}

/** Create/order/sync mirror buttons for a host button set into `container`. */
function syncMirrorButtonsInto(
  container: HTMLElement,
  hostButtons: HTMLElement[],
  listRoot: HTMLElement,
): void {
  let insertBefore: ChildNode | null = container.firstChild
  for (const hostBtn of hostButtons) {
    const key = hostButtonKey(hostBtn)
    let mirror = listRoot.querySelector(
      `button.${MAIN_MIRROR_BTN_CLASS}[data-mirror-key="${cssAttrEscape(key)}"]`,
    ) as HTMLElement | null

    if (!mirror) {
      mirror = document.createElement('button')
      ;(mirror as HTMLButtonElement).type = 'button'
      mirror.classList.add(MAIN_MIRROR_BTN_CLASS)
      mirror.setAttribute('data-mirror-key', key)
      mirror.addEventListener('click', onMirrorClick)
      // Canvas-owned context menu (host Lumiverse menu only fires on host
      // React buttons — mirror strip is outside the host sidebar).
      mirror.addEventListener('contextmenu', onMirrorContextMenu)
      container.insertBefore(mirror, insertBefore)
    } else if (mirror.parentElement !== container || mirror !== insertBefore) {
      container.insertBefore(mirror, insertBefore)
    }

    syncMirrorFromHost(mirror, hostBtn)
    _mirrorToHost.set(mirror, hostBtn)
    insertBefore = mirror.nextSibling
  }

  // Remove extra non-mirror nodes left in this container (shouldn't happen).
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement
    if (!el.classList.contains(MAIN_MIRROR_BTN_CLASS)) {
      container.removeChild(el)
      continue
    }
    const key = el.getAttribute('data-mirror-key') || ''
    if (!hostButtons.some((b) => hostButtonKey(b) === key)) {
      container.removeChild(el)
    }
  }
}

/**
 * Whether mirror buttons should use labeled (56px) geometry.
 *
 * Prefer host-settings `showTabLabels` (via isShowTabLabels — includes the
 * optimistic cache after Hide/Show). Host button `tabBtnLabeled` lags React
 * commit after hide; on activate/reconcile that stale class re-applied 56px
 * height with empty label DOM ("grow again even when there's no label").
 *
 * Settings is host chrome (gear only) — never labeled, even when tabs show
 * short names. Title/aria-label still say "Settings" for a11y/tooltips.
 */
function resolveMirrorLabeled(hostBtn: HTMLElement): boolean {
  if (isSettingsButton(hostBtn)) return false
  return isShowTabLabels()
}

/**
 * Match secondary tab button geometry: square 48px (icon-only) / 56px (labeled).
 * Secondary sets these as inline styles at create time; keep main in lockstep.
 *
 * Do NOT set inline background/boxShadow/color — CSS drives hover +
 * .sidebar-ux-tab-active (inline background:transparent was killing the
 * active highlight).
 */
function applyMirrorButtonChrome(btn: HTMLElement, labeled: boolean): void {
  const height = labeled ? '56px' : '48px'
  // Only rewrite when height (or base chrome) drifted — avoid layout thrash.
  if (btn.style.height === height && btn.style.gap === '1px') {
    // Still clear any leftover paint overrides so active CSS can apply.
    btn.style.background = ''
    btn.style.boxShadow = ''
    btn.style.color = ''
    btn.style.borderRadius = ''
    return
  }
  btn.style.width = '100%'
  btn.style.height = height
  btn.style.flexShrink = '0'
  btn.style.display = 'flex'
  btn.style.flexDirection = 'column'
  btn.style.alignItems = 'center'
  btn.style.justifyContent = 'center'
  btn.style.gap = '1px'
  btn.style.border = 'none'
  btn.style.cursor = 'pointer'
  btn.style.transition = 'all 0.2s ease'
  // Host .tabBtn has no horizontal padding (ViewportDrawer.module.css).
  btn.style.padding = '0'
  btn.style.boxSizing = 'border-box'
  // Let stylesheet control fill / active chrome.
  btn.style.background = ''
  btn.style.boxShadow = ''
  btn.style.color = ''
  btn.style.borderRadius = ''
}

function resolveMirrorList(): HTMLElement | null {
  // Prefer shell/pinned list from main-mirror-drawer.
  const fromShell = getMainMirrorTabList()
  if (fromShell) return fromShell

  // Fallback: create a list on the pin host (tests / partial mount).
  const side = getMainDrawerSide()
  const host = ensureMainPinHost(side)
  if (!host) return null
  let list = host.querySelector(`.${MAIN_MIRROR_LIST_CLASS}`) as HTMLElement | null
  if (!list) {
    list = host.querySelector('.sidebar-ux-tab-list') as HTMLElement | null
  }
  if (!list) {
    list = document.createElement('div')
    list.classList.add('sidebar-ux-tab-list')
    list.classList.add(MAIN_MIRROR_LIST_CLASS)
    list.classList.add(TAB_LIST_PINNED_CLASS)
    host.appendChild(list)
  }
  return list
}

function collectHostTabButtons(sidebar: HTMLElement): HTMLElement[] {
  const buttons = Array.from(
    sidebar.querySelectorAll('button[class*="tabBtn"]'),
  ) as HTMLElement[]
  // querySelector already requires tabBtn; only filter host-hidden buttons
  // (secondary-assigned tabs use display:none via hideMainTabButton).
  return buttons.filter((b) => b.style.display !== 'none')
}

function hostButtonKey(btn: HTMLElement): string {
  const id = btn.getAttribute('data-tab-id')
  if (id) return `id__${id}`
  const title = btn.getAttribute('title') || btn.getAttribute('aria-label') || ''
  if (title) return `title__${title}`
  return `node__${btn.tagName}__${btn.className}`
}

/** Key for a mirror button (mirrors hostButtonKey from data-tab-id / title). */
function mirrorButtonKey(mirror: HTMLElement): string {
  const id = mirror.getAttribute('data-tab-id')
  if (id) return `id__${id}`
  const title = mirror.getAttribute('title') || mirror.getAttribute('aria-label') || ''
  if (title) return `title__${title}`
  const dataKey = mirror.getAttribute('data-mirror-key')
  if (dataKey) return dataKey
  return `node__${mirror.tagName}__${mirror.className}`
}

function hostHasTabBtnActive(host: HTMLElement | undefined | null): boolean {
  if (!host) return false
  return (
    host.classList.contains('tabBtnActive') ||
    String(host.className || '').includes('tabBtnActive')
  )
}

function syncMirrorFromHost(mirror: HTMLElement, hostBtn: HTMLElement): void {
  const tabId = hostBtn.getAttribute('data-tab-id')
  if (tabId) mirror.setAttribute('data-tab-id', tabId)
  else mirror.removeAttribute('data-tab-id')

  const title = hostBtn.getAttribute('title') || hostBtn.getAttribute('aria-label') || ''
  if (title) {
    mirror.setAttribute('title', title)
    mirror.setAttribute('aria-label', title)
  }

  // Match secondary: no tab looks selected while the drawer is closed.
  // While open, Canvas-owned key is exclusive — host may still mark
  // Profile (or a previous tab) tabBtnActive during restore/repark, and
  // OR-ing hostActive would highlight two mirrors at once.
  // Fallback to host only when no Canvas key is set yet.
  const key = hostButtonKey(hostBtn)
  const hostActive = hostHasTabBtnActive(hostBtn)
  const canvasActive =
    _activeMainMirrorKey != null && key === _activeMainMirrorKey
  const showActive =
    isCanvasMainOpen() &&
    (_activeMainMirrorKey != null ? canvasActive : hostActive)
  const wasActive = mirror.classList.contains('sidebar-ux-tab-active')
  mirror.classList.toggle('sidebar-ux-tab-active', showActive)
  if (showActive !== wasActive) {
    dlog('[main-mirror] active toggle', {
      title: mirror.getAttribute('title'),
      showActive,
      hostActive,
      canvasActive,
      canvasKey: _activeMainMirrorKey,
      open: isCanvasMainOpen(),
    })
  }

  const labeled = resolveMirrorLabeled(hostBtn)
  mirror.classList.toggle('sidebar-ux-tab-labeled', labeled)

  const nextHtml = buildMirrorInnerHtml(hostBtn, labeled)
  if (mirror.getAttribute('data-mirror-html') !== nextHtml) {
    mirror.setAttribute('data-mirror-html', nextHtml)
    mirror.innerHTML = nextHtml
  }

  // Keep geometry in sync when labels toggle; never paint-override active CSS.
  applyMirrorButtonChrome(mirror, labeled)
}

function buildMirrorInnerHtml(hostBtn: HTMLElement, labeled: boolean): string {
  const parts: string[] = []
  const svg = hostBtn.querySelector('svg')
  if (svg) {
    parts.push(`<span>${svg.outerHTML}</span>`)
  }
  // Host only mounts .tabLabel when showTabLabels is on — and can lag after
  // Canvas Show. Prefer host short name; fall back to title-derived short
  // name so main-mirror can rebuild labels immediately after secondary Show.
  // Omit the span entirely when unlabeled (zero-height still costs 1px flex gap).
  // Settings never gets a short-name label (host keeps it icon-only).
  if (labeled && !isSettingsButton(hostBtn)) {
    const hostLabel = hostBtn.querySelector('span[class*="tabLabel"]') as HTMLElement | null
    const fromHost = hostLabel ? (hostLabel.textContent || '').trim() : ''
    const title =
      hostBtn.getAttribute('title') || hostBtn.getAttribute('aria-label') || ''
    const text = fromHost || (title ? deriveShortName(title) : '')
    if (text) {
      parts.push(
        `<span class="sidebar-ux-tab-label" style="opacity:1;height:auto;margin-top:1px;transition:opacity 0.2s ease, height 0.2s ease, margin 0.2s ease">${escapeHtml(text)}</span>`,
      )
    }
  }
  return parts.join('')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cssAttrEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/(["\\])/g, '\\$1')
}

function onMirrorClick(ev: Event): void {
  ev.preventDefault()
  ev.stopPropagation()
  const mirror = ev.currentTarget as HTMLElement
  const title =
    mirror.getAttribute('title') ||
    mirror.getAttribute('aria-label') ||
    undefined

  const hostBtn = _mirrorToHost.get(mirror)
  const key = hostBtn ? hostButtonKey(hostBtn) : mirrorButtonKey(mirror)

  // Settings is host chrome only (opens Lumiverse settings). Never treat as a
  // Canvas main-mirror tab: no active key, header title, open, or toggle-close.
  const settingsHost = hostBtn && hostBtn.isConnected ? hostBtn : null
  const isSettings =
    (settingsHost != null && isSettingsButton(settingsHost)) ||
    isSettingsButton(mirror)
  if (isSettings) {
    dlog('[main-mirror] click → settings (host only, no canvas tab)', { key })
    let target = settingsHost
    if (!target || !target.isConnected) {
      reconcileMainMirror()
      target = _mirrorToHost.get(mirror) ?? null
    }
    if (target && target.isConnected) {
      try {
        target.click()
      } catch {
        /* host may throw during teardown */
      }
    }
    return
  }

  // Secondary parity: clicking the already-active tab while open closes the
  // drawer. When Canvas owns a key, that key alone decides toggle-close —
  // do not OR host tabBtnActive (Profile can stay host-active after restore
  // while Canvas key points at another tab; OR would close on Profile click).
  // Fall back to host/mirror only when no Canvas key is set yet.
  const wasActive =
    _activeMainMirrorKey != null
      ? key === _activeMainMirrorKey
      : mirror.classList.contains('sidebar-ux-tab-active') ||
        hostHasTabBtnActive(hostBtn)
  if (isCanvasMainOpen() && wasActive) {
    dlog('[main-mirror] click → close (active tab)', { title, key })
    closeCanvasMainDrawer()
    return
  }

  dlog('[main-mirror] click', {
    title,
    key,
    hostConnected: !!(hostBtn && hostBtn.isConnected),
    open: isCanvasMainOpen(),
  })
  if (!hostBtn || !hostBtn.isConnected) {
    reconcileMainMirror()
    const again = _mirrorToHost.get(mirror)
    if (again && again.isConnected) {
      _activeMainMirrorKey = hostButtonKey(again)
      try {
        again.click()
      } catch {
        /* host may throw during teardown */
      }
    } else {
      _activeMainMirrorKey = key
    }
    onMainMirrorTabActivated(title)
    return
  }
  try {
    hostBtn.click()
  } catch {
    /* ignore */
  }
  _activeMainMirrorKey = key
  onMainMirrorTabActivated(title)
}

/**
 * Right-click on mirror tabs → forward to host twin so Lumiverse opens its
 * ContextMenu (Configure tabs, Hide/Show labels). Canvas injects "Move to
 * second drawer" via context-menu/index.ts on the synthetic host path
 * (gated by secondSidebarEnabled). Settings is never forwarded.
 */
function onMirrorContextMenu(ev: Event): void {
  const e = ev as MouseEvent
  e.preventDefault()
  e.stopPropagation()
  const mirror = e.currentTarget as HTMLElement

  // Settings is host chrome only (same as onMirrorClick) — never forward
  // contextmenu / open move menu. Host inject path also skips Settings.
  let hostBtn = _mirrorToHost.get(mirror)
  const settingsHost = hostBtn && hostBtn.isConnected ? hostBtn : null
  const isSettings =
    (settingsHost != null && isSettingsButton(settingsHost)) ||
    isSettingsButton(mirror)
  if (isSettings) {
    dlog('[main-mirror] contextmenu → settings (no host forward)')
    return
  }

  if (!hostBtn || !hostBtn.isConnected) {
    reconcileMainMirror()
    hostBtn = _mirrorToHost.get(mirror)
  }
  if (!hostBtn || !hostBtn.isConnected) {
    dwarn('[main-mirror] contextmenu: no connected host twin', {
      title: mirror.getAttribute('title'),
    })
    return
  }

  dlog('[main-mirror] contextmenu → host forward', {
    title: hostBtn.getAttribute('title') || mirror.getAttribute('title'),
    x: e.clientX,
    y: e.clientY,
  })
  try {
    hostBtn.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: e.clientX,
        clientY: e.clientY,
        button: 2,
        buttons: 2,
      }),
    )
  } catch (err) {
    dwarn('[main-mirror] contextmenu: host dispatch failed', err)
  }
}

function ensureObservers(): void {
  const sidebar = getMainSidebar()
  if (sidebar) attachSidebarObserver(sidebar)
}

function attachSidebarObserver(sidebar: HTMLElement): void {
  if (_sidebarObserver && _observedSidebar === sidebar) return
  if (_sidebarObserver) {
    _sidebarObserver.disconnect()
    _sidebarObserver = null
  }
  _observedSidebar = sidebar
  if (typeof MutationObserver === 'undefined') return
  // Coalesce heavily — host React mutates often; never do work sync in
  // the observer callback beyond scheduling one rAF reconcile.
  _sidebarObserver = new MutationObserver(() => scheduleReconcile())
  _sidebarObserver.observe(sidebar, {
    childList: true,
    subtree: true,
    attributes: true,
    // Do not watch style — host may thrash style during layout.
    attributeFilter: ['class', 'data-tab-id', 'title', 'aria-label'],
  })
}

function stopObservers(): void {
  if (_sidebarObserver) {
    _sidebarObserver.disconnect()
    _sidebarObserver = null
  }
  _observedSidebar = null
  if (_reconcileRaf !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(_reconcileRaf)
    _reconcileRaf = null
  }
}
