// Presentation-only guard for a live chrome-mode switch. Settings acquire it
// BEFORE feature.apply changes shells; the OS drain registers its real promise.
// Keep this module free of synchronous shell imports (state -> panel -> OS is
// cyclic). Restore/geometry modules are loaded only by the settling tail.
import type { CanvasSettings } from '../types'
import { injectStyles } from '../debug/styles'
import { dwarn } from '../debug/log'
import { isInstanceActive } from '../lifecycle/instance'

const STYLE_ID = 'canvas-mode-reveal-styles'
const PENDING = 'sidebar-ux-mode-switch-pending'
const REVEAL = 'sidebar-ux-mode-switch-reveal'
const STRIP_CHANGE = 'sidebar-ux-mode-switch-strip-change'
const FADE_MS = 180
const MAX_HOLD_MS = 15000

const SURFACES = [
  '[class*="_wrapper_"]:has([data-spindle-mount="sidebar"])',
  '.sidebar-ux-main-mirror-wrapper',
  '.sidebar-ux-secondary-wrapper',
  '.sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"]',
]
const MAIN_STRIP = '.sidebar-ux-tab-list-pin-host[data-pin-owner="main"]'
const scoped = (classes: string, selectors: string[]) =>
  selectors.map((selector) => `html.${classes} ${selector}`).join(',\n')

const CSS = `
  ${scoped(PENDING, SURFACES)},
  ${scoped(`${PENDING}.${STRIP_CHANGE}`, [MAIN_STRIP])},
  html.${PENDING} [class*="_panelContent_"],
  html.${PENDING} [data-canvas-main-panel-content] {
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    animation: none !important;
    transition: none !important;
  }
  ${scoped(REVEAL, SURFACES)},
  ${scoped(`${REVEAL}.${STRIP_CHANGE}`, [MAIN_STRIP])} {
    animation: canvas-mode-reveal ${FADE_MS}ms ease-out both !important;
  }
  @keyframes canvas-mode-reveal {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    ${scoped(REVEAL, SURFACES)},
    ${scoped(`${REVEAL}.${STRIP_CHANGE}`, [MAIN_STRIP])} {
      animation: none !important;
    }
  }
`

type ChromeSettings = Pick<CanvasSettings,
  'osMode' | 'taskbarMode' | 'moveControlsToOuterEdge' | 'drawerLocation'>
const pinned = (s: ChromeSettings) => !!s.taskbarMode && !!s.moveControlsToOuterEdge

interface RevealSession {
  revision: number
  work: Set<Promise<void>>
  finishing: Promise<void> | null
  timer: ReturnType<typeof setTimeout> | null
  ended: Promise<void>
  end: () => void
  reflow: (() => void) | null
}
let _session: RevealSession | null = null
let _fadeTimer: ReturnType<typeof setTimeout> | null = null

/** Settings call this before publishing the normalized next state. */
export function beginModeReveal(prev: ChromeSettings, next: ChromeSettings): void {
  if (prev.osMode === next.osMode && pinned(prev) === pinned(next)
      && prev.drawerLocation === next.drawerLocation) return
  if (typeof document === 'undefined' || !document.head
      || !document.documentElement?.classList || !isInstanceActive()) return
  if (_fadeTimer !== null) clearTimeout(_fadeTimer)
  _fadeTimer = null
  injectStyles(STYLE_ID, CSS)
  document.documentElement.classList.remove(REVEAL)
  if (!_session) {
    document.documentElement.classList.remove(STRIP_CHANGE)
    let end!: () => void
    const ended = new Promise<void>((resolve) => { end = resolve })
    _session = { revision: 0, work: new Set(), finishing: null, timer: null, ended, end, reflow: null }
  }
  const session = _session
  session.revision++
  document.documentElement.classList.add(PENDING)
  // OS -> Taskbar keeps the working main strip visible. A pin/edge change
  // (especially OS -> Vanilla) replaces that surface, so guard it as well.
  if (pinned(prev) !== pinned(next) || prev.drawerLocation !== next.drawerLocation) {
    document.documentElement.classList.add(STRIP_CHANGE)
  }
  if (session.timer !== null) clearTimeout(session.timer)
  session.timer = setTimeout(() => {
    if (_session !== session) return
    dwarn('[mode-reveal] restore timed out; releasing the visual guard')
    release(session, false)
  }, MAX_HOLD_MS)
  ;(session.timer as unknown as { unref?: () => void }).unref?.()
}

/** Register synchronously in feature.apply, including an already-running OS drain. */
export function trackModeRevealWork(work: Promise<unknown>): void {
  const session = _session
  if (!session) return
  session.revision++
  const settled = work.then(() => {}, () => {})
  session.work.add(settled)
  void settled.then(() => { session.work.delete(settled) })
}

/** Coalesce transient drawer-width observations into one final chat reflow. */
export function deferModeRevealReflow(reflow: () => void): boolean {
  if (!_session) return false
  _session.reflow = reflow
  return true
}

function frame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else resolve()
  })
}

/** Called after synchronous feature.apply; callers may await full visual completion. */
export function finishModeReveal(): Promise<void> {
  const session = _session
  if (!session) return Promise.resolve()
  if (session.finishing) return session.finishing
  session.finishing = (async () => {
    try {
      while (_session === session) {
        const revision = session.revision
        await Promise.race([Promise.all([...session.work]), session.ended])
        if (_session !== session) return
        const [dispatch, main] = await Promise.all([
          import('../recon/dispatch'), import('../sidebar/main-persist'),
        ])
        if (_session !== session) return
        // The bootstrap promise includes placement AND the removal sweep and
        // final active-panel reassertion. A flush alone does not await these.
        await Promise.race([dispatch.bootPlacementDone(), session.ended])
        if (_session !== session) return
        await Promise.race([dispatch.flush(), session.ended])
        if (_session !== session) return
        await Promise.race([main.waitForMainContentSettled(1000), session.ended])
        if (_session !== session) return
        if (revision !== session.revision || session.work.size > 0) continue
        const chrome = await import('../os/chrome-locations')
        if (_session !== session) return
        chrome.reconcileChromeLocations()
        // Allow scheduled mirror renders and React DOM commits to land under
        // the guard. No fixed delay based on tab count or guessed load time.
        await Promise.race([frame().then(frame), session.ended])
        if (_session !== session) return
        if (revision !== session.revision || session.work.size > 0) continue
        release(session, true)
      }
    } catch (err) {
      dwarn('[mode-reveal] settle failed:', err)
      if (_session === session) release(session, false)
    }
  })()
  return session.finishing
}

function release(session: RevealSession, animate: boolean, reflow = true): void {
  if (_session !== session) return
  _session = null
  if (session.timer !== null) clearTimeout(session.timer)
  session.end()
  document.documentElement.classList.remove(PENDING)
  if (animate) {
    document.documentElement.classList.add(REVEAL)
    _fadeTimer = setTimeout(() => {
      _fadeTimer = null
      document.documentElement.classList.remove(REVEAL, STRIP_CHANGE)
    }, FADE_MS + 60)
  } else {
    document.documentElement.classList.remove(REVEAL, STRIP_CHANGE)
  }
  if (reflow && isInstanceActive()) session.reflow?.()
}

/** Teardown must neither fade nor write chat margins into the restored host. */
export function cancelModeReveal(): void {
  if (_session) release(_session, false, false)
  if (_fadeTimer !== null) clearTimeout(_fadeTimer)
  _fadeTimer = null
  if (typeof document !== 'undefined') {
    document.documentElement?.classList?.remove(PENDING, REVEAL, STRIP_CHANGE)
    document.getElementById?.(STYLE_ID)?.remove()
  }
}
