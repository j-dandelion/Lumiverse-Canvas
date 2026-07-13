// Weaver Studio strip-lane containment (keep-tabs only).
//
// When Weaver Studio is open under keepTabListVisible, inset its dialog by the
// permanent pin-strip widths only — NOT by open drawer widths. Open drawers
// may overlay the studio; the static tab lists stay clear of the shell.
//
// When keep-tabs is off, no inset (host full-viewport modal).
//
// Why geometry (not z-index) matters: pin hosts are `body > *` siblings of
// `#root` with z-index 10000. Weaver lives inside `#root`, so strips always
// paint above the modal. Without left/right inset the shell still sits under
// the strips and looks full-bleed.
//
// Detection (either is enough):
//   1. getActiveModal(true) === 'weaver'  (force-bust fiber TTL)
//   2. [role=dialog][aria-modal=true] with aria-label matching /weaver/i
//
// Geometry: computeStripGutters() + live pin-host widths (capped / maxed).
// Does not call computeContentLaneInsets (that includes open drawers for chat).
//
// On Weaver open (rising edge only): close main + secondary drawers so the
// studio is not covered by open panels. Keep-tabs pin strips stay visible.

import { getActiveModal } from '../store'
import { publishContentLaneInsets } from '../chat/reflow'
import { injectStyles } from '../debug/styles'
import { dwarn } from '../debug/log'
import { TAB_LIST_WIDTH_PX } from '../sidebar/styles'
import { isKeepTabListVisibleEnabled } from '../settings/state'
import { computeStripGutters } from '../sidebar/strip-gutter'
import { isMobileViewport } from '../sidebar/mobile-exclusion'

const WEAVER_LANE_STYLE_ID = 'canvas-weaver-lane-styles'
const WEAVER_LANE_ATTR = 'data-canvas-weaver-lane'
/** Weaver-only inset vars — never overwrite chat content-lane insets. */
const WEAVER_INSET_L_VAR = '--sidebar-ux-weaver-inset-l'
const WEAVER_INSET_R_VAR = '--sidebar-ux-weaver-inset-r'
const PIN_HOST_SEL = '.sidebar-ux-tab-list-pin-host'

let _observer: MutationObserver | null = null
let _rafId: number | null = null
let _active = false
let _resizeListening = false
let _pollTimer: ReturnType<typeof setInterval> | null = null
let _taggedDialog: HTMLElement | null = null
/** True after we collapsed drawers for the current Weaver open session. */
let _drawersClosedForWeaver = false
const POLL_MS = 250

/**
 * Close main + secondary drawers once when Weaver opens.
 * Secondary may be off/unmounted — main still closes (host or Canvas mirror).
 * Lazy imports avoid circular load with secondary / main-mirror modules.
 */
function closeBothDrawersForWeaver(): void {
  // Secondary (Canvas-owned). No-op when second drawer is off / closed.
  void import('../sidebar/secondary')
    .then((m) => {
      try {
        if (m.isSecondarySidebarOpen()) m.closeSecondarySidebar()
      } catch (err) {
        dwarn('[weaver-lane] closeSecondarySidebar failed:', err)
      }
    })
    .catch((err) => dwarn('[weaver-lane] secondary import failed:', err))

  // Main always attempted — independent of second-drawer mode.
  // keep-tabs: Canvas mirror owns open/close; host wrapper is headless.
  // keep-tabs off (vanilla / second-off): host store closeDrawer + toggle.
  void import('../sidebar/main-mirror-drawer')
    .then((m) => {
      try {
        if (m.isMainMirrorActive()) {
          if (m.isCanvasMainOpen()) m.closeCanvasMainDrawer()
          return
        }
      } catch (err) {
        dwarn('[weaver-lane] closeCanvasMainDrawer failed:', err)
      }
      closeHostMainDrawer()
    })
    .catch((err) => {
      dwarn('[weaver-lane] main-mirror import failed:', err)
      closeHostMainDrawer()
    })
}

/**
 * Host-owned main drawer close (second drawer off, keep-tabs off).
 * Prefer Zustand closeDrawer (idempotent); fall back to edge-toggle click
 * (same path as mobile exclusion) when the fiber action is unavailable.
 */
function closeHostMainDrawer(): void {
  void Promise.all([
    import('../store'),
    import('../dom/lumiverse'),
    import('../sidebar/main-persist'),
  ])
    .then(([storeMod, dom, persist]) => {
      // 1) Prefer host store action — works even if toggle DOM is hard to find.
      try {
        storeMod.findStoreData(true)
        const snap = storeMod.getStoreSnapshot() as {
          closeDrawer?: () => void
          drawerOpen?: boolean
        } | null
        if (snap && typeof snap.closeDrawer === 'function') {
          // closeDrawer is idempotent (sets drawerOpen: false). Always call
          // when present so a stale drawerOpen:false cache cannot skip a
          // drawer that is still open in React / DOM.
          snap.closeDrawer()
          return
        }
      } catch (err) {
        dwarn('[weaver-lane] store closeDrawer failed:', err)
      }

      // 2) DOM toggle click fallback (mobile-exclusion parity).
      try {
        const wrapper = dom.getMainWrapper()
        if (!wrapper) return
        const cls = wrapper.classList?.toString?.() ?? String(wrapper.className || '')
        if (!cls.includes('wrapperOpen')) return
        const btn = persist.findDrawerToggleButton(wrapper)
        if (btn) {
          try {
            btn.click()
          } catch {
            /* swallow */
          }
        }
      } catch (err) {
        dwarn('[weaver-lane] closeHostMainDrawer failed:', err)
      }
    })
    .catch((err) => dwarn('[weaver-lane] host main close import failed:', err))
}

function injectWeaverLaneStyles(): void {
  injectStyles(WEAVER_LANE_STYLE_ID, `
    [${WEAVER_LANE_ATTR}="1"] {
      position: fixed !important;
      inset: unset !important;
      top: 0 !important;
      bottom: 0 !important;
      left: var(${WEAVER_INSET_L_VAR}, 0px) !important;
      right: var(${WEAVER_INSET_R_VAR}, 0px) !important;
      /* Beat host --app-scaled-viewport-width which ignores strip insets. */
      width: auto !important;
      height: auto !important;
      max-width: none !important;
      max-height: none !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    /* Host .shell uses 95vw of the full viewport — size to the strip lane. */
    [${WEAVER_LANE_ATTR}="1"] > * {
      width: min(100%, 1180px) !important;
      max-width: 100% !important;
      height: min(100%, 880px) !important;
      max-height: 100% !important;
      box-sizing: border-box !important;
      flex: 0 1 auto !important;
    }
  `)
}

function setImportant(el: HTMLElement, prop: string, value: string): void {
  el.style.setProperty(prop, value, 'important')
}

function clearLaneInlineStyles(el: HTMLElement): void {
  for (const prop of [
    'position',
    'inset',
    'top',
    'bottom',
    'left',
    'right',
    'width',
    'height',
    'max-width',
    'max-height',
    'box-sizing',
    'overflow',
    'display',
    'align-items',
    'justify-content',
  ]) {
    el.style.removeProperty(prop)
  }
}

function clearShellInlineStyles(dialog: HTMLElement): void {
  const shell = dialog.firstElementChild as HTMLElement | null
  if (!shell) return
  for (const prop of ['width', 'max-width', 'height', 'max-height', 'box-sizing', 'flex']) {
    shell.style.removeProperty(prop)
  }
}

function clearWeaverInsetVars(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.removeProperty(WEAVER_INSET_L_VAR)
  root.style.removeProperty(WEAVER_INSET_R_VAR)
}

/**
 * Live pin-host widths only (static keep-tabs strips). Ignores open drawers.
 * Cap each side at a reasonable strip width so a mis-measured host cannot
 * collapse the studio.
 */
function measurePinStripInsets(): { left: number; right: number } {
  let left = 0
  let right = 0
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { left, right }
  }

  const vw = document.documentElement.clientWidth || window.innerWidth || 0
  // Strips are TAB_LIST_WIDTH_PX; allow a little slack for borders/padding.
  const cap = TAB_LIST_WIDTH_PX + 8

  for (const el of document.querySelectorAll<HTMLElement>(PIN_HOST_SEL)) {
    const style = window.getComputedStyle?.(el)
    if (style && (style.display === 'none' || style.visibility === 'hidden')) continue
    const w = el.offsetWidth
    if (w < 8) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    const mid = rect.left + rect.width / 2
    const strip = Math.min(w, cap)
    if (mid < vw / 2) left = Math.max(left, strip)
    else right = Math.max(right, strip)
  }

  return { left, right }
}

/**
 * Strip-only insets for Weaver. Open-drawer widths are intentionally excluded.
 * keep-tabs off or mobile → {0,0}.
 */
export function computeWeaverStripInsets(): { left: number; right: number } {
  if (typeof document === 'undefined') return { left: 0, right: 0 }
  if (isMobileViewport()) return { left: 0, right: 0 }
  if (!isKeepTabListVisibleEnabled()) return { left: 0, right: 0 }

  let gutters = { left: 0, right: 0 }
  try {
    gutters = computeStripGutters()
  } catch (err) {
    dwarn('[weaver-lane] computeStripGutters failed:', err)
  }
  const live = measurePinStripInsets()
  return {
    left: Math.max(gutters.left, live.left),
    right: Math.max(gutters.right, live.right),
  }
}

function applyLaneGeometry(dialog: HTMLElement): void {
  const insets = computeWeaverStripInsets()
  try {
    const root = document.documentElement
    root.style.setProperty(WEAVER_INSET_L_VAR, `${insets.left}px`)
    root.style.setProperty(WEAVER_INSET_R_VAR, `${insets.right}px`)
  } catch (err) {
    dwarn('[weaver-lane] publish weaver inset vars failed:', err)
  }

  setImportant(dialog, 'position', 'fixed')
  setImportant(dialog, 'inset', 'unset')
  setImportant(dialog, 'top', '0px')
  setImportant(dialog, 'bottom', '0px')
  setImportant(dialog, 'left', `${insets.left}px`)
  setImportant(dialog, 'right', `${insets.right}px`)
  setImportant(dialog, 'width', 'auto')
  setImportant(dialog, 'height', 'auto')
  setImportant(dialog, 'max-width', 'none')
  setImportant(dialog, 'max-height', 'none')
  setImportant(dialog, 'box-sizing', 'border-box')
  setImportant(dialog, 'overflow', 'hidden')
  setImportant(dialog, 'display', 'flex')
  setImportant(dialog, 'align-items', 'center')
  setImportant(dialog, 'justify-content', 'center')

  const shell = dialog.firstElementChild as HTMLElement | null
  if (shell) {
    setImportant(shell, 'width', 'min(100%, 1180px)')
    setImportant(shell, 'max-width', '100%')
    setImportant(shell, 'height', 'min(100%, 880px)')
    setImportant(shell, 'max-height', '100%')
    setImportant(shell, 'box-sizing', 'border-box')
    setImportant(shell, 'flex', '0 1 auto')
  }
}

function findWeaverDialog(): HTMLElement | null {
  if (typeof document === 'undefined') return null

  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
  for (const d of dialogs) {
    const label = (d.getAttribute('aria-label') || '').toLowerCase()
    if (label.includes('weaver')) return d
    if (d.getAttribute(WEAVER_LANE_ATTR) === '1') return d
  }

  let modal: string | null = null
  try {
    modal = getActiveModal(true)
  } catch (err) {
    dwarn('[weaver-lane] getActiveModal failed:', err)
  }
  if (modal === 'weaver') {
    return document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
  }
  return null
}

function clearTaggedDialog(): void {
  if (_taggedDialog) {
    clearShellInlineStyles(_taggedDialog)
    clearLaneInlineStyles(_taggedDialog)
    _taggedDialog.removeAttribute(WEAVER_LANE_ATTR)
    _taggedDialog = null
  } else if (typeof document !== 'undefined') {
    const tagged = document.querySelector<HTMLElement>(`[${WEAVER_LANE_ATTR}="1"]`)
    if (tagged) {
      clearShellInlineStyles(tagged)
      clearLaneInlineStyles(tagged)
      tagged.removeAttribute(WEAVER_LANE_ATTR)
    }
  }
  clearWeaverInsetVars()
  setResizeListening(false)
  setPoll(false)
  // Restore chat content-lane vars (may have been stale only if something
  // else depended on them while weaver was open — reflow owns those).
  try {
    publishContentLaneInsets()
  } catch {
    /* ignore */
  }
}

function setResizeListening(on: boolean): void {
  if (typeof window === 'undefined') return
  if (on && !_resizeListening) {
    window.addEventListener('resize', scheduleApply)
    _resizeListening = true
  } else if (!on && _resizeListening) {
    window.removeEventListener('resize', scheduleApply)
    _resizeListening = false
  }
}

function setPoll(on: boolean): void {
  if (on && _pollTimer === null) {
    _pollTimer = setInterval(() => {
      if (!_active) {
        setPoll(false)
        return
      }
      scheduleApply()
    }, POLL_MS)
  } else if (!on && _pollTimer !== null) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

function applyWeaverLane(): void {
  if (!_active) return

  const dialog = findWeaverDialog()
  if (dialog) {
    if (_taggedDialog && _taggedDialog !== dialog) {
      clearShellInlineStyles(_taggedDialog)
      clearLaneInlineStyles(_taggedDialog)
      _taggedDialog.removeAttribute(WEAVER_LANE_ATTR)
    }
    dialog.setAttribute(WEAVER_LANE_ATTR, '1')
    _taggedDialog = dialog
    applyLaneGeometry(dialog)
    setResizeListening(true)
    setPoll(true)
    // Rising edge: shut both drawers once per Weaver open session.
    if (!_drawersClosedForWeaver) {
      _drawersClosedForWeaver = true
      closeBothDrawersForWeaver()
    }
    return
  }

  if (_taggedDialog || (typeof document !== 'undefined' && document.querySelector(`[${WEAVER_LANE_ATTR}="1"]`))) {
    clearTaggedDialog()
  }
  // Weaver closed — allow drawer collapse again on next open.
  _drawersClosedForWeaver = false
}

function scheduleApply(): void {
  if (_rafId !== null) return
  _rafId = requestAnimationFrame(() => {
    _rafId = null
    applyWeaverLane()
  })
}

/**
 * Start the weaver-lane containment module.
 * Returns a teardown function.
 */
export function startWeaverLane(): () => void {
  if (_observer) {
    return () => { /* no-op — already running */ }
  }

  injectWeaverLaneStyles()
  _active = true
  scheduleApply()

  _observer = new MutationObserver(() => {
    if (!_active) return
    scheduleApply()
  })
  _observer.observe(document.body, { childList: true, subtree: true })

  return () => {
    _active = false
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId)
      _rafId = null
    }
    if (_observer) {
      _observer.disconnect()
      _observer = null
    }
    setPoll(false)
    clearTaggedDialog()
    _drawersClosedForWeaver = false
  }
}
