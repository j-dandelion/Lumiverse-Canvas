// Layout state persisted to backend storage
export interface DetachedTab {
  tabId: string        // extension tab ID from store
  tabTitle: string     // human-readable title (fallback identifier)
  sidebar: 'primary' | 'secondary'
}

export interface SidebarState {
  open: boolean
  width: number        // px
}

export interface LayoutState {
  primary: SidebarState
  secondary: SidebarState
  detachedTabs: DetachedTab[]
  /**
   * Canvas user preferences. Optional on read for backward compatibility
   * with layouts written by older versions; `mergeCanvasSettings` fills in
   * defaults for any missing field. New fields should be added with
   * `mergeCanvasSettings` providing a default — never read `_settings.X`
   * without a fallback.
   */
  settings?: CanvasSettings
}

/**
 * Canvas user-facing settings. Every field is optional on disk so old
 * layouts (or partial writes) still load; defaults come from
 * `mergeCanvasSettings`. Group order mirrors the settings panel UI.
 */
export interface CanvasSettings {
  // --- Second Sidebar ---
  /** Master toggle for the entire second-sidebar feature. When off, all
   *  sub-features (resize, mirror, labels) are unmounted. */
  secondSidebarEnabled?: boolean

  /** Drag-to-resize handle on both drawers (main + secondary). */
  resizeSidebars?: boolean

  /** Mirror the main drawer's compact mode + vertical position. */
  mirrorCompactPosition?: boolean

  // showTabLabels was removed — the second drawer always follows the
  // host main-drawer showTabLabels setting (no Canvas override).

  // --- Drawers ---
  /** Move the tab-button column to the screen-edge side of the secondary
   *  sidebar (desktop/tablet only). The border stays between the tab list
   *  and the panel; the resize handle stays on the chat-facing edge.
   *  No-op on mobile (mobile CSS forces column layout + bottom border). */
  moveControlsToOuterEdge?: boolean

  /** When a drawer is closed, show its tab-button strip as a taskbar
   *  pinned to the screen edge so the user can switch tabs without opening
   *  the drawer. Requires `moveControlsToOuterEdge` (forced off when
   *  outer-edge is off). Secondary: reparents Canvas-owned tab list.
   *  Main: Canvas mirror strip (host React nodes stay in place; clicks
   *  forward to host buttons). Panels still slide in/out from behind
   *  the strip. No-op on mobile. */
  taskbarMode?: boolean

  /** When on (desktop only, default off), hide the drawer open/close
   *  edge buttons for the second drawer and, when taskbar mode is on, the
   *  Canvas main drawer. Requires `taskbarMode` (otherwise the
   *  edge button is the only way to reopen a closed drawer). Does not
   *  affect mobile — mobile edge buttons always follow has-tabs (+
   *  mutual exclusion CSS). Does not change the host main drawer's edge
   *  control when taskbar mode is off. */
  hideDrawerOpenCloseButtons?: boolean

  /** Long-press drag-and-drop to reorder drawer tabs within a list or
   *  move them between primary and secondary. Requires `taskbarMode`
   *  (primary surface is the Canvas main-mirror strip). Default on. */
  dragAndDropDrawerTabs?: boolean

  /** Show box-shadow on drawers at min-width: 601px (desktop). */
  drawerShadowsDesktop?: boolean

  /** Show box-shadow on drawers at max-width: 600px (mobile). */
  drawerShadowsMobile?: boolean

  // --- Chat ---
  /** Center the chat column in the visible area (set --canvas-chat-ml/mr). */
  chatReflow?: boolean

  /** Master switch for the Canvas slash-command system. When off, the
   *  intercept, suggest popup, toast surface, and runtime command
   *  registry are all unmounted — typing `/` in the chat textarea is
   *  treated as plain text. Default on so existing users keep their
   *  behavior; toggling requires a page reload only if the user wants
   *  to clear an in-flight popup (the live-apply path hides it). */
  slashCommandsEnabled?: boolean

  // --- Layout ---
  /** Remember main + secondary drawer open/close (+ primary active tab) across sessions. */
  persistDrawerOpenState?: boolean

  /** Remember resized main + secondary drawer widths across sessions. */
  persistDrawerWidth?: boolean

  // Tab assignment persistence is always-on (built-in). Secondary tab
  // assignments (+ activeTabId) are always saved/restored. Zombie disk key
  // persistTabAssignments from older versions is ignored by mergeCanvasSettings.

  // --- Drawer Tab Drag ---
  /** Enable click/tap-and-drag on sidebar drawer tabs to reposition them
   *  vertically. The dragged value is a Canvas-side override; the Lumiverse
   *  slider won't reflect the drag value (documented limitation). */
  drawerTabDrag?: boolean

  /** Canvas-side override for the main drawer tab's vertical position (vh).
   *  When defined, takes precedence over the Lumiverse display setting.
   *  Written by the drag handler; cleared on extension disable. */
  mainDrawerTabOverrideVh?: number

  /** Canvas-side override for the secondary drawer tab's vertical position (vh).
   *  When defined, takes precedence over the mirror from the main tab.
   *  Written by the drag handler; cleared on extension disable. */
  secondaryDrawerTabOverrideVh?: number

  // --- Debug ---
  /** Master debug switch — enables [Canvas] console output AND installs
   *  `window.__canvasDebug()` for in-browser fiber tree inspection. */
  debugMode?: boolean
}

export const DEFAULT_LAYOUT: LayoutState = {
  primary: { open: false, width: 420 },
  secondary: { open: false, width: 420 },
  detachedTabs: [],
}

export const DEFAULT_CANVAS_SETTINGS: Required<CanvasSettings> = {
  // Second Sidebar
  secondSidebarEnabled: true,
  resizeSidebars: true,
  mirrorCompactPosition: true,
  // Drawers
  moveControlsToOuterEdge: false,
  taskbarMode: false,
  hideDrawerOpenCloseButtons: false,
  dragAndDropDrawerTabs: true,
  drawerShadowsDesktop: true,
  drawerShadowsMobile: false,
  // Chat
  chatReflow: true,
  slashCommandsEnabled: true,
  // Layout
  persistDrawerOpenState: true,
  persistDrawerWidth: true,
  // Drawer Tab Drag
  drawerTabDrag: true,
  mainDrawerTabOverrideVh: undefined as unknown as number,
  secondaryDrawerTabOverrideVh: undefined as unknown as number,
  // Debug
  debugMode: false,
}

/**
 * taskbarMode only makes sense with tab lists on the screen edge.
 * Clear it whenever moveControlsToOuterEdge is off (load safety + merge path).
 * Idempotent — safe to call after already-normalized settings.
 *
 * hideDrawerOpenCloseButtons and dragAndDropDrawerTabs require taskbarMode
 * (hide: edge button is the only reopen affordance without a pin strip;
 * drag: primary surface is the main-mirror strip). Cascade: outer-edge off →
 * taskbar mode off → hide + drag-and-drop off.
 */
export function normalizeCanvasSettingsFields(
  s: Required<CanvasSettings>,
): Required<CanvasSettings> {
  let out = s
  // Cascade 1: taskbar mode requires outer-edge
  if (out.taskbarMode && !out.moveControlsToOuterEdge) {
    out = {
      ...out,
      taskbarMode: false,
      hideDrawerOpenCloseButtons: false,
      dragAndDropDrawerTabs: false,
    }
  }
  // Cascade 2: hide requires taskbar mode
  if (out.hideDrawerOpenCloseButtons && !out.taskbarMode) {
    out = { ...out, hideDrawerOpenCloseButtons: false }
  }
  // Cascade 3: drag-and-drop drawer tabs requires taskbar mode
  if (out.dragAndDropDrawerTabs && !out.taskbarMode) {
    out = { ...out, dragAndDropDrawerTabs: false }
  }
  return out
}

/**
 * Merge a (possibly partial) saved settings blob with the defaults. Every
 * missing field gets the default. Callers should always use this instead of
 * reading `layout.settings` directly, so new fields added in future versions
 * gracefully appear at their default value.
 *
 * Always returns a normalized full settings object (taskbarMode outer-edge
 * invariant enforced here so future callers cannot skip it).
 */
export function mergeCanvasSettings(saved: CanvasSettings | null | undefined): Required<CanvasSettings> {
  const out = { ...DEFAULT_CANVAS_SETTINGS }
  if (saved && typeof saved === 'object') {
    for (const key of Object.keys(out) as Array<keyof CanvasSettings>) {
      const v = saved[key]
      if (v !== undefined) (out as Record<string, unknown>)[key] = v
    }
    // Legacy keys from pre-drawerShadows rename (layout.json may still hold these).
    // New keys win when both are present; only map legacy when the new key is absent.
    const raw = saved as Record<string, unknown>
    if (saved.drawerShadowsDesktop === undefined && typeof raw.sidebarShadowsDesktop === 'boolean') {
      out.drawerShadowsDesktop = raw.sidebarShadowsDesktop
    }
    if (saved.drawerShadowsMobile === undefined && typeof raw.sidebarShadowsMobile === 'boolean') {
      out.drawerShadowsMobile = raw.sidebarShadowsMobile
    }
    // Legacy single layoutPersistence → two layout facets (persistTabAssignments is always-on,
    // so legacy maps to open + width only). Only when none of the new keys are present on disk
    // (new keys win; missing new keys keep defaults).
    const hasNewLayoutFacet =
      saved.persistDrawerOpenState !== undefined
      || saved.persistDrawerWidth !== undefined
    if (!hasNewLayoutFacet && typeof raw.layoutPersistence === 'boolean') {
      out.persistDrawerOpenState = raw.layoutPersistence
      out.persistDrawerWidth = raw.layoutPersistence
    }
    // Legacy keepTabListVisible → taskbarMode migration. Prefer the new key when
    // present on the raw object; only map the zombie key when taskbarMode is absent.
    if (saved.taskbarMode === undefined && typeof raw.keepTabListVisible === 'boolean') {
      out.taskbarMode = raw.keepTabListVisible
    }
  }
  return normalizeCanvasSettingsFields(out)
}
