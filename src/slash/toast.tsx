import { render, h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { injectStyles } from '../debug/styles'

interface ToastEntry {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}

const STYLE_ID = 'canvas-slash-toast-styles'

let nextId = 0
const listeners = new Set<(toasts: ToastEntry[]) => void>()
let toasts: ToastEntry[] = []
const _toastTimers = new Set<ReturnType<typeof setTimeout>>()

function pushToast(kind: ToastEntry['kind'], text: string) {
  const id = ++nextId
  toasts = [...toasts, { id, kind, text }]
  listeners.forEach((l) => l(toasts))
  const timer = setTimeout(() => {
    _toastTimers.delete(timer)
    toasts = toasts.filter((t) => t.id !== id)
    listeners.forEach((l) => l(toasts))
  }, 4000)
  _toastTimers.add(timer)
}

function ToastSurface() {
  const [list, setList] = useState(toasts)
  useEffect(() => {
    listeners.add(setList)
    return () => { listeners.delete(setList) }
  }, [])
  return (
    <div class="canvas-slash-toast-surface" data-canvas-slash="toast-surface">
      {list.map((t) => (
        <div
          key={t.id}
          class={`canvas-slash-toast canvas-slash-toast--${t.kind}`}
          data-kind={t.kind}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

let mounted = false
let toastHostEl: HTMLDivElement | null = null
let toastEventHandler: ((e: Event) => void) | null = null

function handleToastEvent(e: Event) {
  const { kind, text } = (e as CustomEvent).detail
  pushToast(kind, text)
}

export function mountToastSurface() {
  if (mounted) return unmountToastSurface
  mounted = true
  injectToastStyles()
  toastHostEl = document.createElement('div')
  toastHostEl.id = 'canvas-slash-toast-host'
  document.body.appendChild(toastHostEl)
  render(h(ToastSurface, {}), toastHostEl)

  // Public API: anyone in the extension (or registered via CustomEvent) can call this.
  toastEventHandler = handleToastEvent
  window.addEventListener('canvas:slash-toast', toastEventHandler)

  return unmountToastSurface
}

export function unmountToastSurface() {
  if (toastHostEl) {
    toastHostEl.remove()
    toastHostEl = null
  }
  if (toastEventHandler) {
    window.removeEventListener('canvas:slash-toast', toastEventHandler)
    toastEventHandler = null
  }
  mounted = false
  toasts = []
}

/**
 * Idempotent: creates <style id="canvas-slash-toast-styles"> in <head>
 * exactly once per page load. Mirrors injectSuggestStyles in
 * canvas_ext/src/slash/suggest.ts:263. The block uses only --lumiverse-*
 * vars that are guaranteed by ~/Lumiverse/frontend/src/theme/variables.css.
 *
 * --lumiverse-info is intentionally NOT in variables.css — it is referenced
 * with a hex fallback across core modals (InputArea.tsx:2705,
 * InputArea.module.css:725-727, RegexEditorModal.module.css). The plan was
 * to preserve that pattern here for consistency.
 */
function injectToastStyles(): void {
  injectStyles(STYLE_ID, `
    .canvas-slash-toast-surface {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 9980;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 400px;
      pointer-events: none;
    }
    .canvas-slash-toast {
      background: var(--lumiverse-bg-elevated);
      border: 1px solid var(--lumiverse-border);
      border-left-width: 3px;
      border-left-style: solid;
      border-radius: var(--lumiverse-radius);
      padding: 8px 12px;
      font-family: var(--lumiverse-font-family);
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text);
      white-space: pre-wrap;
      box-shadow: var(--lumiverse-shadow-md);
      pointer-events: auto;
    }
    .canvas-slash-toast--error  { border-left-color: var(--lumiverse-danger); }
    .canvas-slash-toast--success { border-left-color: var(--lumiverse-success); }
    /* --lumiverse-info is referenced with a #42a5f5 fallback in core modals
       (InputArea.tsx:2705, RegexEditorModal.module.css, etc.). Preserved
       here for consistency; the var is not defined in variables.css. */
    .canvas-slash-toast--info   { border-left-color: var(--lumiverse-info, #42a5f5); }
  `)
}
