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
 * The X→close interception is a document-level capture listener (the
 * production-proven configure-intercept pattern): immune to host React
 * re-renders by construction, removed on teardown. The minimize button is
 * INJECTED into both headers — the main header is host React DOM
 * (`_panelHeader_`), the secondary header is Canvas-owned shell DOM —
 * with a MutationObserver re-ensuring presence (spike F5: injection
 * survives tab switches; the observer covers wholesale header rewrites).
 *
 * When the drawer has NO displayed window (active null), both header
 * buttons hide — there is nothing to minimize or close (D17).
 */

import { getMainPanelHeader } from '../dom/lumiverse'
import { getSecondaryWrapper } from '../sidebar/secondary'
import { getHostDrawerSettings } from '../dom/host-settings'
import { isOsModeEnabled } from '../settings/state'
import { closeWindowByLiveId, minimizeWindowByLiveId } from './actions'
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

let _active = false
let _clickHandler: ((e: MouseEvent) => void) | null = null
let _headerObserver: MutationObserver | null = null
let _ensureRaf = 0

/** Injected minimize-button markup — mirrors the shell's close button. */
function minimizeButtonHtml(): string {
  return `<button type="button" aria-label="Minimize" title="Minimize" ${MINIMIZE_ATTR}="1" style="width:32px;height:32px;flex-shrink:0;background:transparent;border:none;border-radius:8px;color:var(--lumiverse-text-muted);cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;transition:background 0.15s ease, color 0.15s ease;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>`
}

// ── Header resolution ────────────────────────────────────────────────────────

/**
 * Resolve a header element to its drawer side, or null when it is not an
 * OS-relevant header. The main header is the host React `_panelHeader_`;
 * the secondary header is the Canvas shell's `sidebar-ux-panel-header`.
 */
function resolveHeaderSide(header: HTMLElement | null): 'primary' | 'secondary' | null {
  const mainHeader = getMainPanelHeader()
  if (mainHeader && (header === mainHeader || mainHeader.contains(header))) return 'primary'
  const secondaryWrapper = getSecondaryWrapper()
  const secondaryHeader = secondaryWrapper?.querySelector('.sidebar-ux-panel-header') as HTMLElement | null
  if (secondaryHeader && (header === secondaryHeader || secondaryHeader.contains(header))) return 'secondary'
  return null
}

/**
 * Resolve the drawer-side's DISPLAYED window as a live id (null = none).
 * The model's active is TabKey-keyed; the host resolves to the live id.
 */
function resolveDisplayedLiveId(side: 'primary' | 'secondary'): string | null {
  const host = getHost()
  const model = getModel()
  const key = model?.active[side] ?? null
  if (!host || !key) return null
  return host.resolve(key)
}

/**
 * Resolve the close button inside a header. Order: aria-label/title/class
 * containing "close" (case-insensitive), then the LAST button (the X is
 * conventionally rightmost). DebugMode logs the pick (see the ensure pass)
 * so a wrong match surfaces in a bug report instead of misfiring silently.
 */
function findCloseButton(header: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(header.querySelectorAll('button')) as HTMLButtonElement[]
  const byLabel = buttons.find(b => /close/i.test(
    b.getAttribute('aria-label') || b.title || b.className || '',
  ))
  return byLabel ?? buttons[buttons.length - 1] ?? null
}

// ── Injection ────────────────────────────────────────────────────────────────

function resolveHeaderForSide(side: 'primary' | 'secondary'): HTMLElement | null {
  if (side === 'primary') return getMainPanelHeader()
  const wrapper = getSecondaryWrapper()
  return (wrapper?.querySelector('.sidebar-ux-panel-header') as HTMLElement | null) ?? null
}

/**
 * Ensure the minimize button exists in the side's header, sits left of the
 * close button, and is wired to the minimize action. Also toggles both
 * header buttons by displayed-window presence (D17: nothing to minimize
 * or close when nothing is displayed). Idempotent per side.
 */
function ensureChromeForSide(side: 'primary' | 'secondary'): void {
  const header = resolveHeaderForSide(side)
  if (!header || !header.isConnected) return

  const displayed = resolveDisplayedLiveId(side)
  const closeBtn = findCloseButton(header)
  if (!closeBtn) {
    dlog('[os] header chrome: no close button found', { side })
    return
  }

  // X hidden when nothing is displayed (D17); the capture interception
  // handles the repurpose, so no listener surgery on the host button.
  closeBtn.style.display = displayed ? '' : 'none'

  // Minimize button: ensure-inject before the close button.
  let minBtn = header.querySelector(`button[${MINIMIZE_ATTR}]`) as HTMLButtonElement | null
  if (displayed && !minBtn) {
    const template = document.createElement('template')
    template.innerHTML = minimizeButtonHtml().trim()
    minBtn = template.content.firstElementChild as HTMLButtonElement
    closeBtn.parentElement?.insertBefore(minBtn, closeBtn)
    minBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      const liveId = resolveDisplayedLiveId(side)
      if (!liveId) return
      void minimizeWindowByLiveId(liveId, side)
    })
    dlog('[os] header chrome: minimize button injected', { side })
  }
  if (minBtn) {
    // Existence parity with the close button (stale injections survive
    // header rewrites; hide keeps them invisible until the observer pass).
    minBtn.style.display = displayed ? 'flex' : 'none'
  }
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
 * One refresh pass for the model-driven OS chrome:
 *   1. Secondary strip: the model's closed set (resolved to live ids)
 *      MERGES into the effective hidden set — closed windows hide through
 *      the same applicator as Configure-hidden (D3), so a re-opened
 *      window un-hides through the same path (the show branch).
 *   2. Header chrome: minimize/X presence per displayed-window state (D17).
 *
 * Runs on every model commit while OS mode is on. In non-OS mode the
 * closed set is empty by invariant, so the merge is a no-op and the call
 * degrades to the plain hidden applicator (harmless).
 */
function refreshOsVisibility(): void {
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
    dwarn('[os] refresh visibility failed:', err instanceof Error ? err.message : err)
  }
  ensureChromeBoth()
}

// ── X interception (capture) ─────────────────────────────────────────────────

function onCaptureClick(ev: MouseEvent): void {
  if (!isOsModeEnabled()) return
  const target = ev.target
  if (!(target instanceof Element)) return
  const side = resolveHeaderSide(target.closest('.sidebar-ux-panel-header, [class*="_panelHeader_"]') as HTMLElement | null)
  if (!side) return
  const header = resolveHeaderForSide(side)
  if (!header) return
  const btn = target.closest('button') as HTMLButtonElement | null
  if (!btn || !header.contains(btn)) return
  if (btn.hasAttribute(MINIMIZE_ATTR)) return // minimize button handles itself
  const closeBtn = findCloseButton(header)
  if (!closeBtn || btn !== closeBtn) return
  // D2/D9: X = close the DISPLAYED window (the action collapses the drawer
  // when the displayed window closes).
  const liveId = resolveDisplayedLiveId(side)
  if (!liveId) return
  ev.preventDefault()
  ev.stopPropagation()
  ev.stopImmediatePropagation()
  dlog('[os] header X intercepted → close window', { side, liveId })
  void closeWindowByLiveId(liveId)
}

// ── Observer (header rewrites re-ensure injection) ──────────────────────────

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

function ensureObservers(): void {
  if (_headerObserver || typeof MutationObserver === 'undefined') return
  _headerObserver = new MutationObserver(scheduleEnsure)
  for (const side of ['primary', 'secondary'] as const) {
    const header = resolveHeaderForSide(side)
    if (header?.isConnected) {
      _headerObserver.observe(header, { childList: true })
    }
  }
  // The secondary header mounts late (drawer enable / side flips) — the
  // observe set above covers the headers present at mount; the feature's
  // apply() path and the capture-click path re-ensure the rest, and the
  // next mountPanelChrome() call re-arms the observer for new headers.
}

// ── Feature hooks ────────────────────────────────────────────────────────────

/** Model-change subscription (refresh pass id; detached on teardown). */
let _unsubModelChanged: (() => void) | null = null

/** Mount OS-mode header chrome (feature mount / runtime enable). */
export function mountPanelChrome(): void {
  if (_active) return
  _active = true
  _clickHandler = onCaptureClick
  document.addEventListener('click', _clickHandler, true)
  // Model-driven refresh: every commit re-applies closed-set hiding (the
  // secondary applicator takes the merged set) + header chrome presence.
  if (!_unsubModelChanged) {
    _unsubModelChanged = onModelChanged(refreshOsVisibility)
  }
  ensureObservers()
  ensureChromeBoth()
  refreshOsVisibility()
  dlog('[os] panel chrome mounted')
}

/** Teardown: remove injections + listeners (feature unmount / disable). */
export function teardownPanelChrome(): void {
  if (!_active) return
  _active = false
  if (_clickHandler) {
    document.removeEventListener('click', _clickHandler, true)
    _clickHandler = null
  }
  _headerObserver?.disconnect()
  _headerObserver = null
  if (_ensureRaf) {
    cancelAnimationFrame(_ensureRaf)
    _ensureRaf = 0
  }
  _unsubModelChanged?.()
  _unsubModelChanged = null
  closedLiveIdsCache = new Set()
  for (const side of ['primary', 'secondary'] as const) {
    const header = resolveHeaderForSide(side)
    if (!header) continue
    header.querySelector(`button[${MINIMIZE_ATTR}]`)?.remove()
    const closeBtn = findCloseButton(header)
    if (closeBtn) closeBtn.style.display = ''
  }
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
