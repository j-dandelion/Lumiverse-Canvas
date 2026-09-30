// Canvas settings panel — DOM construction helpers.
//
// Pure rendering functions that build individual UI controls (toggle
// switches, setting rows, segmented controls, mode tiles, help tooltips).
// These don't depend on settings state; the caller wires onChange handlers.
//
// 2026-09-19 overhaul: descriptions moved from always-visible row hints into
// a `?` popover (`buildHelpTip`). The hint element is kept in the row DOM
// (class `.sidebar-ux-panel-row-hint`, hidden) as the popover's text source —
// dynamic lock reasons update it via `SettingRowHandle.setHint`, and the
// popover reads it at open time.

import { getUiScale } from '../os/start-menu-motion'

const HELP_POPOVER_ID = 'sidebar-ux-help-popover'

// ── Help tooltip ─────────────────────────────────────────────────────────────

let _popover: HTMLElement | null = null
let _anchor: HTMLElement | null = null
let _open = false
let _closeTimer: ReturnType<typeof setTimeout> | null = null
let _uninstallDismiss: (() => void) | null = null
/** True when the current open came from a focus event; a coarse-pointer tap
 *  fires focus before click, so the click must keep it open (M4 2026-09-19). */
let _openedByFocus = false
/** Live hint getters per help button, for refreshHelpPopover (L2). */
const _tipGetters = new WeakMap<HTMLElement, () => string>()

/** Lazy singleton popover (body-level so host modal overflow cannot clip it). */
function ensurePopover(): HTMLElement | null {
  if (_popover) return _popover
  try {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null
    const pop = document.createElement('div')
    pop.className = 'sidebar-ux-help-popover'
    pop.id = HELP_POPOVER_ID
    pop.setAttribute('role', 'tooltip')
    pop.setAttribute('hidden', '')
    const body = document.body
    if (!body || typeof body.appendChild !== 'function') return null
    body.appendChild(pop)
    _popover = pop
    return pop
  } catch {
    return null
  }
}

/** Fine-pointer (hover-capable) detection — hover opens only there. */
function isFinePointer(): boolean {
  try {
    return (
      typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches
    )
  } catch {
    return false
  }
}

function installDismiss(): void {
  if (_uninstallDismiss) return
  try {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
    const onPointerDown = (ev: Event) => {
      const target = ev.target as Node | null
      if (_anchor && target && typeof _anchor.contains === 'function' && _anchor.contains(target)) return
      if (_popover && target && typeof _popover.contains === 'function' && _popover.contains(target)) return
      closeHelp()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeHelp()
    }
    const onScrollOrResize = () => closeHelp()
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('scroll', onScrollOrResize, true)
      window.addEventListener('resize', onScrollOrResize)
    }
    _uninstallDismiss = () => {
      try {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKey, true)
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('scroll', onScrollOrResize, true)
          window.removeEventListener('resize', onScrollOrResize)
        }
      } catch {
        /* teardown race */
      }
    }
  } catch {
    /* stub document — no dismissal listeners */
  }
}

/** Position the popover next to its anchor (fixed coords, clamped). */
function positionPopover(anchor: HTMLElement, pop: HTMLElement): void {
  try {
    if (
      typeof anchor.getBoundingClientRect !== 'function'
      || typeof pop.getBoundingClientRect !== 'function'
    ) return
    const a = anchor.getBoundingClientRect()
    // Reveal for measurement, then hide again until placed.
    pop.hidden = false
    const p = pop.getBoundingClientRect()
    const vw = (typeof window !== 'undefined' && window.innerWidth) || 360
    const vh = (typeof window !== 'undefined' && window.innerHeight) || 640
    const gap = 8
    let top = a.top - p.height - gap
    if (top < gap) top = a.bottom + gap
    if (top + p.height > vh - gap) top = Math.max(gap, vh - p.height - gap)
    let left = a.left + a.width / 2 - p.width / 2
    left = Math.max(gap, Math.min(vw - p.width - gap, left))
    // Body-level popover under the host's `body > * { zoom: var(--lumiverse-ui-scale) }`
    // contract: rendered rects / inner* are rendered px, inline coords are
    // layout px. Divide by the UI scale, like start-menu / context-menu (N1).
    const uiScale = getUiScale()
    pop.style.position = 'fixed'
    pop.style.top = `${Math.round(top / uiScale)}px`
    pop.style.left = `${Math.round(left / uiScale)}px`
  } catch {
    /* geometry unavailable (test stub) — popover stays at default position */
  }
}

function openHelp(anchor: HTMLElement, text: string): void {
  if (_closeTimer) {
    clearTimeout(_closeTimer)
    _closeTimer = null
  }
  if (_anchor && _anchor !== anchor) closeHelp()
  const pop = ensurePopover()
  if (!pop) return
  _anchor = anchor
  _open = true
  pop.textContent = text
  pop.hidden = false
  try {
    pop.removeAttribute?.('hidden')
  } catch {
    /* stub */
  }
  anchor.setAttribute('aria-expanded', 'true')
  anchor.setAttribute('aria-describedby', HELP_POPOVER_ID)
  positionPopover(anchor, pop)
  installDismiss()
}

function closeHelp(): void {
  if (!_open && !_anchor) return
  _open = false
  _openedByFocus = false
  const anchor = _anchor
  const pop = _popover
  _anchor = null
  if (pop) {
    pop.hidden = true
    try {
      pop.setAttribute?.('hidden', '')
    } catch {
      /* stub */
    }
  }
  if (anchor) {
    anchor.setAttribute('aria-expanded', 'false')
    try {
      anchor.removeAttribute?.('aria-describedby')
    } catch {
      /* stub */
    }
  }
  if (_uninstallDismiss) {
    _uninstallDismiss()
    _uninstallDismiss = null
  }
}

/** Remove the popover + listeners (panel remount / extension disable). */
export function disposeHelpLayer(): void {
  closeHelp()
  if (_closeTimer) {
    clearTimeout(_closeTimer)
    _closeTimer = null
  }
  if (_popover) {
    try {
      _popover.remove?.()
      _popover.parentElement?.removeChild?.(_popover)
    } catch {
      /* stub */
    }
    _popover = null
  }
}

/** Test/inspection hook: the live popover element (null before first open). */
export function getHelpPopover(): HTMLElement | null {
  return _popover
}

/**
 * Re-render the open popover from its anchor's live hint getter. The panel
 * refresh calls this so dynamic lock reasons update while the popover is open
 * (L2 2026-09-19).
 */
export function refreshHelpPopover(): void {
  if (!_open || !_anchor || !_popover) return
  const get = _tipGetters.get(_anchor)
  if (!get) return
  const next = get()
  if (_popover.textContent !== next) _popover.textContent = next
}

/**
 * Build the small `?` help button. `getText` is read at open time so dynamic
 * lock reasons (updated by the panel refresh) are always current.
 */
export function buildHelpTip(label: string, getText: () => string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'sidebar-ux-panel-help'
  btn.setAttribute('aria-label', `More info: ${label}`)
  btn.setAttribute('aria-expanded', 'false')
  btn.textContent = '?'

  const open = () => openHelp(btn, getText())
  _tipGetters.set(btn, getText)
  btn.addEventListener('click', (ev: Event) => {
    ev.preventDefault?.()
    ev.stopPropagation?.()
    if (_open && _anchor === btn) {
      // Coarse-pointer taps focus the button (opening the popover) before the
      // click lands; treat that click as "keep open" so a single tap works.
      // A second tap fires no new focus event and closes normally (M4).
      if (_openedByFocus) {
        _openedByFocus = false
        return
      }
      closeHelp()
    } else {
      _openedByFocus = false
      open()
    }
  })
  btn.addEventListener('pointerenter', () => {
    if (isFinePointer()) open()
  })
  btn.addEventListener('pointerleave', () => {
    if (!isFinePointer()) return
    if (_anchor !== btn) return
    if (_closeTimer) clearTimeout(_closeTimer)
    _closeTimer = setTimeout(() => {
      _closeTimer = null
      if (_anchor === btn) closeHelp()
    }, 75)
  })
  btn.addEventListener('focus', () => {
    _openedByFocus = true
    open()
  })
  btn.addEventListener('blur', () => {
    if (_anchor === btn) closeHelp()
  })
  btn.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeHelp()
  })
  return btn
}

// ── Setting row ──────────────────────────────────────────────────────────────

export interface SettingRowHandle {
  /** The row element to append. */
  row: HTMLElement
  /** Update the tooltip/hint text (dynamic lock reasons). */
  setHint: (text: string) => void
  /** Toggle the disabled visual + control disabled state where applicable. */
  setDisabled: (disabled: boolean) => void
}

/**
 * Render a single setting row: label + `?` tooltip on the left, control on
 * the right. The hint text lives in a hidden `.sidebar-ux-panel-row-hint`
 * element (the popover's source; kept for dynamic updates + tests).
 */
export function buildSettingRow(args: {
  label: string
  hint?: string
  control: HTMLElement
  disabled?: boolean
  /**
   * Stack the control under the label instead of beside it — the host
   * SettingsModal `.field` layout (Chat → Content Width). Every segmented row
   * opts in so its buttons take the full panel width.
   */
  stacked?: boolean
}): SettingRowHandle {
  const row = document.createElement('div')
  row.className = 'sidebar-ux-panel-row'
  if (args.stacked) row.classList.add('sidebar-ux-panel-row-stacked')
  if (args.disabled) row.classList.add('sidebar-ux-panel-row-disabled')

  const text = document.createElement('div')
  text.className = 'sidebar-ux-panel-row-text'

  const head = document.createElement('div')
  head.className = 'sidebar-ux-panel-row-label-head'
  const label = document.createElement('div')
  label.className = 'sidebar-ux-panel-row-label'
  label.textContent = args.label
  head.appendChild(label)

  const hint = document.createElement('div')
  hint.className = 'sidebar-ux-panel-row-hint'
  hint.textContent = args.hint ?? ''
  hint.hidden = true

  head.appendChild(buildHelpTip(args.label, () => hint.textContent || ''))
  text.appendChild(head)
  text.appendChild(hint)

  row.appendChild(text)
  row.appendChild(args.control)

  return {
    row,
    setHint(next: string) {
      if (hint.textContent !== next) hint.textContent = next
    },
    setDisabled(disabled: boolean) {
      row.classList.toggle('sidebar-ux-panel-row-disabled', disabled)
      try {
        args.control.setAttribute?.('aria-disabled', String(disabled))
      } catch {
        /* stub control without attributes */
      }
      const control = args.control as { disabled?: boolean }
      if (typeof control.disabled === 'boolean') control.disabled = disabled
    },
  }
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /**
   * Optional trailing fragment that may be dropped visually when the panel is
   * too narrow to show `label` in full (e.g. " drawer" in "Left drawer").
   * The full `label` always remains the button's accessible name.
   */
  suffix?: string
}

export interface SegmentedControlHandle<T extends string> {
  /** The `role="radiogroup"` element to place in a setting row. */
  root: HTMLDivElement
  /** Re-sync the selected value + visual state (panel refresh path). */
  refresh: (value: T) => void
  /** Disable/enable every option (pre-hydration guard, locked rows). */
  setDisabled: (disabled: boolean) => void
  /** Disable/enable a single option by value (e.g. Sides on mobile). */
  setOptionDisabled: (value: T, disabled: boolean) => void
}

/**
 * Build a host-style segmented control (Lumiverse SettingsModal `.segmented`
 * visual language): `role="radiogroup"` with `role="radio"` options, active
 * option carries `aria-checked`. WAI-ARIA radio behaviour: Left/Right/Up/Down
 * arrows move selection (skipping disabled options).
 */
export function buildSegmentedControl<T extends string>(
  options: readonly SegmentedOption<T>[],
  value: T,
  onChange: (next: T) => void,
): SegmentedControlHandle<T> {
  const root = document.createElement('div')
  root.className = 'sidebar-ux-panel-segmented'
  root.setAttribute('role', 'radiogroup')

  let current = value
  let controlDisabled = false
  const optionDisabled = new Set<T>()
  const entries: Array<{ btn: HTMLButtonElement; value: T }> = []

  const render = () => {
    for (const { btn, value: v } of entries) {
      const active = v === current
      const disabled = controlDisabled || optionDisabled.has(v)
      btn.classList.toggle('sidebar-ux-panel-segmented-btn-active', active)
      btn.setAttribute('aria-checked', String(active))
      btn.disabled = disabled
      btn.setAttribute('aria-disabled', String(disabled))
      btn.tabIndex = active ? 0 : -1
    }
  }

  const select = (next: T) => {
    if (next === current) return
    current = next
    render()
    onChange(next)
  }

  options.forEach((opt, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'sidebar-ux-panel-segmented-btn'
    btn.setAttribute('role', 'radio')
    if (opt.suffix && opt.label.endsWith(opt.suffix)) {
      // Keep the visible stem as text and the droppable suffix in a span so a
      // narrow-panel container query can hide just the suffix
      // ("Left drawer" -> "Left") instead of ellipsizing the whole word.
      btn.setAttribute('aria-label', opt.label)
      btn.textContent = opt.label.slice(0, opt.label.length - opt.suffix.length)
      const suffixEl = document.createElement('span')
      suffixEl.className = 'sidebar-ux-panel-seg-label-suffix'
      suffixEl.textContent = opt.suffix
      btn.appendChild(suffixEl)
    } else {
      btn.textContent = opt.label
    }
    btn.addEventListener('click', () => {
      if (btn.disabled) return
      select(opt.value)
    })
    btn.addEventListener('keydown', (ev: KeyboardEvent) => {
      const forward = ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
      const backward = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
      if (!forward && !backward) return
      ev.preventDefault()
      const dir = forward ? 1 : -1
      let next = i
      for (let step = 0; step < options.length; step++) {
        next = (next + dir + options.length) % options.length
        const candidate = entries[next]
        if (!candidate || !candidate.btn.disabled) break
      }
      const target = entries[next]
      if (!target || target.btn.disabled) return
      target.btn.focus()
      select(target.value)
    })
    entries.push({ btn, value: opt.value })
    root.appendChild(btn)
  })

  render()

  return {
    root,
    refresh(next: T) {
      current = next
      render()
    },
    setDisabled(disabled: boolean) {
      controlDisabled = disabled
      render()
    },
    setOptionDisabled(value: T, disabled: boolean) {
      if (disabled) optionDisabled.add(value)
      else optionDisabled.delete(value)
      render()
    },
  }
}

// ── Mode tiles ───────────────────────────────────────────────────────────────

export interface ModeTileOption<T extends string> {
  value: T
  label: string
  caption?: string
  /** Raw SVG markup for the tile icon. */
  icon?: string
}

export interface TileGroupHandle<T extends string> {
  root: HTMLDivElement
  refresh: (value: T) => void
  setDisabled: (disabled: boolean) => void
}

/**
 * Large rectangular mode tiles (Vanilla / Taskbar / OS). Same WAI-ARIA radio
 * model as the segmented control; tiles add an icon + caption.
 */
export function buildTileGroup<T extends string>(
  options: readonly ModeTileOption<T>[],
  value: T,
  onChange: (next: T) => void,
  opts?: { allowReselect?: boolean },
): TileGroupHandle<T> {
  const root = document.createElement('div')
  root.className = 'sidebar-ux-panel-modes'
  root.setAttribute('role', 'radiogroup')

  let current = value
  const entries: Array<{ btn: HTMLButtonElement; value: T }> = []

  const render = () => {
    for (const { btn, value: v } of entries) {
      const active = v === current
      btn.classList.toggle('sidebar-ux-panel-mode-selected', active)
      btn.setAttribute('aria-checked', String(active))
      btn.tabIndex = active ? 0 : -1
    }
  }

  const select = (next: T) => {
    // Re-selecting the active tile is normally a no-op; callers that derive the
    // active tile from a projection (the mode tiles) can opt in so they get a
    // chance to reconcile stale stored fields (L1 2026-09-19).
    if (next === current && !opts?.allowReselect) return
    current = next
    render()
    onChange(next)
  }

  options.forEach((opt, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'sidebar-ux-panel-mode'
    btn.setAttribute('role', 'radio')
    btn.setAttribute('aria-label', opt.caption ? `${opt.label} — ${opt.caption}` : opt.label)

    if (opt.icon) {
      const icon = document.createElement('span')
      icon.className = 'sidebar-ux-panel-mode-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = opt.icon
      btn.appendChild(icon)
    }
    const title = document.createElement('span')
    title.className = 'sidebar-ux-panel-mode-title'
    title.textContent = opt.label
    btn.appendChild(title)
    if (opt.caption) {
      const caption = document.createElement('span')
      caption.className = 'sidebar-ux-panel-mode-caption'
      caption.textContent = opt.caption
      btn.appendChild(caption)
    }

    btn.addEventListener('click', () => {
      if (btn.disabled) return
      select(opt.value)
    })
    btn.addEventListener('keydown', (ev: KeyboardEvent) => {
      const forward = ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
      const backward = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
      if (!forward && !backward) return
      ev.preventDefault()
      const dir = forward ? 1 : -1
      let next = i
      for (let step = 0; step < options.length; step++) {
        next = (next + dir + options.length) % options.length
        const candidate = entries[next]
        if (!candidate || !candidate.btn.disabled) break
      }
      const target = entries[next]
      if (!target || target.btn.disabled) return
      target.btn.focus()
      select(target.value)
    })
    entries.push({ btn, value: opt.value })
    root.appendChild(btn)
  })

  render()

  return {
    root,
    refresh(next: T) {
      current = next
      render()
    },
    setDisabled(disabled: boolean) {
      for (const { btn } of entries) {
        btn.disabled = disabled
        btn.setAttribute('aria-disabled', String(disabled))
      }
    },
  }
}

/** Build a CSS-only toggle switch matching Lumiverse's Toggle.Switch look. */
export function buildToggleControl(value: boolean, onChange: (next: boolean) => void, disabled?: () => boolean): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'sidebar-ux-panel-toggle' + (value ? ' sidebar-ux-panel-toggle-on' : '')
  btn.setAttribute('role', 'switch')
  btn.setAttribute('aria-checked', String(value))
  const knob = document.createElement('span')
  knob.className = 'sidebar-ux-panel-toggle-knob'
  btn.appendChild(knob)
  btn.addEventListener('click', () => {
    if (disabled && disabled()) return
    // Read current state from the DOM rather than the closure-captured `value`
    // parameter. `value` is the build-time initial; refresh() updates
    // aria-checked whenever setSettings runs, so the DOM is the live source
    // of truth and the toggle can always flip both directions.
    const current = btn.getAttribute('aria-checked') === 'true'
    onChange(!current)
  })
  return btn
}
