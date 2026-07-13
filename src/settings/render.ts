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
