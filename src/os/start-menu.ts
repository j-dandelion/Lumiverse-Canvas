/**
 * OS-mode Start menu (spec D6/D10/D18/D19, §2.4).
 *
 * Per-drawer launcher chrome while OS mode is on:
 *   - a **Start button** styled after the Options dock chrome, injected per
 *     strip: Sides mode → the main mirror's bottom dock BENEATH the settings
 *     button (D10), the secondary strip's end; Top/Bottom mode → the OUTER
 *     (screen-edge) end of each strip via CSS `order` (the S8 #3 dock-order
 *     trick — single geometry authority stays in tab-position.ts).
 *   - the **menu**: a compact vertical list of every non-hidden tab (any
 *     window state), entries in strip order with a state glyph (D18:
 *     ● open, – minimized, ○ closed) and the tab's store icon. Clicking
 *     routes through the window-state actions: closed → launch fresh,
 *     minimized → restore, open → focus; a tab assigned to the other drawer
 *     moves (D13); a closed drawer auto-opens (D19).
 *
 * Lifecycle: ONE menu open at a time across drawers; Escape or click-outside
 * dismisses; entries derive on every open (never stale). The menu anchors
 * to the invoking button's viewport rect, opening away from the screen edge
 * with viewport clamping (§4.4.3).
 *
 * Motion (§4.4.3): the surface scales about the invoking button's center (an
 * external transform-origin) while fading — grows out of the button on open,
 * collapses back into it on close. Interruptible: a close mid-open continues
 * from the captured visual state instead of popping. Reduced-motion / no-WAAPI
 * environments take the instant path. The menu is a <body> child under the
 * host UI zoom, so every rendered rect is converted to layout px (see
 * start-menu-motion.ts for the coordinate contract).
 */

import type { Side } from '../core/model'
import { getModel, getHost } from '../recon/dispatch'
import { getDrawerTabs, getMainDrawerSide } from '../store'
import { getSettings, isHorizontalStrip, isOsModeEnabled } from '../settings/state'
import { openWindowInDrawerByLiveId } from './actions'
import { getSecondaryTabList } from '../sidebar/secondary'
import { DRAWER_SHELL_CREATED_EVENT } from '../sidebar/drawer-shell'
import { SECONDARY_START_DOCK_CLASS } from '../tabs/secondary-start-dock'
import { dlog } from '../debug/log'
import {
  canAnimateMenu,
  captureMenuVisualState,
  computeGrowthOrigin,
  getUiScale,
  playMenuIn,
  playMenuOut,
  prefersReducedMotion,
} from './start-menu-motion'

const START_ATTR = 'data-canvas-os-start'
const MENU_ID = 'canvas-os-start-menu'
/** Secondary Start dock: carries the main-drawer dock chrome (divider + 8px
 *  gap + bottom anchor) so the separator is owned by the container, not the
 *  button. Must stay the LAST child of the secondary tab list — tab writers
 *  insert before it via the shared leaf helper. */
const TAB_LIST_BOTTOM_CLASS = 'sidebar-ux-tab-list-bottom'

let _menu: HTMLElement | null = null
let _menuOpenFor: Side | null = null
/** Invoking button — the close animation's anchor. Cleared on hide. */
let _menuButton: HTMLElement | null = null
/** Pending position rAF (identity-guarded against a superseded open). */
let _menuRaf = 0
/** Open-animation handle (cancelled when a close starts). */
let _menuAnim: Animation | null = null
/** False until the position rAF reveals the menu (hide-before-reveal → instant). */
let _menuRevealed = false
/** In-flight close: the menu stays in the DOM while it animates out. */
let _closing: { menu: HTMLElement; anim: Animation | null } | null = null
let _buttonRaf = 0
let _unsubDocListeners: (() => void) | null = null

// ── Entry derivation (pure, exported for tests) ──────────────────────────────

export interface StartMenuEntry {
  /** Live tab id (the window-state actions' keying). */
  liveId: string
  title: string
  iconSvg?: string
  iconUrl?: string
  state: 'open' | 'minimized' | 'closed'
}

/**
 * Derive the Start menu entries for a drawer: every non-hidden tab in strip
 * order, each with its window state. F7: eye-hidden tabs never appear.
 * Unresolvable extension keys are skipped (they cannot open this session).
 */
export function deriveStartMenuEntries(
  side: Side,
  model: {
    primary: readonly string[]
    secondary: readonly string[]
    hidden: readonly string[]
    closed: readonly string[]
    active: { primary: string | null; secondary: string | null }
  },
  resolve: (key: string) => string | null,
): StartMenuEntry[] {
  const keys = side === 'primary' ? model.primary : model.secondary
  const activeKey = model.active[side]
  const out: StartMenuEntry[] = []
  for (const key of keys) {
    if (model.hidden.includes(key)) continue
    const liveId = resolve(key)
    if (!liveId) continue
    const state = model.closed.includes(key)
      ? 'closed'
      : key === activeKey ? 'open' : 'minimized'
    const tab = getDrawerTabs().find((t) => t.id === liveId)
    out.push({
      liveId,
      title: tab?.title ?? key,
      iconSvg: tab?.iconSvg,
      iconUrl: tab?.iconUrl,
      state,
    })
  }
  return out
}

/** D18 state glyphs: ● open, – minimized, ○ closed. */
export function glyphFor(state: StartMenuEntry['state']): string {
  return state === 'open' ? '●' : state === 'minimized' ? '–' : '○'
}

// ── Menu DOM ─────────────────────────────────────────────────────────────────

function createMenuEntry(entry: StartMenuEntry, side: Side): HTMLElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.setAttribute('role', 'menuitem')
  item.setAttribute('data-os-state', entry.state)
  item.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--lumiverse-text);
    cursor: pointer;
    text-align: left;
    font-size: calc(13px * var(--lumiverse-font-scale, 1));
  `
  const icon = document.createElement('span')
  icon.style.cssText = 'width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;'
  if (entry.iconSvg) icon.innerHTML = entry.iconSvg
  else if (entry.iconUrl) {
    const img = document.createElement('img')
    img.src = entry.iconUrl
    img.alt = ''
    img.width = 20
    img.height = 20
    img.style.borderRadius = '2px'
    icon.appendChild(img)
  }
  item.appendChild(icon)
  const label = document.createElement('span')
  label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
  label.textContent = entry.title
  item.appendChild(label)
  const glyph = document.createElement('span')
  glyph.textContent = glyphFor(entry.state)
  glyph.style.cssText = 'color:var(--lumiverse-text-muted);flex-shrink:0;'
  item.appendChild(glyph)
  item.addEventListener('click', () => {
    hideStartMenu()
    void openWindowInDrawerByLiveId(entry.liveId, side)
  })
  return item
}

/** Build the menu surface for one drawer's entries (caller positions it). */
function buildMenu(side: Side): HTMLElement | null {
  const host = getHost()
  const model = getModel()
  if (!host || !model) return null
  const entries = deriveStartMenuEntries(side, model, (key) => host.resolve(key))
  const menu = document.createElement('div')
  menu.id = MENU_ID
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', 'Start menu')
  menu.style.cssText = `
    position: fixed;
    z-index: 2147483600;
    display: flex;
    flex-direction: column;
    min-width: 220px;
    max-width: 320px;
    max-height: min(60vh, 420px);
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--lumiverse-surface, #1a1a1e);
    border: 1px solid var(--lumiverse-primary-015, rgba(255,255,255,0.15));
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    padding: 6px;
    gap: 2px;
  `
  if (entries.length === 0) {
    // Empty-state row (spec §4.4.3): "where did my tabs go?" in one glance.
    const empty = document.createElement('div')
    empty.setAttribute('role', 'presentation')
    empty.style.cssText = 'padding:14px 12px;color:var(--lumiverse-text-muted);font-size:calc(12px * var(--lumiverse-font-scale, 1));'
    empty.textContent = 'No windows'
    menu.appendChild(empty)
  }
  for (const entry of entries) {
    menu.appendChild(createMenuEntry(entry, side))
  }
  return menu
}

/** Cancel the pending menu-position rAF (if any). */
function cancelMenuRaf(): void {
  if (_menuRaf) {
    cancelAnimationFrame(_menuRaf)
    _menuRaf = 0
  }
}

/** Cancel an in-flight close animation and drop its menu immediately. */
function cancelClosing(): void {
  if (!_closing) return
  const { menu, anim } = _closing
  _closing = null
  if (anim) {
    anim.onfinish = null
    anim.cancel()
  }
  menu.remove()
}

/**
 * Dismiss a menu whose invoking button left the DOM (shell remount, side
 * change, second-drawer disable): a body-level menu must not outlive its
 * anchor. Runs from the ensure pass — the same signal that recreates the
 * strip — because those remounts carry no OS-setting diff.
 */
function reconcileStartMenuPresence(): void {
  if (_menu && (!_menuButton || !_menuButton.isConnected)) {
    hideStartMenu({ immediate: true })
  }
}

/** Open the menu for a drawer, anchored to the invoking button. Idempotent:
 *  clicking a drawer's own Start button while its menu is open toggles. */
function openStartMenu(side: Side, button: HTMLElement): void {
  // Same-side toggle — only while the menu is genuinely open on a live
  // button. A shell remount can leave a stale open flag + dead anchor; then
  // the click must open a fresh menu, not try to close the orphan.
  if (_menuOpenFor === side && _menuButton?.isConnected) {
    hideStartMenu()
    return
  }
  hideStartMenu({ immediate: true })
  const menu = buildMenu(side)
  if (!menu) return
  document.body.appendChild(menu)
  _menu = menu
  _menuOpenFor = side
  _menuButton = button
  _menuRevealed = false
  button.setAttribute('aria-expanded', 'true')

  // Position: open AWAY from the screen edge — above bottom-anchored
  // buttons, below top-strip buttons; clamp into the viewport (8px gutters).
  // The menu is a body child under the host's UI zoom: rects and window.inner*
  // are RENDERED px while inline left/top are LAYOUT px — clamp in rendered
  // space, assign divided by the scale (context-menu/index.ts pattern).
  const rect = button.getBoundingClientRect()
  menu.style.visibility = 'hidden'
  cancelMenuRaf()
  _menuRaf = requestAnimationFrame(() => {
    _menuRaf = 0
    if (_menu !== menu) return // stale rAF from a superseded open
    const mRect = menu.getBoundingClientRect()
    const uiScale = getUiScale()
    const openUpward = rect.bottom > window.innerHeight / 2
    const renderedLeft = Math.max(8, Math.min(rect.left, window.innerWidth - mRect.width - 8))
    const renderedTop = Math.max(8, Math.min(
      openUpward ? rect.top - mRect.height - 8 : rect.bottom + 8,
      window.innerHeight - mRect.height - 8,
    ))
    menu.style.left = `${renderedLeft / uiScale}px`
    menu.style.top = `${renderedTop / uiScale}px`
    menu.style.visibility = ''
    _menuRevealed = true
    // Grow out of the button: origin at its center, external to the box.
    _menuAnim = playMenuIn(menu, computeGrowthOrigin(rect, mRect, uiScale))
    ;(menu.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus()
  })
  attachMenuDismiss()
  dlog('[os] start menu open', { side })
}

/**
 * Hide the open menu (idempotent). Animated by default: the surface fades
 * while shrinking toward the invoking button; the node is removed when the
 * animation settles. `immediate` skips the motion (teardown, dead anchor,
 * pre-reveal hide, reduced-motion, no WAAPI) — used wherever a visible exit
 * would be wrong.
 */
export function hideStartMenu(opts?: { immediate?: boolean }): void {
  _unsubDocListeners?.()
  _unsubDocListeners = null
  for (const btn of document.querySelectorAll(`button[${START_ATTR}]`)) {
    btn.setAttribute('aria-expanded', 'false')
  }

  const menu = _menu
  const button = _menuButton
  const revealed = _menuRevealed
  const side = _menuOpenFor
  _menu = null
  _menuOpenFor = null
  _menuButton = null
  _menuRevealed = false
  cancelMenuRaf()

  // Focus must not stay on a surface that is leaving the DOM.
  const active = document.activeElement as HTMLElement | null
  if (menu && active && menu.contains(active)) {
    if (button?.isConnected) button.focus()
    else active.blur()
  }

  const animatable = menu !== null && canAnimateMenu(menu) && !prefersReducedMotion()
  if (!menu || opts?.immediate || !animatable || !revealed || !button || !button.isConnected) {
    _menuAnim?.cancel()
    _menuAnim = null
    menu?.remove()
    cancelClosing()
    if (menu) dlog('[os] start menu close', { side, immediate: true })
    return
  }

  // Capture the current visual state BEFORE cancelling the open animation:
  // getComputedStyle sees the animated values, while getBoundingClientRect
  // would fold its transform into the rects measured below. Cancel first,
  // then measure the settled layout so the shrink target is the true button.
  const from = captureMenuVisualState(menu)
  _menuAnim?.cancel()
  _menuAnim = null
  const origin = computeGrowthOrigin(
    button.getBoundingClientRect(),
    menu.getBoundingClientRect(),
    getUiScale(),
  )
  menu.style.pointerEvents = 'none'
  const anim = playMenuOut(menu, origin, from, () => {
    menu.remove()
    if (_closing?.menu === menu) _closing = null
  })
  if (anim) _closing = { menu, anim }
  dlog('[os] start menu close', { side, immediate: false })
}

/** Outside-click + Escape dismissal while the menu is open. */
function attachMenuDismiss(): void {
  const onDocMousedown = (ev: MouseEvent) => {
    const target = ev.target
    if (!(target instanceof Element)) return
    if (_menu?.contains(target)) return
    if (target.closest(`button[${START_ATTR}]`)) return // the button toggles itself
    hideStartMenu()
  }
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.preventDefault()
      hideStartMenu()
      return
    }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return
    if (!_menu) return
    const items = Array.from(_menu.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
    if (items.length === 0) return
    const idx = items.indexOf(document.activeElement as HTMLElement)
    ev.preventDefault()
    const dir = ev.key === 'ArrowDown' ? 1 : -1
    const next = idx === -1 ? items[0]! : items[(idx + dir + items.length) % items.length]!
    next.focus()
  }
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('keydown', onKey, true)
  _unsubDocListeners = () => {
    document.removeEventListener('mousedown', onDocMousedown, true)
    document.removeEventListener('keydown', onKey, true)
  }
}

// ── Start buttons ────────────────────────────────────────────────────────────

/**
 * Start button markup. Chrome is CSS-owned:
 * `.sidebar-ux-tab-list button[data-canvas-os-start]` in
 * `sidebar/styles.ts` (OS_START_BUTTON_CSS) mirrors the Options/Settings dock
 * button — same 48px row, radius, transition and hover background. NEVER
 * inline geometry here: inline styles beat the sheet AND the mobile /
 * horizontal size overrides. The glyph is the only intended difference
 * (20px icon box, same as the mirror's forced icon size).
 */
function startButtonHtml(): string {
  return `<button type="button" ${START_ATTR}="1" aria-label="Start" title="Start" aria-haspopup="menu" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg></button>`
}

/**
 * Ensure the side's Start button exists in the right slot (idempotent):
 *   - Sides, main mirror → the bottom dock, beneath the settings button (D10).
 *   - Sides, secondary → its own bottom dock (same `.sidebar-ux-tab-list-bottom`
 *     chrome as the main drawer's Settings dock: divider + 8px gap, anchored
 *     to the strip end). The divider is therefore NOT part of the button.
 *   - Top/Bottom → CSS `order` at the OUTER (screen-edge) end, adjacent to
 *     the settings dock (S8 #3 order trick: the dock's side is order-owned;
 *     Start takes the outermost slot: left/upper drawer → -2, right/lower → 2).
 */
async function ensureStartButtonForSide(side: Side): Promise<void> {
  const list = side === 'primary' ? await getMainMirrorList() : getSecondaryTabList()
  if (!list) return
  let btn = list.querySelector(`button[${START_ATTR}]`) as HTMLButtonElement | null
  if (btn && !btn.isConnected) btn = null
  if (!btn) {
    const template = document.createElement('template')
    template.innerHTML = startButtonHtml().trim()
    btn = template.content.firstElementChild as HTMLButtonElement
  }
  if (side === 'primary') {
    if (!btn.parentElement) {
      const dock = list.querySelector(`.${TAB_LIST_BOTTOM_CLASS}`) as HTMLElement | null
      if (dock) dock.appendChild(btn)
      else list.appendChild(btn)
    }
  } else {
    // Secondary: wrap the Start in its own dock so the divider matches the
    // main drawer's Settings dock exactly (container border, not button).
    let dock = list.querySelector(`:scope > .${SECONDARY_START_DOCK_CLASS}`) as HTMLElement | null
    if (!dock) {
      dock = document.createElement('div')
      dock.className = `${TAB_LIST_BOTTOM_CLASS} ${SECONDARY_START_DOCK_CLASS}`
      list.appendChild(dock)
    }
    if (btn.parentElement !== dock) dock.appendChild(btn)
    // Self-heal ordering: a late host registration can append a tab button
    // after the dock; tab writers use appendSecondaryTabNode, this is the
    // belt-and-braces for anything that slipped through.
    if (dock.nextElementSibling) list.appendChild(dock)
  }
  if (isHorizontalStrip()) {
    const drawerLeft = getMainDrawerSide() === 'left'
    const startIsOuter = side === 'primary' ? drawerLeft : !drawerLeft
    btn.style.order = startIsOuter ? '-2' : '2'
  } else {
    btn.style.order = ''
  }
  if (!btn.dataset.wired) {
    btn.dataset.wired = '1'
    btn.addEventListener('click', () => openStartMenu(side, btn as HTMLElement))
  }
}

/** The main mirror's tab list (lazy import — load-order cycle). */
async function getMainMirrorList(): Promise<HTMLElement | null> {
  const m = await import('../sidebar/main-mirror-drawer')
  return m.getMainMirrorTabList()
}

function scheduleEnsureButtons(): void {
  if (_buttonRaf) return
  _buttonRaf = requestAnimationFrame(async () => {
    _buttonRaf = 0
    // A remounted shell can strand an open menu on a dead anchor; the ensure
    // pass is the one place that always runs after a remount.
    reconcileStartMenuPresence()
    await ensureStartButtonForSide('primary')
    if (isOsModeEnabled()) {
      if (getSettings().secondSidebarEnabled) {
        await ensureStartButtonForSide('secondary')
      } else {
        // Second drawer disabled mid-session: the Start button (and its dock)
        // leave with the strip (F6 companion — the enable path re-ensures on
        // demand).
        const list = getSecondaryTabList()
        list?.querySelector(`button[${START_ATTR}]`)?.remove()
        list?.querySelector(`.${SECONDARY_START_DOCK_CLASS}`)?.remove()
        if (_menuOpenFor === 'secondary') hideStartMenu({ immediate: true })
      }
    }
  })
}

// ── Feature hooks ────────────────────────────────────────────────────────────

/** Shell-created re-ensure wiring (idempotent; test-visible). */
let _onShellCreated: (() => void) | null = null

/**
 * Subscribe the Start-button ensure to `canvas:drawer-shell-created`.
 * A shell mount (second-drawer enable, side remount, viewport cross) replaces
 * the strip with no OS-mode setting diff — without this the secondary Start
 * button is missing after `requestSecondDrawerMode(true)` while OS mode is
 * already on (live report 2026-09-15; panel-chrome consumes the same signal).
 * Idempotent: repeated calls keep exactly one listener.
 */
export function installShellCreatedListener(): void {
  if (typeof window === 'undefined' || _onShellCreated !== null) return
  _onShellCreated = () => scheduleEnsureButtons()
  window.addEventListener(DRAWER_SHELL_CREATED_EVENT, _onShellCreated)
}

/** Remove the shell-created listener (teardown; safe when never installed). */
export function removeShellCreatedListener(): void {
  if (_onShellCreated && typeof window !== 'undefined') {
    window.removeEventListener(DRAWER_SHELL_CREATED_EVENT, _onShellCreated)
  }
  _onShellCreated = null
}

/** Mount the Start buttons (feature mount / runtime enable). */
export function mountStartMenu(): void {
  if (!isOsModeEnabled()) return
  installShellCreatedListener()
  scheduleEnsureButtons()
  dlog('[os] start menu chrome mounted')
}

/** Teardown: remove buttons + docks + any open menu (feature unmount / disable). */
export function teardownStartMenu(): void {
  removeShellCreatedListener()
  if (_buttonRaf) {
    cancelAnimationFrame(_buttonRaf)
    _buttonRaf = 0
  }
  hideStartMenu({ immediate: true })
  for (const btn of Array.from(document.querySelectorAll(`button[${START_ATTR}]`))) {
    btn.remove()
  }
  // Remove the secondary Start docks too — an empty dock would leave a stray
  // divider line in the strip.
  for (const dock of Array.from(document.querySelectorAll(`.${SECONDARY_START_DOCK_CLASS}`))) {
    dock.remove()
  }
  dlog('[os] start menu chrome unmounted')
}
