# Canvas Feature System

## Feature Registry (`features/registry.ts`)

Every Canvas user-facing behavior is a `CanvasFeature`. The registry is a `readonly CanvasFeature[]` array — the orchestrator (`setup.ts`) iterates it.

### CanvasFeature Interface

```typescript
interface CanvasFeature {
  id: keyof FullCanvasSettings  // matches a settings key
  init?(ctx: SpindleFrontendContext): void   // one-time setup, before mount
  mount?(ctx: SpindleFrontendContext, layout: any): Teardown | void  // conditional mount
  apply?(prev: FullCanvasSettings, next: FullCanvasSettings, ctx: SpindleFrontendContext): void  // live-apply on settings diff
}
```

### Lifecycle

1. **`init()`** — Runs once after `hydrateSettings`, before `mount`. For one-time setup that must run regardless of toggle state (e.g., injecting shadow-disable CSS).
2. **`mount()`** — Runs when the feature's setting is truthy. Returns a teardown function added to the global cleanup chain.
3. **`apply()`** — Called on every settings diff where `prev[id] !== next[id]`. Mounts/unmounts at runtime.

### Registered Features (in order)

| Feature | Setting ID | Description |
|---------|-----------|-------------|
| `debugFeature` | `debugMode` | Enables `[Canvas]` console output + `window.__canvasDebug()` |
| `chatReflowFeature` | `chatReflow` | Centers chat column by adjusting margins |
| `welcomeReflowFeature` | `welcomeReflow` | Centers the Welcome/Landing screen by the same open-drawer margins |
| `secondSidebarFeature` | `secondSidebarEnabled` | Master toggle for the secondary drawer |
| `resizeSidebarsFeature` | `resizeSidebars` | Drag-to-resize handles on both drawers |
| `drawerSyncFeature` | `mirrorCompactPosition` | Mirrors main drawer's compact mode + vertical position |
| `shadowsDesktopFeature` | `drawerShadowsDesktop` | Box-shadow on drawers (>=601px) |
| `shadowsMobileFeature` | `drawerShadowsMobile` | Box-shadow on drawers (<=600px) |
| `persistDrawerOpenStateFeature` | `persistDrawerOpenState` | Cancels in-flight save when open facet turns off |
| `persistDrawerWidthFeature` | `persistDrawerWidth` | Cancels in-flight save when width facet turns off |
| `slashFeature` | `slashCommandsEnabled` | Mounts/unmounts the slash command runtime |
| `drawerLocationFeature` | `drawerLocation` | Sides (default) / Top / Bottom. Presentation + presence subscription + the single reconcile fan-out for the horizontal strip (init runs before any pin chrome); unconditional |
| `tabPositionFeature` | `moveControlsToOuterEdge` | Moves tab buttons to screen-edge side |
| `taskbarModeFeature` | `taskbarMode` | Taskbar mode: pin tab strips when drawers are closed (requires `moveControlsToOuterEdge`); on desktop, main uses a full Canvas-owned shell |
| `hideDrawerOpenCloseButtonsFeature` | `hideDrawerOpenCloseButtons` | Hides drawer open/close edge buttons (desktop only, requires `taskbarMode`) |
| `osModeFeature` | `osMode` | OS mode: window lifecycle (open / minimized / closed), per-drawer Start menus, OS-specific layout slots, panel-header minimize/X chrome. Live on mobile (single-drawer force). Requires the taskbar chrome (normalize forces `taskbarMode` + outer edge + `coreTabsHidden` on; `setSettings` snapshots the pre-OS values in `osChromePrefs` and restores them on disable) |
| `osSecondaryStartMenuFeature` | `osSecondaryStartMenu` | Second-drawer OS Start chrome is opt-in (default off): gates the secondary Start button/dock ensure and live-applies the removal. The main drawer's Start menu still lists every window from both drawers |
| `osWindowControlsFeature` | `osWindowControls` | OS panel-header controls (default on): `–` minimizes + `X` closes; off leaves only the X, which minimizes (vanilla). Live-apply re-runs the chrome pass; close stays in the tab context menu |
| `dragAndDropDrawerTabsFeature` | `dragAndDropDrawerTabs` | Drag-and-drop to reorder/move drawer tabs — mouse distance-based, touch long-press (taskbar-agnostic since S7 — toggle-only gate; desktop only) |
| `drawerTabDragFeature` | `drawerTabDrag` | Enables drag-to-reposition on drawer tabs (vertical vh of open/close edge control) |

**Note**: The `drawerTabDrag` feature is in the registry but has no settings panel toggle — it is enabled/disabled via the `drawerTabDrag` setting key, which is not exposed in the UI panel. It is unrelated to `dragAndDropDrawerTabs` (tab *list* reorder).

### Removed Features

| Feature | Setting ID | Reason |
|---------|-----------|--------|
| `persistTabAssignmentsFeature` | `persistTabAssignments` | Tab-assignment persistence is now always-on (built-in); the setting was removed. |

### Always-On Cleanups

These fire on extension disable regardless of toggle state:
- `unmountToastSurface` — removes the slash toast Preact root
- `cancelApplyLayoutInterval` — disconnects the layout restore observer
- `slashAlwaysCleanup` — detaches the slash runtime if active
- `clearTabListPosition` — reverses the host-drawer inline flex/borders (outer-edge writes)
- `clearDrawerLocation` — removes the location html classes + `--sidebar-ux-strip-h` and restores the shell wrapper safe-area offsets (idempotent; also in the feature teardown)

## Settings System

### Settings State (`settings/state.ts`)

In-memory `FullCanvasSettings` (all fields required via `Required<CanvasSettings>`). Hydrated at boot from the saved layout blob with defaults from `DEFAULT_CANVAS_SETTINGS`.

**Key functions:**
- `getSettings()` — read current settings
- `setSettings(patch)` — update, persist, and live-apply diff
- `hydrateSettings(raw)` — one-shot hydration (no-op after first `setSettings`)
- `persistSettings()` — debounced (100ms) SAVE_LAYOUT IPC
- `cancelSettingsSave()` — cancel pending debounce

**Dependency chain (normalize, order matters):**
1. `drawerLocation` enum coercion (unknown → `sides`)
2. Location invariant: `top`/`bottom` force `moveControlsToOuterEdge` + `taskbarMode` ON. Normalize never forces them off — the Sides restore lives in `setSettings` (needs prev/next): an explicit chrome toggle while on Sides records `sidesChromePrefs`, and a horizontal → sides location change restores it (defaults when the record is absent, e.g. a legacy blob last saved while horizontal).
2c. OS-mode invariant: `osMode: true` forces `taskbarMode` + `moveControlsToOuterEdge` + `coreTabsHidden` ON. The pre-OS values are snapshotted into `osChromePrefs` by `setSettings` on an explicit enable and restored on disable (`coreTabsHidden` is optional for legacy blobs → default false).
2e. `osForcedSingleDrawer` boolean coercion (corrupt disk value → false).
3. `hideDrawerOpenCloseButtons` requires `taskbarMode` (must run after #2 so a location flip does not clear `hide`)
- `dragAndDropDrawerTabs` is NOT cascaded (S7 removed the cascade) — the toggle is its only gate.
- `osSecondaryStartMenu` is NOT cascaded and NOT snapshotted into `osChromePrefs`: a plain persistent preference (default off) that survives OS off/on; the panel row is locked while OS mode is off or the second drawer is disabled.
- Helpers: `isTaskbarModeEnabled(s)` requires outer-edge; `isHideDrawerOpenCloseButtonsEnabled(s)` requires taskbar mode; `isDragAndDropDrawerTabsEnabled(s)` = the toggle alone (S7); `isHorizontalStrip(s)` / `getDrawerLocation(s)` / `getStripEdge(s)` for Drawer location.

### Settings Panel (`settings/panel.ts`)

Built once, mounted into Lumiverse's per-extension settings host. In-place re-render via a `refresh` closure — no full re-mount on toggle.

**Sections:**
1. **Chat** — chatReflow, welcomeReflow, slashCommandsEnabled
2. **Layout** — persistDrawerOpenState, persistDrawerWidth (tab-assignment persistence is always-on, no toggle)
3. **Drawers** — drawerLocation (segmented Sides|Top|Bottom; locks the two taskbar rows while horizontal; disabled while the settings load is in flight), moveControlsToOuterEdge, taskbarMode (requires outer edge; main + secondary), osMode, osWindowControls (OS mode only: `–` + `X` panel-header controls; off = only X, which minimizes; row locked while OS mode is off), osSecondaryStartMenu (OS mode only: opt-in Start button in the second drawer; row locked while OS mode is off or the second drawer is disabled), coreTabsHidden (unlocks the Configure eye for core tabs; locked on while OS mode forces it), hideDrawerOpenCloseButtons (requires taskbar mode; pinned strip is the open/close chrome; inert + checked while horizontal), dragAndDropDrawerTabs (toggle-only since S7; mouse distance / touch long-press tab list reorder; fine-pointer desktop only), resizeSidebars, drawerShadowsDesktop, drawerShadowsMobile. `horizontalSplit` (Top/Bottom dual-drawer boundary) has **no panel row** — it is adjusted by dragging the strip's boundary handle and persisted to settings.json; see `docs/sidebar.md` §Drawer location.
4. **Second drawer** — secondSidebarEnabled (master; locked off while OS mode is on and the viewport is mobile — `os/os-mode.syncOsMobileDrawerMode` restores the user's dual layout when OS mode turns off or the viewport leaves mobile), mirrorCompactPosition (showTabLabels removed — second drawer always follows host)
5. **Debug** — debugMode

### Settings Diff Dispatch (`applySettings`)

Iterates the feature registry and calls `feature.apply()` for any feature whose setting changed. This is the single live-update entry point.
