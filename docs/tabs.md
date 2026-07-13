# Tab Management

## Overview

Canvas manages tabs across two drawers: the main (Lumiverse-owned) and the secondary (Canvas-owned). The tab system handles button visibility, assignment tracking, active-tab state, context menus, and activation handoff when tabs move between drawers.

## Tab ID Format

Lumiverse assigns tab IDs in the format: `spindle:{extensionId}:tab:{tabName}:{counter}`

The `counter` is a session-variant suffix (`:1`, `:2`, `:3`) that changes across sessions. Canvas handles this via suffix-drift fallback: strip the trailing `:N` and match by the prefix.

## Assignment System (`tabs/assignment.ts`)

The `_tabAssignments` Map tracks `tabId → 'primary' | 'secondary'`.

### Key Functions

- `getTabAssignments()` — read the full map
- `hasTabAssignment(tabId)` — check if assigned
- `setTabAssignment(tabId, panel)` — set assignment
- `deleteTabAssignment(tabId)` — remove assignment
- `clearTabAssignments()` — reset all (called on teardown)
- `getTabSidebar(tabId)` — returns 'primary' or 'secondary'

### `assignTab(tabId, sidebar)` — The Policy Layer

This is the public API for "move this tab to that sidebar". It delegates to:

- **To secondary**: `SecondaryDrawer.assignToSecondary()` for extensions; host bridge `requestTabLocation()` for built-ins
- **To primary**: `SecondaryDrawer.unassignFromSecondary()` + host bridge `requestTabLocation({ kind: 'main-drawer' })` for built-ins

Built-in tab pre-activation: `ensureBuiltInTabActiveInMain(tabId)` clicks the main sidebar button to trigger Lumiverse to mount the panel before the move.

## Button Management (`tabs/buttons.ts`)

### Main Sidebar

- `hideMainTabButton(tabId)` — sets `display: none` on the button
- `showMainTabButton(tabId)` — clears `display: none`
- `findMainTabButton(tabId)` — lookup by:
  1. `data-tab-id` attribute (fast path, set by tag-buttons)
  2. Direct `title` attribute match (LumiScript fallback)
  3. Store-based title match (pre-tag window)

### Secondary Sidebar

- `addSecondaryTabButton(tab)` — creates a button in `.sidebar-ux-tab-list` with icon, label, click handler (opens drawer + shows tab), and right-click handler (shows context menu)
- `removeSecondaryTabButton(tabId)` — removes the button
- `showSecondaryTab(tabId)` — activates a tab by setting `data-canvas-active` on the matching root, updating header title, toggling `sidebar-ux-tab-active` class on buttons
- `updateDrawerTabVisibility()` — shows/hides the drawer tab button based on whether any tabs are assigned

### Settings Button Detection

`isSettingsButton(btn)` — heuristic to exclude the Settings tab from move operations. Checks class, aria-label, and title for "settings"/"preferences".

## Active Tab Tracking (`tabs/active-tab.ts`)

### Main Drawer

`getActiveTabId()` returns a discriminated union:
- `{ state: 'closed' }` — drawer is closed
- `{ state: 'active', id: string }` — the active tab's ID
- `{ state: 'other', id: string }` — some other tab is active
- `{ state: 'unknown' }` — can't determine

`isTabActiveInMainDrawer(tabId)` — boolean wrapper with DOM fallback (the store can lag behind DOM class changes).

### Secondary Drawer

`getActiveSecondaryTabId()` / `setActiveSecondaryTabId(tabId)` — in-memory tracking.

## Activation Handoff (`tabs/activation-handoff.ts`)

When a tab moves between drawers, the handoff orchestrator decides what happens in both the source and destination.

### Rules

- **Part A**: Source activates a neighbor iff the moved tab was active in the source
- **Part B**: The neighbor is the tab immediately above the moved tab's slot; if none, the tab below
- **Part C**: Destination activates the moved tab on every move (except on mobile)

### `runHandoff(args)`

1. Capture source tab list before the move
2. Check if moved tab was active (`isMovedTabActiveInSource`)
3. Pick replacement (`pickSourceReplacement`)
4. If active + replacement exists: activate replacement in source
5. If not mobile: activate moved tab in destination

### `captureSourceList(side)`

Captures ordered tab IDs before the move. For primary: merges DOM buttons (built-in) + store (extension), filters out tabs already in secondary. For secondary: reads `.sidebar-ux-tab-list` buttons.

## Dual Mode × Configure Tabs (`tabs/configure-*.ts` + `layout/vanilla-baseline.ts`)

Canvas intercepts "Configure tabs" from Lumiverse's context menu regardless of whether the second drawer is enabled (always-on intercept, started in `setup.ts`). The modal presentation depends on the second-drawer state:

- **Second drawer enabled**: Configure Tabs opens in dual-column mode. The user can reorder tabs across columns, change visibility, swap drawer sides, and apply the change.
- **Second drawer disabled**: Configure Tabs still opens (Canvas modal, not vanilla Lumiverse). The footer toggle lets the user enable the second drawer directly from within the modal.

The host `drawerSettings` are patched in one atomic-like write via `commitConfigureDraft` (see `tabs/configure-commit.ts`).

### Three dual-mode state paths

Canvas maintains three distinct state paths for the second drawer lifecycle:

| Path | When | Source | Behaviour |
|------|------|--------|-----------|
| **First-enable seed** | First time user enables second drawer (no prior dual tabs anywhere) | Live `snapshotLayout()` | Seeds `lastLoaded` with live primary, secondary closed/empty. Runs **before** `setSettings`. |
| **Re-enable dual restore** | User re-enables after a prior dual session | `lastLoaded` (synced during disable) or session profile | `applyLayout()` or `restoreSessionDualProfile()` to restore prior tab assignments. |
| **Vanilla baseline (disable)** | On disable (off path) | Session-only `vanilla-baseline.ts` | Restores host `drawerSettings` + main open/active to pre-dual state. |

The first-enable seed is implemented in `layout/persist.ts` (`seedDualLayoutFromLive`). It is guarded by `hasDetachedTabs()` which checks both `lastLoaded` and the session dual profile. If either has detached tabs, the seed is skipped — this prevents overwriting real dual tabs on re-enable.

### Conflict rule: baseline wins on disable

A **session-only vanilla baseline** is captured the first time the user enables the second drawer. It contains the pre-dual host `drawerSettings` + main open/active state. On disable:

| Configure Tabs choice during dual session | Effect on baseline | Effect on disable |
|------------------------------------------|-------------------|-------------------|
| **Apply** | Baseline unchanged | Restore overwrites the Apply with vanilla state |
| **Discard** | Baseline unchanged | Restore applies vanilla (the Discard never wrote anyway) |
| **Cancel** | Baseline unchanged | No effect (the user stays in dual) |
| (no dirty draft) | Baseline unchanged | Restore applies vanilla (no dual changes to overwrite) |

**Repeated Apply** in the dual session: each Apply patches the host `drawerSettings` (active dual session only) but does not modify the baseline. The baseline represents the **first** pre-enable state, not the state at the time of the last Apply. On disable, that first state is restored.

**Repeated enable** (no disable in between): the baseline is not recaptured — `captureVanillaBaseline()` is idempotent and returns `captured: false` when a baseline already exists. This preserves the original pre-dual state across repeated toggles within the same dual session.

### Teardown + restore ordering

`finishDisable()` (in `settings/second-drawer-mode.ts`) runs the following sequence:

1. Resolve any dirty Configure Apply/Discard/Cancel dialog.
2. Capture session dual profile (existing — Canvas-owned state to re-enable).
3. Merge dual into `lastLoaded` + flush + sync freeze base (tab-assignment persistence is always-on, so this is unconditional).
4. `setSettings({ secondSidebarEnabled: false })` — feature.apply tears down the secondary sidebar.
5. **Vanilla baseline restore** (new) — `restoreVanillaBaseline()` patches host `drawerSettings` + restores main open/active. Done AFTER teardown so the host tabs are back in main-drawer before the restored primary tab is clicked.
6. Modal refresh from live (existing) — now shows the restored vanilla layout.
7. **Clear baseline on success** — `clearVanillaBaseline()`. On failure (NO-GO / partial), retain the baseline for retry.

### Why baseline wins

### Auto-save behavior (2026-07-12)

Configure Tabs now auto-saves individual edits immediately rather than
waiting for Done. The draft model is retained but commits happen
automatically on toggle hide, swap side, and drag-end (not mid-drag).

| Action | Behavior |
|--------|----------|
| Toggle tab hidden (eye icon) | Draft commits immediately (no Done needed). |
| Swap drawer side radio | Draft commits immediately (no Done needed). |
| Drag-end within or between columns | Draft commits immediately (no Done needed). |
| Mid-drag | No draft commit; the previous committed state is unchanged. If drag-tab and drop-tab change order, only the final drop commits. |
| Close modal (X / Escape) | No special behavior — regular draft-based close dialog applies. |
| Enable/disable second drawer | No special behavior — full mode-switch dialog. |
