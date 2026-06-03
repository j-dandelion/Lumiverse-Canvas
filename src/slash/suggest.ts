// Slash-command suggestion popup. Pure DOM, no Spindle/Preact dependency.
// Visual style is injected once via injectSuggestStyles() — matches the
// idempotent pattern in canvas_ext/src/frontend.ts:246 (injectDrawerTabStyles).
// All colors, sizes, and shadows come from the canonical --lumiverse-* set
// (see ~/Lumiverse/frontend/src/theme/variables.css:1-148). No hex literals.
import type { SlashCommandDef } from './types'

const SUGGEST_ID = 'canvas-slash-suggest'
const STYLE_ID = 'canvas-slash-suggest-styles'

// --- Public API ---

export interface SuggestController {
  /** Clamp + set. Negative indices are treated as 0. */
  setActiveIndex(i: number): void
  /** -1 if no row is active (e.g. options list was empty). */
  getActiveIndex(): number
  /** Returns the active SlashCommandDef, or null if no row is active. */
  getActiveCommand(): SlashCommandDef | null
  /** Scrolls the active row into view. Safe to call when not visible. */
  scrollActiveIntoView(): void
  /** True while a popup is on screen. */
  isVisible(): boolean
}

/**
 * Show (or update) the suggestion popup anchored to `textarea`. Idempotent:
 * calling repeatedly with new options re-renders the rows in place. Returns
 * a controller used by intercept.ts for keyboard navigation and dispatch.
 *
 * @param options Commands to display. The displayed text is `cmd.usage ?? '/' + cmd.name`.
 */
export function showSuggest(
  textarea: HTMLTextAreaElement,
  options: SlashCommandDef[],
): SuggestController {
  // Empty options: hide any existing popup and return a no-op controller.
  if (options.length === 0) {
    hideSuggest()
    return makeNoopController()
  }

  injectSuggestStyles()
  applyTextareaAriaBaseline(textarea)

  const el = getOrCreate()
  el.setAttribute('role', 'listbox')

  // Module-level so isSuggestVisible() can read it without a closure hop.
  currentAnchor = textarea
  currentEl = el

  // Per-popup state held by the closure.
  let currentOptions: SlashCommandDef[] = options
  let activeIndex = 0
  let visible = true

  // --- helpers ---

  const updateActiveDom = (): void => {
    const rows = el.querySelectorAll<HTMLElement>('.canvas-slash-opt')
    rows.forEach((row, i) => {
      const isActive = i === activeIndex
      row.setAttribute('data-active', isActive ? 'true' : 'false')
      row.setAttribute('aria-selected', isActive ? 'true' : 'false')
    })
    // Mirror the active row on the textarea so screen readers announce it.
    textarea.setAttribute('aria-expanded', 'true')
    if (activeIndex >= 0 && activeIndex < rows.length) {
      textarea.setAttribute('aria-activedescendant', `canvas-slash-opt-${activeIndex}`)
    } else {
      textarea.removeAttribute('aria-activedescendant')
    }
  }

  const renderRows = (): void => {
    el.innerHTML = currentOptions
      .map((c, i) => {
        const label = escapeHtml(c.usage ?? '/' + c.name)
        const desc = escapeHtml(c.description ?? '')
        const owner = escapeHtml(c.owner)
        const isActive = i === activeIndex
        // Row shape mirrors CommandPalette.module.css:144-214:
        //   <div .canvas-slash-opt>      ← row, flex row
        //     <span .canvas-slash-opt-body>   ← flex column, name + desc stacked
        //       <span .canvas-slash-opt-name>
        //       <span .canvas-slash-opt-desc>
        //     <span .canvas-slash-opt-source> ← right-aligned owner chip
        return (
          `<div id="canvas-slash-opt-${i}" class="canvas-slash-opt"` +
          ` role="option" aria-selected="${isActive}" data-active="${isActive}"` +
          ` data-cmd="${escapeAttr(c.name)}">` +
            `<span class="canvas-slash-opt-body">` +
              `<span class="canvas-slash-opt-name">${label}</span>` +
              `<span class="canvas-slash-opt-desc">${desc}</span>` +
            `</span>` +
            `<span class="canvas-slash-opt-source">${owner}</span>` +
          `</div>`
        )
      })
      .join('')
    el.querySelectorAll<HTMLElement>('.canvas-slash-opt').forEach((row, i) => {
      row.addEventListener('mouseenter', () => setActiveIndex(i))
      row.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!currentAnchor) return
        const cmd = currentOptions[i]
        if (!cmd) return
        // If the textarea already starts with the same command name
        // (e.g. `/select 1-3` and the user clicks the `/select` row),
        // the click is a no-op for the value — just dismiss the popup
        // and focus. The user has a complete command; overwriting it
        // with the bare usage would wipe the user's args. This mirrors
        // the intercept.ts Enter fix: never erase a complete command
        // the user has already typed.
        const typedName = currentAnchor.value.split(/\s/, 1)[0].slice(1).toLowerCase()
        if (typedName === cmd.name.toLowerCase()) {
          hideSuggest()
          currentAnchor.focus()
          return
        }
        // Mirror the Tab-commit pattern in intercept.ts:105-116 — same label
        // resolution, same input event, same hideSuggest. Click just adds a
        // focus() at the end so the user can immediately type or press Enter.
        const label = cmd.usage ?? `/${cmd.name}`
        const alreadyHasArgs = currentAnchor.value.includes(' ')
        const replacement = alreadyHasArgs ? label : `${label} `
        currentAnchor.value = replacement
        currentAnchor.dispatchEvent(new Event('input', { bubbles: true }))
        hideSuggest()
        currentAnchor.focus()
      })
    })
    updateActiveDom()
  }

  const setActiveIndex = (i: number): void => {
    if (currentOptions.length === 0) {
      activeIndex = -1
      updateActiveDom()
      return
    }
    const clamped = Math.max(0, Math.min(currentOptions.length - 1, i))
    if (clamped === activeIndex) return
    activeIndex = clamped
    updateActiveDom()
    scrollActiveIntoView()
  }

  const scrollActiveIntoView = (): void => {
    if (activeIndex < 0) return
    const row = el.querySelector<HTMLElement>(`#canvas-slash-opt-${activeIndex}`)
    row?.scrollIntoView({ block: 'nearest' })
  }

  const getActiveCommand = (): SlashCommandDef | null => {
    if (activeIndex < 0 || activeIndex >= currentOptions.length) return null
    return currentOptions[activeIndex]
  }

  // First render
  renderRows()
  position(el, textarea)

  // Register viewport + outside-dismiss listeners (both idempotent).
  attachViewportListeners()
  attachOutsideDismiss()

  // Promote to module-level so the intercept's `isSuggestVisible()` works.
  _currentController = {
    setActiveIndex,
    getActiveIndex: () => activeIndex,
    getActiveCommand,
    scrollActiveIntoView,
    isVisible: () => visible,
  }
  return _currentController
}

/** Tear down the popup, its viewport listeners, and the current controller. */
export function hideSuggest(): void {
  const el = document.getElementById(SUGGEST_ID)
  if (el) el.remove()
  detachViewportListeners()
  detachOutsideDismiss()
  currentAnchor = null
  currentEl = null
  _currentController = null
}

/** True while a popup is on screen. Used by intercept to gate key handling. */
export function isSuggestVisible(): boolean {
  return _currentController?.isVisible() === true
}

/**
 * Returns the active controller (or null). Used by intercept to drive
 * keyboard navigation and to consult the active row at dispatch time.
 */
export function getSuggestController(): SuggestController | null {
  return _currentController
}

// --- module state ---

let _currentController: SuggestController | null = null
let visualViewportListener: (() => void) | null = null
let scrollListener: (() => void) | null = null
let resizeListener: (() => void) | null = null
let outsideDismissListener: ((e: Event) => void) | null = null
let currentAnchor: HTMLTextAreaElement | null = null
let currentEl: HTMLElement | null = null

function makeNoopController(): SuggestController {
  return {
    setActiveIndex: () => {},
    getActiveIndex: () => -1,
    getActiveCommand: () => null,
    scrollActiveIntoView: () => {},
    isVisible: () => false,
  }
}

function getOrCreate(): HTMLDivElement {
  let el = document.getElementById(SUGGEST_ID) as HTMLDivElement | null
  if (el) return el
  el = document.createElement('div')
  el.id = SUGGEST_ID
  el.setAttribute('data-canvas-slash', 'suggest')
  document.body.appendChild(el)
  return el
}

const VIEWPORT_MARGIN = 8  // keep the popup this many px from the viewport edge

function position(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  // Sit just above the textarea (the standard "autocomplete" position).
  // If there's not enough room above, sit below.
  const spaceAbove = rect.top
  const elHeight = el.offsetHeight
  const top = spaceAbove > elHeight + VIEWPORT_MARGIN ? rect.top - elHeight - 4 : rect.bottom + 4
  el.style.top = `${top}px`
  // Clamp the left edge so the popup never clips off the right side of the
  // viewport (or off the left, in case the textarea is near x=0). The popup
  // width is bounded by CSS `max-width: min(420px, calc(100vw - 16px))` so
  // `el.offsetWidth` is a safe upper bound for what we need to fit.
  const elWidth = el.offsetWidth
  const maxLeft = window.innerWidth - elWidth - VIEWPORT_MARGIN
  el.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft))}px`
  el.style.minWidth = `${rect.width}px`
}

function attachViewportListeners(): void {
  if (!visualViewportListener) {
    visualViewportListener = () => {
      if (currentAnchor && currentEl) position(currentEl, currentAnchor)
    }
    window.visualViewport?.addEventListener('resize', visualViewportListener)
  }
  if (!scrollListener) {
    scrollListener = () => {
      if (currentAnchor && currentEl) position(currentEl, currentAnchor)
    }
    window.addEventListener('scroll', scrollListener, true)
  }
  if (!resizeListener) {
    resizeListener = () => {
      if (currentAnchor && currentEl) position(currentEl, currentAnchor)
    }
    window.addEventListener('resize', resizeListener)
  }
}

function detachViewportListeners(): void {
  if (visualViewportListener) {
    window.visualViewport?.removeEventListener('resize', visualViewportListener)
    visualViewportListener = null
  }
  if (scrollListener) {
    window.removeEventListener('scroll', scrollListener, true)
    scrollListener = null
  }
  if (resizeListener) {
    window.removeEventListener('resize', resizeListener)
    resizeListener = null
  }
}

/**
 * Outside-input dismiss. Closes the popup when the user taps/clicks/right-
 * clicks anywhere outside the popup element itself.
 *
 * Why these three event types:
 *   - `mousedown` covers desktop click AND touch tap (touch fires mousedown
 *     as a compatibility mouse event) AND pen tap. It's the broadest input
 *     signal with universal browser support.
 *   - `pointerdown` is the W3C unified pointer event. It fires slightly
 *     earlier than mousedown on touch devices, so the dismiss feels
 *     snappier. Redundant with mousedown on most paths, but `hideSuggest`
 *     is idempotent so the double-fire is harmless.
 *   - `contextmenu` covers right-click on all platforms.
 *
 * The row's own click handler calls `e.stopPropagation()`, so row clicks
 * never reach this listener. We also short-circuit on the `contains` check
 * for any other event whose target happens to be inside the popup (e.g.
 * right-click on the popup's padding).
 */
function attachOutsideDismiss(): void {
  if (outsideDismissListener) return
  outsideDismissListener = (e: Event) => {
    if (!_currentController) return
    const target = e.target
    if (!(target instanceof Node)) return
    if (currentEl?.contains(target)) return
    hideSuggest()
  }
  document.addEventListener('mousedown', outsideDismissListener)
  document.addEventListener('pointerdown', outsideDismissListener)
  document.addEventListener('contextmenu', outsideDismissListener)
}

function detachOutsideDismiss(): void {
  if (!outsideDismissListener) return
  document.removeEventListener('mousedown', outsideDismissListener)
  document.removeEventListener('pointerdown', outsideDismissListener)
  document.removeEventListener('contextmenu', outsideDismissListener)
  outsideDismissListener = null
}

// --- ARIA ---

/**
 * Apply the static combobox attributes to the textarea once. Per-show
 * dynamic attributes (aria-expanded, aria-activedescendant) are written by
 * showSuggest's updateActiveDom.
 */
function applyTextareaAriaBaseline(textarea: HTMLTextAreaElement): void {
  if (textarea.getAttribute('role') !== 'combobox') {
    textarea.setAttribute('role', 'combobox')
    textarea.setAttribute('aria-autocomplete', 'list')
    textarea.setAttribute('aria-haspopup', 'listbox')
    textarea.setAttribute('aria-controls', SUGGEST_ID)
  }
}

// --- style injection ---

/**
 * Idempotent: creates <style id="canvas-slash-suggest-styles"> in <head>
 * exactly once per page load. Mirrors injectDrawerTabStyles in
 * canvas_ext/src/frontend.ts:246. The block uses only --lumiverse-* vars
 * that are guaranteed by ~/Lumiverse/frontend/src/theme/variables.css:1-148.
 */
function injectSuggestStyles(): void {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${SUGGEST_ID} {
      position: fixed;
      z-index: 10005; /* above Lumiverse modals (10001-10003) and toast (now 9980) */
      background: var(--lumiverse-bg-elevated);
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius-md);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 200px;
      max-width: min(420px, calc(100vw - 16px));
      max-height: min(240px, calc(35vh / var(--lumiverse-ui-scale, 1)));
      overflow-y: auto;
      font-family: var(--lumiverse-font-family);
      color: var(--lumiverse-text);
      box-shadow: var(--lumiverse-shadow-md);
      animation: canvas-slash-suggest-fade 160ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    #${SUGGEST_ID} .canvas-slash-opt {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: var(--lumiverse-radius);
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text);
      cursor: pointer;
      user-select: none;
      transition: background 120ms ease;
    }
    #${SUGGEST_ID} .canvas-slash-opt:hover {
      background: var(--lumiverse-fill-subtle);
    }
    #${SUGGEST_ID} .canvas-slash-opt[data-active="true"] {
      background: var(--lumiverse-primary-020);
      color: var(--lumiverse-text);
    }
    #${SUGGEST_ID} .canvas-slash-opt[data-active="true"] .canvas-slash-opt-name {
      color: var(--lumiverse-primary);
    }
    #${SUGGEST_ID} .canvas-slash-opt-body {
      display: flex;
      flex-direction: column;
      gap: 1px;
      flex: 1;
      min-width: 0;
    }
    #${SUGGEST_ID} .canvas-slash-opt-name {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      color: var(--lumiverse-text);
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${SUGGEST_ID} .canvas-slash-opt-desc {
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-dim);
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #${SUGGEST_ID} .canvas-slash-opt-source {
      font-size: calc(10px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-dim);
      padding: 2px 6px;
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius);
      background: var(--lumiverse-fill-subtle);
      flex-shrink: 0;
      max-width: 80px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @keyframes canvas-slash-suggest-fade {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `
  document.head.appendChild(style)
}

// --- escaping ---

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c))
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}
