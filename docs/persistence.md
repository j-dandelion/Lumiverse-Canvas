# Layout Persistence

## Overview

Canvas persists the full UI state (drawer open/close, widths, tab assignments, settings) to a `layout.json` file on the host's filesystem via the Spindle backend IPC.

## Storage Format

`layout.json` is a JSON blob with this shape:

```json
{
  "version": "1.7.1.0",
  "primary": {
    "open": true,
    "width": 420,
    "tabId": "spindle:uuid:tab:profile:1"
  },
  "secondary": {
    "open": true,
    "width": 350,
    "activeTabId": "spindle:uuid:tab:lorebook:2"
  },
  "detachedTabs": [
    { "tabId": "spindle:uuid:tab:lorebook:2", "tabTitle": "Lorebook", "sidebar": "secondary" }
  ],
  "settings": {
    "secondSidebarEnabled": true,
    "resizeSidebars": true,
    "chatReflow": true,
    "persistDrawerOpenState": true,
    "persistDrawerWidth": true,
    "slashCommandsEnabled": true,
    "debugMode": false,
    ...
  }
}
```

## Frontend-Backend IPC

Communication uses `spindle.sendToBackend()` / `spindle.onFrontendMessage()`:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `SAVE_LAYOUT` | FE → BE | Persist layout blob |
| `LOAD_LAYOUT` | FE → BE | Request layout load |
| `LAYOUT_DATA` | BE → FE | Response with layout blob |
| `SET_DEBUG` | FE → BE | Toggle backend debug logging |

## Backend (`backend.ts`)

- `loadLayout()` — reads `layout.json` via `spindle.storage.read()`
- `saveLayout(state)` — atomic write: writes to `layout.json.tmp`, then `storage.move()` to `layout.json`. Falls back to direct write on cross-device/Windows errors.
- Uses `spindle.storage.*` (not raw `fs`) because the host resolves paths against a per-extension, per-user storage root.
- Serializes `SAVE_LAYOUT` requests and makes `LOAD_LAYOUT` wait for queued saves. Extension updates can overlap IPC handlers; without this ordering, an older slower write can overwrite a newer layout or a reload can read stale settings.

## Frontend Persistence (`layout/persist.ts`)

### Two Write Paths

1. **`persistOpenState()`** — synchronous. Used by open/close/resize handlers so "open then immediately close" records the final state. Also drains any pending `persistLayout()` debounce and `cancelSettingsSave()` to prevent double-writes.
2. **`persistLayout()`** — 500ms debounced. Used by tab assignment and resize (high-frequency operations). Also cancels any pending settings save.

### `snapshotLayout()`

Builds the current layout from in-memory state:
- `primary`:
  - **Host main** (default): module-level cache (`_mainDrawerOpen`, `_mainDrawerTabId`) + `getMainDrawerWidth()`
  - **Canvas main mirror** (`taskbarMode` desktop): `html.sidebar-ux-canvas-main-open` for open + `--sidebar-ux-main-mirror-w` for width (host wrapper is headless; measuring it freezes stale open/width)
- `secondary`: reads `isSecondarySidebarOpen()`, CSS variable for width, `getActiveSecondaryTabId()` for active tab
- `detachedTabs`: maps secondary assignments to `{ tabId, tabTitle, sidebar }`

### Layout facets (settings)

Two user-facing toggles control which parts of the layout are saved and restored:

| Setting | Restores / writes |
|---------|-------------------|
| `persistDrawerOpenState` | `primary.open`, `primary.tabId`, `secondary.open` |
| `persistDrawerWidth` | `primary.width`, `secondary.width` |

Tab-assignment persistence (`detachedTabs`, `secondary.activeTabId`) is **always-on** (built-in) and not user-configurable. There is no user-facing toggle for it.

**Write path:** every SAVE_LAYOUT uses `buildPersistedLayout()` — live values for enabled facets, last-loaded (or defaults) for disabled facets. Turning a facet off freezes its disk value rather than scrubbing it. Tab assignments are always written from the live state (or frozen from last-loaded when the second drawer is off).

**Restore path:** `applyLayout` / `applyMainDrawer` apply only the enabled facets, but tabs are always restored. Old disks with only `layoutPersistence` migrate in `mergeCanvasSettings` (true → open + width on; false → open + width off). Secondary open restore also requires at least one live secondary tab assignment (tabs are always restored, so the check is just whether the restored map has any tabs assigned); open facet alone does not show an empty second drawer.

### `loadSavedLayout()`

1. Sends `LOAD_LAYOUT` IPC
2. Resolves on first `LAYOUT_DATA` response
3. 2s safety timeout (resolves null if backend doesn't respond)

### `flushPendingSaves()`

Drains both layout and settings debounce timers, posts a single merged SAVE_LAYOUT. Called on `pagehide`/`beforeunload`/`visibilitychange` to prevent data loss.

The same flush runs during extension teardown because the Extension tab's update/unload path does not reliably emit page lifecycle events. Teardown also cancels the in-flight layout load and prevents a late async load from mounting stale Canvas features after the replacement bundle starts.

### `applyMainDrawer(layout)`

Restores the main drawer's open/close + active tab. Delegates to `restoreMainDrawerFromDom()` which:
1. **Canvas main mirror** (`taskbarMode`): sets `--sidebar-ux-main-mirror-w`, calls `openCanvasMainDrawer` / `closeCanvasMainDrawer`, clicks host/mirror tab for content
2. **Host main** (default):
   - Compares current state with saved state
   - If open target: clicks the tab button to open the drawer
   - If closed target: clicks the drawer toggle button to close
   - Restores width via `drawer.style.width` and `--drawer-panel-w`

### Main Drawer State Cache

The module maintains `_mainDrawerOpen` and `_mainDrawerTabId` — populated by the watcher in `main-persist.ts`. `snapshotLayout()` reads these instead of the Zustand store (which has a 3s cache TTL).

## Main Drawer Persistence (`sidebar/main-persist.ts`)

The main drawer is host-owned — Canvas can't call its API directly. Instead:

1. **Open/close**: `MutationObserver` on the wrapper's class attribute (`wrapperOpen` class)
2. **Active tab**: `MutationObserver` on the sidebar for `tabBtnActive` class movement
3. **Width**: `ResizeObserver` with 300ms debounce

**Suppress/unsuppress pattern**: At the start of `setup()`, `beginMainDrawerRestoreGuard()` adds `html.sidebar-ux-main-restore-pending`. Styles + inline stamps hide host main, main-mirror shell, and every main panel body (**opacity:0** — `visibility:hidden` alone is not enough when content forces `visibility:visible`).

**Unsuppress readiness** (main-mirror and host): lift the guard only when (1) the **host** sidebar has `tabBtnActive` for the saved `primary.tabId` for **≥ N consecutive polls** (`RESTORE_HOST_STABLE_POLLS`, poll every `RESTORE_TAB_POLL_MS` ≈16ms; re-click when `polls % 3 === 0` while host not yet active), **and** (2) the parked panel body has settled (childList mutation quiescence, or a short fallback if the tab was already correct / empty). Final panel-body stamp + repark run while still pending, then two rAF unsuppress. Canvas mirror chrome (`_activeMainMirrorKey` / `sidebar-ux-tab-active` on mirror buttons) is **not** a restore-ready signal — `activateMainMirrorFromRestore` paints header + highlight before React commits panel children. Secondary `finishRestore` re-asserts primary via `ensureRestoredPrimaryTab` (also host-only). ~1s poll budget + fail-forward unsuppress if restore never completes.

**Restore**: `restoreMainDrawerFromDom()` simulates clicks on the host tab (with Canvas active-key update under taskbar mode) since `spindle.ui.openDrawerTab` is not available to extensions at runtime. Open/width are applied while still suppressed; visibility lifts only once host active + content settle.

## Vanilla Baseline (session-only) (`layout/vanilla-baseline.ts`)

The vanilla baseline is a **session-only** snapshot of the pre-dual host state, captured when the user transitions from single-drawer to dual-drawer mode. On the return trip (disable), the baseline is applied so the user sees the same vanilla Lumiverse layout they had before enabling the second drawer.

**Captured fields:**
- Host `drawerSettings`: `side`, `tabOrder`, `hiddenTabIds`, `showTabLabels`
- Main drawer open state
- Main drawer active tab id

**Strictly session-only.** The baseline is **not** persisted to `layout.json`. A page reload while in dual mode is a no-op for the baseline (it stays in memory only). This is intentional — the baseline represents the in-flight mode transition, not durable layout data.

**Independent from the dual session profile** (`layout/dual-session-profile.ts`):
- Dual profile = Canvas state to restore on re-enable (Canvas-owned)
- Vanilla baseline = host state to restore on disable (host-owned)

**Conflict rule: baseline wins.** Any Configure Apply, host-side edit, or other temporary dual change to the host `drawerSettings` / main open/active is overwritten on disable with the captured pre-dual state. Discard and Cancel do not modify the baseline.

**Capture timing:** `requestSecondDrawerMode(true)` calls `captureVanillaBaseline()` **before** `setSettings({ secondSidebarEnabled: true })` and before any dual UI mount can mutate host settings. Capture is idempotent — repeated enable calls (without a successful disable in between) do not overwrite the existing baseline.

**Restore timing:** `finishDisable()` calls `restoreVanillaBaseline()` **after** `setSettings({ secondSidebarEnabled: false })` (which tears down the secondary sidebar via the feature.apply path) and **before** refreshing any still-open Configure Tabs modal. The restore is unconditional (not gated on `persistDrawerOpenState` or `persistDrawerWidth`) — the "baseline wins" rule applies regardless of facet settings.

**Restore implementation:**
1. `patchHostDrawerSettings()` — atomic-like single patch for side, tabOrder, hiddenTabIds, showTabLabels. NO-GO (no setSetting in fiber tree) returns `false`; baseline is retained for retry.
2. `restoreMainDrawerFromDom()` from `sidebar/main-persist.ts` — same path as initial load restore. Bypasses the open/width facet gates so the baseline restores unconditionally. The restore-pending guard, content-settle watch, and `ensureRestoredPrimaryTab` handoff all run as on initial load.
3. **Fallback behavior:** if the saved active tab is hidden or no longer registered (e.g. extension tab removed mid-session), pick a safe fallback tab (first visible host tab) rather than failing.

**Failure handling:** if `patchHostDrawerSettings` returns false (NO-GO) or the main drawer restore fails partially, the baseline is **retained** so the next attempt (or the next disable cycle) can retry. Silent success claims are avoided per the plan's "no false restore" rule.

**Clear:** on successful restore, `finishDisable()` calls `clearVanillaBaseline()`. The next single → dual transition captures a fresh snapshot of the (now restored) vanilla state.

## First-Enable Seed (`layout/persist.ts` — `seedDualLayoutFromLive`)

When the user enables the second drawer for the **first time** (no prior dual tabs exist on disk or in the session profile), Canvas seeds the dual layout from the current live single-drawer state rather than restoring stale or empty defaults.

**Trigger:** `requestSecondDrawerMode(true)` checks `hasDetachedTabs(lastLoaded)` and `hasDetachedTabs(sessionProfile)` after capturing the vanilla baseline but **before** `setSettings({ secondSidebarEnabled: true })`. If both are empty/missing, the seed runs.

**Seed contents:**
- `primary`: copied from `snapshotLayout()` — preserves the current drawer open state, width, and active tab.
- `secondary`: hard-coded to `open: false`, width matching the primary width, `activeTabId: null`.
- `detachedTabs`: empty array.

**Why before setSettings:** the seed is written to `_lastLoadedLayout` so `secondSidebarFeature.apply` reads it during its mount callback. Without the seed, the feature would see a stale lastLoaded (possibly with ghost secondary state from a prior session) and attempt to restore tabs that don't exist.

**Re-enable (has dual tabs):** skipped entirely — `hasDetachedTabs` returns true for lastLoaded or the session profile, so the restore path (`applyLayout` or `restoreSessionDualProfile`) runs unchanged. The seed does not overwrite real dual tabs.

**Helper functions:**
- `hasDetachedTabs(layoutOrProfile)` — null-safe check for at least one entry in `detachedTabs`.
- `seedDualLayoutFromLive()` — snapshots live layout, builds and writes the seed.

## Layout Restore (`layout/apply.ts`)

Restores the secondary sidebar state:

1. Set `--sidebar-ux-secondary-w` from saved width (clamped to viewport)
2. Restore wrapper transform (animate if needed)
3. For each `detachedTabs` entry:
   - Try exact match in store
   - Try suffix-drift fallback (strip `:N` suffix)
   - Try DOM fallback (find button in main sidebar)
   - Call `assignToSecondary(tabId)`
4. Use `MutationObserver` on sidebar to catch late tab registrations
5. 10s safety timeout
6. End-of-restore: pick active tab, re-apply open/closed state

**Guard**: `setRestoringFromLayout(true/false)` prevents the `onTabUnregistered` handler from interfering during restore.

## Settings Persistence

Settings are merged into the layout blob as the `settings` field. `persistSettings()` debounces at 100ms and posts `SAVE_LAYOUT` with `buildPersistedLayout()` geometry plus `getSettings()`.

Tab assignment is always written (built-in). When the remaining two user-facing layout facets (open + width) are both OFF, their geometry fields come from the last-loaded layout (or closed defaults), so re-enabling a facet later does not lose the previous disk state.
