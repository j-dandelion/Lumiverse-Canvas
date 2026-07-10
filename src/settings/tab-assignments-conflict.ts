// Conflict dialog when enabling "Remember tab assignments" while live
// assignments differ from the last saved layout. Pure DOM + injectStyles.

import { injectStyles } from '../debug/styles'

const HOST_ID = 'canvas-tab-assignments-conflict'
const STYLE_ID = 'canvas-tab-assignments-conflict-styles'

export type TabAssignmentsConflictHandlers = {
  onSaveCurrent: () => void | Promise<void>
  onLoadPrevious: () => void | Promise<void>
  onDismiss: () => void
}

let _host: HTMLElement | null = null
let _onKeyDown: ((e: KeyboardEvent) => void) | null = null
let _busy = false

function injectConflictStyles(): void {
  injectStyles(STYLE_ID, `
    #${HOST_ID} {
      position: fixed;
      inset: 0;
      z-index: 11050;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
      font-family: var(--lumiverse-font-family, sans-serif);
      animation: canvas-tab-assign-conflict-fade 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    #${HOST_ID} .canvas-tab-assign-conflict-backdrop {
      position: absolute;
      inset: 0;
      background: color-mix(in srgb, var(--lumiverse-fill-heavy, rgba(0,0,0,0.45)) 85%, transparent);
    }
    #${HOST_ID} .canvas-tab-assign-conflict-card {
      position: relative;
      z-index: 1;
      width: min(380px, 100%);
      background: var(--lumiverse-bg-elevated, var(--lumiverse-bg-deep, #1a1a1a));
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius-md, 12px);
      box-shadow: var(--lumiverse-shadow-md, 0 12px 32px rgba(0,0,0,0.5));
      padding: 16px;
      box-sizing: border-box;
      animation: canvas-tab-assign-conflict-in 120ms ease-out;
    }
    #${HOST_ID} .canvas-tab-assign-conflict-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    #${HOST_ID} .canvas-tab-assign-conflict-title {
      margin: 0;
      font-size: calc(15px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      line-height: 1.3;
      color: var(--lumiverse-text);
      padding-top: 4px;
    }
    #${HOST_ID} .canvas-tab-assign-conflict-close {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--lumiverse-text-muted);
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease;
    }
    #${HOST_ID} .canvas-tab-assign-conflict-close:hover {
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
      color: var(--lumiverse-text);
    }
    #${HOST_ID} .canvas-tab-assign-conflict-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${HOST_ID} .canvas-tab-assign-conflict-option {
      display: block;
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border);
      border-radius: 8px;
      background: var(--lumiverse-bg-050, transparent);
      color: var(--lumiverse-text);
      cursor: pointer;
      font-family: inherit;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    #${HOST_ID} .canvas-tab-assign-conflict-option:hover:not(:disabled) {
      background: var(--lumiverse-primary-020, rgba(66,165,245,0.12));
      border-color: var(--lumiverse-primary, #42a5f5);
    }
    #${HOST_ID} .canvas-tab-assign-conflict-option:disabled {
      opacity: 0.55;
      cursor: default;
    }
    #${HOST_ID} .canvas-tab-assign-conflict-option-label {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      line-height: 1.3;
      color: var(--lumiverse-text);
    }
    #${HOST_ID} .canvas-tab-assign-conflict-option-hint {
      margin-top: 2px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.35;
      color: var(--lumiverse-text-muted);
    }
    @keyframes canvas-tab-assign-conflict-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes canvas-tab-assign-conflict-in {
      from { opacity: 0; transform: scale(0.92); }
      to { opacity: 1; transform: scale(1); }
    }
  `)
}

function makeOptionButton(label: string, hint: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'canvas-tab-assign-conflict-option'
  const labelEl = document.createElement('div')
  labelEl.className = 'canvas-tab-assign-conflict-option-label'
  labelEl.textContent = label
  const hintEl = document.createElement('div')
  hintEl.className = 'canvas-tab-assign-conflict-option-hint'
  hintEl.textContent = hint
  btn.appendChild(labelEl)
  btn.appendChild(hintEl)
  return btn
}

function cleanupListeners(): void {
  if (_onKeyDown) {
    document.removeEventListener('keydown', _onKeyDown)
    _onKeyDown = null
  }
}

/** Hide and remove the conflict dialog if present. */
export function hideTabAssignmentsConflictDialog(): void {
  cleanupListeners()
  _busy = false
  if (_host) {
    _host.remove()
    _host = null
  }
}

export function isTabAssignmentsConflictDialogVisible(): boolean {
  return _host != null && document.body.contains(_host)
}

/**
 * Show (or replace) the conflict dialog. Idempotent: a second show removes
 * the previous instance first.
 */
export function showTabAssignmentsConflictDialog(handlers: TabAssignmentsConflictHandlers): void {
  hideTabAssignmentsConflictDialog()
  injectConflictStyles()
  _busy = false

  const host = document.createElement('div')
  host.id = HOST_ID
  host.setAttribute('role', 'dialog')
  host.setAttribute('aria-modal', 'true')
  host.setAttribute('aria-labelledby', 'canvas-tab-assign-conflict-title')

  const backdrop = document.createElement('div')
  backdrop.className = 'canvas-tab-assign-conflict-backdrop'
  backdrop.addEventListener('click', () => {
    if (_busy) return
    handlers.onDismiss()
  })

  const card = document.createElement('div')
  card.className = 'canvas-tab-assign-conflict-card'
  // Stop backdrop from receiving clicks that land on the card.
  card.addEventListener('click', (e) => e.stopPropagation())

  const header = document.createElement('div')
  header.className = 'canvas-tab-assign-conflict-header'

  const title = document.createElement('h3')
  title.id = 'canvas-tab-assign-conflict-title'
  title.className = 'canvas-tab-assign-conflict-title'
  title.textContent = 'Tab assignments differ'

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'canvas-tab-assign-conflict-close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.innerHTML =
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`
  closeBtn.addEventListener('click', () => {
    if (_busy) return
    handlers.onDismiss()
  })

  header.appendChild(title)
  header.appendChild(closeBtn)

  const options = document.createElement('div')
  options.className = 'canvas-tab-assign-conflict-options'

  const saveBtn = makeOptionButton(
    'Save current',
    "Write this session's tab arrangement to storage, then turn remember on.",
  )
  const loadBtn = makeOptionButton(
    'Load previous',
    'Restore the last saved tab arrangement, then turn remember on.',
  )

  const setBusy = (busy: boolean) => {
    _busy = busy
    saveBtn.disabled = busy
    loadBtn.disabled = busy
    closeBtn.disabled = busy
  }

  saveBtn.addEventListener('click', () => {
    if (_busy) return
    setBusy(true)
    void Promise.resolve(handlers.onSaveCurrent()).finally(() => {
      // hide is expected from the orchestrator; if not, unlock.
      if (_host === host) setBusy(false)
    })
  })
  loadBtn.addEventListener('click', () => {
    if (_busy) return
    setBusy(true)
    void Promise.resolve(handlers.onLoadPrevious()).finally(() => {
      if (_host === host) setBusy(false)
    })
  })

  options.appendChild(saveBtn)
  options.appendChild(loadBtn)
  card.appendChild(header)
  card.appendChild(options)
  host.appendChild(backdrop)
  host.appendChild(card)

  _onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (_busy) return
    e.preventDefault()
    e.stopPropagation()
    handlers.onDismiss()
  }
  document.addEventListener('keydown', _onKeyDown)

  document.body.appendChild(host)
  _host = host
  // Focus close for accessibility without trapping focus hard.
  closeBtn.focus()
}
