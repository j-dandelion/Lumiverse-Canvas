# Changelog

## Unreleased

### Fixed

- **Extension tabs that set `display: flex` on `tab.root` collapse to ~100-200px when moved to the secondary drawer.** When Canvas moved a tab root to the secondary panel, it stamped `display: none !important` on inactive roots (so only the active one was visible) and called `removeProperty('display')` on activation. The `setProperty` call overwrote any `display` value the extension had set on `tab.root` (e.g. `display: flex`), and `removeProperty` only removes the property — it does not restore the previous value. Result: extensions like Creator Notes HTML Renderer, which set `display:flex; flex-direction:column; height:100%` directly on `tab.root` (`~/Lumiverse/data/extensions/creator_notes_html_renderer/repo/src/frontend.ts:15`), ended up with `display: block` and the inner `flex: 1` container collapsed to the iframe's intrinsic ~150px height. Fix: replaced all inline `display` manipulation on moved roots with a CSS rule `[data-canvas-moved]:not([data-canvas-active]) { display: none !important; }` plus `data-canvas-active` attribute toggling. The extension's inline `display` value is now never touched by Canvas. Files: `src/sidebar/styles.ts` (CSS rule), `src/tabs/assignment.ts` (repositionTab), `src/tabs/buttons.ts` (showSecondaryTab), `src/sidebar/secondary.tsx` (closeSecondarySidebar).
- **`syncDrawerTabSettings` log flood — 12+ redundant calls per tick.** Five internal callers (rAF retry, ResizeObserver, class MutationObserver, style MutationObserver, 2-second `checkSideChanged` setInterval) and three external callers (openSecondarySidebar, closeSecondarySidebar, mountSecondarySidebar, plus the two feature-registry entry points) could all fire within the same animation frame, each logging `syncDrawerTabSettings: enter (lastVh=5.7) N` and writing the same 8 CSS variables via `setProperty` to the secondary drawer tab. Even on a no-op tick (same dimensions), each caller rewrote all 8 vars and iterated the full tab list for `syncSecondaryTabLabels`. Result: console spammed with the same N-throttled call dozens of times per second, drowning out real diagnostic output. Fix: public `syncDrawerTabSettings()` is now a coalescing wrapper that schedules a rAF and short-circuits subsequent calls until the rAF fires; the body was moved to private `_runSyncDrawerTabSettings()`. The 8 `setProperty` writes are guarded by a serialized cache key of the inputs (`offsetWidth|offsetHeight|paddingTop|paddingRight|paddingBottom|paddingLeft|gap|border`); `syncSecondaryTabLabels()` is guarded by a `showLabels?'show':'hide'` cache key. The rAF retry path (when the main drawer tab is not in the DOM yet) still calls `_runSyncDrawerTabSettings()` directly so it bypasses the coalesce gate and is the only legitimate second-call in a tick. Files: `src/sidebar/drawer-sync.ts`. Covered by 23 tests in `src/sidebar/__tests__/syncDrawerTabSettings.test.ts` (existing 6 cases + T7 coalescing, T8 cache hit, T9 rAF retry bypass).
- **Active secondary tab icon was indistinguishable from inactive in some themes.** `showSecondaryTab` (and the `mouseleave` handler in `addSecondaryTabButton`) wrote the active button's `color`, label `color`, and `boxShadow` inset indicator as `var(--lumiverse-primary)` with no fallback. When the CSS variable was undefined, absent on `documentElement` at computation time, or resolved to a non-purple value (e.g. `pL=75` in the engine dark-mode formula produces near-white — `--lumiverse-primary` matches `--lumiverse-text-muted` in that case), the active tab icon and label rendered the same white-65% as the inactive state, making it impossible to tell which tab was active. **First fix attempt (cb56bc3):** added `, #9370db` (matches `~/Lumiverse/frontend/src/theme/variables.css:3` default) as the CSS-var fallback. **This was wrong** — CSS-var fallbacks only fire when the var is UNSET, not when it's set to a wrong value. In the user's theme `--lumiverse-primary` is defined as white-65% (engine dark-mode formula `hsla(h, s, 75, 0.9)`), so the fallback was never reached. **Correct fix:** write the active-state color, background, box-shadow indicator, and label color as literal hex with `!important` priority via `setProperty(name, value, 'important')` — the literal `#9370db` (and `rgba(147, 112, 219, 0.2)` for the background) forces the active state to render correctly regardless of how the theme computes the var. The `!important` priority is required so the literal wins over any other inline declaration. The inactive case keeps `var(--lumiverse-text-muted)` because that var resolves to the user-expected text color in this theme. Files: `src/tabs/buttons.ts` (4 active-state writes in `showSecondaryTab` + 4 in the `mouseleave` handler). Covered by 33 tests in `src/tabs/__tests__/buttons.test.ts` (T10 active/inactive color and priorities, T11 switch active tab, T12 idempotent re-call, T13 demoted button loses `!important`).

## v1.6.4 — 2026-06-13

### Fixed

- **Chat reflow no longer over-insets when the LumiScript dock panel is on the same side as the main drawer.** The dock panel and main drawer on the same side overlap (both at `right: 0` / `left: 0` with `position: fixed`; the drawer has higher z-index). The Lumiverse App's `padding-right: var(--spindle-dock-right)` already pushes the chat by the dock panel's width, but `updateChatReflow()` was adding the main drawer's width on top, resulting in `dockInset + mainWidth` total inset and a visible gap of (mainWidth - dockInset) between the chat and the drawer. Fix: `getDockInsets()` reads `--spindle-dock-left` and `--spindle-dock-right` from the `[data-app-root]` element's inline style; `updateChatReflow()` subtracts the dock inset from the drawer width on each side, clamped to 0 with `Math.max`. `startReflowObserver()` also observes the App element for `style` changes so dock panel add/remove triggers a reflow. Covered by 17 tests in `src/chat/__tests__/reflow-dock-insets.test.ts`.
- **Secondary sidebar header and active tab state restored after a drawer-side flip.** When the user changed the drawer side in Lumiverse settings, the secondary sidebar's header reverted to the hardcoded "Second Sidebar" string and the active button state was lost. `checkSideChanged()` rebuilt the wrapper but never called `showSecondaryTab()` to restore the title from the active tab. Fix: call `showSecondaryTab(getActiveSecondaryTabId())` after `repositionAssignedTabs()` if there's an active secondary tab still assigned (guarded against stale tabId).
- **Restored tab from secondary renders with content instead of empty.** `repositionTab()` primary case removed the `data-canvas-moved` attribute but never cleared the `!important` inline styles stamped on the tab root while in secondary (`display: none` from `showSecondaryTab`/`closeSecondarySidebar`, `position: absolute; inset: 0` from `repositionTab` secondary case). User repro: with LumiBooks and Hone in secondary, activate LumiBooks then move Hone to main — Hone was invisible (display:none) and mis-positioned (position:absolute anchors to the wrong container). Fix: call `style.removeProperty('display' | 'position' | 'inset')` after `appendChild` in the primary case.
- **Closing then reopening the secondary sidebar restores moved-tab visibility.** `closeSecondarySidebar` sets `display: none !important` on all moved roots. `openSecondarySidebar` → `repositionAssignedTabs` → `repositionTab` for each tab only set `position: absolute; inset: 0 !important`, never touching display, so the display:none from close persisted. `showSecondaryTab`'s active branch used `setProperty('display', '', 'important')` which is a no-op (empty value is a CSS parse error). Fix: `repositionTab` secondary case now manages display based on `getActiveSecondaryTabId()` (active → `removeProperty`, inactive → `setProperty(none)`, null → `removeProperty` to avoid flash on first-open); `showSecondaryTab` active branch now uses `removeProperty('display')` instead of the no-op.
- **No flicker when moving an un-activated tab to the secondary sidebar.** The activate-then-move dance was 80ms + rAF and caused the moved tab's content to flash in the main panel. With the store fix in 805cf0d, `getDrawerTabs()` returns real extension tabs with `tab.root`, so we can move a detached node directly via `appendChild` with no click, no React commit wait, no flicker. Fallback dance (with `visibility: hidden !important` hard hide) retained as a safety net for edge cases.
- **Drag-resizing the secondary drawer no longer briefly shows all moved tabs at once.** `repositionTab()` was setting `display: '' !important` on every resize pointermove, which REMOVED inline `display: none` set by `showSecondaryTab` on inactive tabs — all moved roots (positioned absolute, inset:0) became visible simultaneously. Fix: removed the `display` reset from `repositionTab`; it now only manages position/inset. `showSecondaryTab`/`closeSecondarySidebar` own display.
- **Extension tab move/restore now works with LumiScript installed.** LumiScript's dock panel interferes with the Zustand store's `getDrawerTabs()` (returns only the dock panel, missing extension tabs like LumiBooks and Hone). The move path had eight failure modes: (1) `isMovedTabNode` guard blocking the active secondary tab from being treated as moved; (2) active tab id not persisted across refresh; (3) round-trip move/return losing state; (4) `tab.root` missing from store; (5) `showSecondaryTab` using `getDrawerTabs` (no-op for extensions); (6) layout restore using `getDrawerTabs` (no-op for extensions); (7) `scanForStoreData` heuristic accepting dock panel state; (8) restore-to-primary emptying the moved tab's content. All eight fixed with a Canvas-owned `data-canvas-moved` attribute as source of truth, DOM-walk fallbacks, store filter requiring `badge` field, and a lightweight LumiScript fallback that activates the tab then moves after 80ms. Covered by `src/tabs/__tests__/assignment.test.ts`.

## v1.6.3 — 2026-06-11

### Added

- Canvas: add "Move tab controls to outer edge" toggle in Sidebars settings.
- **Vertical drag-to-reposition for drawer tabs.** Drag the main or
  secondary drawer tab up/down to reposition it vertically. Replaces
  the Lumiverse tab-position slider with a pointer-based drag handler.
  New `drawerTabDrag` setting (default on). Drag accuracy fix: computed
  px values are now converted to vh via `window.innerHeight` instead
  of being treated as vh directly. Polish sync: secondary drawer tab
  mirrors the main drawer tab's vertical position in real time via a
  MutationObserver on the main tab's `style` attribute. Covered by
  `src/drawerTabPosition/__tests__/drag.test.ts` and
  `src/sidebar/__tests__/syncDrawerTabSettings.test.ts`.

### Fixed

- **Chat reflow no longer affects mobile visuals.** The "Center the chat
  in the visible area" toggle (`chatReflow`) used to shift the chat
  column on mobile (≤600px) and to leave stale desktop margins in place
  during a drag-resize across the 600px boundary. The injected reflow
  `<style>` rule now includes a `max-width: 600px` override that
  nullifies the margin and the transition; `updateChatReflow()`
  early-returns on mobile (and clears any stale inline vars); a new
  `matchMedia('(max-width: 600px)')` change listener registered in
  `startReflowObserver` clears the inline vars on cross-down and
  re-runs the reflow on cross-up. Toggling the setting and drag-resizing
  big ↔ small now transition seamlessly. Covered by
  `src/chat/__tests__/reflow-mobile.test.ts`.
- **Chat reflow no longer reads a stale `drawerOpen` after rapid tab clicks.** `isMainDrawerOpen()` in `src/store/index.ts` previously preferred the 3s-cached Zustand snapshot and only fell back to the live `wrapper.classList` when the store had no `drawerOpen` field — a leftover asymmetry with its sibling `getMainDrawerSide()`, which already does the opposite and documents the rationale. User repro: open the main drawer, click all 15 visible tab buttons (each click refreshes the cache via the tagger observer's `findStoreData(true)` call inside `tagMainSidebarButtons`), then click the drawer tab to close. The cache was just refreshed while the drawer was open, the DOM correctly drops `wrapperOpen`, and the previous store-first order returned the stale `true` — so `updateChatReflow` left the chat margins as if the drawer were still open until a hard refresh. The fix flips `isMainDrawerOpen` to DOM-first / store-fallback (mirroring `getMainDrawerSide`), so a stale cache is ignored whenever the wrapper is in the DOM. Covered by `src/chat/__tests__/reflow-staleness.test.ts`.
- **Reflow teardown no longer leaks the observer or rAF.** Two race
  conditions in `startReflowObserver`'s teardown path: (1) if teardown
  fires before `waitForElement` resolves, the `.then()` callback ran
  `observer.observe()` after `disconnect()` — reattaching with no
  subsequent cleanup; (2) pending `requestAnimationFrame` from
  `scheduleReflow` was not cancelled on teardown, so the callback
  would write stale margin vars. Both fixed with a `cancelled` flag
  and `cancelAnimationFrame` in the teardown closure. Covered by
  tests R1 and R2 in `src/chat/__tests__/reflow-mobile.test.ts`.
- **Secondary sidebar build default now matches the OFF-case.**
  `createSecondarySidebar`'s build-default `flex-direction` and
  tab-list border side were inverted from native Lumiverse CSS and
  from the values `applyTabListPosition(false)` produces. Currently
  invisible (overwritten synchronously on mount), but the build
  default should match the OFF-case so `apply()` is a true no-op
  when the toggle is off.

## v1.6.2 — 2026-06-11

### Fixed

- **Sidebar shadows (desktop) / (mobile) settings now survive a hard refresh.** The feature mount loop in `setup.ts` skipped features whose setting was falsy, but the shadow features are inverted: they need to inject `box-shadow: none !important` when the user has shadows turned OFF. The result was that shadows always showed on page refresh even with the toggle disabled, on both desktop and mobile. Wired the existing-but-unused `init()` hook on `CanvasFeature`. Both shadow features now implement `init()` to inject the disable-CSS post-hydration but pre-mount, so it fires regardless of the mount gate.

### Removed

- Unreachable `mount()` stubs from `shadowsDesktopFeature` and `shadowsMobileFeature` in `src/features/registry.ts`. The `mount()` methods were dead code: the mount loop in `setup.ts` skips features whose setting is falsy, but the shadow `mount()` bodies only acted when the setting was falsy. With `init()` now handling the boot-time injection and `apply()` handling runtime toggles, the stubs served no purpose. Frontend bundle dropped from 176.1 KB to 175.8 KB.

## v1.6.1 — 2026-06-10

- Re-bundled. No behavioral changes since v1.6.0.

## v1.6.0 — 2026-06-09

### Added

- **New "Sidebars" settings category.** Houses the existing "Drag to resize sidebars" toggle (moved out of "Second Sidebar") plus two new toggles: "Sidebar shadows (desktop)" and "Sidebar shadows (mobile)". Each shadow toggle injects a `<style>` element with `box-shadow: none !important` scoped to its breakpoint (`min-width: 601px` / `max-width: 600px`) targeting both the extension's own drawer (`.sidebar-ux-drawer`) and the host-owned main drawer (`:has(> [data-spindle-mount="sidebar"])`). The desktop toggle defaults ON; the mobile toggle defaults OFF (shadows suppressed on small viewports by default). Initial hydration runs in `setup.ts` after `hydrateSettings()` so the mobile shadow style is present before the secondary drawer mounts — no flash on first paint. Cleanup chain in `setup.ts` removes the injected `<style>` elements on extension disable.
- `[Canvas] mobile-exclusion resize-tick` debug log (gated behind the existing `debugMode` setting, throttled to one entry per 500ms). Reports `innerWidth`, `isMobile`, `sidebarOpen`, the current `cssVar` value, and the wrapper's inline `transform` on each coalesced resize tick. Filter on `mobile-exclusion` in the DevTools console to see the trace while drag-resizing.
- **"Enable slash commands" toggle in the "Chat & Layout" settings section.** New `slashCommandsEnabled` setting (defaults to `true`) gates the entire Canvas slash-command runtime: when off, the keydown/input/click intercept listeners, the suggest popup, the toast surface, and the command registry are all unmounted. Typing `/` in the chat textarea is then plain text — no popup, no parsing, no dispatch. The runtime is mounted/unmounted via the same `applySettings` diff pattern used by the existing master toggles (e.g. `secondSidebarEnabled`); a new `attachSlashRuntime(ctx)` / `_slashDetach()` pair in `settings/panel.ts` keeps the active teardown reference. Setup-time attach in `setup.ts` is also gated on the persisted setting, so a user with the setting off never has the runtime installed.

### Fixed

- **"Enable slash commands" toggle did not actually disable the slash popup.** The initial mount in `setup.ts` and the runtime re-attach in `applySettings` (`settings/panel.ts`) each kept their own reference to the active teardown — the panel's `_slashDetach` stayed `null` after the initial mount, so a user toggling the setting off at runtime hit the `if (_slashDetach)` guard, did nothing, and the intercept listeners kept firing. New exported `setSlashDetach(fn)` in `settings/panel.ts` is the single registration point: `setup.ts` calls it after the initial attach, and `applySettings` calls it after a runtime re-attach. `applySettings` also now `registerCleanup`s the runtime teardown when it mounts at runtime, so a user who toggles the setting on at runtime and then disables the extension still gets a clean teardown (no leaked intercept listeners on `document`).
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
