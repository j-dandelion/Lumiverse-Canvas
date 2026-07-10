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
import { getSettings } from '../settings/state'
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
// Delay before restoring the active primary tab via .click(). One frame
// is enough for keep-tabs pin/reconcile to attach mirror buttons; panel
// bodies stay opacity:0 until the correct tab is active, so we do not
// need a long blank settle.
const RESTORE_TAB_CLICK_MS = 0
// html class + stylesheet: hide host main AND Canvas main-mirror shell
// until primary open/tab restore finishes (prevents profile flash).
const RESTORE_PENDING_CLASS = 'sidebar-ux-main-restore-pending'
const RESTORE_GUARD_STYLE_ID = 'sidebar-ux-main-restore-guard'
/** Inline stamp on every panel body we force-hide during restore. */
const RESTORE_HIDE_ATTR = 'data-canvas-restore-hide'
// Host tabBtnActive must hold for this many consecutive polls before we
// consider chrome "host-ready". Mirror-only active must NOT count (Canvas
// paints mirror highlight before React commits panel children).
const RESTORE_HOST_STABLE_POLLS = 2
// After host is stable: require panel-body mutation quiescence this long
// (ms) before lifting the restore guard. Fallback settle if no mutations
// (already-correct tab / empty panel).
const RESTORE_CONTENT_QUIET_MS = 40
const RESTORE_CONTENT_FALLBACK_MS = 50

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
/** Re-stamps inline hide on newly mounted panel bodies during restore. */
let _panelHideObserver: MutationObserver | null = null
let _panelHideRaf: number | null = null
/** Watches parked panel body children during restore tab settle. */
let _contentSettleObserver: MutationObserver | null = null
let _contentQuietTimer: ReturnType<typeof setTimeout> | null = null
let _contentFallbackTimer: ReturnType<typeof setTimeout> | null = null

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

function ensureRestoreGuardStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(RESTORE_GUARD_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = RESTORE_GUARD_STYLE_ID
  // Hide chrome + every possible main panel body node. Host React can
  // remount `[class*="_panelContent_"]` outside the shell (or with
  // visibility:visible !important) during tab switches — class rules on
  // the shell alone are not enough. Inline stamps (stampPanelBodyHide)
  // back the same nodes.
  el.textContent = `
    html.${RESTORE_PENDING_CLASS} [class*="_wrapper_"]:has([data-spindle-mount="sidebar"]),
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-main-mirror-wrapper {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Panel bodies anywhere — host tree, parked in shell, or mid-reparent. */
    html.${RESTORE_PENDING_CLASS} [class*="_panelContent_"],
    html.${RESTORE_PENDING_CLASS} [data-canvas-main-panel-content],
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content,
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > * {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    html.${RESTORE_PENDING_CLASS} .sidebar-ux-tab-list-pin-host[data-pin-owner="main"] {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `
  document.head.appendChild(el)
}

function isPanelBodyNode(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  const cls = String(el.className || '')
  if (cls.includes('_panelContent_')) return true
  if (el.hasAttribute('data-canvas-main-panel-content')) return true
  // Shell content slot that holds parked host panelContent.
  if (
    cls.includes('sidebar-ux-panel-content')
    && el.closest('.sidebar-ux-main-mirror-wrapper')
  ) {
    return true
  }
  return false
}

/**
 * Force-hide every live main panel body with inline !important styles.
 * Survives reparenting and CSS fights better than ancestor-only rules.
 * Safe to call repeatedly; also used from main-mirror after park.
 */
export function stampPanelBodyHide(): void {
  if (typeof document === 'undefined') return
  if (!document.documentElement.classList.contains(RESTORE_PENDING_CLASS)) return
  const nodes = document.querySelectorAll(
    '[class*="_panelContent_"],'
    + '[data-canvas-main-panel-content],'
    + '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content,'
    + '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > *',
  )
  for (const node of Array.from(nodes)) {
    const el = node as HTMLElement
    el.setAttribute(RESTORE_HIDE_ATTR, '1')
    el.style.setProperty('visibility', 'hidden', 'important')
    el.style.setProperty('opacity', '0', 'important')
    el.style.setProperty('pointer-events', 'none', 'important')
  }
}

function clearPanelBodyHide(): void {
  if (typeof document === 'undefined') return
  const nodes = document.querySelectorAll(`[${RESTORE_HIDE_ATTR}]`)
  for (const node of Array.from(nodes)) {
    const el = node as HTMLElement
    el.removeAttribute(RESTORE_HIDE_ATTR)
    el.style.removeProperty('visibility')
    el.style.removeProperty('opacity')
    el.style.removeProperty('pointer-events')
  }
}

function scheduleStampPanelBodyHide(): void {
  if (_panelHideRaf != null) return
  _panelHideRaf = requestAnimationFrame(() => {
    _panelHideRaf = null
    stampPanelBodyHide()
  })
}

function startPanelHideObserver(): void {
  if (typeof document === 'undefined' || _panelHideObserver) return
  stampPanelBodyHide()
  _panelHideObserver = new MutationObserver((mutations) => {
    if (!document.documentElement.classList.contains(RESTORE_PENDING_CLASS)) return
    let needs = false
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const n of Array.from(m.addedNodes)) {
          if (n instanceof Element && (isPanelBodyNode(n) || n.querySelector?.('[class*="_panelContent_"], [data-canvas-main-panel-content]'))) {
            needs = true
            break
          }
        }
      }
      if (needs) break
    }
    if (needs) scheduleStampPanelBodyHide()
  })
  _panelHideObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

function stopPanelHideObserver(): void {
  if (_panelHideObserver) {
    _panelHideObserver.disconnect()
    _panelHideObserver = null
  }
  if (_panelHideRaf != null) {
    cancelAnimationFrame(_panelHideRaf)
    _panelHideRaf = null
  }
}

function armUnsuppressTimeout(): void {
  if (_unsuppressTimer) clearTimeout(_unsuppressTimer)
  _unsuppressTimer = setTimeout(() => {
    unsuppressMainDrawer()
    dlog('main-persist: unsuppress timeout fired (restore may have failed)')
  }, UNSUPPRESS_TIMEOUT_MS)
}

/**
 * Start the restore-pending visual guard early (before keep-tabs /
 * main-mirror mounts) so the host default tab (profile) never paints
 * for a frame. Safe to call before the main-drawer watcher attaches.
 */
export function beginMainDrawerRestoreGuard(): void {
  ensureRestoreGuardStyles()
  document.documentElement.classList.add(RESTORE_PENDING_CLASS)
  startPanelHideObserver()
  stampPanelBodyHide()
  armUnsuppressTimeout()
}

/**
 * Immediately hide the main-drawer wrapper (and main-mirror shell via
 * RESTORE_PENDING_CLASS) to prevent a flash of the default (open /
 * profile) state while layout restore runs.
 * Shown again by unsuppressMainDrawer() after restore completes (or
 * after a timeout safety net).
 */
export function suppressMainDrawer(): void {
  beginMainDrawerRestoreGuard()
  const wrapper = _wrapper
  if (!wrapper) return
  // Inline backup for environments where the html-class stylesheet is slow
  // or stripped; class-based rule also covers main-mirror.
  wrapper.style.setProperty('visibility', 'hidden', 'important')
  wrapper.style.setProperty('opacity', '0', 'important')
  stampPanelBodyHide()
}

/**
 * Restore visibility on the main-drawer wrapper + main-mirror shell
 * after restore is done. Safe to call multiple times; idempotent.
 */
export function unsuppressMainDrawer(): void {
  if (_unsuppressTimer) { clearTimeout(_unsuppressTimer); _unsuppressTimer = null }
  stopContentSettleWatch()
  stopPanelHideObserver()
  clearPanelBodyHide()
  document.documentElement.classList.remove(RESTORE_PENDING_CLASS)
  const wrapper = _wrapper
  if (wrapper) {
    wrapper.style.removeProperty('visibility')
    wrapper.style.removeProperty('opacity')
  }
}

/** True while restore-pending guard is active (main-mirror park consults this). */
export function isMainDrawerRestorePending(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains(RESTORE_PENDING_CLASS)
}

/**
 * True when the **host** sidebar marks targetTabId as active via
 * `tabBtnActive`. Does **not** consult Canvas mirror chrome — mirror
 * highlight is set synchronously in activateMainMirrorFromRestore and
 * would unsuppress before React commits panel children.
 *
 * Accepts data-tab-id equality, title match, or bare-id suffix match
 * (stored "spindle:…:tab:memory:1" vs host data-tab-id "memory").
 */
export function isHostPrimaryTabActive(targetTabId: string): boolean {
  const sidebar =
    _sidebar
    || (document.querySelector('[data-spindle-mount="sidebar"]') as HTMLElement | null)
  const active = sidebar?.querySelector(
    'button.tabBtnActive, button[class*="tabBtnActive"]',
  ) as HTMLElement | null
  if (!active) return false
  const id = active.getAttribute('data-tab-id') || ''
  const title = active.getAttribute('title') || ''
  if (id === targetTabId || title === targetTabId) return true
  if (id && (targetTabId.endsWith(`:${id}`) || targetTabId.includes(`:tab:${id}:`) || targetTabId.includes(`:tab:${id}`))) {
    return true
  }
  return false
}

/** Resolve the parked / live main panel body for content-settle watch. */
function resolveMainPanelBody(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const marked = document.querySelector(
    '[data-canvas-main-panel-content]',
  ) as HTMLElement | null
  if (marked) return marked
  const shellPanel = document.querySelector(
    '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content [class*="_panelContent_"],'
    + '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content > [data-canvas-main-panel-content],'
    + '.sidebar-ux-main-mirror-wrapper [class*="_panelContent_"]',
  ) as HTMLElement | null
  if (shellPanel) return shellPanel
  return document.querySelector('[class*="_panelContent_"]') as HTMLElement | null
}

function stopContentSettleWatch(): void {
  if (_contentSettleObserver) {
    _contentSettleObserver.disconnect()
    _contentSettleObserver = null
  }
  if (_contentQuietTimer != null) {
    clearTimeout(_contentQuietTimer)
    _contentQuietTimer = null
  }
  if (_contentFallbackTimer != null) {
    clearTimeout(_contentFallbackTimer)
    _contentFallbackTimer = null
  }
}

/**
 * Prefer a stable parent for content settle: React may remount
 * `_panelContent_` under the shell, so observing a detached old node
 * would never see the real swap.
 */
function resolveContentSettleRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const shellSlot = document.querySelector(
    '.sidebar-ux-main-mirror-wrapper .sidebar-ux-panel-content',
  ) as HTMLElement | null
  if (shellSlot) return shellSlot
  const panel = resolveMainPanelBody()
  if (panel?.parentElement instanceof HTMLElement) return panel.parentElement
  return panel
}

/**
 * Watch panel-body childList mutations after host tab is active.
 * Sets contentSettled via callbacks when mutations quiet or fallback
 * timeout fires (already-correct tab with no swap).
 */
function startContentSettleWatch(
  onSettled: (reason: 'mutation-quiet' | 'fallback') => void,
): void {
  stopContentSettleWatch()
  let settled = false
  const settle = (reason: 'mutation-quiet' | 'fallback') => {
    if (settled) return
    settled = true
    stopContentSettleWatch()
    onSettled(reason)
  }

  const root = resolveContentSettleRoot()
  if (!root) {
    // No panel node yet — fall back shortly; repark may create it.
    _contentFallbackTimer = setTimeout(() => settle('fallback'), RESTORE_CONTENT_FALLBACK_MS)
    return
  }

  let sawMutation = false
  _contentSettleObserver = new MutationObserver(() => {
    if (!document.documentElement.classList.contains(RESTORE_PENDING_CLASS)) return
    sawMutation = true
    if (_contentQuietTimer != null) clearTimeout(_contentQuietTimer)
    if (_contentFallbackTimer != null) {
      clearTimeout(_contentFallbackTimer)
      _contentFallbackTimer = null
    }
    _contentQuietTimer = setTimeout(() => settle('mutation-quiet'), RESTORE_CONTENT_QUIET_MS)
    // Re-stamp + repark if React remounts mid-switch
    stampPanelBodyHide()
    void import('./main-mirror-drawer').then((m) => {
      m.ensureHostContentParkedPublic()
    }).catch(() => { /* ignore */ })
  })
  _contentSettleObserver.observe(root, { childList: true, subtree: true })

  // Already-correct tab / no child swap: unsuppress after short settle.
  _contentFallbackTimer = setTimeout(() => {
    if (!sawMutation) settle('fallback')
  }, RESTORE_CONTENT_FALLBACK_MS)
}

/**
 * Find the host button for a persisted primary tabId and activate it.
 * Never dispatches through main-mirror onMirrorClick — that path
 * toggle-closes when the drawer is already open on the same tab.
 * When keep-tabs / canvas-main is active, also set the Canvas active
 * key + open via activateMainMirrorFromRestore.
 */
function clickRestoredPrimaryTab(targetTabId: string | null, preferMirror: boolean): boolean {
  if (!targetTabId) return false
  const sidebar =
    _sidebar
    || (document.querySelector('[data-spindle-mount="sidebar"]') as HTMLElement | null)
  let tabBtn =
    sidebar?.querySelector(
      `button[data-tab-id="${CSS.escape(targetTabId)}"]`,
    ) as HTMLButtonElement | null
  if (!tabBtn) {
    tabBtn = sidebar?.querySelector(
      `button[title="${CSS.escape(targetTabId)}"]`,
    ) as HTMLButtonElement | null
  }
  // Bare-id / suffix-drift: layout may store full spindle id while host
  // buttons use data-tab-id="profile" | "memory" etc.
  if (!tabBtn && targetTabId.includes(':')) {
    const bare = targetTabId.replace(/:\d+$/, '').split(':').pop()
    if (bare) {
      tabBtn = sidebar?.querySelector(
        `button[data-tab-id="${CSS.escape(bare)}"]`,
      ) as HTMLButtonElement | null
    }
  }

  // Canvas main-mirror mode: activate via host + open helper (no mirror.click).
  // preferMirror only means "we are in keep-tabs restore"; still use host for content.
  if (preferMirror || document.documentElement.classList.contains('sidebar-ux-canvas-main-active')) {
    void import('./main-tab-pin').then((m) => {
      const title =
        tabBtn?.getAttribute('title') ||
        tabBtn?.getAttribute('aria-label') ||
        targetTabId
      m.activateMainMirrorFromRestore(tabBtn, title)
    }).catch((err) => {
      dlog(`main-persist restore: activateMainMirrorFromRestore failed: ${err}`)
      // Fallback: host click only if available
      if (tabBtn) {
        try { tabBtn.click() } catch { /* ignore */ }
      }
    })
    // Host-only path if import path will run; if no host yet, try bare host later.
    if (tabBtn || document.querySelector('.sidebar-ux-main-tab-mirror-btn')) {
      return true
    }
  }

  if (!tabBtn) {
    dlog(`main-persist restore: no button for tabId="${targetTabId}"`)
    return false
  }
  try {
    tabBtn.click()
    return true
  } catch (err) {
    dlog(`main-persist restore: tab click threw: ${err}`)
    return false
  }
}

/** Max polls if the host is slow to honor the tab click (~1s). */
const RESTORE_TAB_POLL_MAX = 50
const RESTORE_TAB_POLL_MS = 16

/**
 * Activate the restored tab, keep stamping panel-body hide, reveal only
 * after **host** tabBtnActive matches and panel body has settled
 * (mutation quiet or short fallback). Mirror chrome alone must not
 * unsuppress — activateMainMirrorFromRestore paints highlight before
 * React commits children.
 */
function scheduleRestoreTabThenUnsuppress(
  targetTabId: string | null,
  preferMirror: boolean,
  fallbackClickFirstHostTab = false,
): void {
  const run = () => {
    if (_stopped) {
      unsuppressMainDrawer()
      return
    }
    stampPanelBodyHide()
    // Force repark while still hidden — tab click may recreate panelContent
    // under the host; repark watch is slower once restore-pending lifts.
    void import('./main-mirror-drawer').then((m) => {
      m.ensureHostContentParkedPublic()
    }).catch(() => { /* mirror not loaded */ })

    if (targetTabId) {
      // Always drive restore click when host is not on target. Mirror-only
      // "active" does not skip the click (host may still be Profile).
      if (!isHostPrimaryTabActive(targetTabId)) {
        clickRestoredPrimaryTab(targetTabId, preferMirror)
      }
    } else if (fallbackClickFirstHostTab) {
      const sidebar =
        _sidebar
        || (document.querySelector('[data-spindle-mount="sidebar"]') as HTMLElement | null)
      const first =
        sidebar?.querySelector('button[class*="tabBtn"]') as HTMLButtonElement | null
      if (first) {
        try { first.click() } catch (err) {
          dlog(`main-persist restore: first-tab click threw: ${err}`)
        }
      }
    }

    let polls = 0
    let stable = 0
    let contentSettled = false
    let watchingContent = false
    let finished = false
    const finish = (reason: string) => {
      if (finished) return
      finished = true
      stopContentSettleWatch()
      stampPanelBodyHide()
      dlog(`main-persist restore: unsuppress (${reason})`)
      // Two paints under the guard after content is ready.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          unsuppressMainDrawer()
        })
      })
    }
    const tryFinish = () => {
      if (finished) return
      if (!targetTabId) {
        finish('no-target-tab')
        return
      }
      if (stable >= RESTORE_HOST_STABLE_POLLS && contentSettled) {
        finish('host-active+content-settled')
      }
    }
    const beginContentWatch = () => {
      if (watchingContent || finished) return
      watchingContent = true
      void import('./main-mirror-drawer').then((m) => {
        m.ensureHostContentParkedPublic()
      }).catch(() => { /* ignore */ })
      stampPanelBodyHide()
      startContentSettleWatch((settleReason) => {
        contentSettled = true
        dlog(`main-persist restore: content settled (${settleReason})`)
        tryFinish()
      })
    }
    const poll = () => {
      if (_stopped) {
        unsuppressMainDrawer()
        return
      }
      if (finished) return
      stampPanelBodyHide()
      if (!targetTabId) {
        finish('no-target-tab')
        return
      }
      if (isHostPrimaryTabActive(targetTabId)) {
        stable++
        if (stable === 1) {
          beginContentWatch()
        }
        tryFinish()
        if (finished) return
      } else {
        stable = 0
        contentSettled = false
        watchingContent = false
        stopContentSettleWatch()
        // Re-click while wrong — host pendingActiveTabReset → profile.
        if (polls % 3 === 0) {
          clickRestoredPrimaryTab(targetTabId, preferMirror)
          void import('./main-mirror-drawer').then((m) => {
            m.ensureHostContentParkedPublic()
          }).catch(() => { /* ignore */ })
        }
      }
      polls++
      if (polls >= RESTORE_TAB_POLL_MAX) {
        clickRestoredPrimaryTab(targetTabId, preferMirror)
        finish(contentSettled ? 'poll-max-content-ok' : 'poll-max')
        return
      }
      setTimeout(poll, RESTORE_TAB_POLL_MS)
    }
    // One rAF so mirror buttons exist; no fixed 100ms blank.
    requestAnimationFrame(() => poll())
  }
  if (RESTORE_TAB_CLICK_MS > 0) {
    setTimeout(run, RESTORE_TAB_CLICK_MS)
  } else {
    run()
  }
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
  // Canvas main-mirror owns open/close; host wrapperOpen is headless and
  // must not clobber primary.open. Still track active tabId from host.
  const canvasMain = !!getSettings().keepTabListVisible
    && typeof window !== 'undefined'
    && window.innerWidth > 600
  const open = canvasMain
    ? document.documentElement.classList.contains('sidebar-ux-canvas-main-open')
    : readWrapperOpen(_wrapper)
  const tabId = _sidebar ? readActiveTabId(_sidebar) : null
  if (open === _lastSeenOpen && tabId === _lastSeenTabId) return
  _lastSeenOpen = open
  _lastSeenTabId = tabId
  setMainDrawerState(open, tabId)
  // Open transitions are persisted by open/closeCanvasMainDrawer in mirror
  // mode; host mode still needs the watcher write. Tab-only changes always
  // persist so primary.tabId stays fresh.
  if (!canvasMain || tabId !== null) {
    persistOpenState()
  }
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
  

  // Observe the wrapper's class attribute. Open/close transitions
  // toggle `wrapperOpen`; the MutationObserver fires once per
  // change, so we don't need any internal debounce here.
  _classObserver = new MutationObserver((mutations) => {
    if (_stopped) return
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
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
      
      persistLayout()
    }, RESIZE_DEBOUNCE_MS)
  })
  _resizeObserver.observe(wrapper)

  
}

export function startMainDrawerPersistence(): void {
  if (!_stopped) return
  _stopped = false

  const drawer = getMainDrawer()
  if (!drawer) {
    
    waitForDrawerDOM(
      { get value() { return _stopped } },
      _initObservers,
    )
    return
  }
  _initObservers(drawer)
}

/**
 * Re-click the persisted primary tab if the host is not already on it.
 * Used after secondary layout restore (assignToSecondary can shove the
 * host back to profile). Does not toggle the restore-pending guard.
 */
export function ensureRestoredPrimaryTab(targetTabId: string): void {
  if (!targetTabId || _stopped) return
  // Host-only: mirror chrome can claim active while host is still Profile
  // after secondary assign resets the host tab.
  if (isHostPrimaryTabActive(targetTabId)) return
  const keepVisible = !!getSettings().keepTabListVisible
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 600
  clickRestoredPrimaryTab(targetTabId, keepVisible && !isMobile)
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

  // Canvas main-mirror owns open/close + width when keepTabListVisible is on
  // (desktop). Host wrapperOpen / --drawer-panel-w are headless and must not
  // drive restore — apply MAIN_MIRROR_WIDTH_VAR and open/close the shell.
  //
  // Stay suppressed until after the restored tab is activated: the host
  // defaults to "profile", and opening the mirror early would flash that
  // panel for a frame (or ~100ms) before the deferred tab click.
  const keepVisible = !!getSettings().keepTabListVisible
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 600
  if (keepVisible && !isMobile) {
    void import('./main-mirror-drawer').then((m) => {
      if (_stopped) {
        unsuppressMainDrawer()
        return
      }
      if (clampedWidth !== null) {
        m.applyMainMirrorRestoredWidth(clampedWidth)
      }
      if (targetOpen) {
        m.openCanvasMainDrawer()
        // Prefer mirror button; always wait for tab click before showing.
        scheduleRestoreTabThenUnsuppress(targetTabId, true)
      } else {
        m.closeCanvasMainDrawer()
        unsuppressMainDrawer()
      }
    })
    return
  }

  const currentOpen = readWrapperOpen(wrapper)
  if (currentOpen === targetOpen) {
    // If the drawer is open, set the width so it's correct on this session.
    // If closed, leave --drawer-panel-w alone — the host's CSS uses it
    // for the close animation (translateX). Clearing it breaks the
    // animation on desktop.
    if (targetOpen && clampedWidth !== null && drawer) {
      if (!isPointerResizeActive()) {
        drawer.style.width = `${clampedWidth}px`
        wrapper.style.setProperty('--drawer-panel-w', `${clampedWidth}px`, 'important')
      }
    }
    // Drawer is already in the target state — still restore the active tab
    // before lifting the guard so profile does not paint first.
    if (targetOpen) {
      scheduleRestoreTabThenUnsuppress(targetTabId, false)
    } else {
      unsuppressMainDrawer()
    }
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
      }
    }
    // Open by clicking the restored tab (or first host tab). Stay
    // suppressed until after the click so the default profile panel
    // never paints.
    scheduleRestoreTabThenUnsuppress(targetTabId, false, true)
  } else {
    // Target state is "closed" but drawer is open. The host's
    // drawer-tab button (sibling of the drawer div inside the wrapper)
    // toggles open/close. Click it to close.
    const toggleBtn = findDrawerToggleButton(wrapper)
    if (toggleBtn) {
      try {
        toggleBtn.click()
      } catch (err) {
        dlog(`main-persist restore: toggleBtn.click() threw: ${err}`)
      }
    }
    unsuppressMainDrawer()
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
  // Lift any in-flight restore guard so teardown does not leave the
  // drawer permanently hidden.
  unsuppressMainDrawer()
  document.getElementById(RESTORE_GUARD_STYLE_ID)?.remove()
  _wrapper = null
  _sidebar = null
  _lastSeenOpen = null
  _lastSeenTabId = null
}