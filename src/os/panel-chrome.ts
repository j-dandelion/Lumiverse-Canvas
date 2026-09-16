/**
 * OS-mode panel-header chrome (spec §4.4.1, D2/D9/D17).
 *
 * Both drawers' panel headers gain OS chrome while OS mode is on:
 *   - a **minimize button** left of the X (same visual class as the
 *     existing close button — "borrow existing chrome tokens, never
 *     invent"),
 *   - the **X repurposed to close the window** (D2/D9) instead of the
 *     drawer; closing the displayed window leaves nothing displayed, so
 *     the action itself collapses the drawer body (D7 — the action's
 *     setDrawer close provides animation + persist + reflow).
 *
 * SURFACE OWNERSHIP. Both visible headers are Canvas-owned: the main
 * drawer is the `sidebar-ux-main-mirror-wrapper` shell (the host main
 * drawer is force-hidden while Canvas owns the surface —
 * main-mirror-drawer.ts `injectHostHideStyles`), and the secondary is the
 * secondary shell. Resolve headers through those shells only; host
 * `_panelHeader_` DOM is invisible and must never receive chrome. The
 * minimize button is INJECTED into the shell's header actions cluster; the
 * X is a shell-owned listener routed through `os/header-close.ts` (a
 * document-capture override cannot preempt a target-phase listener that was
 * registered first).
 *
 * Lifecycle. `ensureChromeForSide` is idempotent and re-runs on every model
 * commit, on mutations of each resolved header (base-subtree rewrites), and
 * on `canvas:drawer-shell-created` (shell remounts replace the header with
 * no model change to piggyback on).
 *
 * When the drawer has NO displayed window (active null), both header
 * buttons hide — there is nothing to minimize or close (D17). Hiding uses
 * the `data-canvas-os-hidden` attribute (a sheet rule), never inline
 * `display`, so the shell buttons' own chrome survives teardown.
 */

import { HEADER_ACTIONS_CLASS, DRAWER_SHELL_CREATED_EVENT } from '../sidebar/drawer-shell'
import {
  getMainMirrorWrapper,
  setCanvasMainNoActive,
} from '../sidebar/main-mirror-drawer'
import { getSecondaryWrapper } from '../sidebar/secondary'
import { isPanelAnimating, whenPanelMotionSettles } from '../sidebar/animation'
import { getHostDrawerSettings } from '../dom/host-settings'
import { getSettings, isOsModeEnabled } from '../settings/state'
import { closeWindowByLiveId, getDisplayedLiveId, minimizeWindowByLiveId } from './actions'
import { setPanelHeaderCloseHandler } from './header-close'
import { getHost, getModel, onModelChanged } from '../recon/dispatch'
import {
  applyHiddenTabIdsToSecondary,
} from '../tabs/buttons'
import {
  getCanvasHiddenTabIds,
  mergeHiddenTabIdLists,
} from '../tabs/canvas-hidden'
import { dlog, dwarn } from '../debug/log'

const MINIMIZE_ATTR = 'data-canvas-os-minimize'
const HIDDEN_ATTR = 'data-canvas-os-hidden'

let _active = false
let _headerObserver: MutationObserver | null = null
let _observedHeaders = new WeakSet<HTMLElement>()
let _ensureRaf = 0

/** Injected minimize-button markup — mirrors the shell's close button. */
function minimizeButtonHtml(): string {
  return `<button type="button" aria-label="Minimize" title="Minimize" ${MINIMIZE_ATTR}="1" style="width:32px;height:32px;flex-shrink:0;background:transparent;border:none;border-radius:8px;color:var(--lumiverse-text-muted);cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;transition:background 0.15s ease, color 0.15s ease;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>`
}

// ── Header surface resolution (Canvas shells only) ───────────────────────────

interface HeaderSurface {
  header: HTMLElement
  closeBtn: HTMLButtonElement
  actions: HTMLElement
}

/**
 * Resolve the side's VISIBLE header surface:
 *   - primary   → the Canvas main mirror shell's header,
 *   - secondary → the Canvas secondary shell's header.
 * Canvas-owned class selectors (stable hooks), never host CSS-module
 * hashes. Returns null while a shell is unmounted (teardown / boot race).
 */
function resolveHeaderSurface(
  side: 'primary' | 'secondary',
): HeaderSurface | null {
  const wrapper =
    side === 'primary' ? getMainMirrorWrapper() : getSecondaryWrapper()
  const header = wrapper?.querySelector('.sidebar-ux-panel-header') as HTMLElement | null
  if (!header || !header.isConnected) return null
  const closeBtn = header.querySelector('.sidebar-ux-close-btn') as HTMLButtonElement | null
  const actions = header.querySelector(`.${HEADER_ACTIONS_CLASS}`) as HTMLElement | null
  if (!closeBtn || !actions) return null
  return { header, closeBtn, actions }
}

function setHeaderHidden(el: HTMLElement, hidden: boolean): void {
  if (hidden) el.setAttribute(HIDDEN_ATTR, '1')
  else el.removeAttribute(HIDDEN_ATTR)
}

/** D17: clear the stale header title when nothing is displayed. */
function clearTitle(header: HTMLElement): void {
  const title = header.querySelector('.sidebar-ux-panel-title') as HTMLElement | null
  if (title) title.textContent = ''
}

/**
 * Run the D17 parking (`apply`) once the side's close motion has settled.
 * The chrome pass can run BEFORE the close command starts the animation
 * (model commit → host setDrawer ordering), so a direct `isPanelAnimating`
 * check is not enough: re-check on the next frame and otherwise register for
 * the settle. Callbacks re-check the live state — a reopen may win the race.
 * (User feedback 2026-09-15: parking mid-fade made the panel content/title
 * vanish instantly.)
 */
function whenPanelParkingReady(side: 'primary' | 'secondary', apply: () => void): void {
  const wrapper = side === 'primary' ? getMainMirrorWrapper() : getSecondaryWrapper()
  if (!wrapper) {
    apply()
    return
  }
  const check = (): void => {
    if (isPanelAnimating(wrapper)) whenPanelMotionSettles(wrapper, apply)
    else apply()
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(check)
  else check()
}

// ── Injection + presence (D17) ────────────────────────────────────────────────

/**
 * Ensure the minimize button exists in the side's actions cluster, sits
 * left of the close button, and is wired to the minimize action. Also
 * toggles both header buttons by displayed-window presence (D17: nothing
 * to minimize or close when nothing is displayed). Idempotent per side.
 */
function ensureChromeForSide(side: 'primary' | 'secondary'): void {
  const surface = resolveHeaderSurface(side)
  if (!surface) return
  ensureHeaderObserved(surface.header)

  const displayed = getDisplayedLiveId(side)
  // D17 parking: no displayed window → no header title and no stale parked
  // content (the drawer can still be manually reopened via the edge toggle,
  // D16). Primary hides its content slot through the shell attribute; both
  // sides clear the stale title (the next activation restores it).
  if (side === 'primary') {
    if (displayed) {
      setCanvasMainNoActive(false)
    } else {
      whenPanelParkingReady('primary', () => {
        if (!getDisplayedLiveId('primary')) setCanvasMainNoActive(true)
      })
    }
  } else if (!displayed) {
    whenPanelParkingReady('secondary', () => {
      if (!getDisplayedLiveId('secondary')) clearTitle(surface.header)
    })
  }
  // Existence parity with the close button: stale injections survive
  // rewrites; hide keeps them invisible until the next ensure pass.
  setHeaderHidden(surface.closeBtn, !displayed)

  // The minimize control is opt-out (`osWindowControls`): when off, only the
  // X shows and the X minimizes (vanilla behavior — see mountPanelChrome's
  // close-policy branch). Drop a stale injection on toggle-off; never touch
  // the shell-owned X.
  const showMinimize = displayed && !!getSettings().osWindowControls
  let minBtn = surface.actions.querySelector(
    `button[${MINIMIZE_ATTR}]`,
  ) as HTMLButtonElement | null
  if (showMinimize && !minBtn) {
    const template = document.createElement('template')
    template.innerHTML = minimizeButtonHtml().trim()
    minBtn = template.content.firstElementChild as HTMLButtonElement
    surface.actions.insertBefore(minBtn, surface.closeBtn)
    minBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      const liveId = getDisplayedLiveId(side)
      if (!liveId) return
      void minimizeWindowByLiveId(liveId, side)
    })
    dlog('[os] header chrome: minimize button injected', { side })
  }
  if (!getSettings().osWindowControls && minBtn) {
    minBtn.remove()
    minBtn = null
  }
  if (minBtn) setHeaderHidden(minBtn, !displayed)
}

/** Resolved closed-set live ids (refreshed on every model change). */
let closedLiveIdsCache: Set<string> = new Set()

function resolveClosedLiveIds(): Set<string> {
  const host = getHost()
  const model = getModel()
  if (!host || !model) return new Set()
  const out = new Set<string>()
  for (const key of model.closed) {
    const liveId = host.resolve(key)
    if (liveId) out.add(liveId)
  }
  return out
}

// ── Visibility refresh (model-driven) ────────────────────────────────────────

/**
 * Re-apply the secondary strip's effective hidden set (eye-hidden + the OS
 * closed set) WITHOUT touching header chrome. No-op when OS mode is off (the
 * closed set is empty by invariant, and the plain applicator stays
 * refreshOsVisibility's job).
 *
 * Exported for the placement-drain tail (`reassignSecondaryTabsFromModel`):
 * buttons created after the last model commit would otherwise keep a closed
 * window's strip button visible until the next commit (live report
 * 2026-09-15: `presets` showed after enabling the second drawer although it
 * was in the entering slot's closed set).
 */
export function reapplyOsClosedVisibility(): void {
  if (!isOsModeEnabled()) return
  try {
    closedLiveIdsCache = resolveClosedLiveIds()
    applyHiddenTabIdsToSecondary(
      new Set(
        mergeHiddenTabIdLists(
          getHostDrawerSettings()?.hiddenTabIds,
          [...getCanvasHiddenTabIds(), ...closedLiveIdsCache],
        ),
      ),
    )
  } catch (err) {
    dwarn('[os] reapply closed visibility failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * One refresh pass for the model-driven OS chrome:
 *   1. Secondary strip: the model's closed set (resolved to live ids)
 *      MERGES into the effective hidden set — closed windows hide through
 *      the same applicator as Configure-hidden (D3), so a re-opened
 *      window un-hides through the same path (the show branch). The main
 *      strip handles `model.closed` in the renderer.
 *   2. Header chrome: minimize/X presence per displayed-window state (D17).
 *
 * Runs on every model commit while OS mode is on.
 */
function refreshOsVisibility(): void {
  reapplyOsClosedVisibility()
  ensureChromeBoth()
}

// ── Observer + lifecycle ─────────────────────────────────────────────────────

/**
 * Observe a resolved header (base childList) so a header rewrite re-ensures
 * injection. WeakSet-guarded: a remounted header is observed on the next
 * pass, and the old node is garbage without bookkeeping.
 */
function ensureHeaderObserved(header: HTMLElement): void {
  if (!_headerObserver || _observedHeaders.has(header)) return
  _headerObserver.observe(header, { childList: true })
  _observedHeaders.add(header)
}

function scheduleEnsure(): void {
  if (_ensureRaf) return
  _ensureRaf = requestAnimationFrame(() => {
    _ensureRaf = 0
    ensureChromeBoth()
  })
}

function ensureChromeBoth(): void {
  ensureChromeForSide('primary')
  if (isOsModeEnabled()) ensureChromeForSide('secondary')
}

/**
 * Live-apply the `osWindowControls` toggle: re-run the chrome pass so the
 * minimize control appears/disappears without a remount. The X handler reads
 * the setting per click, so no listener rewire is needed.
 */
export function applyOsWindowControlsChange(): void {
  if (!isOsModeEnabled() || !_active) return
  ensureChromeBoth()
}

// ── Feature hooks ────────────────────────────────────────────────────────────

/** Model-change subscription (refresh pass id; detached on teardown). */
let _unsubModelChanged: (() => void) | null = null

/** Mount OS-mode header chrome (feature mount / runtime enable). */
export function mountPanelChrome(): void {
  if (_active) return
  _active = true
  // X policy (D2/D9, osWindowControls): the Canvas shells own their header
  // buttons and call back through the header-close seam (no document
  // interception). With osWindowControls ON the X closes the window; OFF it
  // MINIMIZES (vanilla drawer behavior — the strip button stays), and the
  // window can still be closed from the tab button's context menu.
  setPanelHeaderCloseHandler((side) => {
    if (!isOsModeEnabled()) return false
    const liveId = getDisplayedLiveId(side)
    if (!liveId) return false
    if (getSettings().osWindowControls) {
      dlog('[os] header X intercepted → close window', { side, liveId })
      void closeWindowByLiveId(liveId)
    } else {
      dlog('[os] header X intercepted → minimize window (osWindowControls off)', { side, liveId })
      void minimizeWindowByLiveId(liveId, side)
    }
    return true
  })
  if (typeof MutationObserver !== 'undefined') {
    _headerObserver = new MutationObserver(scheduleEnsure)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener(DRAWER_SHELL_CREATED_EVENT, scheduleEnsure)
  }
  // Model-driven refresh: every commit re-applies closed-set hiding (the
  // secondary applicator takes the merged set) + header chrome presence.
  if (!_unsubModelChanged) {
    _unsubModelChanged = onModelChanged(refreshOsVisibility)
  }
  ensureChromeBoth()
  refreshOsVisibility()
  dlog('[os] panel chrome mounted')
}

/** Teardown: remove injections + listeners (feature unmount / disable). */
export function teardownPanelChrome(): void {
  if (!_active) return
  _active = false
  setPanelHeaderCloseHandler(null)
  if (typeof window !== 'undefined') {
    window.removeEventListener(DRAWER_SHELL_CREATED_EVENT, scheduleEnsure)
  }
  _headerObserver?.disconnect()
  _headerObserver = null
  _observedHeaders = new WeakSet()
  if (_ensureRaf) {
    cancelAnimationFrame(_ensureRaf)
    _ensureRaf = 0
  }
  _unsubModelChanged?.()
  _unsubModelChanged = null
  closedLiveIdsCache = new Set()
  for (const side of ['primary', 'secondary'] as const) {
    const surface = resolveHeaderSurface(side)
    if (!surface) continue
    surface.actions.querySelector(`button[${MINIMIZE_ATTR}]`)?.remove()
    surface.closeBtn.removeAttribute(HIDDEN_ATTR)
  }
  // Un-hide the primary content slot (the drawer may be open with a window
  // displayed in non-OS mode; the attribute must not survive the teardown).
  setCanvasMainNoActive(false)
  // Restore the secondary strip: re-run the plain hidden applicator so
  // closed-hidden buttons reappear in non-OS mode (the closed set is gone).
  void applyHiddenTabIdsToSecondary(
    new Set(
      mergeHiddenTabIdLists(
        getHostDrawerSettings()?.hiddenTabIds,
        [...getCanvasHiddenTabIds()],
      ),
    ),
  )
  dlog('[os] panel chrome unmounted')
}

// Self-cleanup registration (extension disable regardless of toggle).
// LAZY import: panel-chrome sits inside a load cycle (registry → panel-chrome
// → dispatch → settings/state → panel → registry), so a top-level
// registerCleanup call can run while cleanup.ts is still initializing (TDZ,
// caught by second-drawer-mode.test). The microtask defers past init.
void import('../sidebar/cleanup').then((m) => m.registerCleanup(teardownPanelChrome))
