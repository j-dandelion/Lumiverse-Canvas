// Canvas settings panel — DOM construction helpers.
//
// Pure rendering functions that build individual UI controls (toggle
// switches, setting rows). These don't depend on settings state; the
// caller wires onChange handlers.
//
// showTabLabels was removed from Canvas — the second drawer always
// follows the host main-drawer showTabLabels setting. The tri-state
// segmented control (buildShowLabelsControl) has been removed.

/**
 * Render a single setting row. `control` is the right-hand element
 * (toggle button, etc.) — caller builds it.
 */
export function buildSettingRow(args: {
  label: string
  hint?: string
  control: HTMLElement
  disabled?: boolean
}): HTMLElement {
  const row = document.createElement('div')
  row.className = 'sidebar-ux-panel-row'
  if (args.disabled) row.classList.add('sidebar-ux-panel-row-disabled')

  const text = document.createElement('div')
  text.className = 'sidebar-ux-panel-row-text'
  const label = document.createElement('div')
  label.className = 'sidebar-ux-panel-row-label'
  label.textContent = args.label
  text.appendChild(label)
  if (args.hint) {
    const hint = document.createElement('div')
    hint.className = 'sidebar-ux-panel-row-hint'
    hint.textContent = args.hint
    text.appendChild(hint)
  }

  row.appendChild(text)
  row.appendChild(args.control)
  return row
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlHandle<T extends string> {
  /** The `role="radiogroup"` element to place in a setting row. */
  root: HTMLDivElement
  /** Re-sync the selected value + visual state (panel refresh path). */
  refresh: (value: T) => void
  /** Disable/enable every option (pre-hydration guard, locked rows). */
  setDisabled: (disabled: boolean) => void
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
  const entries: Array<{ btn: HTMLButtonElement; value: T }> = []

  const render = () => {
    for (const { btn, value: v } of entries) {
      const active = v === current
      btn.classList.toggle('sidebar-ux-panel-segmented-btn-active', active)
      btn.setAttribute('aria-checked', String(active))
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
    btn.textContent = opt.label
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
