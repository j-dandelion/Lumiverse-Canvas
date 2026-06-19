// Main-drawer persistence watcher.
//
// The secondary sidebar is fully owned by Canvas, so its open/close +
// resize handlers can call persistOpenState / persistLayout directly
// (see sidebar/secondary.tsx and resize/handles.ts). The main drawer is
// owned by Lumiverse and exposes no equivalent extension hook — its
// state is read-only from Canvas's side.
//
// Until this watcher existed, the `primary.{open,width}` fields in
// layout.json were effectively write-once: snapshotLayout() captured
// the live state on every save, but no event ever fired a save when
// the user opened/closed/resized the main drawer.
//
// v1.5.6 (MutationObserver approach): Lumiverse does not expose
// spindle.ui to extensions at runtime (the API is documented in
// node_modules/lumiverse-spindle-types/src/dom.ts but window.spindle
// is undefined inside an extension's frontend context). So we
// observe the main drawer's wrapper element directly:
//
//   - The wrapper is `.drawer.main` / `#main-drawer` (see
//     dom/lumiverse.ts). It carries a `wrapperOpen` class while open
//     (ViewportDrawer.tsx:177 in the Lumi frontend).
//   - A MutationObserver on the wrapper's `class` attribute fires
//     whenever the open/close state transitions. We read the new
//     state via the same class-name check isMainDrawerOpen() uses.
//   - A second MutationObserver watches the sidebar's tab list
//     (`[data-spindle-mount="sidebar"]`) for the `tabBtnActive`
//     class moving between buttons, so we can capture the active
//     tab id (the data-tab-id attribute or a derived label).
//   - Width is captured with a debounced ResizeObserver (300ms,
//     matching persistLayout's debounce) so drag-coalesces-to-one-write.
//
// Restore on load: since the host's `spindle.ui.openDrawerTab` API is
// also unavailable, the restore path is DOM-driven. If the saved
// state was `open=true` and the wrapper is currently closed, we
// programmatically `.click()` the first tab button inside the
// sidebar — the host's onClick handler runs `openDrawer()` and
// switches to that tab. We log the outcome and let any animation
// settle naturally.
//
// Restore caveat: if the user had a non-built-in tab active (a
// tab contributed by another extension), the click will switch
// them to the first tab. Acceptable degradation: at least the
// drawer reopens.

import { getMainDrawer } from '../dom/lumiverse'
import { clampSidebarWidth } from '../dom/clamp'
import { persistOpenState, persistLayout, setMainDrawerState } from '../layout/persist'
import { dlog } from '../debug/log'
import { isPointerResizeActive } from '../resize/handles'
import { enforceExclusionOnOpen, setMobileOpenClass } from './mobile-exclusion'
import { waitForDrawerDOM, cleanupDomPoll } from './persist-polling'

// Re-export for back-compat so existing imports keep working.
export { waitForDrawerDOM, cleanupDomPoll } from './persist-polling'

// Debounce window for resize-triggered writes (ms). Mirrors the
// 300ms debounce in persistLayout so drag-to-resize coalesces to a
// single on-disk write.
const RESIZE_DEBOUNCE_MS = 300
// Suppression window after the watcher mounts (ms). The host's
// initial mount fires the ResizeObserver once with a 0→N transition;
// we drop the first burst to avoid a redundant "drawer just resized
// to its current width" save.
const MOUNT_QUIET_MS = 500
// Timeout (ms) to unsuppress the wrapper even if restore fails or the
// async LOAD_LAYOUT never arrives. Prevents a permanently hidden drawer.
const UNSUPPRESS_TIMEOUT_MS = 3000

// module-level cache, populated by the observers and read by
// snapshotLayout() so every save path (settings-toggle, pagehide
// flush, manual save) sees the live main-drawer state.
let _wrapper: HTMLElement | null = null
let _sidebar: HTMLElement | null = null
let _classObserver: MutationObserver | null = null
let _tabObserver: MutationObserver | null = null
let _resizeObserver: ResizeObserver | null = null
let _resizeDebounce: ReturnType<typeof setTimeout> | null = null
let _stopped = true
let _lastSeenOpen: boolean | null = null
let _lastSeenTabId: string | null = null
let _unsuppressTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Read the current open state of the main drawer from the wrapper's
 * class list. Mirrors isMainDrawerOpen()'s DOM fallback (see
 * store/index.ts) so the watcher's truth matches the rest of the
 * app's reads.
 */
function readWrapperOpen(wrapper: HTMLElement): boolean {
  return wrapper.classList.toString().includes('wrapperOpen')
}

/**
 * Read the active tab id from the sidebar. The host marks the active
 * tab button with `tabBtnActive`; we return the button's `data-tab-id`
 * if present, else its `title` attribute (which the host uses to
 * render the localized tab name).
 */
function readActiveTabId(sidebar: HTMLElement): string | null {
  const active = sidebar.querySelector('button.tabBtnActive, button[class*="tabBtnActive"]') as HTMLElement | null
  if (!active) return null
  return active.getAttribute('data-tab-id') || active.getAttribute('title') || null
}

/**
 * Immediately hide the main-drawer wrapper to prevent a flash of the
 * default (open) state while the async LOAD_LAYOUT round-trip resolves.
 * The wrapper is shown again by unsuppressMainDrawer() after restore
 * completes (or after a timeout safety net).
 */
export function suppressMainDrawer(): void {
  const wrapper = _wrapper
  if (!wrapper) return
  wrapper.style.setProperty('visibility', 'hidden', 'important')
  // Safety net: if restore never fires (backend down, timeout, etc.),
  // unsuppress after UNSUPPRESS_TIMEOUT_MS so the drawer isn't stuck hidden.
  if (_unsuppressTimer) clearTimeout(_unsuppressTimer)
  _unsuppressTimer = setTimeout(() => {
    unsuppressMainDrawer()
    dlog('main-persist: unsuppress timeout fired (restore may have failed)')
  }, UNSUPPRESS_TIMEOUT_MS)
}

/**
 * Restore visibility on the main-drawer wrapper after restore is done.
 * Safe to call multiple times; idempotent.
 */
export function unsuppressMainDrawer(): void {
  if (_unsuppressTimer) { clearTimeout(_unsuppressTimer); _unsuppressTimer = null }
  const wrapper = _wrapper
  if (!wrapper) return
  wrapper.style.removeProperty('visibility')
}

/**
 * Find the host's "drawer tab" toggle button — the direct-child <button>
 * inside the wrapper that opens/closes the main drawer. In the DOM
 * hierarchy it's the sibling of the drawer div:
 *
 *   div.wrapper
 *     button.drawerTab   ← this one (toggle open/close)
 *     div.drawer
 */
export function findDrawerToggleButton(wrapper: HTMLElement): HTMLButtonElement | null {
  // Direct-child buttons inside the wrapper
  const buttons = wrapper.querySelectorAll(':scope > button')
  for (const btn of buttons) {
    // The host's drawer-tab button has a class containing "drawerTab"
    // (CSS-module hashed). Match by substring.
    if (/drawerTab/i.test((btn as HTMLElement).className)) {
      return btn as HTMLButtonElement
    }
  }
  return null
}

/**
 * Persist the current main-drawer state to disk. Called on every
 * observed change. We snapshot via the cache rather than re-reading
 * the DOM, so the persistence layer's snapshotLayout() is consistent
 * with what we just observed.
 */
function pushCurrentState() {
  if (!_wrapper) return
  const open = readWrapperOpen(_wrapper)
  const tabId = _sidebar ? readActiveTabId(_sidebar) : null
  if (open === _lastSeenOpen && tabId === _lastSeenTabId) return
  _lastSeenOpen = open
  _lastSeenTabId = tabId
  setMainDrawerState(open, tabId)
  dlog(`main-persist: state change captured (open=${open}, tabId=${tabId})`)
  persistOpenState()
}

/**
 * Core initialization: attach all observers, seed state, suppress/restore.
 * Extracted from startMainDrawerPersistence so it can be called either
 * immediately (drawer already in DOM) or after _waitForDrawerDOM resolves.
 */
function _initObservers(drawer: HTMLElement): void {
  // The wrapper (which carries `wrapperOpen`) is the grandparent of
  // the sidebar mount node, NOT the parent. DOM hierarchy:
  //   div.wrapper[.wrapperOpen]     ← we need this (grandparent)
  //     button.drawerTab
  //     div.drawer                  ← getMainDrawer() returns this
  //       div.sidebar[data-spindle-mount="sidebar"]
  //
  // If the grandparent has no `wrapperOpen`-like class on first read
  // (drawer starts closed), walk upward to the closest ancestor with
  // a "wrapper" CSS-module class (the mangled name always contains
  // "wrapper" as a substring — confirmed from ViewportDrawer.module.css).
  let wrapper: HTMLElement = drawer as HTMLElement
  // Try parent (in case getMainDrawer already returns the wrapper)
  const parent = drawer.parentElement as HTMLElement | null
  if (parent && parent.classList.toString().match(/wrapper/i)) {
    wrapper = parent
  }
  // Also try grandparent (the common case)
  const grandparent = parent?.parentElement as HTMLElement | null
  if (grandparent && grandparent.classList.toString().match(/wrapper/i)) {
    wrapper = grandparent
  }
  const sidebar = document.querySelector('[data-spindle-mount="sidebar"]') as HTMLElement | null

  _wrapper = wrapper
  _sidebar = sidebar
  _lastSeenOpen = readWrapperOpen(wrapper)
  _lastSeenTabId = sidebar ? readActiveTabId(sidebar) : null

  // Immediately hide the wrapper to prevent a flash of the default
  // (open) state while the async LOAD_LAYOUT round-trip resolves.
  // unsuppressMainDrawer() is called by restoreMainDrawerFromDom()
  // after the state is applied, or by the 3s safety-net timeout.
  suppressMainDrawer()

  // Seed the module-level cache so snapshotLayout() reads the right
  // values on the first save after mount.
  setMainDrawerState(_lastSeenOpen, _lastSeenTabId)
  dlog(`main-persist: seeded from DOM (open=${_lastSeenOpen}, tabId=${_lastSeenTabId})`)

  // Observe the wrapper's class attribute. Open/close transitions
  // toggle `wrapperOpen`; the MutationObserver fires once per
  // change, so we don't need any internal debounce here.
  _classObserver = new MutationObserver((mutations) => {
    if (_stopped) return
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const _newClass = wrapper.classList.toString()
        dlog(`[reflow-trace] main-persist MO: wrapper class changed to "${_newClass}"`)
        pushCurrentState()
        // Mobile exclusion: detect closed→open transition
        if (wrapper) {
          const isOpen = readWrapperOpen(wrapper)
          enforceExclusionOnOpen('primary')
          setMobileOpenClass('primary', isOpen)
        }
        break
      }
    }
  })
  _classObserver.observe(wrapper, { attributes: true, attributeFilter: ['class'] })

  // Observe the sidebar's tab list for active-tab transitions. The
  // host moves `tabBtnActive` between buttons; the MutationObserver
  // fires for each class change inside the subtree.
  if (sidebar) {
    _tabObserver = new MutationObserver((mutations) => {
      if (_stopped) return
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          const target = m.target as HTMLElement
          if (target.className && /tabBtn/.test(target.className)) {
            pushCurrentState()
            break
          }
        } else if (m.type === 'childList') {
          pushCurrentState()
          break
        }
      }
    })
    _tabObserver.observe(sidebar, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    })
  }

  // Width: ResizeObserver with debounce. The 500ms MOUNT_QUIET_MS
  // suppression prevents the very first observation callback (which
  // fires on initial layout) from triggering a redundant save.
  let mountedAt = Date.now()
  _resizeObserver = new ResizeObserver(() => {
    if (_stopped) return
    if (Date.now() - mountedAt < MOUNT_QUIET_MS) return
    if (_resizeDebounce) clearTimeout(_resizeDebounce)
    _resizeDebounce = setTimeout(() => {
      if (_stopped) return
      dlog(`main-persist: width changed, persisting`)
      persistLayout()
    }, RESIZE_DEBOUNCE_MS)
  })
  _resizeObserver.observe(wrapper)

  dlog(`main-persist: started (wrapper=${!!wrapper}, sidebar=${!!sidebar})`)
}

export function startMainDrawerPersistence(): void {
  if (!_stopped) return
  _stopped = false

  const drawer = getMainDrawer()
  if (!drawer) {
    dlog('main-persist: getMainDrawer() returned null; waiting for host DOM...')
    waitForDrawerDOM(
      { get value() { return _stopped } },
      _initObservers,
    )
    return
  }
  _initObservers(drawer)
}

/**
 * Restore the main-drawer open/close state on load by simulating a
 * click on the host's first tab button. Called from layout/persist.ts
 * after loadSavedLayout resolves.
 *
 * Optionally restores the drawer width by setting `drawer.style.width`
 * and the `--drawer-panel-w` CSS variable on the wrapper (mirroring
 * the resize handle's onDrag logic in resize/handles.ts).
 */
export function restoreMainDrawerFromDom(
  targetOpen: boolean,
  targetTabId: string | null,
  targetWidthPx?: number,
): void {
  if (_stopped) return
  const drawer = getMainDrawer()
  const wrapper = _wrapper || (drawer as HTMLElement | null)
  if (!wrapper) {
    dlog('main-persist restore: no wrapper in DOM, cannot restore')
    unsuppressMainDrawer()
    return
  }

  // Restore width first (even if the drawer is closed, the width
  // should be applied so it's visible when the user opens it).
  // NOTE: --drawer-panel-w is only set when the target state is OPEN
  // and the viewport is desktop (>600px). On mobile, the host's CSS
  // (ViewportDrawer.module.css @media max-width:600px) forces
  // .drawer { width: calc(100vw / var(--lumiverse-ui-scale, 1)) !important }
  // independently. Setting the variable with !important on mobile
  // decouples the wrapper transform from the actual drawer width,
  // causing a ~80px peek when the user closes the sidebar.
  const clampedWidth = (typeof targetWidthPx === 'number' && targetWidthPx > 0)
    ? clampSidebarWidth(targetWidthPx)
    : null

  const currentOpen = readWrapperOpen(wrapper)
  if (currentOpen === targetOpen) {
    dlog(`main-persist restore: already in target state (open=${targetOpen}), nothing to do`)
    // If the drawer is open, set the width so it's correct on this session.
    // If closed, leave --drawer-panel-w alone — the host's CSS uses it
    // for the close animation (translateX). Clearing it breaks the
    // animation on desktop.
    if (targetOpen && clampedWidth !== null && drawer) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`
        wrapper.style.setProperty('--drawer-panel-w', `${clampedWidth}px`, 'important')
        dlog(`main-persist restore: set width=${clampedWidth}px (open, same state)`)
      } else {
        dlog(`main-persist restore: skipped width override on mobile (host CSS handles sizing)`)
      }
    }
    unsuppressMainDrawer()
    return
  }
  if (targetOpen) {
    // Set width BEFORE opening so the drawer renders at the right size.
    // On mobile, skip the width override — the host's mobile CSS
    // handles sizing and setting --drawer-panel-w with !important
    // causes the close-animation peek.
    if (clampedWidth !== null && drawer) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`
        wrapper.style.setProperty('--drawer-panel-w', `${clampedWidth}px`, 'important')
        dlog(`main-persist restore: set width=${clampedWidth}px (opening)`)
      } else {
        dlog(`main-persist restore: skipped width override on mobile (host CSS handles sizing)`)
      }
    }
    // Find a tab button to click. The host's first visible built-in
    // tab is a safe default — clicking opens the drawer and switches
    // to that tab. The user can switch tabs after.
    const sidebar = _sidebar || (document.querySelector('[data-spindle-mount="sidebar"]') as HTMLElement | null)
    const tabBtn = sidebar?.querySelector('button[class*="tabBtn"]') as HTMLButtonElement | null
    if (tabBtn) {
      dlog(`main-persist restore: clicking first tab to open drawer (target tabId=${targetTabId})`)
      unsuppressMainDrawer()
      try {
        tabBtn.click()
      } catch (err) {
        dlog(`main-persist restore: tabBtn.click() threw: ${err}`)
      }
    } else {
      dlog('main-persist restore: no tab button found in sidebar; cannot programmatically open')
      unsuppressMainDrawer()
    }
  } else {
    // Target state is "closed" but drawer is open. The host's
    // drawer-tab button (sibling of the drawer div inside the wrapper)
    // toggles open/close. Click it to close.
    const toggleBtn = findDrawerToggleButton(wrapper)
    if (toggleBtn) {
      dlog('main-persist restore: clicking drawer toggle to close')
      unsuppressMainDrawer()
      try {
        toggleBtn.click()
      } catch (err) {
        dlog(`main-persist restore: toggleBtn.click() threw: ${err}`)
      }
    } else {
      dlog('main-persist restore: target=closed but no toggle button found; leaving to user gesture')
      unsuppressMainDrawer()
    }
  }
}

export function stopMainDrawerPersistence(): void {
  if (_stopped) return
  _stopped = true
  if (_classObserver) { _classObserver.disconnect(); _classObserver = null }
  if (_tabObserver) { _tabObserver.disconnect(); _tabObserver = null }
  if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null }
  if (_resizeDebounce) { clearTimeout(_resizeDebounce); _resizeDebounce = null }
  cleanupDomPoll()
  _wrapper = null
  _sidebar = null
  _lastSeenOpen = null
  _lastSeenTabId = null
  if (_unsuppressTimer) { clearTimeout(_unsuppressTimer); _unsuppressTimer = null }
}