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
    "layoutPersistence": true,
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

## Frontend Persistence (`layout/persist.ts`)

### Two Write Paths

1. **`persistOpenState()`** — synchronous. Used by open/close/resize handlers so "open then immediately close" records the final state. Also drains any pending `persistLayout()` debounce and `cancelSettingsSave()` to prevent double-writes.
2. **`persistLayout()`** — 500ms debounced. Used by tab assignment and resize (high-frequency operations). Also cancels any pending settings save.

### `snapshotLayout()`

Builds the current layout from in-memory state:
- `primary`: reads from module-level cache (`_mainDrawerOpen`, `_mainDrawerTabId`) + DOM measurement for width
- `secondary`: reads `isSecondarySidebarOpen()`, CSS variable for width, `getActiveSecondaryTabId()` for active tab
- `detachedTabs`: maps secondary assignments to `{ tabId, tabTitle, sidebar }`

### `loadSavedLayout()`

1. Sends `LOAD_LAYOUT` IPC
2. Resolves on first `LAYOUT_DATA` response
3. 2s safety timeout (resolves null if backend doesn't respond)

### `flushPendingSaves()`

Drains both layout and settings debounce timers, posts a single merged SAVE_LAYOUT. Called on `pagehide`/`beforeunload`/`visibilitychange` to prevent data loss.

### `applyMainDrawer(layout)`

Restores the main drawer's open/close + active tab. Delegates to `restoreMainDrawerFromDom()` which:
1. Compares current state with saved state
2. If open target: clicks the first tab button to open the drawer
3. If closed target: clicks the drawer toggle button to close
4. Restores width by setting `drawer.style.width` and `--drawer-panel-w`

### Main Drawer State Cache

The module maintains `_mainDrawerOpen` and `_mainDrawerTabId` — populated by the watcher in `main-persist.ts`. `snapshotLayout()` reads these instead of the Zustand store (which has a 3s cache TTL).

## Main Drawer Persistence (`sidebar/main-persist.ts`)

The main drawer is host-owned — Canvas can't call its API directly. Instead:

1. **Open/close**: `MutationObserver` on the wrapper's class attribute (`wrapperOpen` class)
2. **Active tab**: `MutationObserver` on the sidebar for `tabBtnActive` class movement
3. **Width**: `ResizeObserver` with 300ms debounce

**Suppress/unsuppress pattern**: On mount, the wrapper is hidden (`visibility: hidden`) to prevent a flash of the default state while the async `LOAD_LAYOUT` resolves. `unsuppressMainDrawer()` restores visibility after state is applied or after a 3s timeout.

**Restore**: `restoreMainDrawerFromDom()` simulates clicks on the host's tab buttons since `spindle.ui.openDrawerTab` is not available to extensions at runtime.

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

Settings are merged into the layout blob as the `settings` field. `persistSettings()` debounces at 100ms and posts `SAVE_LAYOUT` with both `snapshotLayout()` and `getSettings()`.

When `layoutPersistence` is OFF, `persistSettings` records a clean snapshot (everything closed, no detached tabs).
