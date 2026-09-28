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
| `secondSidebarFeature` | `secondSidebarEnabled` | Master toggle for the secondary drawer. On re-enable, tab state restores ONLY from Canvas-owned namespaces (dual slot + layout blob — LUMI-26): the host `hiddenTabIds` list is never adopted (the LUMI-25 leak — vanilla-made hides must not adopt into Canvas), and tabs the host has filtered out of the drawer DOM are re-adopted from the layout blob (`resolveLayoutOwnedStoredId`) so they stay manageable in Configure Tabs. Presentation rule (LUMI-26 rework + Amendment 3): Canvas surfaces never render host-unbacked keys as launch targets — no strip button, and no NORMAL Start-menu row, for a key with no drawer-DOM twin and no closed lifecycle, and no raw `builtin:`/`ext:` key ever renders as a title (Amendment 3: manage panels mode is the exception — it lists the complete model inventory, unbacked rows dimmed + hinted + non-launchable); a recovered tab materializes on strips/Start only after the vanilla side backs it again (see `docs/tabs.md` §Off-world tab recovery + `docs/pitfalls.md` §23) |
| `resizeSidebarsFeature` | `resizeSidebars` | Drag-to-resize handles on both drawers |
| `drawerSyncFeature` | `mirrorCompactPosition` | Mirrors main drawer's open/close handle (size + vertical position) |
| `shadowsDesktopFeature` | `drawerShadowsDesktop` | Box-shadow on drawers (>=601px) |
| `shadowsMobileFeature` | `drawerShadowsMobile` | Box-shadow on drawers (<=600px) |
| `persistDrawerOpenStateFeature` | `persistDrawerOpenState` | Cancels in-flight save when open facet turns off |
| `persistDrawerWidthFeature` | `persistDrawerWidth` | Cancels in-flight save when width facet turns off |
| `slashFeature` | `slashCommandsEnabled` | Mounts/unmounts the slash command runtime |
| `drawerLocationFeature` | `drawerLocation` | Sides (default) / Top / Bottom. Presentation + presence subscription + the single reconcile fan-out for the horizontal strip (init runs before any pin chrome); unconditional |
| `tabPositionFeature` | `moveControlsToOuterEdge` | Moves tab buttons to screen-edge side |
| `taskbarModeFeature` | `taskbarMode` | Taskbar mode: pin tab strips when drawers are closed (requires `moveControlsToOuterEdge`); on desktop, main uses a full Canvas-owned shell |
| `hideDrawerOpenCloseButtonsFeature` | `hideDrawerOpenCloseButtons` | Hides drawer open/close edge buttons (desktop only, requires `taskbarMode`) |
| `osModeFeature` | `osMode` | OS mode: window lifecycle (open / minimized / closed), per-drawer Start menus (header "Start" + a manage mode: eye toggle reveals menu-hidden tabs AND host-unbacked recovered keys (LUMI-26 Amendment 3 — the manage projection is the complete model inventory; unbacked rows render dimmed, hinted "Hidden in Lumiverse's settings — restore to bring it back here", non-launchable, click = restore via the Amendment 4 bridge) with visible/hidden checkboxes, transient per menu-open; menu-hidden tabs are excluded from the normal projection, which stays launchable-windows-only (Amendment 2: unbacked keys never get dead launch rows); the manage header's `N panels · M hidden` tally updates live on each toggle, LUMI-24). Amendment 4: a host-unbacked manage row (waiting on the vanilla side) is itself the restore action — clicking it clears that one tab from Lumiverse's `drawerSettings.hiddenTabIds` via Lumiverse's own settings API (`restoreVanillaHiddenTab`: remove-only, read-modify-write, never synced back into Canvas state), then reloads so the host re-renders the button; the manage checkbox toggles the START-MENU-ONLY `menuHidden` set (layout `menuHiddenTabIds`, LUMI-16b) — a menu toggle changes ONLY the Start-menu listing, never the strips; strip visibility stays owned by Configure Tabs' `hidden` set + the window lifecycle; launching a menu-hidden panel never writes the menu axis either (LUMI-23: it stays menu-hidden until its manage checkbox un-hides it). OS-specific layout slots, panel-header minimize/X chrome. Live on mobile (single-drawer force). Requires the taskbar chrome (normalize forces `taskbarMode` + outer edge + `coreTabsHidden` on; `setSettings` snapshots the pre-OS values in `osChromePrefs` and restores them on disable) |
| `startButtonLocationFeature` | `startButtonLocation` | Where the OS-mode Start button lives (literal screen sides `left`/`right`/`both`, `null` = main drawer only). Replaces `osSecondaryStartMenu` (legacy `true` migrates to `both`). Unconditional: mount/apply reconcile both sides through the shared dock; the main drawer's Start menu still lists every window from both drawers |
| `optionsButtonLocationFeature` | `optionsButtonLocation` | Where the drawer-hosted Settings ("Options") gear is shown (literal sides, `null` = main drawer). Hides the main mirror gear + clones it into the shared secondary dock; fallback keeps Settings reachable in single-drawer mode. Unconditional |
| `startButtonAlwaysOnScreenEdgeFeature` | `startButtonAlwaysOnScreenEdge` | Top/Bottom only (default on): anchors Start at the outer strip end; off puts it on the tab-facing side. Toggles the root class `sidebar-ux-start-edge-inner` (robust across pin-host recreation); `HORIZONTAL_STRIP_CSS` owns the order. Unconditional |
| `startButtonAtStripTopFeature` | `startButtonAtStripTop` | Sides only (default off = bottom dock): lifts Start to the FIRST child of the vertical tab strip; the dock (Options gear inside) stays bottom-anchored. Toggles the root class `sidebar-ux-start-at-strip-top`; `START_STRIP_TOP_CSS` styles only the top position (desktop ≥601px — mobile is a row no-op); the DOM move itself is `ensureStartButtonForSide` (re-docks a lifted button when off). Unconditional |
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
2f. `optionsButtonLocation` / `startButtonLocation` chrome-location enum coercion (`left`/`right`/`both` kept; unknown/absent → `null` = main drawer only). Legacy `osSecondaryStartMenu: true` migrates to `startButtonLocation: 'both'` in `mergeCanvasSettings`.
2g. `startButtonAlwaysOnScreenEdge` boolean coercion (corrupt → true).
2h. `startButtonAtStripTop` boolean coercion (corrupt → false, the shipped bottom-dock default).
3. `hideDrawerOpenCloseButtons` requires `taskbarMode` (must run after #2 so a location flip does not clear `hide`)
- `dragAndDropDrawerTabs` is NOT cascaded (S7 removed the cascade) — the toggle is its only gate.
- `startButtonLocation` (and `optionsButtonLocation`) are NOT cascaded and NOT snapshotted into `osChromePrefs`: plain persistent preferences that survive OS off/on. Resolution is live: `resolveChromeSides(value, mainSide, secondEnabled)` (`sidebar/chrome-sides.ts`) maps literal sides onto the current drawer roles, falling back to the main drawer when the requested side has no drawer.
- Helpers: `isTaskbarModeEnabled(s)` requires outer-edge; `isHideDrawerOpenCloseButtonsEnabled(s)` requires taskbar mode; `isDragAndDropDrawerTabsEnabled(s)` = the toggle alone (S7); `isHorizontalStrip(s)` / `getDrawerLocation(s)` / `getStripEdge(s)` for Drawer location.

### Settings Panel (`settings/panel.ts`)

Built once, mounted into Lumiverse's per-extension settings host. In-place re-render via a `refresh` closure — no full re-mount on toggle. 2026-09-19 overhaul: every row carries a `?` help popover (body-level `sidebar-ux-help-popover`, render.ts; hover/focus opens on fine pointers, tap toggles, Esc/outside dismisses) instead of always-visible hint text. Popover copy was rewritten in plain end-user language (simple wording + a bit more detail; 2026-09-23g).

**Visual contract (2026-09-23 refinement + stacked rows, pinned by `settings/__tests__/settings-visual-pins.test.ts`):** the panel wears the host's settings language verbatim where the host has one — `.subsectionTitle` section titles (12px/700 uppercase .05em `--lumiverse-text-dim`), 16px/650 panel header, 11px `--lumiverse-text-dim` meta/captions, `--lumiverse-fill-hover` row hover, and every duration on `--lumiverse-transition-fast`. The segmented control keeps the **Canvas skin** (flat cells + hairline dividers, 12px/600, `--lumiverse-primary-020` active, inset focus ring — user preference, deliberately not host pill-in-trough) and lives in **stacked rows** (host SettingsModal `.field` pattern — Chat → Content Width, 2026-09-23d): the label (host `.fieldLabel` treatment, 12px `--lumiverse-text-muted`) sits on top and the control spans the full row width, so every option has room for its longest label (`stacked: true` on all five segmented rows; `render.ts` `buildSettingRow`). Toggle rows stay inline (label column `flex: 0 1 auto`). The panel root is an inline-size container: ≤420px panel stacks the remaining rows and gives the control full width; ≤300px hides the shared `" drawer"` suffix ("Left drawer" → "Left", full name kept in `aria-label`). Group containers are **troughs on the host card**: the Spindle extension shell is already `--lumiverse-fill-subtle`, so groups step to `--lumiverse-fill` and mode tiles stay `fill-subtle` to pop off them (never `fill-subtle`-in-`fill-subtle`). Canvas-invented controls (mode tiles, `?` popover, the 36×20 switch) keep their shapes but wear host tokens; the switch spec is **shared with Configure Tabs** (36×20 border-box track `fill-strong`+`border`, 14px knob inset 2px / 16px travel, knob off `--lumiverse-text` / on `var(--lumiverse-primary-contrast, #fff)` — engine-emitted token, keep the fallback). Mode tiles sit under a host-style "Chrome mode" `.headerRow` eyebrow + `?` line (the help chip must never be absolutely positioned over the tile grid — it collided with the selected tile's corner dot). Tile captions hide only ≤420px viewport (not for all coarse pointers); under coarse/narrow, `±4px` invisible `::before` hit expanders pad the toggle and help chip to the 24px minimum.

**Sections:**
1. **Drawers / Taskbars** — mode tiles (Vanilla / Taskbar / OS, one combined `setSettings` patch each; effective state derived via `osMode` then `isTaskbarModeEnabled`; Vanilla auto-returns a Top/Bottom layout to Sides). Tile clicks are **last-click-wins** (`selectModeSeq` token — a slower earlier click cannot overwrite a later one's write, L14 2026-09-23). Entering/leaving OS records the shape-only `willRestore` gate on `os/os-configure-gate` before flipping `osMode` so the OS run only refreshes (discards) an open Configure draft when the dirty dialog would have run (L13). drawerLocation ("Drawer layout" segmented Sides|Top|Bottom; disabled while the settings load is in flight), secondSidebarEnabled ("Drawer mode" Single|Dual via `requestSecondDrawerMode`), main drawer side (live-derived from the store/override; dispatches `{t:'swapSides'}` only when the MODEL side differs; locked pre-model / mid-swap), moveControlsToOuterEdge ("Move tab strip to outer edge"), hideDrawerOpenCloseButtons (requires taskbar mode; inert + checked while horizontal), mirrorCompactPosition ("Mirror drawer open/close buttons"; directly under Hide drawer open/close buttons, requires the second drawer), optionsButtonLocation / startButtonLocation (Left drawer|Right drawer|Both; display resolves `null` to the main drawer's side), startButtonAlwaysOnScreenEdge (inert outside Top/Bottom), startButtonAtStripTop ("Start button at top of tab strip"; Sides only — disabled + inert hint while horizontal), osWindowControls (OS only), coreTabsHidden (locked on in OS), drawerShadowsDesktop / drawerShadowsMobile. Row order is pinned by `drawer-location-panel.test.ts` (2026-09-23g: Drawer mode above Main drawer side; the two open/close-handle rows directly above Options button location). `horizontalSplit` (Top/Bottom dual-drawer boundary) has **no panel row** — it is adjusted by dragging the strip's boundary handle and persisted to settings.json; see `docs/sidebar.md` §Drawer location.
2. **Layout** — chatReflow, welcomeReflow ("Center the landing page in the visible area"), dragAndDropDrawerTabs ("Drag and drop tabs"), resizeSidebars ("Drag to resize panels").
3. **Persistence** — persistDrawerOpenState, persistDrawerWidth ("Remember drag-to-resize"); tab-assignment persistence is always-on.
4. **Misc** — slashCommandsEnabled, debugMode.

Chrome-location lifecycle: `os/chrome-locations.reconcileChromeLocations()` is the single fan-out (Options gear + Start sides + edge attr). It is called from the three new features' unconditional mount/apply, `DRAWER_SHELL_CREATED_EVENT` (via the Start ensure), `refreshSideGeometry` (S4 flips), `resetSideRemountStateAfterDisable`, `drawerLocationFeature.apply`, and after `applyCanvasSideChange`. Do **not** rely on `applySettings` alone: it early-returns when the panel is not mounted and never sees side/dual changes with no settings diff.

### Settings Diff Dispatch (`applySettings`)

Iterates the feature registry and calls `feature.apply()` for any feature whose setting changed. This is the single live-update entry point.
