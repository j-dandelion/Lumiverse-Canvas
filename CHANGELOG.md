# Changelog

## v1.7.0 — 2026-06-19

### Added

- Built-in tab mobility: move built-in tabs (Databank, Characters, History, etc.) to the secondary drawer via right-click context menu.
- Secondary drawer auto-closes when the last tab is moved out.
- Secondary drawer header syncs with the active tab's title from the main drawer.

### Fixed

- Drawer open/close state is now preserved across hard refreshes when layout persistence is on. Previously the secondary drawer was force-opened whenever tabs were assigned, ignoring the saved close state.
- Secondary drawer tab button stays visible when tabs are assigned but the drawer is closed.
- Secondary drawer open/close tab aligns with the main drawer tab after a drawer-side change in Lumiverse display settings.
- Built-in tab assignments restore correctly on hard refresh.
- Tab buttons and content restore correctly after disabling and re-enabling the extension.
- Chat reflow observer persists across SPA navigation instead of timing out after 5 seconds.
- Secondary drawer creates a missing tab button when the root element is already in the DOM.
- Extension tab root is reparented on drawer move to preserve its state.
- Panel margin (space between tab content and panel edge) is preserved when tabs move to the secondary sidebar.
- Extension tabs deduplicate correctly when moved between drawers.
- Active tab button color is distinguishable from inactive in all themes.
- Extension tab activation and deactivation work correctly with built-in tabs present.

### Changed

- "Second Sidebar" renamed to "Second drawer" in user-visible labels.
- "Enable Second drawer" renamed to "Enable second drawer".
- "Move to Main Sidebar" context menu label renamed to "Move to main drawer".

## v1.6.5 — 2026-06-15

### Fixed

- Extension tabs that set `display: flex` no longer collapse when moved to the secondary drawer.
- `syncDrawerTabSettings` no longer fires 12+ redundant calls per tick; style writes are coalesced.
- Active secondary tab icon is distinguishable from inactive in all themes.
- Slash commands dispatch correctly on mobile.
- Iframe no longer captures pointer events during drawer resize drag.
- Chat reflow applies on SPA navigation without requiring a sidebar close/reopen cycle.
- Extension inline display styles are preserved when moving tabs to secondary.

## v1.6.4 — 2026-06-13

### Fixed

- Chat reflow no longer over-insets when the LumiScript dock panel is on the same side as the main drawer.
- Secondary sidebar header and active tab state restore after a drawer-side flip.
- Restored tab from secondary renders with content instead of empty.
- Closing then reopening the secondary sidebar restores moved-tab visibility.
- No flicker when moving an un-activated tab to the secondary sidebar.
- Drag-resizing the secondary drawer no longer briefly shows all moved tabs at once.
- Extension tab move/restore works with LumiScript installed.

## v1.6.3 — 2026-06-11

### Added

- "Move tab controls to outer edge" toggle in Sidebars settings.
- Vertical drag-to-reposition for drawer tabs. Drag the main or secondary drawer tab up/down to reposition it vertically.

### Fixed

- Chat reflow no longer affects mobile visuals.
- Chat reflow no longer reads a stale `drawerOpen` state after rapid tab clicks.
- Reflow teardown no longer leaks the observer or animation frame.
- Secondary sidebar build default now matches the OFF-case.

## v1.6.2 — 2026-06-11

### Fixed

- Sidebar shadows (desktop) and (mobile) settings now survive a hard refresh.

### Removed

- Unreachable `mount()` stubs from shadow features.

## v1.6.1 — 2026-06-10

- Re-bundled. No behavioral changes since v1.6.0.

## v1.6.0 — 2026-06-09

### Added

- "Sidebars" settings category with desktop and mobile shadow toggles.
- "Enable slash commands" toggle in Chat & Layout settings.

### Fixed

- Slash commands toggle actually disables the popup at runtime.
- Secondary drawer tab no longer pins to x=600 when slowly drag-resizing wide to narrow.
- Secondary resize handle renders at full width (was clipped by `overflow: hidden`).

## v1.5.10 — 2026-06-06

### Fixed

- Main sidebar peek on mobile after cross-device sync.
- Hard refresh no longer breaks drawer interactions.
- Close animation restored on desktop.

### Changed

- Extracted `_initObservers()` for immediate and deferred initialization paths.
- Deleted dead module `chat/last-chat.ts`, removed 8 dead exports, 2 deprecated aliases.
- Normalized console calls to debug-gated `dwarn`.

## v1.5.9 — 2026-06-05

### Fixed

- Main sidebar peek on mobile when drawer is closed.
- Secondary sidebar width clamped on narrow viewports.
- Debug logging gated behind the Canvas debug setting.
- Version-stamp stale-bundle warning no longer fires spuriously.

### Changed

- Internal cleanup: net -1152 lines, no user-visible behavior changes.

## v1.5.3 — 2026-06-04

### Fixed

- Settings persist across Lumi restarts. Atomic writes, debounced saves, and unload flush prevent data loss.

### Changed

- Disable and re-enable no longer doubles event handlers.
- Stale frontend bundle surfaces a visible console warning.

## v1.5.2 — 2026-06-03

### Fixed

- Tab context menu on mobile: long-press keeps menu open; glass mode gated to non-touch devices.

## v1.5.1 — 2026-06-03

### Fixed

- Context menu entrance animation uses `animation-fill-mode: forwards`.

## v1.5.0 — 2026-06-03

### Fixed

- Settings panel toggles respond to taps (previously threw silent ReferenceError).
- Settings panel re-renders after saved layout loads.
- `getTabAssignments()` return type widened to `Map`.

## v1.4.3 — 2026-06-03

### Fixed

- Settings panel toggles can be flipped in both directions.

## v1.4.2 — 2026-06-03

### Changed

- `/select` toast no longer includes the "scroll to load" suffix.

## v1.4.1 — 2026-06-03

### Fixed

- Pressing Enter on a complete slash command preserves typed args.
- Suggest popup row click preserves typed args.

## v1.4.0 — 2026-06-03

### Added

- Per-feature settings panel with 10 toggleable features.
- `CanvasSettings` interface and `mergeCanvasSettings` helper.
- Live update path for all settings.
- Debug-mode toggle consolidates old localStorage and window function hacks.

### Changed

- Frontend bundle reduced from 77.7 KB to 74.5 KB.
- Panel header is flat inline title.

## v1.3.0 — 2026-06-03

### Fixed

- Tab move no longer desyncs when React re-mounts the active tab.
- "Panel appears in both sidebars" symptom fixed.
- "Panel does not appear" symptom fixed.

### Removed

- `hideRepositionedTabs`, `_savedStyles`, dead window properties, unused locals, permanent no-op listener.

## v1.2.0 — 2026-06-02

### Changed

- Slash-suggest and toast surfaces use injected CSS with canonical `--lumiverse-*` variables.
- Context menu matches Lumiverse's shared `ContextMenu` style exactly.

### Added

- Full keyboard nav for slash-suggest popup (Enter, Tab, Arrow keys, Escape).
- Suggest popup rows show command description and source badge.
- ARIA combobox/listbox/option attributes.
- IME composition guard prevents popup flicker during CJK input.
- Single-menu invariant: canvas context menu closes before Lumiverse's opens.

### Fixed

- Context menu box-shadow matches Lumiverse's shared style.
- Toast z-index no longer occludes suggest popup.
- Context menu removed from DOM on close for clean re-entry animation.

## v1.1.0 — 2026-06-02

### Added

- Slash-command runtime: type `/command args` in the main chat input.
- Built-in commands: `/help`, `/select`.
- Cross-extension command registry via `canvas:slash-register` CustomEvent.
