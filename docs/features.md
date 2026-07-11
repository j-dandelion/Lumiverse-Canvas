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
| `secondSidebarFeature` | `secondSidebarEnabled` | Master toggle for the secondary drawer |
| `resizeSidebarsFeature` | `resizeSidebars` | Drag-to-resize handles on both drawers |
| `drawerSyncFeature` | `mirrorCompactPosition` | Mirrors main drawer's compact mode + vertical position |
| `shadowsDesktopFeature` | `drawerShadowsDesktop` | Box-shadow on drawers (>=601px) |
| `shadowsMobileFeature` | `drawerShadowsMobile` | Box-shadow on drawers (<=600px) |
| `persistDrawerOpenStateFeature` | `persistDrawerOpenState` | Cancels in-flight save when open facet turns off |
| `persistDrawerWidthFeature` | `persistDrawerWidth` | Cancels in-flight save when width facet turns off |
| `persistTabAssignmentsFeature` | `persistTabAssignments` | Cancels in-flight save when tabs facet turns off |
| `slashFeature` | `slashCommandsEnabled` | Mounts/unmounts the slash command runtime |
| `tabPositionFeature` | `moveControlsToOuterEdge` | Moves tab buttons to screen-edge side |
| `keepTabListVisibleFeature` | `keepTabListVisible` | Pins tab lists when drawers are closed (requires `moveControlsToOuterEdge`); on desktop, main uses a full Canvas-owned shell |
| `hideDrawerOpenCloseButtonsFeature` | `hideDrawerOpenCloseButtons` | Hides drawer open/close edge buttons (desktop only, requires `keepTabListVisible`) |
| `drawerTabDragFeature` | `drawerTabDrag` | Enables drag-to-reposition on drawer tabs |

**Note**: The `drawerTabDrag` feature is in the registry but has no settings panel toggle — it is enabled/disabled via the `drawerTabDrag` setting key, which is not exposed in the UI panel.

### Always-On Cleanups

These fire on extension disable regardless of toggle state:
- `unmountToastSurface` — removes the slash toast Preact root
- `cancelApplyLayoutInterval` — disconnects the layout restore observer
- `slashAlwaysCleanup` — detaches the slash runtime if active

## Settings System

### Settings State (`settings/state.ts`)

In-memory `FullCanvasSettings` (all fields required via `Required<CanvasSettings>`). Hydrated at boot from the saved layout blob with defaults from `DEFAULT_CANVAS_SETTINGS`.

**Key functions:**
- `getSettings()` — read current settings
- `setSettings(patch)` — update, persist, and live-apply diff
- `hydrateSettings(raw)` — one-shot hydration (no-op after first `setSettings`)
- `persistSettings()` — debounced (100ms) SAVE_LAYOUT IPC
- `cancelSettingsSave()` — cancel pending debounce

**Dependency chain (normalize):**
- `hideDrawerOpenCloseButtons` → `keepTabListVisible` → `moveControlsToOuterEdge`
- Normalize cascades: outer-edge off → keep-tabs off → hide off
- Helpers: `isKeepTabListVisibleEnabled(s)` requires outer-edge; `isHideDrawerOpenCloseButtonsEnabled(s)` requires keep-tabs (and thus outer-edge)

### Settings Panel (`settings/panel.ts`)

Built once, mounted into Lumiverse's per-extension settings host. In-place re-render via a `refresh` closure — no full re-mount on toggle.

**Sections:**
1. **Chat** — chatReflow, slashCommandsEnabled
2. **Layout** — persistDrawerOpenState, persistDrawerWidth, persistTabAssignments
3. **Drawers** — moveControlsToOuterEdge, keepTabListVisible (requires outer edge; main + secondary), hideDrawerOpenCloseButtons (requires keep-tabs; pinned strip is the open/close chrome), resizeSidebars, drawerShadowsDesktop, drawerShadowsMobile
4. **Second drawer** — secondSidebarEnabled (master), mirrorCompactPosition, showTabLabels (tri-state)
5. **Debug** — debugMode

### Settings Diff Dispatch (`applySettings`)

Iterates the feature registry and calls `feature.apply()` for any feature whose setting changed. This is the single live-update entry point.
