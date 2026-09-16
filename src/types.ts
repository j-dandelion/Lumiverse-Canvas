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
   * Tab ids hidden via Configure Tabs. Canvas-owned so hide survives hard
   * refresh even when host `drawerSettings.hiddenTabIds` never persists
   * (fiber setSetting NO-GO). Optional on old layouts; missing → [].
   */
  hiddenTabIds?: string[]
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
 * Where the drawer tab lists live. Panels always keep their left/right side;
 * `'sides'` slides them in/out horizontally, `'top' | 'bottom'` pins one
 * always-visible horizontal strip to that viewport edge and blooms the panel
 * out of the rail instead (wrapper transform snaps structurally; the panel
 * fades + micro-scales anchored at the strip — see `sidebar/animation.ts`).
 * This only moves the tab buttons; Top/Bottom requires taskbar chrome
 * (auto-enabled by the normalization invariant).
 */
export type DrawerLocation = 'sides' | 'top' | 'bottom'

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
  /** Where the drawer tab lists live: `'sides'` (default) keeps the
   *  vertical tab columns beside their panel; `'top'` / `'bottom'` pin one
   *  always-visible horizontal strip to that viewport edge while panels
   *  still slide in from their own side. Selecting top/bottom forces
   *  `moveControlsToOuterEdge` + `taskbarMode` on (normalize invariant);
   *  returning to sides restores the user's Sides values from
   *  `sidesChromePrefs` (see `setSettings`). */
  drawerLocation?: DrawerLocation

  /** Internal bookkeeping (never a user-facing toggle): the user's
   *  `taskbarMode` + `moveControlsToOuterEdge` values while on Sides.
   *  Top/Bottom force both on (`normalizeCanvasSettingsFields` invariant),
   *  so a plain setting flip would bake the forced values in; this snapshot
   *  lets the return to Sides restore the user's prefs. `null` = no explicit
   *  Sides choice recorded yet (legacy blob) → restore the defaults.
   *  Written by `setSettings` on an explicit chrome toggle while on Sides. */
  sidesChromePrefs?: { taskbarMode: boolean; moveControlsToOuterEdge: boolean } | null

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
   *  forward to host buttons). Sides panels slide in/out from behind the
   *  strip; Top/Bottom location blooms them out of the rail instead.
   *  No-op on mobile. */
  taskbarMode?: boolean

  /** When on (desktop only, default off), hide the drawer open/close
   *  edge buttons for the second drawer and, when taskbar mode is on, the
   *  Canvas main drawer. Requires `taskbarMode` (otherwise the
   *  edge button is the only way to reopen a closed drawer). Does not
   *  affect mobile — mobile edge buttons always follow has-tabs (+
   *  mutual exclusion CSS). Does not change the host main drawer's edge
   *  control when taskbar mode is off. */
  hideDrawerOpenCloseButtons?: boolean

  /** OS mode (desktop only, default off): window-style tab/panel lifecycle —
   *  each visible tab is a window that is open (displayed/active),
   *  minimized (parked, strip button stays), or closed (strip button
   *  hidden; the per-drawer Start menu is its only return path). Requires
   *  the taskbar chrome: enabling OS mode forces `taskbarMode` +
   *  `moveControlsToOuterEdge` on (normalize invariant — same pattern as
   *  top/bottom `drawerLocation`); disabling OS mode restores the pre-OS
   *  values from `osChromePrefs`. Persists via the dedicated OS layout
   *  slots (`osSingleLayout` / `osDualLayout`) so OS edits never touch the
   *  non-OS slots. No-op on mobile (≤600px). */
  osMode?: boolean

  /** Internal bookkeeping (never a user-facing toggle): the user's
   *  `taskbarMode` + `moveControlsToOuterEdge` values before OS mode was
   *  enabled, restored when OS mode is disabled. `null` = no explicit OS
   *  choice recorded yet (legacy blob) → restore the defaults. Written by
   *  `setSettings` on an explicit OS enable. Same pattern as
   *  `sidesChromePrefs`. */
  osChromePrefs?: { taskbarMode: boolean; moveControlsToOuterEdge: boolean } | null

  /** Drag-and-drop to reorder drawer tabs within a list or move them
   *  between primary and secondary. Mouse: distance-based lift (~6px);
   *  touch/pen: long-press. Taskbar-agnostic (S7: the Canvas main shell is
   *  always mounted, so the mirror strip is always the primary surface).
   *  Desktop only (≤600px no-op). Default on. */
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
  drawerLocation: 'sides',
  sidesChromePrefs: null,
  moveControlsToOuterEdge: false,
  taskbarMode: false,
  hideDrawerOpenCloseButtons: false,
  osMode: false,
  osChromePrefs: null,
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
 * S1 gate inversion: taskbarMode no longer requires moveControlsToOuterEdge.
 * Canvas owns the main drawer shell unconditionally on desktop; taskbarMode
 * is a purely visual chrome option ("pin tab strips to the screen edge") and
 * its effective gate is `isTaskbarModeEnabled()` (taskbarMode && outer-edge)
 * at the pin sites. The old cascade silently cleared the user's taskbarMode
 * choice when outer-edge was off — dropped so the setting survives.
 * Idempotent — safe to call after already-normalized settings.
 *
 * S7: drag-and-drop is taskbar-agnostic (the main shell is always mounted
 * since S1, so the mirror strip is always the primary mid-drag surface; the
 * old gate's reason is obsolete). Only hideDrawerOpenCloseButtons still
 * requires taskbarMode (the edge button is the only reopen affordance
 * without a pin strip). Idempotent — safe to call after already-normalized
 * settings.
 *
 * S8 (Drawer location) cascades — ORDER MATTERS:
 *   1. Enum coercion: corrupt/unknown `drawerLocation` → `'sides'`.
 *   2. Location invariant: `'top' | 'bottom'` forces `moveControlsToOuterEdge`
 *      + `taskbarMode` on. Never forces them off — the Sides restore lives in
 *      `setSettings` (it needs prev/next, this function has only one state).
 *   2b. `sidesChromePrefs` shape validation (corrupt persisted bookkeeping →
 *      null, so the Sides restore falls back to defaults).
 *   2c. OS-mode invariant: `osMode: true` forces `taskbarMode` +
 *      `moveControlsToOuterEdge` on (window chrome needs the pinned strips).
 *      Never forces them off — the pre-OS restore lives in `setSettings`
 *      (it needs prev/next; this function has only one state).
 *   2d. `osChromePrefs` shape validation (corrupt persisted bookkeeping →
 *      null, so the OS-disable restore falls back to defaults).
 *   3. `hideDrawerOpenCloseButtons` requires taskbarMode (must run AFTER the
 *      location + OS invariants, so `{osMode:true, hide:true, taskbar:false}`
 *      keeps `hide`).
 * Idempotent — safe to call after already-normalized settings.
 */
export function normalizeCanvasSettingsFields(
  s: Required<CanvasSettings>,
): Required<CanvasSettings> {
  let out = s
  // Cascade 1: enum coercion (corrupt disk values)
  if (out.drawerLocation !== 'top' && out.drawerLocation !== 'bottom') {
    out = { ...out, drawerLocation: 'sides' }
  }
  // Cascade 2: drawer location invariant — horizontal strips need the
  // taskbar chrome (outer-edge tab controls + pinned strips).
  if (out.drawerLocation !== 'sides') {
    out = { ...out, moveControlsToOuterEdge: true, taskbarMode: true }
  }
  // Cascade 2b: sidesChromePrefs shape validation. Persisted bookkeeping —
  // a corrupt shape is dropped to null (the Sides restore then uses defaults).
  {
    const p = out.sidesChromePrefs as unknown
    if (
      p != null
      && (typeof p !== 'object'
        || typeof (p as { taskbarMode?: unknown }).taskbarMode !== 'boolean'
        || typeof (p as { moveControlsToOuterEdge?: unknown }).moveControlsToOuterEdge !== 'boolean')
    ) {
      out = { ...out, sidesChromePrefs: null }
    }
  }
  // Cascade 2c: OS-mode invariant — window chrome (panel headers, taskbar
  // strips, Start buttons) is built on the taskbar pin path, so OS mode
  // requires the full taskbar chrome pair, same as top/bottom locations.
  if (out.osMode) {
    out = { ...out, taskbarMode: true, moveControlsToOuterEdge: true }
  }
  // Cascade 2d: osChromePrefs shape validation (see cascade 2b rationale).
  {
    const p = out.osChromePrefs as unknown
    if (
      p != null
      && (typeof p !== 'object'
        || typeof (p as { taskbarMode?: unknown }).taskbarMode !== 'boolean'
        || typeof (p as { moveControlsToOuterEdge?: unknown }).moveControlsToOuterEdge !== 'boolean')
    ) {
      out = { ...out, osChromePrefs: null }
    }
  }
  // Cascade 3: hide requires taskbar mode
  if (out.hideDrawerOpenCloseButtons && !out.taskbarMode) {
    out = { ...out, hideDrawerOpenCloseButtons: false }
  }
  // Cascade 4 (drag requires taskbar mode) REMOVED in S7 — the toggle is
  // the only gate; see isDragAndDropDrawerTabsEnabled.
  return out
}

/**
 * Merge a (possibly partial) saved settings blob with the defaults. Every
 * missing field gets the default. Callers should always use this instead of
 * reading `layout.settings` directly, so new fields added in future versions
 * gracefully appear at their default value.
 *
 * Always returns a normalized full settings object (the hide-opens taskbarMode
 * invariant is enforced here so future callers cannot skip it).
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
