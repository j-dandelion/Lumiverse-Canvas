# Changelog

## v1.4.2 — 2026-06-03

### Changed
- `/select` toast messages no longer include the "scroll to load" suffix.
  The actionable counts (matched/missing) are still reported; the
  imperative "scroll to load" instruction is dropped. The Lumiverse
  chat surface already makes the scroll affordance obvious.

## v1.4.1 — 2026-06-03

### Fixed
- Pressing Enter on a complete slash command no longer wipes the typed
  args. The intercept handler now checks `parseCommand(ta.value)` first
  and dispatches when the textarea already holds a valid command, even
  if the suggest popup is visible. Previously `/select 1-3` + Enter would
  overwrite the value to `/select ` (the active row's `usage`), drop the
  user's `1-3`, and leave the popup hidden — the user had to retype the
  args and press Enter a second time.
- The same protection applies to the suggest-popup row click handler.
  Clicking the row for a command the user has already typed (e.g.
  clicking `/select` while the textarea is `/select 1-3`) no longer
  overwrites the typed args — it dismisses the popup and focuses the
  textarea.

## v1.4.0 — 2026-06-03

### Added
- Per-feature settings panel. Every user-togglable behavior in Canvas is
  now exposed as a switch in a dedicated panel mounted into Lumiverse's
  per-extension settings host (`[data-spindle-mount="settings_extensions"]`).
  10 features are individually toggleable; the second-sidebar master
  switch gates 4 sub-features visually.
- `CanvasSettings` interface and `mergeCanvasSettings` helper in
  `src/types.ts`. Settings ride on the existing `LayoutState` blob and
  persist via the same `SAVE_LAYOUT` IPC — no new storage key, no
  new permissions on `spindle.json`.
- Live update path: every setting has a corresponding handler in
  `applySettings()` so changes apply without a reload. The most visible
  one — the second-sidebar master toggle — mounts/unmounts the wrapper
  in place and restores the saved tab assignments.
- Debug-mode toggle consolidates the old `localStorage.sidebarUxDebug`
  hack and the `window.__sidebarUxDebug()` escape hatch into a single
  panel switch. Window function renamed to `window.__canvasDebug()` and
  console prefix to `[Canvas]`.

### Changed
- `dist/frontend.js` is 77.7 KB → 74.5 KB after field consolidation
  (combined the per-drawer resize toggles and the debug toggles into
  single switches).
- Panel header is now a flat inline title — no bordered box.

## v1.3.0 — 2026-06-03

### Fixed
- Tab move no longer desyncs when React re-mounts the active tab's
  `ExtensionTabContent`. Identification pivoted from DOM-Node identity to
  stable `tabId`. The Node-keyed guard (`isTabMovedToSecondary`) is
  replaced with a tabId-keyed check (`isMovedTabId` + `isMovedTabNode`)
  that re-derives the current Node from a forced-fresh store cache on
  every call, closing the 3-second TTL timing window.
- The "panel appears in both sidebars" symptom is closed. `repositionTab`
  now sweeps the destination container for any prior copy of the tabId
  (tagged with `data-canvas-moved`) and removes it before appending the
  current `tab.root`. The moved Node is tagged on every move so the next
  move can find the orphan.
- The "panel does not appear" symptom is closed. The main panel content
  container is now re-guarded on every move via `ensureNodeGuard`, so a
  React-driven container swap does not leave the moved tab reclaimable
  by the unguarded new container.
- `_originalParents` is now a `tabId`-keyed `Map` (was a `Node`-keyed
  `WeakMap`). Stable across re-mounts; the original parent is a logical
  fact about the tab, not about a specific DOM Node.

### Removed
- `hideRepositionedTabs` function — never called; the equivalent logic is
  inlined in `closeSecondarySidebar`.
- `_savedStyles` Map — declared, get/delete/clear, never set. Dead.
- `__sidebarUxResizeHandler` / `__sidebarUxPositionUpdate` properties —
  read/deleted but never assigned; no `window.addEventListener('resize', …)`
  ever attached them. Dead.
- Unused `secondaryContent` local in `showSecondaryTab` — assigned, never
  read.
- Permanent `ctx.onBackendMessage` no-op in `setup()` — the
  `loadSavedLayout` one-shot handler resolves on the only LAYOUT_DATA the
  backend sends. The permanent listener never fired; it added no value.

## v1.2.0 — 2026-06-02

### Changed
- Slash-suggest popup uses an injected CSS style block tied to the
  canonical `--lumiverse-*` variable set (was inline styles with hex
  fallbacks). Active row uses `--lumiverse-primary-020` background
  fill, matching `~/Lumiverse/frontend/src/components/modals/CommandPalette.module.css:163-165`.
- Toast surface refactored to the same injected style block pattern.
  `error` kind uses `--lumiverse-danger`, `success` uses
  `--lumiverse-success`, `info` preserves the existing
  `var(--lumiverse-info, #42a5f5)` pattern to match core modals
  (`InputArea.tsx:2705`, `RegexEditorModal.module.css`).
- Context menu (right-click on extension tabs) now matches Lumiverse's
  shared `ContextMenu` style exactly: `z-index: 11000`, the same
  shadow, the same `contextMenuIn 120ms ease-out` entrance animation,
  and the `body[data-glass]` glass variant. Mirrors
  `~/Lumiverse/frontend/src/components/shared/ContextMenu.module.css:1-18`.
- Two undefined variables replaced with canonical ones:
  `--lumiverse-bg-surface` → `--lumiverse-bg-elevated` (suggest popup,
  toast surface) and `--lumiverse-font` → `--lumiverse-font-family`
  (suggest popup, typo fix).

### Added
- Full keyboard nav for the slash-suggest popup: `Enter` (dispatch,
  active row wins over parsed name), `Tab` (autocomplete active row's
  `usage` into the textarea; does not dispatch), `ArrowUp` / `ArrowDown`
  (move active row, clamped), `Escape` (dismiss popup, preserves typed
  text). The new `SuggestController` API exposes `setActiveIndex` /
  `getActiveIndex` / `getActiveCommand` / `scrollActiveIntoView` /
  `isVisible`.
- Suggest popup rows now show the command's description (second line,
  muted) and a right-aligned source badge chip (e.g. `[canvas]`,
  `[chronicle]`) — see `CommandPalette.module.css:144-214` precedent.
- ARIA combobox / listbox / option attributes on the textarea and rows.
  `aria-activedescendant` follows the active row. Mirrors
  `~/Lumiverse/frontend/src/components/dream-weaver/components/chat/Composer.tsx:141-209`.
- IME composition guard: the input handler no longer fires
  `onTextChange` while the user is composing a CJK character,
  preventing popup flicker. `compositionend` re-runs detection on the
  next microtask so the popup reflects the committed value, even on
  IMEs that don't fire a trailing `input` event (Gboard swipe, Samsung
  Keyboard). Mirrors the `isComposingRef` pattern in
  `InputArea.tsx:200-205, 1879-1889` and `CommandPalette.tsx:47`.
- Single-menu invariant: canvas's tab context menu and Lumiverse's
  shared `ContextMenu` no longer overlap when right-clicking between
  tabs of different kinds. A capture-phase `contextmenu` document
  listener closes canvas's menu before any other handler opens a new
  one — mirrors the `openMenus` registry in
  `~/Lumiverse/frontend/src/components/shared/ContextMenu.tsx:52, 68-78`.

### Fixed
- Context menu's hardcoded `box-shadow` (rgba literals) replaced with
  the Lumiverse shared-context-menu values, so the canvas extension's
  tab right-click menu now looks identical to the menus on built-in
  tabs.
- Toast `z-index: 10000` → `9980`: toasts no longer occlude the
  suggest popup (which is at `z-index: 10005`).
- Hide-on-close now removes the context menu element from the DOM
  (was `display: none`) so the `contextMenuIn` animation re-runs
  cleanly on every open.

## v1.1.0 — 2026-06-02

### Added
- Slash-command runtime: type `/command args` in the main chat input to
  invoke registered commands. Built-in commands: `/help`, `/select`.
- Cross-extension registry: other extensions can register commands via
  `canvas:slash-register` CustomEvent. See
  `references/slash-command-extension-api.md`.

### /select scope (v1.1.0)
- `/select <range>` — select a range of messages (e.g., `/select 5-10`).
- `/select all` — select all currently loaded messages.
- `/select clear` — clear the current selection.
- `/select hide|unhide|delete <range>` — DEFERRED to v1.2.0.

### Migration from Chronicle v1.1.0
- The `/select <range>` feature that shipped in Chronicle v1.1.0 (released
  2026-06-01) is now in Canvas. Update Chronicle to v1.0.5 to drop the
  duplicate implementation. See `chronicle_ext/AGENTS.md` for the revert
  note.
