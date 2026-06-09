# Changelog

## v1.6.0 — 2026-06-09

### Added

- **New "Sidebars" settings category.** Houses the existing "Drag to resize sidebars" toggle (moved out of "Second Sidebar") plus two new toggles: "Sidebar shadows (desktop)" and "Sidebar shadows (mobile)". Each shadow toggle injects a `<style>` element with `box-shadow: none !important` scoped to its breakpoint (`min-width: 601px` / `max-width: 600px`) targeting both the extension's own drawer (`.sidebar-ux-drawer`) and the host-owned main drawer (`:has(> [data-spindle-mount="sidebar"])`). The desktop toggle defaults ON; the mobile toggle defaults OFF (shadows suppressed on small viewports by default). Initial hydration runs in `setup.ts` after `hydrateSettings()` so the mobile shadow style is present before the secondary drawer mounts — no flash on first paint. Cleanup chain in `setup.ts` removes the injected `<style>` elements on extension disable.
- `[Canvas] mobile-exclusion resize-tick` debug log (gated behind the existing `debugMode` setting, throttled to one entry per 500ms). Reports `innerWidth`, `isMobile`, `sidebarOpen`, the current `cssVar` value, and the wrapper's inline `transform` on each coalesced resize tick. Filter on `mobile-exclusion` in the DevTools console to see the trace while drag-resizing.
- **"Enable slash commands" toggle in the "Chat & Layout" settings section.** New `slashCommandsEnabled` setting (defaults to `true`) gates the entire Canvas slash-command runtime: when off, the keydown/input/click intercept listeners, the suggest popup, the toast surface, and the command registry are all unmounted. Typing `/` in the chat textarea is then plain text — no popup, no parsing, no dispatch. The runtime is mounted/unmounted via the same `applySettings` diff pattern used by the existing master toggles (e.g. `secondSidebarEnabled`); a new `attachSlashRuntime(ctx)` / `_slashDetach()` pair in `settings/panel.ts` keeps the active teardown reference. Setup-time attach in `setup.ts` is also gated on the persisted setting, so a user with the setting off never has the runtime installed.

### Fixed

- **"Enable slash commands" toggle did not actually disable the slash popup.** The initial mount in `setup.ts` and the runtime re-attach in `applySettings` (`settings/panel.ts`) each kept their own reference to the active teardown — the panel's `_slashDetach` stayed `null` after the initial mount, so a user toggling the setting off at runtime hit the `if (_slashDetach)` guard, did nothing, and the intercept listeners kept firing. New exported `setSlashDetach(fn)` in `settings/panel.ts` is the single registration point: `setup.ts` calls it after the initial attach, and `applySettings` calls it after a runtime re-attach. `applySettings` also now `registerCleanup`s the runtime teardown when it mounts at runtime, so a user who toggles the setting on at runtime and then disables the extension still gets a clean teardown (no leaked intercept listeners on `document`).

### Fixed

- **Secondary drawerTab pinned to x=600 when slowly drag-resizing wide → narrow.** The `matchMedia('(max-width: 600px)')` `change` event fires exactly once per boundary crossing, but no `window resize` listener existed to keep `--sidebar-ux-secondary-w` or the wrapper's `translateX` in sync as the viewport continued to narrow. On slow resize the CSS var and the close transform froze at the `window.innerWidth` at the moment of crossing (~600px) while the drawer's `100vw` kept auto-shrinking, so the wrapper overshot and the drawerTab's right edge anchored to that stale x-coordinate — appearing to slide off the right of the screen as the user kept narrowing. A coalesced rAF resize listener inside `startMobileExclusion()` now re-runs `_updateDrawerWidth()` on every frame the user is on mobile, keeping the transform pinned to the actual viewport right edge. Fast resizes and resizes-while-already-mobile were unaffected because the CSS var happened to be set to a value close to the final viewport width (or to the right value to begin with). A separate but real rAF race (a close animation's requestAnimationFrame loop overwriting the corrected transform on a simultaneous breakpoint cross) is also closed: `cancelWrapperAnimation()` is exported from `src/sidebar/animation.ts` and called as the first line of `_updateDrawerWidth()` before the transform write.
- **Second sidebar resize handle rendered narrower than the main sidebar's.** Both handles are created by the same `createResizeHandle()` with `width: 8px`, but the secondary drawer's `overflow: hidden` was clipping the handle's intentional 4px overhang on the inner edge, leaving only ~4px visible. Removed the redundant `overflow: hidden` from the secondary drawer; the children (`sidebar`, `panel`, `content`) already handle their own overflow containment.

## v1.5.10 — 2026-06-06

### Fixed

- **Main sidebar peek on mobile after cross-device sync.** `isMobile()` guard skips `--drawer-panel-w` writes on mobile viewports, preventing the CSS cascade mismatch that caused an ~80px peek when closing the sidebar on phone.
- **Hard refresh broke drawer interactions.** Extension now waits for host DOM via MutationObserver when `getMainDrawer()` returns null, making hard-refresh behave identically to disable+re-enable.
- **Close animation broken on desktop.** Removed `--drawer-panel-w` clear-on-close path — host CSS uses the variable for `translateX` animation.

### Changed

- Extracted `_initObservers()` from `startMainDrawerPersistence()` for immediate and deferred initialization paths.
- Deleted dead module `chat/last-chat.ts`, removed 8 dead exports, 2 deprecated aliases.
- Normalized console calls to debug-gated `dwarn`, extracted shared `injectStyles()` utility.

## v1.5.9 — 2026-06-05

### Fixed
- **Main sidebar peek on mobile.** `restoreMainDrawerFromDom` was setting
  `--drawer-panel-w` with `!important` even when the drawer was closed,
  overriding the host's ~28px collapsed width. The drawer element stayed
  wide and peeked into the viewport. Now only sets the CSS var when the
  target state is open; clears it when closed.
- **Secondary sidebar width on narrow viewports.** Clamped `initWidth`
  and `applyLayout` restore to `max(200, min(innerWidth × 0.8, width))`
  so the closed transform fully hides the sidebar on small screens.
- Debug logging (`[SidebarUX]`) now gated behind the Canvas debug
  setting — server logs are quiet unless debug mode is toggled on.
- The version-stamp stale-bundle warning stopped firing spuriously.
  `CANVAS_VERSION` in `src/layout/persist.ts` was stuck at `1.5.6`
  while `spindle.json` was at `1.5.7`, so the mismatch check warned on
  every load since v1.5.6. The three version strings now agree.

### Changed
- Internal quality. Post-v1.5.7 cleanup of decomp breadcrumbs and dead
  code: net -1152 lines, no user-visible behavior changes.
  - Dropped 16 `FIXME-decomp` + 8 "Step N complete" comments
  - Removed the `DEBUG_LAYOUT_PERSIST` flag in `backend.ts` and the
    `diagFrontend` helper plus its 15 call sites in `layout/persist.ts`
  - Deleted the 60-line duplicate `injectDrawerTabStyles` shadowed by
    the import in `frontend.ts`
  - Trimmed 25 unused imports; the orchestrator `frontend.ts` is now
    4 lines (was 285)
  - Moved `applySettings` from `frontend.ts` to `settings/panel.ts`,
    closing the transient import the decomp never finished
  - Removed three stale `.release-notes-v*` drafts, the 630-line
    salvaged Chronicle reference never imported, and
    `src/slash/RECON.md`; added `.release-notes-*.md` to `.gitignore`

## v1.5.3 — 2026-06-04

### Fixed
- Settings now persist across Lumi restarts. Five overlapping layers were
  closing the door on user toggles: the backend write was non-atomic
  (a process kill mid-write left a truncated `layout.json` that loaded
  as defaults), the 300 ms settings debounce and the 500 ms layout
  debounce could each clobber the other with an out-of-date snapshot,
  there was no flush on page unload (a toggle made <300 ms before the
  tab closed was silently dropped), debounced saves could survive
  teardown and fire after the IPC was gone, and the async
  `loadSavedLayout` could overwrite a toggle the user made during the
  load window. The atomic write now routes through
  `spindle.storage.move` (which is `renameSync` on the host, atomic on
  POSIX and NTFS, and resolves against the host's per-extension
  per-user storage root, not `process.cwd()`); the settings debounce
  drops to 100 ms; `cancelSettingsSave` drains the settings timer
  before every layout write and every flush; `flushPendingSaves` posts
  a single merged save; `pagehide` / `beforeunload` /
  `visibilitychange` listeners arm a flush before unload; and a
  `_userHasTouchedSettings` flag makes `hydrateSettings` a no-op once
  the user has toggled anything.

### Changed
- Disable and re-enable no longer doubles event handlers. The
  context-menu listeners, the reflow `MutationObserver`, the
  secondary sidebar wrapper DOM, the resize-handle DOM, and the
  two injected `<style>` elements are now registered with the
  cleanup chain so they are torn down when the extension is
  disabled.
- A stale frontend bundle surfaces a visible console warning
  instead of silently misbehaving. The saved `layout.json` now
  carries a `version` field, and `setup()` warns when the saved
  version does not match the running `CANVAS_VERSION`, prompting
  the user to hard-refresh (Ctrl+F5).

## v1.5.2 — 2026-06-03

### Fixed
- Tab context menu on mobile: long-press now keeps the menu open
  (the synthesized `click` that browsers dispatch at the end of a
  long-press is no longer treated as an outside-click when it lands
  on the same element that opened the menu), and the glass-mode
  `backdrop-filter` is gated to non-touch devices via
  `@media not (pointer: coarse)` so the menu no longer reads as a
  "very large, opaque shadow" on busy mobile backgrounds. Desktop
  right-click flow and the desktop glass look are unchanged.

## v1.5.1 — 2026-06-03

### Fixed
- Context menu entrance animation now uses `animation-fill-mode:
  forwards` so the `contextMenuIn` keyframe's end state (opacity:1,
  transform:none) sticks after the 120ms entrance finishes. With the
  default `none` fill-mode, a post-animation DevTools inspection of
  the live element reverted to the un-animated base style and showed
  the keyframe's start values (opacity:0, transform:scale(0.92)),
  making the element look like it had never finished animating. No
  user-visible behavior change; this is a diagnostic-time
  correctness fix for the next time someone debugs the menu.

## v1.5.0 — 2026-06-03

### Fixed
- Settings panel toggles and segmented control actually respond to
  taps. The previous build silently threw `ReferenceError` on every
  tap because `frontend.ts` referenced module-level variables
  (`DEBUG`, `_secondarySidebarOpen`, `_secondaryWrapper`,
  `_tabAssignments`) by their bare names without importing the
  accessor functions that wrap them. Each tap ran the handler, hit
  one of the bare references, threw, the handler's `try/catch`
  swallowed it, and the toggle never flipped. The bug was equally
  present on desktop — it just hadn't been observed because nothing
  exercised the tap path until the mobile test. All bare references
  are now routed through `getDebug()` / `setDebug()`,
  `isSecondarySidebarOpen()` / `getSecondaryWrapper()`, and
  `getTabAssignments()` / `hasTabAssignment()`.
- Settings panel now re-renders after the saved layout is loaded.
  `mountSettingsPanel` ran before `loadSavedLayout` resolved, so
  the panel was built with default values and never refreshed when
  the loaded settings arrived. The panel now shows the saved state
  on every page load.
- `getTabAssignments()` return type widened from `ReadonlyMap` to
  `Map` so callers can mutate the assignment registry (one caller
  in `applyLayout`'s restore path needs `.set()`).

## v1.4.3 — 2026-06-03

### Fixed
- Settings panel toggles can now be flipped in both directions. The
  click handler on each CSS toggle button previously closed over the
  build-time initial value, so a setting that started ON could be
  turned OFF but never back ON (and vice versa). The handler now
  reads the live state from the button's `aria-checked` attribute,
  which `refresh()` keeps in sync with `_settings`. Affects all 10
  toggles in the panel.

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
