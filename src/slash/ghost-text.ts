// Ghost-text overlay for slash arg completion. The ghost is NOT written
// into the textarea value — it is a fixed/absolute grey overlay painted
// after the caret. Accept replaces the arg range via setControlledValue.
//
// Ghost is only shown when the caller has a visible suggest popup; hide
// paths (hideSuggest, empty candidates) must call hideGhost().
import { injectStyles } from '../debug/styles'
import { setControlledValue, setSkipNextTextChange } from './dom-utils'

const GHOST_ID = 'canvas-slash-ghost'
const STYLE_ID = 'canvas-slash-ghost-styles'

export interface GhostRange {
  start: number
  end: number
}

export interface GhostArgPayload {
  /** Complete argument string, e.g. "Chris" or "all". */
  fullArg: string
  /** Slice of ta.value to replace on accept. */
  range: GhostRange
  /** Currently typed arg prefix (for suffix length / rebind). */
  typedPrefix: string
}

interface GhostCtx {
  ta: HTMLTextAreaElement
  fullArg: string
  range: GhostRange
  typedPrefix: string
  /** True when the grey overlay is currently painted. */
  visible: boolean
}

let _ctx: GhostCtx | null = null

/**
 * Show or update ghost for an arg completion. Hides the overlay when
 * suffix is empty (exact match) but keeps the arg context so arrow-key
 * rebinds can restore a different candidate. Pass null to fully clear.
 */
export function setGhost(
  ta: HTMLTextAreaElement,
  payload: GhostArgPayload | null,
): void {
  if (!payload) {
    hideGhost()
    return
  }
  const suffix = ghostSuffixLocal(payload.fullArg, payload.typedPrefix)
  _ctx = {
    ta,
    fullArg: payload.fullArg,
    range: payload.range,
    typedPrefix: payload.typedPrefix,
    visible: false,
  }
  if (!suffix) {
    removeOverlay()
    return
  }
  injectGhostStyles()
  _ctx.visible = true
  renderGhostOverlay(ta, suffix, payload.range.end)
}

/**
 * Rebind fullArg while keeping the stored range + typedPrefix (arrow-key
 * active-row changes). No-op if no prior setGhost context.
 */
export function rebindGhostArg(
  ta: HTMLTextAreaElement,
  fullArg: string | null,
): void {
  if (!_ctx) return
  if (!fullArg) {
    removeOverlay()
    if (_ctx) _ctx.visible = false
    return
  }
  setGhost(ta, {
    fullArg,
    range: _ctx.range,
    typedPrefix: _ctx.typedPrefix,
  })
}

/** True when a ghost overlay is painted (acceptable via acceptGhost). */
export function hasGhost(): boolean {
  return _ctx?.visible === true
}

/**
 * Accept the active ghost: replace range with fullArg, ensure trailing
 * space, set skip flag, clear ghost. Returns false if no ghost active.
 */
export function acceptGhost(ta: HTMLTextAreaElement): boolean {
  if (!_ctx?.visible) return false
  const { fullArg, range } = _ctx
  const value = ta.value
  const start = Math.max(0, Math.min(range.start, value.length))
  const end = Math.max(start, Math.min(range.end, value.length))
  let next = value.slice(0, start) + fullArg + value.slice(end)
  if (!next.endsWith(' ')) next += ' '
  setSkipNextTextChange()
  setControlledValue(ta, next)
  ta.setSelectionRange(next.length, next.length)
  hideGhost()
  return true
}

/** Fully clear ghost context and overlay. */
export function hideGhost(): void {
  _ctx = null
  removeOverlay()
}

// --- internal ---

function removeOverlay(): void {
  const el = document.getElementById(GHOST_ID)
  if (el) el.remove()
}

function ghostSuffixLocal(full: string, typedPrefix: string): string | null {
  if (!full.toLowerCase().startsWith(typedPrefix.toLowerCase())) return null
  if (full.length <= typedPrefix.length) return null
  return full.slice(typedPrefix.length)
}

function renderGhostOverlay(
  ta: HTMLTextAreaElement,
  suffix: string,
  caretPos: number,
): void {
  const coords = measureCaretPosition(ta, caretPos)
  let el = document.getElementById(GHOST_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = GHOST_ID
    el.setAttribute('data-canvas-slash', 'ghost')
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
  }
  el.textContent = suffix
  // Match the textarea typography so the ghost aligns with real text.
  const style = window.getComputedStyle(ta)
  el.style.font = style.font
  el.style.fontFamily = style.fontFamily
  el.style.fontSize = style.fontSize
  el.style.fontWeight = style.fontWeight
  el.style.fontStyle = style.fontStyle
  el.style.lineHeight = style.lineHeight
  el.style.letterSpacing = style.letterSpacing
  el.style.top = `${coords.top}px`
  el.style.left = `${coords.left}px`
}

/**
 * Mirror-div caret measurement. Copies font/padding/border metrics from
 * the textarea, lays out value.slice(0, pos) + a marker span, and maps
 * the marker into viewport coordinates (accounting for scroll).
 */
function measureCaretPosition(
  ta: HTMLTextAreaElement,
  pos: number,
): { top: number; left: number } {
  const style = window.getComputedStyle(ta)
  const mirror = document.createElement('div')

  mirror.style.font = style.font
  mirror.style.fontFamily = style.fontFamily
  mirror.style.fontSize = style.fontSize
  mirror.style.fontWeight = style.fontWeight
  mirror.style.fontStyle = style.fontStyle
  mirror.style.lineHeight = style.lineHeight
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.textTransform = style.textTransform
  mirror.style.padding = style.padding
  mirror.style.border = style.border
  mirror.style.boxSizing = style.boxSizing
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.overflowWrap = style.overflowWrap || 'break-word'
  mirror.style.width = `${ta.clientWidth}px`
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.left = '-9999px'
  mirror.style.top = '0'
  mirror.style.overflow = 'hidden'

  const clamped = Math.max(0, Math.min(pos, ta.value.length))
  mirror.textContent = ta.value.slice(0, clamped)
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const taRect = ta.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()

  const top = taRect.top + (markerRect.top - mirrorRect.top) - ta.scrollTop
  const left = taRect.left + (markerRect.left - mirrorRect.left) - ta.scrollLeft

  mirror.remove()
  return { top, left }
}

function injectGhostStyles(): void {
  injectStyles(STYLE_ID, `
    #${GHOST_ID} {
      position: fixed;
      z-index: 10004; /* below suggest (10005), above toast */
      pointer-events: none;
      color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, #888));
      opacity: 0.65;
      font-family: var(--lumiverse-font-family, inherit);
      white-space: pre;
      user-select: none;
    }
  `)
}
