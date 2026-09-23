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
// 2026-09-19 overhaul — section structure (mirrors the user-facing layout):
//   - Drawers / Taskbars (mode tiles + layout/side/mode + chrome + shadows)
//   - Layout (chat reflow, landing reflow, tab DnD, panel resize)
//   - Persistence (open state, drag-resize width)
//   - Misc (slash commands, debug)
//
// Every setting row carries a `?` help button; descriptions open in a
// body-level popover (render.ts) instead of always-visible hint text.
//
// Tab-assignment persistence is always-on (built-in). showTabLabels was
// removed — the second drawer always follows the host main-drawer
// showTabLabels setting.
//
// All toggles call setSettings({ field: value }) from settings/state.ts.
// The "live-apply" effect chain runs through applySettings below.

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import {
  getSettings,
  setSettings,
  setPanelRefresh,
  refreshSettingsPanel,
  isHorizontalStrip,
  isTaskbarModeEnabled,
  isSettingsHydrated,
  type FullCanvasSettings,
} from '../settings/state'
import { dlog, dwarn } from '../debug/log'
import { FEATURES } from '../features/registry'
import { injectStyles } from '../debug/styles'
import { displayChromeSide } from '../sidebar/chrome-sides'


// CSS class names are namespaced (sidebar-ux-*) to avoid colliding with
// Lumiverse's own CSS modules. The class definitions are injected once
// when the panel is first built.
import {
  buildSettingRow,
  buildToggleControl,
  buildSegmentedControl,
  buildTileGroup,
  buildHelpTip,
  disposeHelpLayer,
  refreshHelpPopover,
  type SettingRowHandle,
} from './render'

// ── Tooltip (help) text ──────────────────────────────────────────────────────
// Shown only in the `?` popover. Lock branches swap in the *_LOCK_HINT /
// *_INERT_HINT variants via row.setHint().

const MODE_TILES_HINT =
  'How much drawer chrome Canvas adds. Vanilla keeps the stock Lumiverse drawers; Taskbar pins tab strips to the screen edge; OS mode adds window controls and a Start menu.'
const DRAWER_LAYOUT_HINT =
  'Where the tab strips live. Top/Bottom pins a full-width strip to that viewport edge and turns Taskbar mode on automatically.'
const MAIN_SIDE_HINT =
  'Which screen edge the main drawer sits on. Mirrors Lumiverse → Display → Drawer side, and also changes with Configure Tabs → Swap drawer locations.'
const MAIN_SIDE_SWAP_HINT = 'Swapping drawer sides…'
const DRAWER_MODE_HINT =
  'Single = one drawer (the main one). Dual = a second drawer on the opposite side. Each mode keeps its own saved layout.'
const DRAWER_MODE_OS_MOBILE_HINT =
  'OS mode uses single-drawer mode on mobile. Disable OS mode to use the second drawer.'
const MIRROR_COMPACT_HINT =
  "Matches the main drawer's compact mode and vertical tab position on the second drawer."
const MIRROR_COMPACT_LOCK_HINT =
  'Requires the second drawer. Switch Drawer mode to Dual to use it.'
const MOVE_CONTROLS_HINT =
  'Puts the tab strip on the screen edge instead of the panel edge. Taskbar mode and Top/Bottom layouts switch this on automatically.'
const LOCATION_LOCK_HINT =
  'Locked while Drawer layout is Top or Bottom — the horizontal strip is already edge-anchored.'
const OS_MODE_TASKBAR_LOCK_HINT =
  'Locked while OS mode is on (window chrome needs the pinned strips). Disable OS mode to change this.'
const OPTIONS_LOCATION_HINT =
  'Which drawer shows the Settings gear. Left/Right are screen sides; if that side has no drawer open, the gear stays on the main drawer.'
const START_LOCATION_HINT =
  'OS mode only: which drawer shows the Start button. The Start menu always lists every window from both drawers.'
const START_LOCATION_LOCK_HINT =
  'Requires OS mode. Turn it on to choose where Start appears.'
const START_EDGE_HINT =
  'Top/Bottom only: pins Start to the outer (screen-edge) end of the tab strip. Off places it next to the tabs.'
const START_EDGE_INERT_HINT = 'Only applies when Drawer layout is Top or Bottom.'
const HIDE_BUTTONS_HINT =
  'Hides the small handle that opens/closes the drawer. Requires Taskbar mode.'
const HIDE_BUTTONS_INERT_HINT = 'Handles are always hidden while tabs are pinned to the top/bottom edge.'
const OS_WINDOW_CONTROLS_HINT =
  'On: the panel header shows – (minimize) and X (close). Off: only X, which minimizes — standard Lumiverse behavior. A window can still be closed from its tab button right-click/long-press menu.'
const OS_WINDOW_CONTROLS_LOCK_HINT = 'Requires OS mode. Turn it on to use it.'
const CORE_TABS_HIDDEN_HINT =
  'Unlocks the hide toggle for core tabs (Profile, Reasoning, Loom, …) in Configure Tabs. OS mode turns this on automatically: closing a core tab marks it hidden, with the Start menu as its return path.'
const CORE_TABS_HIDDEN_OS_LOCK_HINT = 'Required by OS mode. Disable OS mode to change.'
const SHADOWS_DESKTOP_HINT = 'Show box-shadow on drawers when the viewport is wider than 600px.'
const SHADOWS_MOBILE_HINT = 'Show box-shadow on drawers when the viewport is 600px or narrower.'
const CHAT_REFLOW_HINT =
  'Shifts the chat column by the open-drawer widths so neither drawer covers it.'
const WELCOME_REFLOW_HINT =
  'Shifts the landing page by the open-drawer widths so neither drawer covers it.'
const SLASH_HINT = 'When on, typing / in the chat input opens the slash-command menu.'
const PERSIST_OPEN_HINT = 'Persist drawer open/closed state (and active tab) across sessions.'
const PERSIST_WIDTH_HINT = 'Persist drawer widths across sessions.'
const DRAG_DROP_HINT =
  'Drag a tab button to reorder it within a drawer or move it to the other drawer (mouse: drag after a short move; touch: long-press). Desktop only (viewport wider than 600px); on mobile use Configure Tabs.'
const RESIZE_PANELS_HINT = 'Adds a 4px grab handle on the inner edge of both drawers.'
const DEBUG_HINT =
  'Enables [Canvas] console output and installs window.__canvasDebug() for in-browser fiber tree inspection. Useful when filing a bug report.'

// Captured SpindleFrontendContext from mountSettingsPanel. The live-apply
// dispatch path (settings/state.setSettings → applySettings) needs the
// ctx to feed feature.apply().
let _settingsPanelCtx: SpindleFrontendContext | null = null

/** Mobile viewport check local to this module (no sidebar/mobile-exclusion
 *  import — that module pulls the whole shell graph). */
function _isMobileViewportForPanel(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 600px)').matches
    )
  } catch {
    return false
  }
}

// ── Live drawer-side read (lazy store import) ────────────────────────────────
// A static import of ../store pulls drawer-observer + the DOM layer into the
// settings graph; the panel tests import this module with minimal stubs. The
// dynamic import resolves in production and kicks one refresh so the Main
// drawer side control shows the real side.

let _storeMod: typeof import('../store') | null = null
let _dispatchMod: typeof import('../recon/dispatch') | null = null
void import('../store')
  .then((m) => {
    _storeMod = m
    refreshSettingsPanel()
  })
  .catch(() => { /* store unavailable (stub env) */ })
void import('../recon/dispatch')
  .then((m) => {
    _dispatchMod = m
    refreshSettingsPanel()
  })
  .catch(() => { /* dispatch unavailable (stub env) */ })

function safeMainSide(): 'left' | 'right' {
  try {
    return _storeMod?.getMainDrawerSide() ?? 'right'
  } catch {
    return 'right'
  }
}

function safeMainSideOverride(): 'left' | 'right' | null {
  try {
    return _storeMod?.getMainDrawerSideOverride() ?? null
  } catch {
    return null
  }
}

/** True once the store module is available (Main drawer side is actionable). */
function isStoreReady(): boolean {
  return _storeMod !== null
}

/** True once the owned layout model exists (a swap can converge). */
function isModelReady(): boolean {
  try {
    return _dispatchMod?.getModel() != null
  } catch {
    return false
  }
}

const PANEL_STYLE_ID = 'sidebar-ux-panel-styles'

function injectPanelStyles() {
  injectStyles(PANEL_STYLE_ID, `
    .sidebar-ux-panel-root {
      font-family: var(--lumiverse-font-family, sans-serif);
      color: var(--lumiverse-text);
      padding: 2px 0 10px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      min-width: 0;
    }
    .sidebar-ux-panel-header {
      padding: 2px 0 0;
      margin: 0;
    }
    .sidebar-ux-panel-header-title {
      margin: 0;
      font-size: calc(17px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      line-height: 1.2;
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-header-sub {
      margin-top: 3px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.4;
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-section { min-width: 0; }
    .sidebar-ux-panel-section-title {
      margin: 0 0 8px 2px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-group {
      border: 1px solid var(--lumiverse-border-subtle, var(--lumiverse-border));
      border-radius: var(--lumiverse-radius-md, 10px);
      background: color-mix(in srgb, var(--lumiverse-text) 2.5%, transparent);
      overflow: hidden;
    }
    .sidebar-ux-panel-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 11px 13px;
      min-width: 0;
      transition: background 0.15s ease, opacity 0.15s ease;
    }
    .sidebar-ux-panel-row + .sidebar-ux-panel-row {
      border-top: 1px solid var(--lumiverse-border-subtle, var(--lumiverse-border));
    }
    .sidebar-ux-panel-row:hover {
      background: color-mix(in srgb, var(--lumiverse-text) 2%, transparent);
    }
    .sidebar-ux-panel-row-disabled { opacity: 0.45; }
    .sidebar-ux-panel-row-text { flex: 1 1 auto; min-width: 0; }
    .sidebar-ux-panel-row-label-head {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .sidebar-ux-panel-row-label {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      line-height: 1.3;
      color: var(--lumiverse-text);
    }
    /* Hint text is the popover's source only — never painted inline. */
    .sidebar-ux-panel-row-hint { display: none; }
    /* Sub-rows (second-drawer / OS-scoped options) read as children of the
       row above them. */
    .sidebar-ux-panel-sub {
      padding-left: 26px;
      position: relative;
    }
    .sidebar-ux-panel-sub::before {
      content: '';
      position: absolute;
      left: 12px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--lumiverse-primary-020);
    }
    /* Help button */
    .sidebar-ux-panel-help {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--lumiverse-border);
      border-radius: 50%;
      background: transparent;
      color: var(--lumiverse-text-dim, var(--lumiverse-text-muted));
      font-size: calc(10px * var(--lumiverse-font-scale, 1));
      font-weight: 700;
      line-height: 1;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .sidebar-ux-panel-help:hover,
    .sidebar-ux-panel-help[aria-expanded="true"] {
      border-color: var(--lumiverse-primary);
      background: var(--lumiverse-primary-020);
      color: var(--lumiverse-primary);
    }
    .sidebar-ux-panel-help:focus-visible {
      outline: 2px solid var(--lumiverse-primary);
      outline-offset: 2px;
    }
    /* Mode tiles */
    .sidebar-ux-panel-modes-wrap {
      position: relative;
    }
    .sidebar-ux-panel-modes-help {
      position: absolute;
      top: 8px;
      right: 8px;
    }
    .sidebar-ux-panel-modes {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 12px 13px 10px;
      margin-bottom: 0;
    }
    .sidebar-ux-panel-mode {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      min-height: 68px;
      padding: 10px 8px;
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius-md, 10px);
      background: var(--lumiverse-fill-subtle, rgba(0,0,0,0.15));
      color: var(--lumiverse-text-muted);
      cursor: pointer;
      text-align: center;
      font-family: inherit;
      transition: all 0.15s ease;
      position: relative;
    }
    .sidebar-ux-panel-mode:hover:not(:disabled) {
      border-color: var(--lumiverse-border-hover);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-mode-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: currentColor;
    }
    .sidebar-ux-panel-mode-icon svg { width: 18px; height: 18px; }
    .sidebar-ux-panel-mode-title {
      font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      line-height: 1.2;
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-mode-caption {
      font-size: calc(10.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.25;
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-mode-selected {
      border-color: var(--lumiverse-primary);
      background: var(--lumiverse-primary-020);
      color: var(--lumiverse-primary);
    }
    .sidebar-ux-panel-mode-selected .sidebar-ux-panel-mode-title {
      color: var(--lumiverse-primary);
    }
    .sidebar-ux-panel-mode-selected::after {
      content: '';
      position: absolute;
      top: 7px;
      right: 7px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--lumiverse-primary);
    }
    .sidebar-ux-panel-mode:focus-visible {
      outline: 2px solid var(--lumiverse-primary);
      outline-offset: 2px;
    }
    .sidebar-ux-panel-mode:disabled { opacity: 0.5; cursor: not-allowed; }
    /* Toggle */
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
      transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.15s ease;
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
    /* Host-style segmented control (Lumiverse SettingsModal .segmented). */
    .sidebar-ux-panel-segmented {
      display: flex;
      flex-shrink: 0;
      min-width: 150px;
      max-width: 100%;
      border-radius: 8px;
      background: var(--lumiverse-fill-subtle, rgba(0,0,0,0.15));
      border: 1px solid var(--lumiverse-border);
      overflow: hidden;
    }
    .sidebar-ux-panel-segmented-btn {
      flex: 1 1 0;
      padding: 7px 10px;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      font-family: inherit;
      text-align: center;
      white-space: nowrap;
      color: var(--lumiverse-text-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .sidebar-ux-panel-segmented-btn:not(:last-child) {
      border-right: 1px solid var(--lumiverse-border);
    }
    .sidebar-ux-panel-segmented-btn:hover:not(:disabled) {
      color: var(--lumiverse-text);
      background: var(--lumiverse-fill-subtle, rgba(0,0,0,0.15));
    }
    .sidebar-ux-panel-segmented-btn-active {
      background: var(--lumiverse-primary-020, rgba(255,255,255,0.08));
      color: var(--lumiverse-primary);
    }
    .sidebar-ux-panel-segmented-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .sidebar-ux-panel-segmented-btn:focus-visible {
      outline: 2px solid var(--lumiverse-primary);
      outline-offset: -2px;
    }
    /* Help popover (body-level, fixed) */
    .sidebar-ux-help-popover {
      position: fixed;
      z-index: 10050;
      max-width: 260px;
      padding: 8px 10px;
      border: 1px solid var(--lumiverse-border);
      border-radius: 10px;
      background: var(--lumiverse-bg-elevated, var(--lumiverse-bg-opaque, var(--lumiverse-surface, #1a1a1e)));
      color: var(--lumiverse-text);
      box-shadow: var(--lumiverse-shadow-md, 0 8px 24px rgba(0,0,0,0.4));
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      line-height: 1.45;
      animation: sidebar-ux-help-in 120ms ease;
    }
    [data-glass] .sidebar-ux-help-popover {
      background: var(--lcs-glass-bg, var(--lumiverse-bg-elevated, #1a1a1e));
      backdrop-filter: blur(var(--lcs-glass-blur, 12px));
    }
    @keyframes sidebar-ux-help-in {
      from { opacity: 0; transform: translateY(2px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .sidebar-ux-help-popover { animation: none; }
      .sidebar-ux-panel-row,
      .sidebar-ux-panel-toggle,
      .sidebar-ux-panel-toggle-knob,
      .sidebar-ux-panel-mode,
      .sidebar-ux-panel-help { transition: none; }
    }
    /* Narrow layouts: stack the control under the label. */
    @media (max-width: 600px), (pointer: coarse) {
      .sidebar-ux-panel-row {
        flex-direction: column;
        align-items: stretch;
        gap: 9px;
      }
      .sidebar-ux-panel-row > .sidebar-ux-panel-segmented { min-width: 0; width: 100%; }
      .sidebar-ux-panel-row > .sidebar-ux-panel-toggle { align-self: flex-end; }
      .sidebar-ux-panel-help { width: 20px; height: 20px; }
      .sidebar-ux-panel-mode-caption { display: none; }
      .sidebar-ux-panel-sub { padding-left: 22px; }
      .sidebar-ux-panel-sub::before { left: 9px; }
    }
  `)
}

interface ModeTileDef {
  value: 'vanilla' | 'taskbar' | 'os'
  label: string
  caption: string
  icon: string
}

const MODE_TILE_DEFS: readonly ModeTileDef[] = [
  {
    value: 'vanilla',
    label: 'Vanilla mode',
    caption: 'Stock Lumiverse drawers',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="2"/><rect x="14" y="4" width="7" height="16" rx="2"/></svg>',
  },
  {
    value: 'taskbar',
    label: 'Taskbar mode',
    caption: 'Strips pinned to the edge',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 6.5h.01"/></svg>',
  },
  {
    value: 'os',
    label: 'OS mode',
    caption: 'Windows + Start menu',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18"/><path d="M6 6h.01"/><path d="M9 6h.01"/><path d="M9 16h6"/></svg>',
  },
]

/**
 * Build the Canvas settings panel DOM. Pure — caller appends to a host.
 * The panel re-renders its visual state in-place via `refresh` after
 * each `setSettings` call, so the controls always reflect the current
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
  const headerSub = document.createElement('div')
  headerSub.className = 'sidebar-ux-panel-header-sub'
  headerSub.textContent = 'Drawers, taskbars, and layout — applied live.'
  header.appendChild(headerSub)
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

  // Section helper: title + one grouped container (hairline-separated rows).
  const section = (title: string): { sec: HTMLElement; group: HTMLElement } => {
    const sec = document.createElement('div')
    sec.className = 'sidebar-ux-panel-section'
    const h = document.createElement('h4')
    h.className = 'sidebar-ux-panel-section-title'
    h.textContent = title
    sec.appendChild(h)
    const group = document.createElement('div')
    group.className = 'sidebar-ux-panel-group'
    sec.appendChild(group)
    return { sec, group }
  }

  const appendRow = (group: HTMLElement, handle: SettingRowHandle, sub = false): SettingRowHandle => {
    if (sub) handle.row.classList.add('sidebar-ux-panel-sub')
    group.appendChild(handle.row)
    return handle
  }

  // --- Section: Drawers / Taskbars ---
  const drawers = section('Drawers / Taskbars')

  // Mode tiles: Vanilla / Taskbar / OS. Selecting is a preset write; the
  // effective state is derived (osMode → OS; taskbar+outer → Taskbar).
  const effectiveMode = (): ModeTileDef['value'] => {
    const s = getSettings()
    if (s.osMode) return 'os'
    return isTaskbarModeEnabled(s) ? 'taskbar' : 'vanilla'
  }
  const selectMode = (mode: ModeTileDef['value']): void => {
    // Fire-and-forget async (plan A7): tiles that will RESTORE a saved layout
    // slot guard the Configure Tabs dirty draft first; on cancel the tile
    // snaps back via refreshSettingsPanel(). NEVER a static import of
    // os-mode/second-drawer-mode from here (panel tests mock
    // features/registry to avoid loading that graph).
    void (async () => {
      if (mode === effectiveMode()) {
        if (mode !== 'vanilla') return
        // Stale taskbarMode with the outer-edge toggle off derives as Vanilla;
        // clicking Vanilla must still clear it or re-enabling the edge
        // resurrects Taskbar mode (L1 2026-09-19).
        if (!getSettings().taskbarMode) return
      }
      // A7 dirty guard: entering/leaving OS restores that side's saved slot
      // (shape-only check — the dialog appearing one keystroke early is safe).
      const wasOs = getSettings().osMode
      if (wasOs || mode === 'os') {
        try {
          const om = await import('../os/os-mode')
          const willRestore = mode === 'os'
            ? om.osEntrySlotHasTabs()
            : om.osExitSlotHasTabs()
          if (willRestore) {
            const sdm = await import('./second-drawer-mode')
            const choice = await sdm.guardConfigureDirty()
            if (choice === 'cancel') {
              refreshSettingsPanel() // tile snaps back (re-derive)
              return
            }
          }
        } catch (err) {
          // Guard contract: any throw → proceed (never block the toggle).
          dwarn('[settings-panel] mode dirty guard failed:', err)
        }
      }
      if (mode === 'os') {
        setSettings({ osMode: true })
        return
      }
      if (mode === 'taskbar') {
        // One combined patch: the sidesChromePrefs record branch runs before
        // the OS-disable restore, so the explicit taskbar pair survives.
        setSettings({ osMode: false, taskbarMode: true, moveControlsToOuterEdge: true })
        return
      }
      // Vanilla: auto-return a Top/Bottom layout to Sides (D5) and clear all
      // chrome; `chromeTouched` records the new Sides preference first.
      setSettings({
        drawerLocation: 'sides',
        osMode: false,
        taskbarMode: false,
        moveControlsToOuterEdge: false,
      })
    })()
  }
  const modes = buildTileGroup(
    MODE_TILE_DEFS,
    effectiveMode(),
    (v) => selectMode(v),
    // Re-clicking the derived-active tile must reach selectMode so a stale
    // stored taskbarMode (outer edge off) can be cleared (L1 2026-09-19).
    { allowReselect: true },
  )
  modes.root.setAttribute('aria-label', 'Drawer chrome mode')
  // The tiles are the most complex control in the panel; give them the same
  // `?` affordance as every row. The button sits OUTSIDE the radiogroup so
  // the ARIA model stays valid (L5 2026-09-19).
  {
    const modesWrap = document.createElement('div')
    modesWrap.className = 'sidebar-ux-panel-modes-wrap'
    modesWrap.appendChild(modes.root)
    const modesHelp = buildHelpTip('Chrome mode', () => MODE_TILES_HINT)
    modesHelp.classList.add('sidebar-ux-panel-modes-help')
    modesWrap.appendChild(modesHelp)
    drawers.group.appendChild(modesWrap)
  }

  // Drawer layout (was "Drawer location").
  const drawerLocation = buildSegmentedControl(
    [
      { value: 'sides' as const, label: 'Sides' },
      { value: 'top' as const, label: 'Top' },
      { value: 'bottom' as const, label: 'Bottom' },
    ],
    getSettings().drawerLocation,
    (v) => setSettings({ drawerLocation: v }),
  )
  drawerLocation.root.setAttribute('aria-label', 'Drawer layout')
  const drawerLocationRow = appendRow(drawers.group, buildSettingRow({
    label: 'Drawer layout',
    hint: DRAWER_LAYOUT_HINT,
    control: drawerLocation.root,
  }))

  // Main drawer side (mirrors the host Display setting; live-derived).
  const mainSide = buildSegmentedControl(
    [
      { value: 'left' as const, label: 'Left' },
      { value: 'right' as const, label: 'Right' },
    ],
    safeMainSide(),
    (v) => {
      // Optimistic display; the real refresh rides the shell side change.
      mainSide.refresh(v)
      void (async () => {
        try {
          const m = _dispatchMod ?? (await import('../recon/dispatch'))
          _dispatchMod = m
          const model = m.getModel()
          if (!model || model.side === v) return
          await m.dispatch({ t: 'swapSides' })
        } catch (err) {
          dwarn('[settings-panel] swap drawer side failed:', err)
          // Revert the optimistic selection: the swap never happened (L3).
          refreshSettingsPanel()
        }
      })()
    },
  )
  mainSide.root.setAttribute('aria-label', 'Main drawer side')
  const mainSideRow = appendRow(drawers.group, buildSettingRow({
    label: 'Main drawer side',
    hint: MAIN_SIDE_HINT,
    control: mainSide.root,
  }))

  // Drawer mode (was "Enable second drawer" master toggle).
  const drawerMode = buildSegmentedControl(
    [
      { value: 'single' as const, label: 'Single' },
      { value: 'dual' as const, label: 'Dual' },
    ],
    getSettings().secondSidebarEnabled ? 'dual' : 'single',
    (v) => {
      // Central mode API: dirty confirm, session profile capture, slot
      // orchestration. Never a plain setSettings.
      void import('./second-drawer-mode')
        .then((m) => m.requestSecondDrawerMode(v === 'dual'))
        .catch((err) => {
          dwarn('[settings-panel] second-drawer-mode import failed:', err)
          setSettings({ secondSidebarEnabled: v === 'dual' })
        })
        // A cancelled dirty confirm changes nothing, so the optimistic
        // selection must snap back to the stored value (M5 2026-09-19).
        .finally(() => { refreshSettingsPanel() })
    },
  )
  drawerMode.root.setAttribute('aria-label', 'Drawer mode')
  const drawerModeRow = appendRow(drawers.group, buildSettingRow({
    label: 'Drawer mode',
    hint: DRAWER_MODE_HINT,
    control: drawerMode.root,
  }))

  const compact = makeToggle(
    () => getSettings().mirrorCompactPosition,
    (v) => setSettings({ mirrorCompactPosition: v }),
    { disabled: () => !getSettings().secondSidebarEnabled }
  )
  const compactRow = appendRow(drawers.group, buildSettingRow({
    label: 'Mirror compact mode + vertical position',
    hint: MIRROR_COMPACT_HINT,
    control: compact.btn,
    disabled: !getSettings().secondSidebarEnabled,
  }), true)

  const moveControlsToOuter = makeToggle(
    () => getSettings().moveControlsToOuterEdge,
    (v) => setSettings({ moveControlsToOuterEdge: v })
  )
  const moveControlsRow = appendRow(drawers.group, buildSettingRow({
    label: 'Move tab strip to outer edge',
    hint: MOVE_CONTROLS_HINT,
    control: moveControlsToOuter.btn,
  }))

  // Options button location (Settings gear per drawer).
  const optionsLocation = buildSegmentedControl(
    [
      { value: 'left' as const, label: 'Left drawer' },
      { value: 'right' as const, label: 'Right drawer' },
      { value: 'both' as const, label: 'Both' },
    ],
    displayChromeSide(getSettings().optionsButtonLocation, safeMainSide()),
    (v) => setSettings({ optionsButtonLocation: v }),
  )
  optionsLocation.root.setAttribute('aria-label', 'Options button location')
  optionsLocation.setDisabled(!isSettingsHydrated())
  const optionsLocationRow = appendRow(drawers.group, buildSettingRow({
    label: 'Options button location',
    hint: OPTIONS_LOCATION_HINT,
    control: optionsLocation.root,
  }))

  // Start button location (OS-mode launcher chrome).
  const startLocation = buildSegmentedControl(
    [
      { value: 'left' as const, label: 'Left drawer' },
      { value: 'right' as const, label: 'Right drawer' },
      { value: 'both' as const, label: 'Both' },
    ],
    displayChromeSide(getSettings().startButtonLocation, safeMainSide()),
    (v) => setSettings({ startButtonLocation: v }),
  )
  startLocation.root.setAttribute('aria-label', 'Start button location')
  const startLocationRow = appendRow(drawers.group, buildSettingRow({
    label: 'Start button location',
    hint: START_LOCATION_HINT,
    control: startLocation.root,
    disabled: !getSettings().osMode,
  }))

  const startEdge = makeToggle(
    () => getSettings().startButtonAlwaysOnScreenEdge,
    (v) => setSettings({ startButtonAlwaysOnScreenEdge: v })
  )
  const startEdgeRow = appendRow(drawers.group, buildSettingRow({
    label: 'Start button always on screen edge',
    hint: START_EDGE_HINT,
    control: startEdge.btn,
    disabled: !isHorizontalStrip(),
  }), true)

  const hideDrawerTabToggle = makeToggle(
    () => getSettings().hideDrawerOpenCloseButtons,
    (v) => setSettings({ hideDrawerOpenCloseButtons: v }),
    { disabled: () => !getSettings().taskbarMode },
  )
  const hideDrawerTabToggleRow = appendRow(drawers.group, buildSettingRow({
    label: 'Hide drawer open/close buttons',
    hint: HIDE_BUTTONS_HINT,
    control: hideDrawerTabToggle.btn,
    disabled: !getSettings().taskbarMode,
  }))

  const osWindowControls = makeToggle(
    () => getSettings().osWindowControls,
    (v) => setSettings({ osWindowControls: v }),
    { disabled: () => !getSettings().osMode },
  )
  const osWindowControlsRow = appendRow(drawers.group, buildSettingRow({
    label: 'Separate minimize and close controls',
    hint: OS_WINDOW_CONTROLS_HINT,
    control: osWindowControls.btn,
    disabled: !getSettings().osMode,
  }))

  const coreTabsHidden = makeToggle(
    () => getSettings().coreTabsHidden,
    (v) => setSettings({ coreTabsHidden: v }),
    { disabled: () => !!getSettings().osMode },
  )
  const coreTabsHiddenRow = appendRow(drawers.group, buildSettingRow({
    label: 'Core tabs can be hidden',
    hint: CORE_TABS_HIDDEN_HINT,
    control: coreTabsHidden.btn,
  }))

  const shadowsDesktop = makeToggle(
    () => getSettings().drawerShadowsDesktop,
    (v) => setSettings({ drawerShadowsDesktop: v })
  )
  appendRow(drawers.group, buildSettingRow({
    label: 'Drawer shadows (desktop)',
    hint: SHADOWS_DESKTOP_HINT,
    control: shadowsDesktop.btn,
  }))

  const shadowsMobile = makeToggle(
    () => getSettings().drawerShadowsMobile,
    (v) => setSettings({ drawerShadowsMobile: v })
  )
  appendRow(drawers.group, buildSettingRow({
    label: 'Drawer shadows (mobile)',
    hint: SHADOWS_MOBILE_HINT,
    control: shadowsMobile.btn,
  }))

  root.appendChild(drawers.sec)

  // --- Section: Layout ---
  const layout = section('Layout')

  const chat = makeToggle(
    () => getSettings().chatReflow,
    (v) => setSettings({ chatReflow: v })
  )
  appendRow(layout.group, buildSettingRow({
    label: 'Center the chat in the visible area',
    hint: CHAT_REFLOW_HINT,
    control: chat.btn,
  }))

  const welcome = makeToggle(
    () => getSettings().welcomeReflow,
    (v) => setSettings({ welcomeReflow: v })
  )
  appendRow(layout.group, buildSettingRow({
    label: 'Center the landing page in the visible area',
    hint: WELCOME_REFLOW_HINT,
    control: welcome.btn,
  }))

  const dragAndDropDrawerTabs = makeToggle(
    () => getSettings().dragAndDropDrawerTabs,
    (v) => setSettings({ dragAndDropDrawerTabs: v }),
  )
  appendRow(layout.group, buildSettingRow({
    label: 'Drag and drop tabs',
    hint: DRAG_DROP_HINT,
    control: dragAndDropDrawerTabs.btn,
  }))

  const resizeSidebars = makeToggle(
    () => getSettings().resizeSidebars,
    (v) => setSettings({ resizeSidebars: v })
  )
  appendRow(layout.group, buildSettingRow({
    label: 'Drag to resize panels',
    hint: RESIZE_PANELS_HINT,
    control: resizeSidebars.btn,
  }))

  root.appendChild(layout.sec)

  // --- Section: Persistence ---
  const persistence = section('Persistence')

  const persistOpen = makeToggle(
    () => getSettings().persistDrawerOpenState,
    (v) => setSettings({ persistDrawerOpenState: v })
  )
  appendRow(persistence.group, buildSettingRow({
    label: 'Remember drawer open/close state',
    hint: PERSIST_OPEN_HINT,
    control: persistOpen.btn,
  }))

  const persistWidth = makeToggle(
    () => getSettings().persistDrawerWidth,
    (v) => setSettings({ persistDrawerWidth: v })
  )
  appendRow(persistence.group, buildSettingRow({
    label: 'Remember drag-to-resize',
    hint: PERSIST_WIDTH_HINT,
    control: persistWidth.btn,
  }))

  root.appendChild(persistence.sec)

  // --- Section: Misc ---
  const misc = section('Misc')

  const slash = makeToggle(
    () => getSettings().slashCommandsEnabled,
    (v) => setSettings({ slashCommandsEnabled: v })
  )
  appendRow(misc.group, buildSettingRow({
    label: 'Enable slash commands',
    hint: SLASH_HINT,
    control: slash.btn,
  }))

  const debugMode = makeToggle(
    () => getSettings().debugMode,
    (v) => setSettings({ debugMode: v })
  )
  appendRow(misc.group, buildSettingRow({
    label: 'Debug mode',
    hint: DEBUG_HINT,
    control: debugMode.btn,
  }))

  root.appendChild(misc.sec)

  // Live-update wiring: setSettings calls this via the registered panel
  // refresh closure (setPanelRefresh in settings/state) so we don't have to
  // thread the refresh closure through every toggle's onChange.
  const refresh = () => {
    compact.refresh()
    moveControlsToOuter.refresh()
    osWindowControls.refresh()
    coreTabsHidden.refresh()
    hideDrawerTabToggle.refresh()
    dragAndDropDrawerTabs.refresh()
    resizeSidebars.refresh()
    chat.refresh()
    welcome.refresh()
    persistOpen.refresh()
    persistWidth.refresh()
    slash.refresh()
    debugMode.refresh()
    shadowsDesktop.refresh()
    shadowsMobile.refresh()
    startEdge.refresh()

    const s = getSettings()

    // Mode tiles: effective preset + pre-hydration lock.
    modes.refresh(effectiveMode())
    modes.setDisabled(!isSettingsHydrated())

    // Drawer layout: sync selection; disabled while the settings load is in
    // flight (the load overwrites pre-hydration picks).
    drawerLocation.refresh(s.drawerLocation)
    drawerLocation.setDisabled(!isSettingsHydrated())
    drawerLocationRow.setDisabled(!isSettingsHydrated())

    // Main drawer side: live-derived from the host; locked until the store
    // module resolves and while a swap is mid-flight (override active).
    const override = safeMainSideOverride()
    mainSide.refresh(override ?? safeMainSide())
    const sideLocked = !isSettingsHydrated() || !isStoreReady() || !isModelReady() || override !== null
    mainSide.setDisabled(sideLocked)
    mainSideRow.setDisabled(sideLocked)
    mainSideRow.setHint(override !== null ? MAIN_SIDE_SWAP_HINT : MAIN_SIDE_HINT)

    // Drawer mode: single/dual; locked while OS mode runs on a mobile
    // viewport (os/os-mode.syncOsMobileDrawerMode forces single drawer there).
    drawerMode.refresh(s.secondSidebarEnabled ? 'dual' : 'single')
    const osMobile = !!s.osMode && _isMobileViewportForPanel()
    drawerMode.setDisabled(osMobile)
    drawerModeRow.setDisabled(osMobile)
    drawerModeRow.setHint(osMobile ? DRAWER_MODE_OS_MOBILE_HINT : DRAWER_MODE_HINT)

    // Mirror compact: gated by the second-drawer master toggle.
    {
      const d = !s.secondSidebarEnabled
      compact.btn.disabled = d
      compact.btn.style.cursor = d ? 'not-allowed' : 'pointer'
      compactRow.setDisabled(d)
      compactRow.setHint(d ? MIRROR_COMPACT_LOCK_HINT : MIRROR_COMPACT_HINT)
    }

    // Horizontal strip (Top/Bottom) locks the taskbar chrome rows on:
    // normalize forces moveControlsToOuterEdge + taskbarMode while active.
    const horizontal = isHorizontalStrip()

    // moveControlsToOuterEdge locked while horizontal, or while OS mode is on
    // (the OS invariant forces it on — inverse gate, spec §8).
    {
      const os = s.osMode
      const d = horizontal || os
      moveControlsToOuter.btn.disabled = d
      moveControlsToOuter.btn.style.cursor = d ? 'not-allowed' : 'pointer'
      moveControlsRow.setDisabled(d)
      moveControlsRow.setHint(
        horizontal ? LOCATION_LOCK_HINT : os ? OS_MODE_TASKBAR_LOCK_HINT : MOVE_CONTROLS_HINT,
      )
    }

    // Options button location: display the literal side (null shows the main
    // drawer's side); locked only during the settings load.
    optionsLocation.refresh(displayChromeSide(s.optionsButtonLocation, safeMainSide()))
    optionsLocation.setDisabled(!isSettingsHydrated())
    optionsLocationRow.setDisabled(!isSettingsHydrated())

    // Start button location: OS chrome only.
    {
      const d = !s.osMode
      startLocation.refresh(displayChromeSide(s.startButtonLocation, safeMainSide()))
      startLocation.setDisabled(d || !isSettingsHydrated())
      startLocationRow.setDisabled(d)
      startLocationRow.setHint(
        d ? START_LOCATION_LOCK_HINT : START_LOCATION_HINT,
      )
    }

    // Start edge anchor: Top/Bottom only (inert elsewhere, stored value kept).
    {
      const d = !horizontal
      startEdge.btn.disabled = d
      startEdge.btn.style.cursor = d ? 'not-allowed' : 'pointer'
      startEdgeRow.setDisabled(d)
      startEdgeRow.setHint(d ? START_EDGE_INERT_HINT : START_EDGE_HINT)
    }

    // coreTabsHidden: locked on while OS mode forces it (a closed window
    // must show as hidden in Configure Tabs). Off-OS the user controls it.
    {
      const os = !!s.osMode
      coreTabsHidden.btn.disabled = os
      coreTabsHidden.btn.style.cursor = os ? 'not-allowed' : 'pointer'
      coreTabsHiddenRow.setDisabled(os)
      coreTabsHiddenRow.setHint(os ? CORE_TABS_HIDDEN_OS_LOCK_HINT : CORE_TABS_HIDDEN_HINT)
    }

    // osWindowControls: panel-header chrome is OS chrome only — locked while
    // OS mode is off (there is no OS header without it).
    {
      const d = !s.osMode
      osWindowControls.btn.disabled = d
      osWindowControls.btn.style.cursor = d ? 'not-allowed' : 'pointer'
      osWindowControlsRow.setDisabled(d)
      osWindowControlsRow.setHint(d ? OS_WINDOW_CONTROLS_LOCK_HINT : OS_WINDOW_CONTROLS_HINT)
    }

    // hideDrawerOpenCloseButtons requires taskbarMode (S7: dragAndDropDrawerTabs
    // no longer does — toggle-only gate, see isDragAndDropDrawerTabsEnabled).
    // While horizontal the handles are hidden unconditionally, so the row is
    // rendered inert and checked regardless of the stored value.
    {
      if (horizontal) {
        hideDrawerTabToggle.btn.disabled = true
        hideDrawerTabToggle.btn.style.cursor = 'not-allowed'
        hideDrawerTabToggle.btn.classList.add('sidebar-ux-panel-toggle-on')
        hideDrawerTabToggle.btn.setAttribute('aria-checked', 'true')
        hideDrawerTabToggleRow.setDisabled(true)
        hideDrawerTabToggleRow.setHint(HIDE_BUTTONS_INERT_HINT)
      } else {
        const d = !s.taskbarMode
        hideDrawerTabToggle.btn.disabled = d
        hideDrawerTabToggle.btn.style.cursor = d ? 'not-allowed' : 'pointer'
        hideDrawerTabToggleRow.setDisabled(d)
        hideDrawerTabToggleRow.setHint(HIDE_BUTTONS_HINT)
      }
    }
  }

  // Keep an open `?` popover in sync with the lock text it is anchored to.
  refreshHelpPopover()

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
    // Drop any popover left by a previous mount before rebuilding (the
    // popover is a body-level singleton, outside the host's replaceChildren).
    disposeHelpLayer()
    // Clear any previous render so a re-mount (e.g. after extension reload)
    // doesn't stack panels.
    host.replaceChildren()
    const { root, refresh } = buildSettingsPanelDOM()
    host.appendChild(root)
    // Wire the panel's refresh closure so setSettings can drive in-place
    // re-rendering. Replaces the legacy window.__canvasPanelRefresh hook.
    setPanelRefresh(refresh)
    refresh()
    // Extension-disable cleanup for the body-level popover (lazy import: the
    // panel loads before the cleanup chain exists in some boot orders).
    void import('../sidebar/cleanup')
      .then((m) => m.registerCleanup(disposeHelpLayer))
      .catch(() => { /* cleanup module unavailable in tests */ })
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
    // One throwing feature must not starve the rest of the diff — or, via
    // setSettings' finally, the panel refresh and the save (N3 2026-09-19).
    try {
      feature.apply(prev, next, _settingsPanelCtx)
    } catch (err) {
      dwarn(`applySettings: feature ${String(feature.id)} apply threw:`, err)
    }
  }
}
