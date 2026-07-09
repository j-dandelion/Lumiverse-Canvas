// Ghost-text overlay for slash command-name and arg completion. The ghost
// is NOT written into the textarea value — it is a fixed/absolute grey
// overlay painted after the caret. Accept replaces the ghost range via
// setControlledValue.
//
// Ghost is only shown when the caller has a visible suggest popup; hide
// paths (hideSuggest, empty candidates) must call hideGhost().
//
// Positioning: a full-size mirror overlay sits on the textarea content box
// with identical font/padding. The typed prefix is rendered transparent so
// the grey suffix shares the same line box as the real text (avoids the
// vertical drift common with caret-only top/left placement).
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
  let el = document.getElementById(GHOST_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = GHOST_ID
    el.setAttribute('data-canvas-slash', 'ghost')
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
  }

  const style = window.getComputedStyle(ta)
  const taRect = ta.getBoundingClientRect()
  const borderTop = parseFloat(style.borderTopWidth) || 0
  const borderLeft = parseFloat(style.borderLeftWidth) || 0

  // Sit on the textarea content box (inside border). Width/height use
  // client* so scrollbar gutters match; border-box + same padding → same
  // wrap width as the real control.
  el.style.left = `${taRect.left + borderLeft}px`
  el.style.top = `${taRect.top + borderTop}px`
  el.style.width = `${ta.clientWidth}px`
  el.style.height = `${ta.clientHeight}px`
  el.style.boxSizing = 'border-box'
  el.style.margin = '0'
  el.style.border = 'none'
  el.style.paddingTop = style.paddingTop
  el.style.paddingRight = style.paddingRight
  el.style.paddingBottom = style.paddingBottom
  el.style.paddingLeft = style.paddingLeft

  // Match typography so the transparent prefix lines up with real glyphs.
  el.style.font = style.font
  el.style.fontFamily = style.fontFamily
  el.style.fontSize = style.fontSize
  el.style.fontWeight = style.fontWeight
  el.style.fontStyle = style.fontStyle
  el.style.fontVariant = style.fontVariant
  el.style.lineHeight = style.lineHeight
  el.style.letterSpacing = style.letterSpacing
  el.style.textTransform = style.textTransform
  el.style.textAlign = style.textAlign
  el.style.textIndent = style.textIndent
  el.style.wordSpacing = style.wordSpacing
  el.style.direction = style.direction
  el.style.whiteSpace = 'pre-wrap'
  el.style.wordWrap = 'break-word'
  el.style.overflowWrap = style.overflowWrap || 'break-word'
  el.style.wordBreak = style.wordBreak
  el.style.tabSize = style.tabSize
  ;(el.style as CSSStyleDeclaration & { MozTabSize?: string }).MozTabSize =
    style.getPropertyValue('tab-size') || style.tabSize

  el.style.overflow = 'hidden'
  el.scrollTop = ta.scrollTop
  el.scrollLeft = ta.scrollLeft

  const clamped = Math.max(0, Math.min(caretPos, ta.value.length))
  const before = ta.value.slice(0, clamped)

  // Transparent prefix occupies the same layout space as the real text;
  // grey suffix continues in the same line box (vertical + horizontal).
  const pre = document.createElement('span')
  pre.className = 'canvas-slash-ghost-pre'
  pre.textContent = before

  const ghost = document.createElement('span')
  ghost.className = 'canvas-slash-ghost-suffix'
  ghost.textContent = suffix

  el.replaceChildren(pre, ghost)
}

function injectGhostStyles(): void {
  injectStyles(STYLE_ID, `
    #${GHOST_ID} {
      position: fixed;
      z-index: 10004; /* below suggest (10005), above toast */
      pointer-events: none;
      user-select: none;
      color: transparent;
    }
    #${GHOST_ID} .canvas-slash-ghost-pre {
      color: transparent;
    }
    #${GHOST_ID} .canvas-slash-ghost-suffix {
      color: var(--lumiverse-text-muted, var(--lumiverse-text-dim, #888));
      opacity: 0.65;
    }
  `)
}
