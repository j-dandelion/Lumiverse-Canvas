// Canvas settings panel.
//
// Built once and mounted into Lumiverse's per-extension settings host
// (`[data-spindle-mount="settings_extensions"]`). The panel builds its DOM
// upfront and re-renders visual state in-place via a `refresh` closure
// registered through settings/state.setPanelRefresh — that closure is
// fired by setSettings (settings/state.ts) on every toggle change, so
// the panel always reflects the current getSettings() value without a
// full re-mount.
//
// Section structure:
//   - Chat (chatReflow, slashCommandsEnabled)
//   - Layout (persistDrawerOpenState, persistDrawerWidth)
//   - Drawers / Second drawer / Debug
//
// Tab-assignment persistence is always-on (built-in). The
// persistTabAssignments setting was removed from the settings panel
// and from the Layout section.
//
// All toggles call setSettings({ field: value }) from settings/state.ts.
// The "live-apply" effect chain runs through applySettings below.

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { getSettings, setSettings, setPanelRefresh, type FullCanvasSettings } from '../settings/state'
import { dlog, dwarn } from '../debug/log'
import { FEATURES } from '../features/registry'
import { injectStyles } from '../debug/styles'


// CSS class names are namespaced (sidebar-ux-*) to avoid colliding with
// Lumiverse's own CSS modules. The class definitions are injected once
// when the panel is first built.
import { buildSettingRow, buildToggleControl, buildShowLabelsControl } from './render'

// Captured SpindleFrontendContext from mountSettingsPanel. The live-apply
// dispatch path (settings/state.setSettings → applySettings) needs the
// ctx to feed feature.apply().
let _settingsPanelCtx: SpindleFrontendContext | null = null

const PANEL_STYLE_ID = 'sidebar-ux-panel-styles'


function injectPanelStyles() {
  injectStyles(PANEL_STYLE_ID, `
    .sidebar-ux-panel-root {
      font-family: var(--lumiverse-font-family, sans-serif);
      color: var(--lumiverse-text);
      padding: 4px 0 24px;
    }
    .sidebar-ux-panel-header {
      padding: 4px 0 12px;
      margin: 0;
    }
    .sidebar-ux-panel-header-title {
      margin: 0;
      font-size: calc(18px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      line-height: 1.2;
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-section {
      margin-top: 18px;
    }
    .sidebar-ux-panel-section-title {
      margin: 0 0 8px;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border);
      border-radius: 8px;
      background: var(--lumiverse-bg-050);
      margin-bottom: 6px;
      transition: opacity 0.15s ease;
    }
    .sidebar-ux-panel-row-disabled {
      opacity: 0.45;
    }
    .sidebar-ux-panel-row-text { flex: 1; min-width: 0; }
    .sidebar-ux-panel-row-label {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      line-height: 1.3;
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-row-hint {
      margin-top: 2px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.35;
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-toggle {
      flex-shrink: 0;
      position: relative;
      width: 36px;
      height: 20px;
      border-radius: 999px;
      background: var(--lumiverse-fill-strong, rgba(0,0,0,0.3));
      border: 1px solid var(--lumiverse-border);
      cursor: pointer;
      padding: 0;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .sidebar-ux-panel-toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--lumiverse-text);
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .sidebar-ux-panel-toggle-on {
      background: var(--lumiverse-primary);
      border-color: var(--lumiverse-primary);
    }
    .sidebar-ux-panel-toggle-on .sidebar-ux-panel-toggle-knob {
      transform: translateX(16px);
      background: white;
    }
    .sidebar-ux-panel-toggle:focus-visible {
      outline: 2px solid var(--lumiverse-primary);
      outline-offset: 2px;
    }
    .sidebar-ux-panel-segmented {
      display: inline-flex;
      flex-shrink: 0;
      border: 1px solid var(--lumiverse-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--lumiverse-fill, rgba(0,0,0,0.15));
    }
    .sidebar-ux-panel-segmented-btn {
      padding: 4px 10px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      font-family: inherit;
      color: var(--lumiverse-text-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .sidebar-ux-panel-segmented-btn:not(:last-child) {
      border-right: 1px solid var(--lumiverse-border);
    }
    .sidebar-ux-panel-segmented-btn-active {
      background: var(--lumiverse-primary);
      color: white;
    }
  `)
}

/**
 * Build the Canvas settings panel DOM. Pure — caller appends to a host.
 * The panel re-renders its visual state in-place via `refresh` after
 * each `setSettings` call, so the toggles always reflect the current
 * `getSettings()` value.
 */
function buildSettingsPanelDOM(): { root: HTMLElement; refresh: () => void } {
  injectPanelStyles()

  const root = document.createElement('div')
  root.className = 'sidebar-ux-panel-root'

  // --- Header ---
  const header = document.createElement('div')
  header.className = 'sidebar-ux-panel-header'
  const headerTitle = document.createElement('h2')
  headerTitle.className = 'sidebar-ux-panel-header-title'
  headerTitle.textContent = 'Canvas - Enhanced UI'
  header.appendChild(headerTitle)
  root.appendChild(header)

  // Each toggle is a small object that knows how to refresh its own visual
  // state. The buildToggleControl factory returns a button; the caller
  // wraps it in this helper to track it for re-rendering.
  const makeToggle = (
    getValue: () => boolean,
    setValue: (next: boolean) => void,
    opts: { disabled?: () => boolean } = {}
  ): { btn: HTMLButtonElement; refresh: () => void } => {
    const btn = buildToggleControl(getValue(), (next) => setValue(next), opts.disabled)
    const refresh = () => {
      const v = getValue()
      btn.classList.toggle('sidebar-ux-panel-toggle-on', v)
      btn.setAttribute('aria-checked', String(v))
    }
    return { btn, refresh }
  }

  // Section helper
  const section = (title: string) => {
    const sec = document.createElement('div')
    sec.className = 'sidebar-ux-panel-section'
    const h = document.createElement('h4')
    h.className = 'sidebar-ux-panel-section-title'
    h.textContent = title
    sec.appendChild(h)
    return sec
  }

  // --- Section: Chat ---
  const sec1 = section('Chat')

  const chat = makeToggle(
    () => getSettings().chatReflow,
    (v) => setSettings({ chatReflow: v })
  )
  sec1.appendChild(buildSettingRow({
    label: 'Center the chat in the visible area',
    hint: 'Shifts the chat column by the open-drawer widths so neither drawer covers it.',
    control: chat.btn,
  }))

  const slash = makeToggle(
    () => getSettings().slashCommandsEnabled,
    (v) => setSettings({ slashCommandsEnabled: v })
  )
  sec1.appendChild(buildSettingRow({
    label: 'Enable slash commands',
    hint: 'When on, typing / in the chat input opens the slash-command menu.',
    control: slash.btn,
  }))

  // --- Section: Layout ---
  const secLayout = section('Layout')

  const persistOpen = makeToggle(
    () => getSettings().persistDrawerOpenState,
    (v) => setSettings({ persistDrawerOpenState: v })
  )
  secLayout.appendChild(buildSettingRow({
    label: 'Remember drawer open/close state',
    hint: 'Persist drawer open/closed state (and active tab) across sessions.',
    control: persistOpen.btn,
  }))

  const persistWidth = makeToggle(
    () => getSettings().persistDrawerWidth,
    (v) => setSettings({ persistDrawerWidth: v })
  )
  secLayout.appendChild(buildSettingRow({
    label: 'Remember resized drawer width',
    hint: 'Persist drawer widths across sessions.',
    control: persistWidth.btn,
  }))

  // Note: "Remember tab assignments" was removed. Tab-assignment persistence
  // is always-on (built-in) — secondary tab assignments (+ activeTabId) are
  // always saved and restored across sessions. There is no user-facing toggle.

  // --- Section: Drawers ---
  const secSidebars = section('Drawers')

  const moveControlsToOuter = makeToggle(
    () => getSettings().moveControlsToOuterEdge,
    (v) => setSettings({ moveControlsToOuterEdge: v })
  )
  secSidebars.appendChild(buildSettingRow({
    label: 'Move tab controls to outer edge',
    hint: 'Moves the list of tab buttons to be along the edge of the screen instead of the edge of the chat area. Required for "Keep tab controls visible".',
    control: moveControlsToOuter.btn,
  }))

  const keepTabListVisible = makeToggle(
    () => getSettings().keepTabListVisible,
    (v) => setSettings({ keepTabListVisible: v }),
    { disabled: () => !getSettings().moveControlsToOuterEdge },
  )
  const keepTabListVisibleRow = buildSettingRow({
    label: 'Keep tab controls visible',
    hint: 'Pins tab buttons to the screen edge when a drawer is closed so you can switch tabs without opening it. Requires "Move tab controls to outer edge". Desktop only.',
    control: keepTabListVisible.btn,
    disabled: !getSettings().moveControlsToOuterEdge,
  })
  secSidebars.appendChild(keepTabListVisibleRow)

  const hideDrawerTabToggle = makeToggle(
    () => getSettings().hideDrawerOpenCloseButtons,
    (v) => setSettings({ hideDrawerOpenCloseButtons: v }),
    { disabled: () => !getSettings().keepTabListVisible },
  )
  const hideDrawerTabToggleRow = buildSettingRow({
    label: 'Hide drawer open/close buttons',
    hint: 'Hides the small button that open/closes the drawer. Requires "Keep tab controls visible".',
    control: hideDrawerTabToggle.btn,
    disabled: !getSettings().keepTabListVisible,
  })
  secSidebars.appendChild(hideDrawerTabToggleRow)

  const resizeSidebars = makeToggle(
    () => getSettings().resizeSidebars,
    (v) => setSettings({ resizeSidebars: v }),
    { disabled: () => !getSettings().secondSidebarEnabled }
  )
  secSidebars.appendChild(buildSettingRow({
    label: 'Drag to resize drawers',
    hint: 'Adds a 4px grab handle on the inner edge of both drawers.',
    control: resizeSidebars.btn,
    disabled: !getSettings().secondSidebarEnabled,
  }))

  const shadowsDesktop = makeToggle(
    () => getSettings().drawerShadowsDesktop,
    (v) => setSettings({ drawerShadowsDesktop: v })
  )
  secSidebars.appendChild(buildSettingRow({
    label: 'Drawer shadows (desktop)',
    hint: 'Show box-shadow on drawers when the viewport is wider than 600px.',
    control: shadowsDesktop.btn,
  }))

  const shadowsMobile = makeToggle(
    () => getSettings().drawerShadowsMobile,
    (v) => setSettings({ drawerShadowsMobile: v })
  )
  secSidebars.appendChild(buildSettingRow({
    label: 'Drawer shadows (mobile)',
    hint: 'Show box-shadow on drawers when the viewport is 600px or narrower.',
    control: shadowsMobile.btn,
  }))

  // --- Section: Second drawer ---
  const sec2 = section('Second drawer')

  const master = makeToggle(
    () => getSettings().secondSidebarEnabled,
    (v) => {
      // Use the central mode-toggle API which handles dirty confirm,
      // session profile capture, and feature lifecycle coordination.
      void import('./second-drawer-mode').then((m) => {
        m.requestSecondDrawerMode(v)
      }).catch((err) => {
        dwarn('[settings-panel] second-drawer-mode import failed:', err)
        // Fallback: direct setSettings if the module failed to load.
        setSettings({ secondSidebarEnabled: v })
      })
    }
  )
  sec2.appendChild(buildSettingRow({
    label: 'Enable second drawer',
    hint: 'Adds a second drawer to the opposite side of the main one. Master switch for all sub-features below.',
    control: master.btn,
  }))

  const compact = makeToggle(
    () => getSettings().mirrorCompactPosition,
    (v) => setSettings({ mirrorCompactPosition: v }),
    { disabled: () => !getSettings().secondSidebarEnabled }
  )
  sec2.appendChild(buildSettingRow({
    label: 'Mirror compact mode + vertical position',
    hint: "Matches the main drawer's compact/vertical tab position on the secondary drawer.",
    control: compact.btn,
    disabled: !getSettings().secondSidebarEnabled,
  }))

  // Tab labels — tri-state segmented control. We keep a reference so refresh
  // can rebuild the inner buttons (a segmented control needs DOM
  // replacement when the active value changes, since each button carries
  // its own click handler bound to the current value).
  let showLabelsWrap: HTMLElement
  let showLabelsRow: HTMLElement
  const buildShowLabelsSeg = () => buildShowLabelsControl(
    getSettings().showTabLabels,
    (v) => setSettings({ showTabLabels: v })
  )
  showLabelsWrap = buildShowLabelsSeg()
  showLabelsRow = buildSettingRow({
    label: 'Tab labels in the second drawer',
    hint: "\"Follow\" mirrors Lumiverse's main sidebar setting. \"Show\" / \"Hide\" override it.",
    control: showLabelsWrap,
    disabled: !getSettings().secondSidebarEnabled,
  })
  sec2.appendChild(showLabelsRow)

  // --- Section: Debug ---
  const sec4 = section('Debug')

  const debugMode = makeToggle(
    () => getSettings().debugMode,
    (v) => setSettings({ debugMode: v })
  )
  sec4.appendChild(buildSettingRow({
    label: 'Debug mode',
    hint: 'Enables [Canvas] console output and installs window.__canvasDebug() for in-browser fiber tree inspection. Useful when filing a bug report.',
    control: debugMode.btn,
  }))

  root.appendChild(sec1)
  root.appendChild(secLayout)
  root.appendChild(secSidebars)
  root.appendChild(sec2)
  root.appendChild(sec4)

  // Live-update wiring: setSettings calls this via the registered panel
  // refresh closure (setPanelRefresh in settings/state) so we don't have to
  // thread the refresh closure through every toggle's onChange.
  const refresh = () => {
    master.refresh()
    moveControlsToOuter.refresh()
    keepTabListVisible.refresh()
    hideDrawerTabToggle.refresh()
    resizeSidebars.refresh()
    compact.refresh()
    chat.refresh()
    persistOpen.refresh()
    persistWidth.refresh()
    slash.refresh()
    debugMode.refresh()
    shadowsDesktop.refresh()
    shadowsMobile.refresh()
    // keepTabListVisible requires moveControlsToOuterEdge (strip on screen edge).
    {
      const d = !getSettings().moveControlsToOuterEdge
      keepTabListVisible.btn.disabled = d
      keepTabListVisible.btn.style.cursor = d ? 'not-allowed' : 'pointer'
      keepTabListVisibleRow.classList.toggle('sidebar-ux-panel-row-disabled', d)
    }
    // hideDrawerOpenCloseButtons requires keepTabListVisible (reopen affordance).
    {
      const d = !getSettings().keepTabListVisible
      hideDrawerTabToggle.btn.disabled = d
      hideDrawerTabToggle.btn.style.cursor = d ? 'not-allowed' : 'pointer'
      hideDrawerTabToggleRow.classList.toggle('sidebar-ux-panel-row-disabled', d)
    }
    // Sub-features gated by the second-drawer master toggle.
    for (const row of [resizeSidebars, compact]) {
      const d = !getSettings().secondSidebarEnabled
      row.btn.disabled = d
      row.btn.style.cursor = d ? 'not-allowed' : 'pointer'
      ;(row.btn.parentElement as HTMLElement)?.classList.toggle('sidebar-ux-panel-row-disabled', d)
    }
    showLabelsRow.classList.toggle('sidebar-ux-panel-row-disabled', !getSettings().secondSidebarEnabled)
    // Rebuild the showTabLabels segmented control (each button captures the
    // current value in its handler).
    const newSeg = buildShowLabelsSeg()
    showLabelsWrap.replaceWith(newSeg)
    showLabelsWrap = newSeg
  }

  return { root, refresh }
}

/**
 * Mount the Canvas settings panel into Lumiverse's per-extension settings
 * host (`[data-spindle-mount="settings_extensions"]`). Called from setup()
 * once the ctx is available. The host is managed by the Spindle loader's
 * mount API; we just append our DOM to the root it returns.
 */
export function mountSettingsPanel(ctx: SpindleFrontendContext) {
  try {
    if (!ctx?.ui?.mount) {
      dwarn('mountSettingsPanel: ctx.ui.mount unavailable; settings panel will not be registered')
      return
    }
    _settingsPanelCtx = ctx
    const host = ctx.ui.mount('settings_extensions')
    if (!host) return
    // Clear any previous render so a re-mount (e.g. after extension reload)
    // doesn't stack panels.
    host.replaceChildren()
    const { root, refresh } = buildSettingsPanelDOM()
    host.appendChild(root)
    // Wire the panel's refresh closure so setSettings can drive in-place
    // re-rendering. Replaces the legacy window.__canvasPanelRefresh hook.
    setPanelRefresh(refresh)
    dlog('Settings panel mounted into data-spindle-mount="settings_extensions"')
  } catch (err) {
    dwarn('mountSettingsPanel failed:', err)
  }
}

/**
 * Diff previous and next settings, applying live effects for any that
 * changed. Idempotent: calling with prev === next is a no-op. The actual
 * per-setting logic lives in features/registry.ts — this function is just
 * the diff dispatcher.
 */
export function applySettings(prev: FullCanvasSettings, next: FullCanvasSettings): void {
  if (!_settingsPanelCtx) return
  for (const feature of FEATURES) {
    if (!feature.apply) continue
    if (prev[feature.id] === next[feature.id]) continue
    feature.apply(prev, next, _settingsPanelCtx)
  }
}
