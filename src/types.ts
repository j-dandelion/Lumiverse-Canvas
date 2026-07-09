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

  /** Tab-label visibility. 'follow' = match Lumiverse's main drawer setting
   *  (read from the store); 'show' = always visible; 'hide' = never visible. */
  showTabLabels?: 'follow' | 'show' | 'hide'

  /** Force 20×20 icon size in the secondary tab list. */
  consistentIconSize?: boolean

  // --- Sidebars ---
  /** Move the tab-button column to the screen-edge side of the secondary
   *  sidebar (desktop/tablet only). The border stays between the tab list
   *  and the panel; the resize handle stays on the chat-facing edge.
   *  No-op on mobile (mobile CSS forces column layout + bottom border). */
  moveControlsToOuterEdge?: boolean

  /** When a drawer is closed, keep its tab-button-list visible at the
   *  screen edge so the user can switch tabs without opening the drawer.
   *  Requires `moveControlsToOuterEdge` (forced off when outer-edge is off).
   *  Secondary: reparents Canvas-owned tab list. Main: Canvas mirror strip
   *  (host React nodes stay in place; clicks forward to host buttons).
   *  Panels still slide in/out from behind the list. No-op on mobile. */
  keepTabListVisible?: boolean

  /** Show box-shadow on sidebars at min-width: 601px (desktop). */
  sidebarShadowsDesktop?: boolean

  /** Show box-shadow on sidebars at max-width: 600px (mobile). */
  sidebarShadowsMobile?: boolean

  // --- Chat & Layout ---
  /** Center the chat column in the visible area (set --canvas-chat-ml/mr). */
  chatReflow?: boolean

  /** Persist open/closed state, widths, and tab assignments to layout.json. */
  layoutPersistence?: boolean

  /** Master switch for the Canvas slash-command system. When off, the
   *  intercept, suggest popup, toast surface, and runtime command
   *  registry are all unmounted — typing `/` in the chat textarea is
   *  treated as plain text. Default on so existing users keep their
   *  behavior; toggling requires a page reload only if the user wants
   *  to clear an in-flight popup (the live-apply path hides it). */
  slashCommandsEnabled?: boolean

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
  showTabLabels: 'follow',
  consistentIconSize: true,
  // Sidebars
  moveControlsToOuterEdge: false,
  keepTabListVisible: false,
  sidebarShadowsDesktop: true,
  sidebarShadowsMobile: false,
  // Chat & Layout
  chatReflow: true,
  layoutPersistence: true,
  slashCommandsEnabled: true,
  // Drawer Tab Drag
  drawerTabDrag: true,
  mainDrawerTabOverrideVh: undefined as unknown as number,
  secondaryDrawerTabOverrideVh: undefined as unknown as number,
  // Debug
  debugMode: false,
}

/**
 * Merge a (possibly partial) saved settings blob with the defaults. Every
 * missing field gets the default. Callers should always use this instead of
 * reading `layout.settings` directly, so new fields added in future versions
 * gracefully appear at their default value.
 */
export function mergeCanvasSettings(saved: CanvasSettings | null | undefined): Required<CanvasSettings> {
  const out = { ...DEFAULT_CANVAS_SETTINGS }
  if (saved && typeof saved === 'object') {
    for (const key of Object.keys(out) as Array<keyof CanvasSettings>) {
      const v = saved[key]
      if (v !== undefined) (out as Record<string, unknown>)[key] = v
    }
  }
  return out
}
