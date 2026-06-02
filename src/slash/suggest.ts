const SUGGEST_ID = 'canvas-slash-suggest'

function getOrCreate(): HTMLDivElement {
  let el = document.getElementById(SUGGEST_ID) as HTMLDivElement | null
  if (el) return el

  el = document.createElement('div')
  el.id = SUGGEST_ID
  el.setAttribute('data-canvas-slash', 'suggest')
  // Inline positioning, no CSS file dependency for v1
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: '9999',
    background: 'var(--lumiverse-bg-surface, #1e2132)',
    border: '1px solid var(--lumiverse-border, #2e334a)',
    borderRadius: '6px',
    padding: '4px 0',
    minWidth: '200px',
    maxHeight: '200px',
    overflowY: 'auto',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
    fontFamily: 'var(--lumiverse-font, sans-serif)',
    fontSize: '13px',
    color: 'var(--lumiverse-text, #c6c8d1)',
  } satisfies Partial<CSSStyleDeclaration>)

  document.body.appendChild(el)
  return el
}

function position(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  // Sit just above the textarea (the standard "autocomplete" position).
  // If there's not enough room above, sit below.
  const spaceAbove = rect.top
  const elHeight = 200  // matches maxHeight
  const top = spaceAbove > elHeight + 8 ? rect.top - elHeight - 4 : rect.bottom + 4
  el.style.top = `${top}px`
  el.style.left = `${rect.left}px`
  el.style.minWidth = `${rect.width}px`
}

let visualViewportListener: (() => void) | null = null
let scrollListener: (() => void) | null = null
let resizeListener: (() => void) | null = null
let currentAnchor: HTMLElement | null = null
let currentEl: HTMLElement | null = null

function detachListeners(): void {
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
  currentAnchor = null
  currentEl = null
}

export function showSuggest(textarea: HTMLTextAreaElement, options: string[]): void {
  if (options.length === 0) {
    hideSuggest()
    return
  }

  const el = getOrCreate()
  el.innerHTML = options
    .map((opt) => `<div class="canvas-slash-opt" data-cmd="${escapeAttr(opt)}">${escapeHtml(opt)}</div>`)
    .join('')
  position(el, textarea)
  currentAnchor = textarea
  currentEl = el

  // Re-position on viewport / scroll changes (mobile keyboard, scroll)
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

export function hideSuggest(): void {
  const el = document.getElementById(SUGGEST_ID)
  if (el) el.remove()
  detachListeners()
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c))
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}
