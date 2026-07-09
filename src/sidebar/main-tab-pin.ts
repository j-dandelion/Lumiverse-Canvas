// Main-drawer "keep tab list visible" — mirror buttons + orchestration.
//
// When keepTabListVisible is on (desktop), Canvas owns the full main drawer
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
import { isMobileViewport } from './mobile-exclusion'
import {
  applyMainMirrorDrawer,
  getMainMirrorTabList,
  isMainMirrorActive,
  onMainMirrorTabActivated,
  reconcileMainMirrorDrawer,
  __resetMainMirrorForTest,
} from './main-mirror-drawer'
import {
  destroyMainPinHost,
  ensureMainPinHost,
  TAB_LIST_PINNED_CLASS,
} from './tab-position'

/** Canvas-owned tab list class (also on shell tab list when pinned). */
export const MAIN_MIRROR_LIST_CLASS = 'sidebar-ux-main-tab-list-mirror'

/** Mirror button class (also carries data-tab-id for shared pin-host CSS). */
export const MAIN_MIRROR_BTN_CLASS = 'sidebar-ux-main-tab-mirror-btn'

let _enabled = false
let _sidebarObserver: MutationObserver | null = null
let _reconcileRaf: number | null = null
/** Observed host sidebar element (re-attach if Lumiverse replaces it). */
let _observedSidebar: HTMLElement | null = null

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

  // Mount / remount Canvas main shell + hide host.
  applyMainMirrorDrawer(true, { force: opts?.force })

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
    return
  }
  reconcileMainMirrorDrawer()
  const on = !!getSettings().keepTabListVisible
  if (!on) {
    teardownMainPin()
    return
  }
  _enabled = true
  ensureObservers()
  reconcileMainMirror()
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
  __resetMainMirrorForTest()
  destroyMainPinHost()
}

function teardownMainPin(): void {
  _enabled = false
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

  const hostButtons = collectHostTabButtons(sidebar)
  const wantedKeys = new Set(hostButtons.map((b) => hostButtonKey(b)))

  for (const child of Array.from(list.children)) {
    const btn = child as HTMLElement
    if (!btn.classList.contains(MAIN_MIRROR_BTN_CLASS)) {
      // Keep non-button nodes? Shell shouldn't put any. Remove unknowns
      // that look like stale mirrors only.
      if (btn.tagName === 'BUTTON' || btn.classList.contains(MAIN_MIRROR_BTN_CLASS)) {
        list.removeChild(btn)
      }
      continue
    }
    const key = btn.getAttribute('data-mirror-key') || ''
    if (!wantedKeys.has(key)) {
      list.removeChild(btn)
    }
  }

  let insertBefore: ChildNode | null = list.firstChild
  for (const hostBtn of hostButtons) {
    const key = hostButtonKey(hostBtn)
    let mirror = list.querySelector(
      `button.${MAIN_MIRROR_BTN_CLASS}[data-mirror-key="${cssAttrEscape(key)}"]`,
    ) as HTMLElement | null

    if (!mirror) {
      mirror = document.createElement('button')
      ;(mirror as HTMLButtonElement).type = 'button'
      mirror.classList.add(MAIN_MIRROR_BTN_CLASS)
      mirror.setAttribute('data-mirror-key', key)
      mirror.addEventListener('click', onMirrorClick)
      list.insertBefore(mirror, insertBefore)
    } else if (mirror !== insertBefore) {
      list.insertBefore(mirror, insertBefore)
    }

    syncMirrorFromHost(mirror, hostBtn)
    _mirrorToHost.set(mirror, hostBtn)
    insertBefore = mirror.nextSibling
  }
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
  return buttons.filter((b) => {
    if (b.style.display === 'none') return false
    if (!String(b.className || '').includes('tabBtn')) return false
    return true
  })
}

function hostButtonKey(btn: HTMLElement): string {
  const id = btn.getAttribute('data-tab-id')
  if (id) return `id__${id}`
  const title = btn.getAttribute('title') || btn.getAttribute('aria-label') || ''
  if (title) return `title__${title}`
  return `node__${btn.tagName}__${btn.className}`
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

  const isActive =
    hostBtn.classList.contains('tabBtnActive') ||
    String(hostBtn.className || '').includes('tabBtnActive')
  mirror.classList.toggle('sidebar-ux-tab-active', isActive)

  const labeled =
    hostBtn.classList.contains('tabBtnLabeled') ||
    String(hostBtn.className || '').includes('tabBtnLabeled')
  mirror.classList.toggle('sidebar-ux-tab-labeled', labeled)

  const nextHtml = buildMirrorInnerHtml(hostBtn)
  if (mirror.getAttribute('data-mirror-html') !== nextHtml) {
    mirror.setAttribute('data-mirror-html', nextHtml)
    mirror.innerHTML = nextHtml
  }
}

function buildMirrorInnerHtml(hostBtn: HTMLElement): string {
  const parts: string[] = []
  const svg = hostBtn.querySelector('svg')
  if (svg) {
    parts.push(`<span>${svg.outerHTML}</span>`)
  }
  const label = hostBtn.querySelector('span[class*="tabLabel"]') as HTMLElement | null
  if (label) {
    const text = (label.textContent || '').trim()
    parts.push(
      `<span class="sidebar-ux-tab-label">${escapeHtml(text)}</span>`,
    )
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
  if (!hostBtn || !hostBtn.isConnected) {
    reconcileMainMirror()
    const again = _mirrorToHost.get(mirror)
    if (again && again.isConnected) {
      try {
        again.click()
      } catch {
        /* host may throw during teardown */
      }
    }
    onMainMirrorTabActivated(title)
    return
  }
  try {
    hostBtn.click()
  } catch {
    /* ignore */
  }
  onMainMirrorTabActivated(title)
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
  _sidebarObserver = new MutationObserver(() => scheduleReconcile())
  _sidebarObserver.observe(sidebar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'data-tab-id', 'title', 'aria-label'],
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
