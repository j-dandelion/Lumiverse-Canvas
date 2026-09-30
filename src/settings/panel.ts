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
//   - Drawers / Taskbars (mode tiles + layout/side/mode + chrome/mirror + shadows)
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
import { setOsConfigureWillRestore } from '../os/os-configure-gate'

// L14: last-click-wins sequence for fire-and-forget selectMode. Each tile
// click bumps the token; a stale async continuation returns before writing.
let selectModeSeq = 0


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
  'Choose how much drawer UI Canvas adds. Vanilla keeps the stock Lumiverse drawers. Taskbar pins the tab strips to the screen edge, so tabs stay reachable even while the drawers are closed. OS mode gives every drawer a Start menu that lists every tab, plus minimize/close window controls.'
const DRAWER_LAYOUT_HINT =
  'Which screen edge the drawer tab strips sit on. Sides keeps a strip next to each drawer. Top or Bottom moves them into a single full-width strip and turns Taskbar mode on. On mobile, OS and Taskbar use the last Top/Bottom choice. Vanilla keeps its normal drawer handles and in-drawer tabs.'
const MAIN_SIDE_HINT =
  "Which side of the screen the main drawer opens from. It stays in sync with Lumiverse's own Display → Drawer side setting and with Configure Tabs → Swap drawer locations, so all three always agree."
const MAIN_SIDE_SWAP_HINT = 'Swapping drawer sides…'
const DRAWER_MODE_HINT =
  'Single shows one drawer, on one side of the screen. Dual adds a second drawer on the opposite side, with its own separate tabs. Each mode keeps its own saved layout, so switching back and forth restores what you had.'
const DRAWER_MODE_MOBILE_TASKBAR_HINT =
  'On phone-width screens, OS and Taskbar use only the main drawer. Choose Vanilla or a wider screen to use the second drawer.'
const MIRROR_COMPACT_HINT =
  "Matches the second drawer's open/close handle to the main drawer's size and vertical position, so the two line up. When off, the second drawer keeps its own handle size and position."
const MIRROR_COMPACT_LOCK_HINT =
  'Only available in Dual mode. Switch Drawer mode to Dual to turn this on.'
const MOVE_CONTROLS_HINT =
  'Moves the tab strip from the drawer panel out to the screen edge, so tabs stay visible even while the drawer is closed. Taskbar mode and Top/Bottom layouts switch this on automatically.'
const LOCATION_LOCK_HINT =
  'Locked while Drawer layout is Top or Bottom: the full-width strip already sits on the screen edge, so there is nothing to move.'
const OS_MODE_TASKBAR_LOCK_HINT =
  'Locked while OS mode is on, because its window controls need the pinned strips. Turn OS mode off to change this.'
const OPTIONS_LOCATION_HINT =
  'Which drawer shows the Settings gear button. Left and Right mean that side of the screen; if no drawer is open there, the gear stays on the main drawer instead. Both puts a gear in each drawer.'
const START_LOCATION_HINT =
  'Which drawer shows the Start button. The Start menu still lists every tab from both drawers, wherever the button lives.'
const START_LOCATION_LOCK_HINT =
  'Only used in OS mode. Turn OS mode on to choose where the Start button appears.'
const START_EDGE_HINT =
  'Top/Bottom layout only: keeps the Start button at the outer end of the strip, right on the screen edge. When off, Start sits next to the tab buttons instead.'
const START_EDGE_INERT_HINT =
  'Only applies to the Top/Bottom layout — the side strips have no outer end to anchor to.'
const START_STRIP_TOP_HINT =
  'Sides layout only: lifts the Start button to the top of the vertical tab strip, above the tabs. The Settings gear button stays at the bottom. When off, Start sits in the bottom dock.'
const START_STRIP_TOP_INERT_HINT =
  'Only applies to the Sides layout — the full-width strip has no separate top slot (use "Start button always on screen edge" there).'
const HIDE_BUTTONS_HINT =
  'Hides the small handle that opens and closes the drawer. Only available in Taskbar mode.'
const HIDE_BUTTONS_INERT_HINT =
  'Has no effect in the Top/Bottom layout: the full-width strip has no open/close handles, so they are always hidden there.'
const OS_WINDOW_CONTROLS_HINT =
  'On: every window header shows a minimize (–) and a close (X) button. Off: a single X button that minimizes, matching standard Lumiverse behavior. Either way you can close a window from its tab button’s right-click menu (long-press on touch).'
const OS_WINDOW_CONTROLS_LOCK_HINT = 'Only used in OS mode. Turn OS mode on to change this.'
const CORE_TABS_HIDDEN_HINT =
  'Lets you hide built-in tabs (Profile, Reasoning, Loom, and so on) from Configure Tabs. OS mode turns it on automatically, because closing a built-in tab there only hides it — bring it back any time from the Start menu.'
const CORE_TABS_HIDDEN_OS_LOCK_HINT = 'OS mode requires this on. Turn OS mode off to change it.'
const SHADOWS_DESKTOP_HINT =
  'Draws a soft shadow along the inner edge of open drawers on desktop-sized screens (wider than 600px), so they stand out from the page behind them.'
const SHADOWS_MOBILE_HINT =
  'Draws a soft shadow along the inner edge of open drawers on phone-sized screens (600px or narrower), so they stand out from the page behind them.'
const CHAT_REFLOW_HINT =
  'Nudges the chat column over by the width of any open drawer, so the conversation stays centered and no drawer covers it.'
const WELCOME_REFLOW_HINT =
  'Nudges the landing page over by the width of any open drawer, so your recent chats stay centered and no drawer covers them.'
const SLASH_HINT =
  'When on, typing / in the chat input opens the slash-command menu. Commands added by other extensions appear there too.'
const PERSIST_OPEN_HINT =
  'Remembers which drawers were open and which tab each one showed after a reload, so your layout comes back the way you left it.'
const PERSIST_WIDTH_HINT =
  'Remembers the width you dragged each drawer to after a reload, so panel sizes come back the way you left them.'
const DRAG_DROP_HINT =
  'Drag a tab button to reorder it or move it to the other drawer. Mouse: press and drag after a short move. Touch: press and hold, then drag. Available on desktop-sized screens (wider than 600px); on phones, use Configure Tabs instead.'
const RESIZE_PANELS_HINT =
  'Adds a thin grab bar to the inner edge of each drawer. Drag it to make the drawer wider or narrower.'
const DEBUG_HINT =
  'Writes [Canvas] messages to the browser console and enables window.__canvasDebug() for inspecting Canvas internals. Useful when reporting a bug — otherwise leave it off.'
const UNHIDE_VANILLA_TABS_HINT =
  "Keeps Lumiverse's hidden-tab list empty so Canvas can access every panel. Panels hidden in both places are unhidden in Canvas too; other Canvas-only Configure Tabs hides stay. Turning this off stops automatic un-hiding but does not re-hide panels already shown."

// Captured SpindleFrontendContext from mountSettingsPanel. The live-apply
// dispatch path (settings/state.setSettings → applySettings) needs the
// ctx to feed feature.apply().
let _settingsPanelCtx: SpindleFrontendContext | null = null

/** Release the setup context once the owning extension instance is torn down. */
export function clearSettingsPanelContext(): void {
  _settingsPanelCtx = null
}

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
      /* Width-true container: the drawer is drag-resizable at ANY viewport
         width, so viewport media queries alone cannot detect a narrow
         drawer (see the @container blocks at the end of the sheet). */
      container-type: inline-size;
      container-name: canvas-settings;
    }
    .sidebar-ux-panel-header {
      padding: 2px 0 0;
      margin: 0;
    }
    /* Host panel h2 (ProductivitySettings.module.css) — 16px/650. */
    .sidebar-ux-panel-header-title {
      margin: 0;
      font-size: calc(16px * var(--lumiverse-font-scale, 1));
      font-weight: 650;
      line-height: 1.2;
      color: var(--lumiverse-text);
    }
    /* Host .cardMeta / small — 11px text-dim. */
    .sidebar-ux-panel-header-sub {
      margin-top: 3px;
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      line-height: 1.4;
      color: var(--lumiverse-text-dim, var(--lumiverse-text-muted));
    }
    .sidebar-ux-panel-section { min-width: 0; }
    /* Host .subsectionTitle (SettingsModal.module.css) verbatim. */
    .sidebar-ux-panel-section-title {
      margin: 0 0 8px 2px;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--lumiverse-text-dim, var(--lumiverse-text-muted));
    }
    /* Trough-on-card: the Spindle extension shell card is already
       --lumiverse-fill-subtle, so groups step to --lumiverse-fill (host
       .segmented trough relationship) and the mode tiles stay fill-subtle
       to pop off the trough. */
    .sidebar-ux-panel-group {
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius, 10px);
      background: var(--lumiverse-fill, color-mix(in srgb, var(--lumiverse-text) 4%, transparent));
      overflow: hidden;
    }
    .sidebar-ux-panel-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 11px 13px;
      min-width: 0;
      transition: background var(--lumiverse-transition-fast, 150ms ease),
        opacity var(--lumiverse-transition-fast, 150ms ease);
    }
    .sidebar-ux-panel-row + .sidebar-ux-panel-row,
    .sidebar-ux-panel-modes-wrap + .sidebar-ux-panel-row {
      border-top: 1px solid var(--lumiverse-border);
    }
    .sidebar-ux-panel-row:hover {
      background: var(--lumiverse-fill-hover, var(--lumiverse-fill-subtle));
    }
    .sidebar-ux-panel-row-disabled { opacity: 0.55; }
    /* Inline rows (toggles): the label column takes only what it needs and
       may shrink (wrapping); it must NOT grow, or it would soak up the free
       space the control needs (that pushed controls against the right edge
       and clipped their longest option — "Bot…"). */
    .sidebar-ux-panel-row-text { flex: 0 1 auto; min-width: 0; }
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
    /* Help button */
    .sidebar-ux-panel-help {
      position: relative;
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
      transition: background var(--lumiverse-transition-fast, 150ms ease),
        border-color var(--lumiverse-transition-fast, 150ms ease),
        color var(--lumiverse-transition-fast, 150ms ease);
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
    /* Mode tiles — host .headerRow/.label (SpindleSettings) eyebrow + help
       line above the grid. (The old absolutely-positioned help chip sat on
       top of the selected tile's corner dot.) */
    .sidebar-ux-panel-modes-wrap { min-width: 0; }
    .sidebar-ux-panel-modes-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 13px 0;
    }
    .sidebar-ux-panel-modes-eyebrow {
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--lumiverse-text-dim, var(--lumiverse-text-muted));
    }
    .sidebar-ux-panel-modes {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 10px 13px 12px;
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
      transition: background var(--lumiverse-transition-fast, 150ms ease),
        border-color var(--lumiverse-transition-fast, 150ms ease),
        color var(--lumiverse-transition-fast, 150ms ease);
      position: relative;
    }
    .sidebar-ux-panel-mode:hover:not(:disabled) {
      border-color: var(--lumiverse-border-hover);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-panel-mode:not(.sidebar-ux-panel-mode-selected):active:not(:disabled) {
      background: var(--lumiverse-fill-hover, var(--lumiverse-fill-subtle));
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
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      line-height: 1.25;
      color: var(--lumiverse-text-dim, var(--lumiverse-text-muted));
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
    .sidebar-ux-panel-mode:disabled { opacity: 0.55; cursor: not-allowed; }
    /* Toggle — the one Canvas-invented binary control (unified spec shared
       with Configure Tabs): 36x20 border-box track, 14px knob inset 2px,
       16px travel. Knob colors: off = text on fill-strong, on =
       primary-contrast on primary (engine-emitted token — keep the #fff
       fallback). */
    .sidebar-ux-panel-toggle {
      flex-shrink: 0;
      position: relative;
      box-sizing: border-box;
      width: 36px;
      height: 20px;
      border-radius: 999px;
      background: var(--lumiverse-fill-strong, rgba(0,0,0,0.3));
      border: 1px solid var(--lumiverse-border);
      cursor: pointer;
      padding: 0;
      transition: background var(--lumiverse-transition-fast, 150ms ease),
        border-color var(--lumiverse-transition-fast, 150ms ease);
    }
    .sidebar-ux-panel-toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--lumiverse-text);
      transition: transform var(--lumiverse-transition-fast, 150ms ease),
        background var(--lumiverse-transition-fast, 150ms ease);
      transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .sidebar-ux-panel-toggle-on {
      background: var(--lumiverse-primary);
      border-color: var(--lumiverse-primary);
    }
    .sidebar-ux-panel-toggle-on .sidebar-ux-panel-toggle-knob {
      transform: translateX(16px);
      background: var(--lumiverse-primary-contrast, #fff);
    }
    .sidebar-ux-panel-toggle:focus-visible {
      outline: 2px solid var(--lumiverse-primary);
      outline-offset: 2px;
    }
    /* Segmented control — REVERTED to the pre-refinement Canvas skin by user
       preference (flat cells + hairline dividers, 12px/600, primary-020
       active). The host .segmented pill-in-trough parity is deliberately
       NOT applied here; only the motion token + ellipsis fallback are kept
       from the 2026-09-23 pass. Radiogroup semantics stay ours (render.ts).
       The control lives in STACKED rows since 2026-09-23d (label above, full
       width below), so every option gets the whole row width; the flex rules
       below keep it usable if it is ever placed inline again. */
    .sidebar-ux-panel-segmented {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      max-width: 100%;
      border-radius: 8px;
      background: var(--lumiverse-fill-subtle, rgba(0,0,0,0.15));
      border: 1px solid var(--lumiverse-border);
      overflow: hidden;
    }
    .sidebar-ux-panel-segmented-btn {
      flex: 1 1 0;
      min-width: 0;
      padding: 7px 10px;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      font-family: inherit;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--lumiverse-text-muted);
      background: transparent;
      border: 0;
      cursor: pointer;
      transition: background var(--lumiverse-transition-fast, 150ms ease),
        color var(--lumiverse-transition-fast, 150ms ease);
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
      opacity: 0.55;
      cursor: not-allowed;
    }
    .sidebar-ux-panel-segmented-btn:focus-visible {
      outline: 2px solid var(--lumiverse-primary);
      outline-offset: -2px;
    }
    /* Stacked segmented rows: label on top, control full width below — the
       host SettingsModal .field pattern (Chat → Content Width). Full-width
       buttons get real room for their longest option instead of sharing the
       row with the label column. The label takes the host .fieldLabel
       treatment (12px text-muted). Sits after the segmented base rules so
       the source pins keep matching the base block first. */
    .sidebar-ux-panel-row-stacked {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
    .sidebar-ux-panel-row-stacked .sidebar-ux-panel-row-label {
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-muted);
    }
    .sidebar-ux-panel-row-stacked > .sidebar-ux-panel-segmented {
      width: 100%;
      min-width: 0;
    }
    /* Help popover (body-level, fixed) */
    .sidebar-ux-help-popover {
      position: fixed;
      z-index: 10050;
      max-width: 260px;
      padding: 8px 10px;
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius-md, 10px);
      background: var(--lumiverse-bg-elevated, var(--lumiverse-surface, #1a1a1e));
      color: var(--lumiverse-text);
      box-shadow: var(--lumiverse-shadow-md, 0 8px 24px rgba(0,0,0,0.4));
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      line-height: 1.45;
      animation: sidebar-ux-help-in var(--lumiverse-transition-fast, 150ms ease);
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
      .sidebar-ux-panel-help,
      .sidebar-ux-panel-segmented,
      .sidebar-ux-panel-segmented-btn { transition: none; }
      .sidebar-ux-panel-toggle-knob { transition-timing-function: linear; }
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
      /* Invisible hit expanders: the 16/20px help chip and the 36x20
         toggle are under the 24px minimum target. Inset stays small so
         the expander cannot steal the neighboring row's hits and barely
         clips at group edges (overflow:hidden). */
      .sidebar-ux-panel-toggle::before,
      .sidebar-ux-panel-help::before {
        content: '';
        position: absolute;
        inset: -4px;
      }
    }
    /* Tile captions only drop on phone-width viewports — a coarse tablet
       in portrait still needs the mode differentiators. */
    @media (max-width: 420px) {
      .sidebar-ux-panel-mode-caption { display: none; }
    }
    /* Width-true narrow-panel layout. A viewport media query cannot see a
       narrow drawer on a wide screen, which left segmented controls squeezed
       to the right and ellipsized ("Left Draw…" / "Bot…"). When the PANEL is
       narrow, stack the control under its label and give segmented controls
       the full row width. */
    @container canvas-settings (max-width: 420px) {
      .sidebar-ux-panel-row {
        flex-direction: column;
        align-items: stretch;
        gap: 9px;
      }
      .sidebar-ux-panel-row > .sidebar-ux-panel-segmented {
        min-width: 0;
        width: 100%;
      }
      .sidebar-ux-panel-row > .sidebar-ux-panel-toggle { align-self: flex-end; }
      .sidebar-ux-panel-help { width: 20px; height: 20px; }
    }
    /* Below this, even a full-width 3-option control cannot show "Left
       drawer"/"Right drawer"; drop the shared " drawer" suffix (the row
       label + aria-label + ? hint keep the full meaning). */
    @container canvas-settings (max-width: 300px) {
      .sidebar-ux-panel-seg-label-suffix { display: none; }
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
    caption: 'Start menu + minimize/close',
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
    const h = document.createElement('h3')
    h.className = 'sidebar-ux-panel-section-title'
    h.textContent = title
    sec.appendChild(h)
    const group = document.createElement('div')
    group.className = 'sidebar-ux-panel-group'
    sec.appendChild(group)
    return { sec, group }
  }

  const appendRow = (group: HTMLElement, handle: SettingRowHandle): SettingRowHandle => {
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
    //
    // L14 (2026-09-23): last-click-wins. Each click takes a sequence token;
    // after every await (and before each setSettings) a stale token returns
    // so a slower earlier click cannot overwrite a later one's write.
    const seq = ++selectModeSeq
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
      let willRestore = false
      if (wasOs || mode === 'os') {
        try {
          const om = await import('../os/os-mode')
          if (seq !== selectModeSeq) return
          willRestore = mode === 'os'
            ? om.osEntrySlotHasTabs()
            : om.osExitSlotHasTabs()
          if (willRestore) {
            const sdm = await import('./second-drawer-mode')
            if (seq !== selectModeSeq) return
            const choice = await sdm.guardConfigureDirty()
            if (seq !== selectModeSeq) return
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
      if (seq !== selectModeSeq) return
      if (mode === 'os') {
        // L13: tell the OS run whether the panel's shape-only restore gate
        // fired — runOsEnable/Disable must not refresh (discard) a dirty
        // Configure draft when willRestore was false (no dialog was shown).
        setOsConfigureWillRestore(willRestore)
        setSettings({ osMode: true })
        return
      }
      if (mode === 'taskbar') {
        if (wasOs) setOsConfigureWillRestore(willRestore)
        // One combined patch: the sidesChromePrefs record branch runs before
        // the OS-disable restore, so the explicit taskbar pair survives.
        setSettings({ osMode: false, taskbarMode: true, moveControlsToOuterEdge: true })
        return
      }
      // Vanilla: auto-return a Top/Bottom layout to Sides (D5) and clear all
      // chrome; `chromeTouched` records the new Sides preference first.
      if (wasOs) setOsConfigureWillRestore(willRestore)
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
  modes.root.setAttribute('aria-label', 'Chrome mode')
  // The tiles are the most complex control in the panel; give them the same
  // `?` affordance as every row. The help button lives in a host-style
  // headerRow ABOVE the tiles (the old absolutely-positioned chip collided
  // with the selected tile's corner dot) and sits OUTSIDE the radiogroup so
  // the ARIA model stays valid (L5 2026-09-19).
  {
    const modesWrap = document.createElement('div')
    modesWrap.className = 'sidebar-ux-panel-modes-wrap'
    const modesHeader = document.createElement('div')
    modesHeader.className = 'sidebar-ux-panel-modes-header'
    const modesEyebrow = document.createElement('span')
    modesEyebrow.className = 'sidebar-ux-panel-modes-eyebrow'
    modesEyebrow.textContent = 'Chrome mode'
    modesHeader.appendChild(modesEyebrow)
    modesHeader.appendChild(buildHelpTip('Chrome mode', () => MODE_TILES_HINT))
    modesWrap.appendChild(modesHeader)
    modesWrap.appendChild(modes.root)
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
    stacked: true,
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
    stacked: true,
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
    stacked: true,
  }))

  const moveControlsToOuter = makeToggle(
    () => getSettings().moveControlsToOuterEdge,
    (v) => setSettings({ moveControlsToOuterEdge: v })
  )
  const moveControlsRow = appendRow(drawers.group, buildSettingRow({
    label: 'Move tab strip to outer edge',
    hint: MOVE_CONTROLS_HINT,
    control: moveControlsToOuter.btn,
  }))

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

  const compact = makeToggle(
    () => getSettings().mirrorCompactPosition,
    (v) => setSettings({ mirrorCompactPosition: v }),
    { disabled: () => !getSettings().secondSidebarEnabled }
  )
  const compactRow = appendRow(drawers.group, buildSettingRow({
    label: 'Mirror drawer open/close buttons',
    hint: MIRROR_COMPACT_HINT,
    control: compact.btn,
    disabled: !getSettings().secondSidebarEnabled,
  }))

  // Options button location (Settings gear per drawer).
  const optionsLocation = buildSegmentedControl(
    [
      { value: 'left' as const, label: 'Left drawer', suffix: ' drawer' },
      { value: 'right' as const, label: 'Right drawer', suffix: ' drawer' },
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
    stacked: true,
  }))

  // Start button location (OS-mode launcher chrome).
  const startLocation = buildSegmentedControl(
    [
      { value: 'left' as const, label: 'Left drawer', suffix: ' drawer' },
      { value: 'right' as const, label: 'Right drawer', suffix: ' drawer' },
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
    stacked: true,
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
  }))

  const startStripTop = makeToggle(
    () => getSettings().startButtonAtStripTop,
    (v) => setSettings({ startButtonAtStripTop: v })
  )
  const startStripTopRow = appendRow(drawers.group, buildSettingRow({
    label: 'Start button at top of tab strip',
    hint: START_STRIP_TOP_HINT,
    control: startStripTop.btn,
    disabled: isHorizontalStrip(),
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

  const unhideVanillaTabs = makeToggle(
    () => getSettings().unhideVanillaTabs,
    (v) => setSettings({ unhideVanillaTabs: v })
  )
  appendRow(misc.group, buildSettingRow({
    label: 'Keep all Lumiverse tabs available',
    hint: UNHIDE_VANILLA_TABS_HINT,
    control: unhideVanillaTabs.btn,
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
    unhideVanillaTabs.refresh()
    debugMode.refresh()
    shadowsDesktop.refresh()
    shadowsMobile.refresh()
    startEdge.refresh()
    startStripTop.refresh()

    const s = getSettings()

    // Mode tiles: effective preset + pre-hydration lock.
    modes.refresh(effectiveMode())
    modes.setDisabled(!isSettingsHydrated())

    // Drawer layout: sync selection; disabled while the settings load is in
    // flight (the load overwrites pre-hydration picks). On a mobile viewport
    // Sides is not offered (LUMI-44): the state layer resolves it to the
    // remembered Top/Bottom choice, so the option is disabled here too.
    drawerLocation.refresh(s.drawerLocation)
    drawerLocation.setDisabled(!isSettingsHydrated())
    drawerLocation.setOptionDisabled('sides', _isMobileViewportForPanel())
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
    const mobileTaskbar = (!!s.osMode || isTaskbarModeEnabled(s)) && _isMobileViewportForPanel()
    drawerMode.setDisabled(mobileTaskbar)
    drawerModeRow.setDisabled(mobileTaskbar)
    drawerModeRow.setHint(mobileTaskbar ? DRAWER_MODE_MOBILE_TASKBAR_HINT : DRAWER_MODE_HINT)

    // Mirror open/close handle: gated by the second-drawer master toggle.
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

    // Start strip-top: Sides only (inverse of the edge anchor's gate — inert
    // while horizontal, stored value kept for the return to Sides).
    {
      const d = horizontal
      startStripTop.btn.disabled = d
      startStripTop.btn.style.cursor = d ? 'not-allowed' : 'pointer'
      startStripTopRow.setDisabled(d)
      startStripTopRow.setHint(d ? START_STRIP_TOP_INERT_HINT : START_STRIP_TOP_HINT)
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
