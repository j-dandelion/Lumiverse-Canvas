import {
  getMainSidebar,
  getMainDrawer,
  getMainPanel,
  getMainPanelContent,
  getMainWrapper,
  getAppElement,
  getChatColumn,
} from './dom/lumiverse'
import { dlog, dwarn, getDebug, setDebug } from './debug/log'
import { installDebugEscapeHatch } from './debug/fiber-scan'
import { findStoreData, getDrawerTabs, getStoreSnapshot, isMainDrawerOpen, getMainDrawerSide, clearStoreCache } from './store'
import { setChatMargin, injectReflowStyles, updateChatReflow, scheduleReflow, startReflowObserver } from './chat/reflow'
import { tagMainSidebarButtons, scheduleTagMainSidebarButtons } from './chat/tag-buttons'
import { hideMainTabButton, showMainTabButton, findMainTabButton, cssEscape, addSecondaryTabButton, removeSecondaryTabButton, updateDrawerTabVisibility, showSecondaryTab, deriveShortName } from './tabs/buttons'
import { getTabAssignments, hasTabAssignment } from './tabs/assignment'
import {
  createSecondarySidebar, mountSecondarySidebar, tearDownSecondarySidebar, openSecondarySidebar, closeSecondarySidebar,
  getSecondaryWrapper, isSecondarySidebarOpen, setSecondarySidebarOpen, unmountSecondarySidebar,
  injectDrawerTabStyles, animateWrapper, getClosedTransformPx, restoreOverflow, SECONDARY_WIDTH_VAR, PUZZLE_ICON_SVG,
} from './sidebar/secondary'
import { isMobile, createResizeHandle, mountResizeHandles, refreshResizeHandles, persistMainWidth, persistSecondaryWidth } from './resize/handles'
import { isShowTabLabels, syncDrawerTabSettings, syncSecondaryTabLabels, checkSideChanged, restoreSecondaryTabButtons, startSideChangeWatcher, stopSideChangeWatcher, startTabRegistrationWatcher, stopTabRegistrationWatcher, clearDrawerTabLayoutCache } from './sidebar/polish'
import { registerCleanup, cleanupAll } from './sidebar/cleanup'
import { startContextMenuListener } from './context-menu'
import { setBackendCtx, applyLayout, loadSavedLayout } from './layout/persist'
import { getSettings, setSettings, setLastLoadedLayout, getLastLoadedLayout, setPanelRefresh, refreshSettingsPanel, hydrateSettings, type FullCanvasSettings } from './settings/state'

// --- Debug Logging ---
// See src/debug/log.ts for the dlog/dwarn/DEBUG implementation.
// This section is intentionally a stub after Step 2 of the decomposition.

// --- Settings (Canvas user preferences) ---

// All settings state + accessors + setSettings + persistSettings +
// hydrateSettings live in src/settings/state.ts (Step 1 of the decomposition).
// This section is intentionally empty after Step 1. The setSettings transient
// re-exports (getSettings, setLastLoadedLayout, getLastLoadedLayout,
// setPanelRefresh) are imported at the top of this file. applySettings
// (the diff/live-apply dispatcher) stays here until Task #2 extracts the
// settings panel.

/**
 * Diff previous and next settings, applying live effects for any that
 * changed. Idempotent: calling with prev === next is a no-op.
 */
// FIXME-decomp(step 2): applySettings will live in settings/panel.ts. Until
// then, settings/state.ts imports it as a transient.
export function applySettings(prev: FullCanvasSettings, next: FullCanvasSettings): void {
  // 1. Debug mode — flip the global flag and install/uninstall the escape hatch.
  if (prev.debugMode !== next.debugMode) {
    setDebug(next.debugMode)
    if (next.debugMode) {
      installDebugEscapeHatch()
    } else {
      delete (window as any).__canvasDebug
    }
  }

  // 2. Chat reflow — toggle the injected style block + recompute margins.
  if (prev.chatReflow !== next.chatReflow) {
    if (next.chatReflow) {
      injectReflowStyles()
      updateChatReflow()
    } else {
      const el = document.getElementById('sidebar-ux-reflow')
      if (el) el.remove()
      // Clear any leftover chat margins so columns stop being pushed.
      const chat = getChatColumn()
      if (chat) {
        chat.style.removeProperty('--sidebar-ux-chat-ml')
        chat.style.removeProperty('--sidebar-ux-chat-mr')
      }
    }
  }

  // 3. Second Sidebar master — mount/unmount the wrapper + restore layout.
  if (prev.secondSidebarEnabled !== next.secondSidebarEnabled) {
    if (next.secondSidebarEnabled) {
      if (!getSecondaryWrapper()) {
        const initialWidth = getLastLoadedLayout()?.secondary?.width
        const initialOpen = getLastLoadedLayout()?.secondary?.open === true
        mountSecondarySidebar({ initialWidth, initialOpen })
        if (getLastLoadedLayout()) applyLayout(getLastLoadedLayout())
      }
    } else {
      tearDownSecondarySidebar()
    }
  }

  // 4. Resize handles — both drawers, single toggle.
  if (prev.resizeSidebars !== next.resizeSidebars) {
    refreshResizeHandles()
  }

  // 5. Auto-mirror on side swap — start/stop the side watcher.
  if (prev.autoMirrorOnSideSwap !== next.autoMirrorOnSideSwap) {
    if (next.autoMirrorOnSideSwap) {
      startSideChangeWatcher()
    } else {
      stopSideChangeWatcher()
    }
  }

  // 6. Mirror compact position — re-sync after a flip.
  if (prev.mirrorCompactPosition !== next.mirrorCompactPosition) {
    if (next.mirrorCompactPosition) {
      syncDrawerTabSettings()
    } else {
      const drawerTab = getSecondaryWrapper()?.querySelector('.sidebar-ux-drawer-tab') as HTMLElement
      if (drawerTab) {
        drawerTab.style.marginTop = ''
        clearDrawerTabLayoutCache()
      }
    }
  }

  // 7. Tab labels — re-sync secondary tab button labels.
  if (prev.showTabLabels !== next.showTabLabels) {
    syncSecondaryTabLabels()
  }

  // 8. Consistent icon size — toggle the CSS rule.
  if (prev.consistentIconSize !== next.consistentIconSize) {
    if (!next.consistentIconSize) {
      const el = document.getElementById('sidebar-ux-drawer-tab-styles')
      if (el) el.remove()
    } else {
      injectDrawerTabStyles()
    }
  }

  // 9. Smooth transitions — toggle the chat-column transition rule.
  if (prev.smoothTransitions !== next.smoothTransitions) {
    const reflow = document.getElementById('sidebar-ux-reflow')
    if (reflow) {
      reflow.textContent = next.smoothTransitions
        ? `
          [class*="_chatColumn_"] {
            margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
            margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
            transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
          }
        `
        : `
          [class*="_chatColumn_"] {
            margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
            margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
            transition: none !important;
          }
        `
    }
  }

  // 10. Settings that don't need live effects (apply on next reload):
  //   - layoutPersistence: read by persistLayout/persistOpenState
  //   - autoCleanupOnUninstall: read by startTabRegistrationWatcher's check
  // The settings panel re-renders to reflect the new value, and the next
  // mount/load cycle reads the updated value from getSettings().
}

// --- DOM Helpers ---

// --- Store Access ---

// All Zustand store access lives in src/store/index.ts (findStoreData,
// getDrawerTabs, getStoreSnapshot, isMainDrawerOpen, getMainDrawerSide,
// clearStoreCache). This section is intentionally empty after Step 3 of
// the decomposition.

// --- Secondary Sidebar ---

// All secondary-sidebar code lives in src/sidebar/secondary.tsx (Step 9 of
// the decomposition). This section is intentionally empty.// --- Chat Reflow ---

// All chat reflow + main-sidebar button tagging code lives in
// src/chat/reflow.ts (Step 4 of the decomposition).
// injectDrawerTabStyles is still defined here and will move to
// sidebar/secondary.tsx in Step 9.

function injectDrawerTabStyles() {
  if (document.getElementById('sidebar-ux-drawer-tab-styles')) return
  const style = document.createElement('style')
  style.id = 'sidebar-ux-drawer-tab-styles'
  style.textContent = `
    .sidebar-ux-drawer-tab {
      flex-shrink: 0;
      align-self: flex-start;
      width: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px 8px 20px;
      background: var(--lcs-glass-bg, var(--lumiverse-bg));
      border: 1px solid var(--lumiverse-border-hover);
      color: var(--lumiverse-text-muted);
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    }
    .sidebar-ux-drawer-tab:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--compact {
      width: 32px;
      padding: 8px 6px;
      gap: 0;
    }
    .sidebar-ux-drawer-tab-icon {
      color: var(--lumiverse-primary);
    }
    /* Force a 20×20 size on the tab-list SVG icons. Extensions that
       provide iconSvg without intrinsic width/height attributes (e.g. Hone)
       render at 0×0 by default — Lumiverse's main sidebar gets around this
       via its own CSS, but Canvas's tab list doesn't inherit that rule.
       Sizing via CSS catches all current and future extensions, and matches
       the existing CSS-injection pattern. */
    .sidebar-ux-tab-list button[data-tab-id] > span > svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
  `
  document.head.appendChild(style)
}

// --- Tab Button Management ---

// All tab button management code lives in src/tabs/buttons.ts (Step 6 of
// the decomposition). This section is intentionally empty.

// --- Context Menu ---

// All context menu code (createContextMenu, injectContextMenuStyles,
// createContextMenuItem, _contextMenu, disposeContextMenu,
// showAssignmentMenu, hideContextMenu, startContextMenuListener,
// stopContextMenuListener) lives in src/context-menu/index.ts (Step 11 of
// the decomposition). This section is intentionally empty.

// --- Drag-to-Resize ---

// All drag-to-resize code lives in src/resize/handles.ts (Step 7 of the
// decomposition). This section is intentionally empty.

// --- Backend Persistence ---

// All layout persistence (getBackendCtx, setBackendCtx, cancelLayoutSave,
// snapshotLayout, persistOpenState, persistLayout, saveLayout,
// loadSavedLayout, applyLayout) lives in src/layout/persist.ts (Step 12
// of the decomposition). This section is intentionally empty.

// --- Polish & Cleanup ---

// All sidebar polish code (syncDrawerTabSettings, isShowTabLabels,
// checkSideChanged, side/registration watchers) lives in
// src/sidebar/polish.ts (Step 8 of the decomposition). The cleanup
// registry and cleanupAll live in src/sidebar/cleanup.ts (Step 14).

// --- Slash Runtime ---

import { attachSlashRuntime } from './slash/runtime'

// --- Settings Panel ---

// CSS class names are namespaced (sidebar-ux-*) to avoid colliding with
// Lumiverse's own CSS modules. The class definitions are injected once
// when the panel is first built.
const PANEL_STYLE_ID = 'sidebar-ux-panel-styles'
function injectPanelStyles() {
  if (document.getElementById(PANEL_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PANEL_STYLE_ID
  style.textContent = `
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
    .sidebar-ux-panel-footer {
      margin-top: 18px;
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-dim);
      text-align: center;
    }
  `
  document.head.appendChild(style)
}

/**
 * Render a single setting row. `control` is the right-hand element
 * (toggle button, segmented control, etc.) — caller builds it.
 */
function buildSettingRow(args: {
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
function buildToggleControl(value: boolean, onChange: (next: boolean) => void, disabled?: () => boolean): HTMLElement {
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

/** Build a 3-button segmented control (Follow / Show / Hide). */
function buildShowLabelsControl(value: 'follow' | 'show' | 'hide', onChange: (next: 'follow' | 'show' | 'hide') => void): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'sidebar-ux-panel-segmented'
  const opts: Array<{ value: 'follow' | 'show' | 'hide'; label: string }> = [
    { value: 'follow', label: 'Follow' },
    { value: 'show', label: 'Show' },
    { value: 'hide', label: 'Hide' },
  ]
  for (const o of opts) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'sidebar-ux-panel-segmented-btn' + (value === o.value ? ' sidebar-ux-panel-segmented-btn-active' : '')
    btn.textContent = o.label
    btn.addEventListener('click', () => onChange(o.value))
    wrap.appendChild(btn)
  }
  return wrap
}

/**
 * Build the Canvas settings panel DOM. Pure — caller appends to a host.
 * The panel re-renders its visual state in-place via `refreshPanel` after
 * each `setSettings` call, so the toggles always reflect the current
 * `_settings` value.
 */
function buildSettingsPanelDOM(): HTMLElement {
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

  // --- Section: Chat & Layout (now at the top) ---
  const sec1 = section('Chat & Layout')

  const chat = makeToggle(
    () => getSettings().chatReflow,
    (v) => setSettings({ chatReflow: v })
  )
  sec1.appendChild(buildSettingRow({
    label: 'Center the chat in the visible area',
    hint: 'Shifts the chat column by the open-drawer widths so neither sidebar covers it.',
    control: chat.btn,
  }))

  const persist = makeToggle(
    () => getSettings().layoutPersistence,
    (v) => setSettings({ layoutPersistence: v })
  )
  sec1.appendChild(buildSettingRow({
    label: 'Remember layout across sessions',
    hint: 'Persists open/closed state, widths, and tab assignments to layout.json.',
    control: persist.btn,
  }))

  const smooth = makeToggle(
    () => getSettings().smoothTransitions,
    (v) => setSettings({ smoothTransitions: v })
  )
  sec1.appendChild(buildSettingRow({
    label: 'Smooth transitions',
    hint: 'Animates drawer open/close and the chat margin transition.',
    control: smooth.btn,
  }))

  // --- Section: Second Sidebar ---
  const sec2 = section('Second Sidebar')

  const master = makeToggle(
    () => getSettings().secondSidebarEnabled,
    (v) => setSettings({ secondSidebarEnabled: v })
  )
  sec2.appendChild(buildSettingRow({
    label: 'Enable Second Sidebar',
    hint: 'Adds a second drawer to the opposite side of the main one. Master switch for all sub-features below.',
    control: master.btn,
  }))

  const resizeSidebars = makeToggle(
    () => getSettings().resizeSidebars,
    (v) => setSettings({ resizeSidebars: v }),
    { disabled: () => !getSettings().secondSidebarEnabled }
  )
  sec2.appendChild(buildSettingRow({
    label: 'Drag to resize sidebars',
    hint: 'Adds a 4px grab handle on the inner edge of both drawers.',
    control: resizeSidebars.btn,
    disabled: !getSettings().secondSidebarEnabled,
  }))

  const mirror = makeToggle(
    () => getSettings().autoMirrorOnSideSwap,
    (v) => setSettings({ autoMirrorOnSideSwap: v }),
    { disabled: () => !getSettings().secondSidebarEnabled }
  )
  sec2.appendChild(buildSettingRow({
    label: 'Auto-mirror when the main sidebar switches side',
    hint: 'Rebuilds the secondary drawer on the opposite edge when the user moves the main one.',
    control: mirror.btn,
    disabled: !getSettings().secondSidebarEnabled,
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
    label: 'Tab labels in the second sidebar',
    hint: "\"Follow\" mirrors Lumiverse's main sidebar setting. \"Show\" / \"Hide\" override it.",
    control: showLabelsWrap,
    disabled: !getSettings().secondSidebarEnabled,
  })
  sec2.appendChild(showLabelsRow)

  const iconSize = makeToggle(
    () => getSettings().consistentIconSize,
    (v) => setSettings({ consistentIconSize: v })
  )
  sec2.appendChild(buildSettingRow({
    label: 'Force 20×20 icon size on tab buttons',
    hint: 'Fixes tabs that ship icons without intrinsic dimensions (some extensions render at 0×0 by default).',
    control: iconSize.btn,
  }))

  // --- Section: Behavior ---
  const sec3 = section('Behavior')

  const cleanup = makeToggle(
    () => getSettings().autoCleanupOnUninstall,
    (v) => setSettings({ autoCleanupOnUninstall: v })
  )
  sec3.appendChild(buildSettingRow({
    label: 'Auto-cleanup when an extension is uninstalled',
    hint: 'Removes the tab from the secondary sidebar if its source extension disappears.',
    control: cleanup.btn,
  }))

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

  // Footer
  const footer = document.createElement('div')
  footer.className = 'sidebar-ux-panel-footer'
  footer.textContent = 'Canvas settings persist to layout.json (300ms debounce).'

  root.appendChild(sec1)
  root.appendChild(sec2)
  root.appendChild(sec3)
  root.appendChild(sec4)
  root.appendChild(footer)

  // Live-update wiring: setSettings calls this via the registered panel
  // refresh closure (setPanelRefresh in settings/state) so we don't have to
  // thread the refresh closure through every toggle's onChange.
  const refresh = () => {
    master.refresh()
    resizeSidebars.refresh()
    mirror.refresh()
    compact.refresh()
    iconSize.refresh()
    chat.refresh()
    persist.refresh()
    smooth.refresh()
    cleanup.refresh()
    debugMode.refresh()
    // Update disabled visual state for sub-features gated by the master toggle.
    for (const row of [resizeSidebars, mirror, compact]) {
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
function mountSettingsPanel(ctx: any) {
  try {
    if (!ctx?.ui?.mount) {
      dwarn('mountSettingsPanel: ctx.ui.mount unavailable; settings panel will not be registered')
      return
    }
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
    console.error('[Canvas] mountSettingsPanel failed:', err)
  }
}

/**
 * Install `window.__canvasDebug()` — a console-invokable function that
 * scans the React fiber tree from the main sidebar to find the Zustand
 * store's drawerTabs / drawerOpen state. Pure debug aid; intentionally
 * unminified and console.log-heavy. The user can toggle it from the
 * Canvas settings panel.
 */
// All debug escape hatch code lives in src/debug/fiber-scan.ts. This
// section is intentionally empty.

// --- Setup ---

export function setup(ctx: any) {
  setBackendCtx(ctx)

  // Mount the settings panel immediately. The host may not be in the DOM yet
  // (the user hasn't opened Settings → Extensions), but ctx.ui.mount sets up
  // a MutationObserver that reparents the host as soon as it appears.
  mountSettingsPanel(ctx)

  // Slash runtime — wired into the canvas cleanup chain so the intercept
  // listeners are detached when the extension is disabled.
  const detachSlash = attachSlashRuntime(ctx)
  registerCleanup(detachSlash)

  // Phase 3 (finding #13): load the persisted layout BEFORE mounting the
  // secondary sidebar so its initial position matches the saved state on the
  // first paint — no 68px sliver, no 500ms flicker. We also hydrate the
  // settings from the same blob so every feature mount downstream sees the
  // correct gate.
  loadSavedLayout().then((layout) => {
    // Hydrate settings from the loaded layout (defaults filled by
    // mergeCanvasSettings inside hydrateSettings).
    hydrateSettings(layout?.settings)
    setDebug(getSettings().debugMode)
    setLastLoadedLayout(layout)
    // The settings panel was mounted earlier in setup() with the default
    // getSettings(). Now that we've hydrated from the saved layout, re-render
    // the panel so the toggles reflect the loaded values rather than the
    // defaults baked in at mount time. refreshSettingsPanel (in
    // settings/state.ts) fires the closure registered by mountSettingsPanel.
    refreshSettingsPanel()

    if (getSettings().debugMode) installDebugEscapeHatch()

    const initialWidth = layout?.secondary?.width
    const initialOpen = layout?.secondary?.open === true

    // Mount features gated by settings. The master toggle is the only one
    // that gates other mounts; sub-features are gated at their own mount
    // sites so a future change to add a non-master-gated sub-feature is
    // a one-liner.
    if (getSettings().secondSidebarEnabled) {
      mountSecondarySidebar({ initialWidth, initialOpen })
    }
    if (getSettings().chatReflow) {
      startReflowObserver()
    }
    if (getSettings().resizeSidebars) {
      mountResizeHandles()
    }
    if (getSettings().autoMirrorOnSideSwap) {
      startSideChangeWatcher()
    }
    if (getSettings().autoCleanupOnUninstall) {
      startTabRegistrationWatcher()
    }
    // Context menu is always on for now (no panel toggle). Could become a
    // setting later if requested.
    startContextMenuListener()

    // Always inject the consistent-icon-size CSS if it's enabled — it
    // doesn't need a wrapper to apply.
    if (getSettings().consistentIconSize) {
      injectDrawerTabStyles()
    }

    // Apply the rest of the layout (tab assignments + width delta if any).
    // Safe to call after mount: it won't double-animate the wrapper.
    if (layout && getSettings().secondSidebarEnabled) {
      applyLayout(layout)
    }
  })

  // v1.3.0: removed the permanent ctx.onBackendMessage no-op. The previous
  // comment noted it was a "safety belt" for late LAYOUT_DATA, but the
  // one-shot handler in loadSavedLayout resolves on the first LAYOUT_DATA
  // and that is the only one the backend ever sends. Carrying a permanent
  // listener that never fires adds no value and would only mask a real bug
  // (a duplicate LAYOUT_DATA send) if the backend ever started sending one.

  // Return teardown — called when extension is disabled
  return cleanupAll
}
