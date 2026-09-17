# Canvas Pitfalls & Significant Findings

Cross-cutting traps and hard-won facts from live debugging (2026-07-31 round: second-drawer moves, main-mirror active handling, boot restore). Each pitfall lists the symptom, root cause, and the rule that prevents it. Subsystem docs ([tabs.md](tabs.md), [sidebar.md](sidebar.md), [persistence.md](persistence.md)) hold the durable architecture; this file is the "check this first" reference.

## 1. TabKey vs liveId dual-keying (caused 3 separate bugs)

**Symptom:** a moved tab behaves correctly in the DOM but the model/observed world disagrees — tabs "revert" to the main drawer on reload, restored tabs fail to re-place ("not found in DrawerObserver or store"), redundant `setOrder` writes on every move.

**Root cause:** since Task 10.6, the assignment facade (`tabs/assignment.ts:getTabAssignments()`) is **derived from the owned model and keyed by TabKey** (`builtin:regex`, `ext:foo/Bar`). DOM and placement functions work on **liveIds** (`regex`, `spindle:foo:tab:bar:0`). Looking one up with the other always misses:

- `LumiverseHost.observe()` looked the facade up by liveId → every DOM-placed secondary tab observed as `primary` → `applySyncFromHost` reverted the move and the drawer never stuck (fixed by `entryLocationFor` in `host/lumiverse/implementation.ts`).
- `openSecondarySidebar`'s re-assignment loop passed TabKeys to `assignToSecondary` (liveIds) → every restored tab failed with "not found" (fixed by `liveIdForFacadeKey` in `sidebar/secondary.tsx`).
- `placeTab` read the facade by liveId → the `current === to` early-return was always wrong.

**Rule:** the facade is read by **TabKey only**. Convert liveId → TabKey via `host.findKey(liveId)` (or `tabKeyFromDrawerTab`); convert TabKey → liveId via `liveIdForFacadeKey` (builtins map structurally: `builtin:X` → `X`; extensions via drawerObserver extensionId+title).

**Extension tabs — the identity model (2026-08-16, REFACTOR-PLAN v2):** extension tabs are keyed by a **FROZEN** TabKey assigned once at first registration — `ext:{extId}/{title}` from birth (extId `'unknown'` while untagged; `@N` suffix disambiguates same-key collisions). The tagger's `data-tab-id` attribute writes are **observed** (DrawerObserver watches attributes) and update the entry's ADDRESS (`tabId`/`extensionId`/`title`) **in place** — the key never changes, so the re-key flip class of bugs is structurally impossible. The observer parses extensionId from `parts[1]` of `spindle:{extId}:tab:{id}:{counter}` (verified against Lumiverse `placement-helper.ts:388`); parts[2] is the literal `tab`.

**Resolution is ONE resolver** (`tabs/identity.ts`): `liveIdForKey` (model key → live id; TOTAL for builtins — their address is the bare id by construction) and `keyForLiveId` (live id → frozen key; **never invents keys**). Legacy inputs are handled INSIDE the resolver (self-migrating): `builtin:{title}` masquerade keys, stale extensionIds, title-valued live ids, `:N` suffix drift, renamed titles (the registry's `titles` set), and key-shaped inputs to `findKey` (the old assignment-map fallback invented garbage `ext:…` keys — the round-2 "TabKey poison"). Never layer new fallbacks outside `identity.ts` — extend its precedence table instead.

**Restore is tagging-state-independent:** `detachedTabs.tabTitle` is the authoritative TabKey in EVERY writer (`layout-model.ts`, `snapshot.ts`, `getLiveIdAssignmentEntries`) and `buildModelFromLayout` prefers it. The boot restore is **merge convergence** (`dispatch.ts`): partial commits land early, late tabs merge at their saved index, user actions inside the 30s boot window are never undone, and the deadline is the only guard. `observe()` dedups facade-vs-live entries **by title** so legacy→canonical key migration is atomic per sync round (placement preserved; duplicates impossible).

## 2. The assignment facade is a read-only snapshot of the model

`getTabAssignments()` returns a fresh Map derived from the owned model whenever the model is active. **Writes to the returned Map are no-ops in production** (the legacy in-memory map only exists pre-bootstrap and in tests). Mutating it looks like it works in a unit test and silently does nothing in the app.

**Rule:** placement state changes go through `dispatch({ t: 'move' | 'activate' | ... })`, never through facade writes.

## 3. Main-mirror active key: Canvas key is truth, host `tabBtnActive` is not

In taskbar mode the mirror highlight, header title, and toggle-close decision are all driven by the **Canvas exclusive key** (`_state.activeKey` in `sidebar/main-tab-pin.ts`), not the host's `tabBtnActive` class:

- The host keeps a **stale** active (`tabBtnActive`) on a previously-active tab (often the persisted `primary.tabId`, e.g. "Databank") long after the user clicked elsewhere. Adopting it clobbers the user's selection.
- After a move the host's `pendingActiveTabReset` marks the **first remaining** tab active — healing to it makes the mirror look "always first tab".
- **Rule:** `adoptActive` (core/reduce.ts) only adopts a host-flagged active whose observed **location is on the same side**; heal/adopt paths in the mirror prefer keeping the Canvas key (`userPicked` semantics below).

## 4. `userPicked`: restore activations must never clobber a user selection

`activateMainMirrorFromRestore` force-sets the mirror key, opens the drawer, and clicks the host button — the right tool for boot restore, the wrong tool mid-session. Reconcile's `diffActive → host.activate` routes through it; after a move this re-activated the persisted `primary.tabId` and stole the user's tab ("moving a tab activates Databank").

**Rule:** the pin state carries `userPicked` — set `true` on mirror clicks (and by `adoptMainMirrorNeighbor`, since the user's own move drove it), cleared by heal/adopt/restore paths. `activateMainMirrorFromRestore` skips entirely when a user-picked key exists. The neighbor handoff (user consequence) may override the key but keeps `userPicked: true` so a later restore still can't clobber it.

## 5. Placement-first moves: the model section must not early-return past chrome work

`placementFirstMoveByLiveId` (recon/dispatch.ts) does placement → chrome → model in one flow. **"Model already in target" is the common case in this environment** (restored tabs being re-moved) — an early return there silently skips the neighbor handoff and content re-assert, leaving the mirror key on the moved tab, the header stale, and the content empty.

**Rule:** capture the chrome decision (neighbor vs re-assert) **before** placement (the moved tab's button is still visible — `findNeighborHostButtonFor` excludes hidden buttons), apply it after placement, and only *skip the move dispatch* when already in target — never the whole tail.

## 6. Host content drift: re-click to settle (never assume the host keeps the panel)

When a container move (`requestTabLocation ok via=bridge`) remounts the host's drawer content area, the host re-resolves its **panel content** to the first remaining tab while `tabBtnActive` stays on the real active — the main-mirror then shows another tab's content with the wrong header ("content changed to Loom"). The observed world has no panel-content signal, so reconcile can't detect it.

**Rule:** after a move to secondary in taskbar mode, re-assert the user's active tab by re-clicking its host button — the same "re-click forces content settle" pattern as `ensureRestoredPrimaryTab` (the host's "already active" skip leaves the panel stale). Clicking the active tab's button is idempotent.

## 7. Boot restore placement: the open path's loop is not enough

`openSecondarySidebar` bails when the drawer is **already open** (`BAIL already-open`) — the re-assignment loop that places restored secondary tabs lives after the open. With `secondary.open: true` at boot, restored tabs stayed visible in the main drawer and the secondary was empty until the first move (`setOrder:secondary-not-ready`).

**Rule:** `bootstrapFromLayout` calls `reassignSecondaryTabsFromModel({ openOnClosed: false, setActiveWhenReady: false })` — placement at boot regardless of open state, never force-opening a closed drawer. `openSecondarySidebar`'s BAIL path calls it too (defaults) for mid-session re-opens.

**Promise contract (2026-09 live-verify #5):** the two callers overlap constantly (BAIL re-attach starts first; the boot pass call is coalesced). The coalesced call must NOT return `Promise.resolve()` — an awaiting caller (`bootPlacementDone()` → the mode-switch reveal hold) would observe "settled" while the serial loop is still appending buttons (the second drawer's tabs popped in one by one). `reassignSecondaryTabsFromModel` runs a drain: overlapping calls queue a single trailing rerun and get a waiter that resolves only when run + rerun have finished; the queued call's opts are merged into the rerun (quiet `false` flags win; an explicit `activateKey` overrides), so the boot `activateKey` tail survives coalescing.

## 8. The re-assignment loop suppresses activation — display it yourself after

The loop wraps placement in `setSuppressAutoActivation`, and `finalizeAssignToSecondary`'s `showSecondaryTabDisplay` is gated on `!deferActivation` — so the loop creates buttons and reparents roots but **never displays content**. A drawer populated with tabs but an empty content area until a click is the tell.

**Rule:** after the loop (suppress released), if the drawer is open and no tab is active, show the preferred tab (`activateKey` — the layout's persisted `active.secondary` from `model.active.secondary`) or the first placed tab via `setActiveSecondaryTabId` + `activateSecondaryTab`.

**Boot exception (2026-09):** "no tab is active" must be judged by DISPLAY truth (`secondaryHasDisplayedRoot()`, i.e. a `[data-canvas-moved][data-canvas-active]` root), not by the tracked cell — on the boot path (`reassignSecondaryTabsFromModel` called WITH `activateKey`, only `bootstrapFromLayout` does) the model→chrome reconcile echo seeds the tracked cell with the persisted active before any root is placed, so a `!getActiveSecondaryTabId()` guard suppresses the tail and every placed root stays `display:none` (black open drawer). Mid-session reopens keep the tracked guard: a pinned-strip click writes only tracked, and the tail must never overwrite the clicked tab with the first-list fallback.

## 9. Drawer state machine `_state` drifts from the physical open state

`openSecondarySidebar`/`closeSecondarySidebar` live in the shell module; `_state` lives in `secondary-drawer.ts`. The mount-with-`initialOpen` path bypasses `openSecondarySidebar` entirely, so `_state` stayed `'closed'` while the drawer was visibly open (visible in the `finalize open-gate` logs). The `openOnClosed` gate then can't be trusted.

**Rule:** every physical open/close transition — including `mountSecondarySidebar({ initialOpen })` — must call `markDrawerOpenState(open)` so the state machine tracks the shell. The explicit open in `placementFirstMoveByLiveId` remains the belt-and-suspenders for the visible outcome.

## 10. Host environment NO-GOs (this runtime)

- `setSetting` is unavailable → `patchHostDrawerSettings` returns `false` (`[host] setOrder:settings-written { ok: false }`). Layout persistence goes through `layout.json` IPC, not host settings — `ok: false` is expected noise, not a bug.
- `requestTabLocation` to a container is an allowlist **silent no-op for most built-ins** (`got {"kind":"main-drawer"}`) and `store.moveTabTo` is missing → the `via=dom` fallback (registry root reparent) is the real placement path for built-ins; `via=bridge` works for a minority (allowlist CORE).
- Mirror clicks do not reliably produce host-syncs → the **model's primary active can lag the mirror key** (it may keep the boot-restored tab). The neighbor-handoff `activate` dispatch converges it; `diffActive`'s re-activation is blocked by the `userPicked` guard.
- A dev-server restart prints `[WS] Closed: 1001` + reconnect at the top of every fresh console — not a Canvas issue.
- Backend API gaps (404s on `preset-bindings`, `personaFolders`, etc.) are host-app issues, unrelated to Canvas.

## 11. S8 Drawer-location traps (single-writer geometry)

- **One geometry author.** `sidebar/tab-position.ts` owns all strip host/list geometry, zone split, spacers and chrome. `drawer-location.ts` must stay presentation/orchestration only — a second writer is the S1 #7/#8 bug class. Host state lives in `data-strip-axis` / `data-strip-edge` plus `sidebar-ux-side-*`; `applyPinHostChrome`'s `className` assignment is wholesale, so any token not written there is wiped on the next reconcile.
- **Never `fixed` + `width:100%` on a half-zone list.** A `position: fixed` element's containing block is the viewport; the horizontal list is `position:absolute; inset:0` inside the fixed zone host. The renderer writes inline `flex-direction: column`, `overflow-x: hidden`, `width: 100%` — only `!important` CSS (`HORIZONTAL_STRIP_CSS`) beats it, and `clearPinnedTabListChrome` must clear the full set in both axes while the Sides branch re-asserts column/56px/borders.
- **Never `justify-content: flex-end` on a horizontal scroller (live bug 2026-09-13).** flex-end pushes overflow past the inline-start edge, which is not part of the scrollable region — `scrollWidth` collapses to `clientWidth`, max `scrollLeft` is 0, and the earliest tabs are clipped and unreachable. This hit the **default right-side main drawer**: the strip was unscrollable from the moment the tabs overflowed (desktop wide windows masked it; mobile exposed it). Right-anchor with `margin-left: auto` on an always-present zero-width `::before` flex spacer + `justify-content: flex-start` instead: the auto margin absorbs only *positive* free space, so the cluster hugs the drawer's edge while the tabs fit and the strip scrolls normally once they overflow.
- **The right-anchor spacer must not depend on a button (2026-09-15, final form).** The spacer started as a class on the first *visible* button, which broke every time button identity changed: hidden first button (2026-09-14), removed / mid-drag-reparented anchor button (2026-09-15), and finally the DnD drop-slot placeholder exclusion — the parked placeholder (the real drop slot) lost the auto margin, the drop-settle overlay animated to the un-anchored slot, and the post-commit real button (which then received the class) teleported to the anchored one. The `::before` pseudo exists in every state (hidden / removed / reparented / placeholder / empty list), so no JS stamping lifecycle remains. Do not reintroduce a class-on-button marker; the CSS is the whole mechanism (`HORIZONTAL_STRIP_CSS`, probe-verified fit + overflow in-browser).
- **The pin path owns the drawer orientation on Sides (live bug 2026-09-14).** While a tab list is pinned, `applyTabListPosition` deliberately skips the drawer flex (the pin owns list chrome), and `restyleShellSide`'s write is horizontal-guarded and not reached on a location flip (same side → `applyMainMirrorDrawer` early-returns). So each pin implementation must orient its drawer itself: side-right → `row-reverse`, side-left → `row`, so the 56px spacer rides the outer screen edge. The secondary's `pinTabList` did; the main mirror's `pinMainMirrorShellTabList` did not — a Top→Sides flip left the mount-time unpinned flex, the panel rode 56px under the pin strip with a gap on the inner side, and toggling "move tab controls to outer edge" off/on masked it by briefly running the unpinned path. Horizontal correctly skips the write (spacer neutralized to 0×0).
- **Horizontal dual drawers are ONE painted surface with a transparent overlay — never two painted halves (2026-09-16).** The main pin host is always `width:100%` and its list paints `TAB_STRIP_BACKGROUND` across the whole strip; the secondary host is a transparent overlay (`background: transparent !important`, `box-shadow: none !important`) on top, sized `var(--sidebar-ux-hsplit)`. The old asymmetric `calc(50% + 1px)`/`50%` zone split existed only to hide a device-pixel seam between two separately-painted fixed layers (live bugs 2026-09-14/15) — with a single surface there is no seam, so the overlap hack is retired. Traps: (a) the separator token is translucent, so letting the overlay draw its own inset `box-shadow` double-paints the line; (b) the overlay must outrank the main host's opaque list (owner+axis-gated `z-index:10001`) or the main surface covers the secondary buttons; (c) the lane boundary is **list padding** `max(8px, calc(env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px) + var(--sidebar-ux-hsplit, calc(-1 * (env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px)))))))` (both safe-area insets added — the overlay edge is inset-anchored; the negated-inset fallback collapses an absent var to 8px), not a margin on the inner section — a percentage margin resolves against the list's padded content box (different basis from the fixed host width) and drifts by up to 8px, which also opens a DnD gap at the seam; (d) the overlay/var must disappear in Sides (the `data-strip-axis="horizontal"` gate is mandatory — the Sides pinned list shares `data-pin-owner="secondary"` and would otherwise go transparent).
- **The split var has one writer and a drag-ownership flag (2026-09-16).** `tab-position.syncHorizontalSplit()` is the only settings→var path; it is called from `runReconcile` **before** the skip-cache (its strict presence predicate includes the secondary list node, which `computeKey` does not track), from `ensurePinHost`, and from `drawerLocationFeature.apply` on a `horizontalSplit` diff. The drag live-writes through `setHorizontalSplitPct` and sets the dragging flag so those calls cannot clobber the live value mid-drag; `pointerup` persists `CanvasSettings.horizontalSplit` and re-syncs. Teardown clears the var (`clearDrawerLocation` → `clearHorizontalSplit`; `destroyPinChrome` too). Without the flag, a presence reconcile snaps the strip back to the persisted value under the pointer.
- **Functional strip geometry must be written inline with `!important` (live bug 2026-09-16).** The pin host's width IS the split geometry, and it was written as a plain inline `width: var(--sidebar-ux-hsplit, 50%)`. A stale Theme Studio custom rule `[class="sidebar-ux-tab-list-pin-host sidebar-ux-side-right"] { width: 50% !important }` (left over from the old 50/50 zone model) beat the plain inline declaration: the secondary host froze at the 50% fallback while the main lane padding (sheet + var) kept tracking — the split worked functionally (tabs covered/uncovered) but the divider/handle never moved. Fix: `tab-position.setImportant` writes the host width with the `important` priority; an inline `!important` outranks even a sheet `!important` (probe-verified in Chromium + Firefox). Use it for layout-critical Canvas geometry a theme could plausibly target by class; themes can still restyle the list surface.
- **Hairlines must use the border paint path, not a 1px background (live report 2026-09-16).** The split divider was a 1px-wide `::after` **background**. At 75% browser zoom (1 CSS px = 0.75 device px) a 1px background antialiases to ~half coverage per device pixel and washes out — worst over a light tab button — while every other 1px UI line (borders, inset shadows) stayed visible. The user only saw the divider at 100% zoom and reasonably asked why other 1px lines show. Fix: a zero-width pseudo with `border-left: 1px solid` — the border paint path keeps near-full intensity on the nearest device pixel and behaves like the rest of the UI. Measured at DPR 0.75 over a light button: 1px background delta 15/30 (split across columns), 1px border delta 28/43.
- **OS closed-set buttons need a post-drain re-apply (live report 2026-09-15).** `os/panel-chrome.refreshOsVisibility` merges the OS closed set into the secondary hidden applicator on every model commit, but a restore that creates buttons AFTER the last commit (the `reassignSecondaryTabsFromModel` drain tail) leaves a closed window's strip button visible until the next commit. `reassignSecondaryTabsFromModel` therefore calls `reapplyOsClosedVisibility()` (the narrow, header-chrome-free half of the refresh) once the drain settles while OS mode is on. When adding a new secondary-button creation path, route it before that tail or re-apply the merge yourself.
- **Settings dock sits at the drawer-side edge, never the cluster's inner end (live feedback 2026-09-14).** The mirror sections are `[main, bottom]` in the DOM and the main section is `flex: 1`, so the dock's side is CSS `order`-owned: left-side hosts `order: -1` (dock before the tabs, flush to the left screen edge) and right-side hosts `order: 0` (dock after them, flush right). The divider always faces the tabs (`border-right` for left, `border-left` for right) and the opposite-side margin/padding/border must be zeroed — the S6 mobile sheet writes left-side dock values at lower specificity. The old inner-end placement put the dock in the middle of the bar whenever both zones were present.
- **The secondary Start dock must stay the list's LAST child (live report 2026-09-15).** The second drawer's Start lives in its own `.sidebar-ux-tab-list-bottom` dock (`sidebar-ux-secondary-start-dock`, created by `os/start-menu.ts`) so the Start↔tabs divider is container chrome identical to the main drawer's Settings dock — never a `border-top` on the Start button (the first attempt did that; the user rejected it). Because the dock carries the divider, a plain `appendChild` of a tab button puts that tab AFTER the divider: every tab writer must use `appendSecondaryTabNode(list, node)` / `getSecondaryStartDock` (`tabs/secondary-start-dock.ts`) — `buttons.addSecondaryTabButton`, `buttons.reorderSecondaryTabButtons` and the DnD end-insert do. The DnD "already last" guard must also treat "next sibling is the dock" as last to avoid a no-op mutation. `teardownStartMenu` and the `osSecondaryStartMenu`/second-drawer-disabled removal branch (`removeSecondaryStartChrome`) remove the dock so no stray divider line survives; that branch removes the dock document-wide (a pinned remount can orphan it from `getSecondaryTabList()`) but never queries the button document-wide — that would remove the primary Start.
- **No force remount on auto-enable.** Selecting Top/Bottom forces `taskbarMode` + `moveControlsToOuterEdge`; on that diff the tabPosition/taskbar features stand down (`prev.drawerLocation !== next.drawerLocation`) and `drawerLocationFeature` reconciles, so the shells are never force-remounted. `taskbarModeFeature.apply`'s pin calls deliberately have no `{force:true}`; the late `scheduleReconcile` rAF re-checks the effective pin gate at execution.
- **Spacers sync unconditionally.** The secondary and main 56px pin spacers are created inside the reparent branch, but `syncSpacerForLocation` must run on every force re-pin (including when the list is already on the host) — `0×0` horizontal, `56px` sides. Skipping the already-pinned case leaves a 56px column inside the horizontal layout.
- **Presence is not location.** Zone presence (`secondSidebarEnabled && shell live && tabs present`) changes what the strip shows even when the location is unchanged; the reconcile skip-cache includes presence + shell liveness. Since 2026-09-16 presence does **not** re-chrome the main host width (always 100%) — it shows/hides the transparent secondary overlay, writes/clears `--sidebar-ux-hsplit` and creates/removes the boundary handle. The split sync deliberately runs before the skip-cache because the strict predicate also requires the secondary list node, which `computeKey` does not track.
- **Host side flips must converge the OWNED MODEL as they happen (live bug 2026-09-14).** A Lumiverse "Drawer side" flip restyles geometry via `applyCanvasSideChange`, but the convergence check must compare the host setting against `getModel().side` — **never** `getMainDrawerSide()`. That getter is DOM-first and already reflects the flipped wrapper by the time either callback runs, so the old comparison silently no-opped and the model kept the old side. The next dispatch (opening a tab) then ran reconcile's `diffSide` (model→host), wrote the old side back to the host, and the strip snapped back. Fix: `drawer-sync.convergeModelToHostSide` — called from `checkSideChanged`'s changed branch immediately and from `startHostSideWatcher` (500ms poll) as fallback; it dispatches `swapSides` only when the model differs. Canvas-initiated swaps are unaffected: `applyCanvasSideChange` stamps `_lastKnownSide` before the host flips, so the echo never enters the changed branch (and `_lastCanvasSwapMs` guards the window).
- **Horizontal force is not the user's Sides preference (live feedback 2026-09-14).** Normalize forces `taskbarMode` + `moveControlsToOuterEdge` on for Top/Bottom and never off, so persisting the normalized settings silently overwrites the user's Sides values — returning to Sides left them on regardless of what they were. Keep a separate persisted record (`sidesChromePrefs: {taskbarMode, moveControlsToOuterEdge} | null`): `setSettings` writes it on an explicit chrome toggle while the location is `sides`, and a horizontal → sides location change restores it (defaults off/off when absent — e.g. a legacy blob last saved while horizontal). The restore cannot live in `normalizeCanvasSettingsFields` (stateless, no prev/next); normalize only shape-validates the record. The feature stand-down on location change keeps `drawerLocationFeature.reconcileDrawerLocation` as the single apply pass on the return leg.
- **A cross-axis margin on a row flex item does not reserve height (live bug 2026-09-15).** The chat composer was clipped in Top mode and sat under the strip in Bottom mode because the strip reserve put `margin-top`/`margin-bottom: 56px` on `_chatColumn_` only. Host structure: `.body` is a flex **ROW** (`height:100%`) whose child `.chatColumn` has `height:100%`; a cross-axis margin does not reduce the item height, so the column became `100% + 56px` and the host's `overflow: clip` cut the bottom 56px off. The reserve must ALSO land on `_chatColumnInner_` (`margin-bottom: var(--sidebar-ux-strip-h, 56px)`): it is a column-flex child with default `flex-shrink`, so it shrinks to `100% − 56` — Bottom lifts the composer above the strip, Top (with the outer top margin) makes the inner exactly fill the visible lane. LandingPage is unaffected (a scroll container, not a row flex item).
- **Theme Studio "strong" overrides outrank plain `!important` (2026-09-15).** TS compiles its strong tier to `:where(base):not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__)` — the two `:not(#id)` guards add the 2-ID authority tier, so at equal `!important` they beat any Canvas selector built from classes/attributes (IDs compare first). A live TS project had a strong `margin-bottom` on `_chatColumnInner_`, which would have silently dropped the strip reserve. Canvas's four chat-reserve rules therefore carry the same inert guards: they never change which elements match (no element has those ids) but raise the reserve above a themed override. Any new rule that owns a functional reserve/layout variable should follow the same pattern — specificity, not source order, decides between competing `!important`s.

## 12. Debugging workflow that found all of the above

Instrument the *decision points* (open gates, heal, adoption, restore clicks) with `dlog`, deploy, and have the user paste the console slice around one repro. Absence of a log line is itself evidence: the mirror key changed with **no** `[main-mirror] click` and **no** `healed/seeded` log → the setter is a direct `commitState` path (`activateMainMirrorFromRestore` / `adoptMainMirrorNeighbor`). `closeSecondarySidebar` logs a 3-frame caller stack to answer "who closed it".

## 13. Layout-restore traps (OS-mode disable, 2026-09-15)

**Symptom:** disabling OS mode (second drawer enabled) left duplicate tab buttons — the same tab in both the main mirror strip and the secondary strip — and neither duplicate loaded panel content.

**Root cause (the removal half was missing).** `os/os-mode.ts` disable restores the non-OS slot through `restoreSingleModeLayout` → `bootstrapFromLayout`. Unlike second-drawer disable (which tears the shell down and unassigns everything), the second drawer stays enabled and the boot placement pass only ran `reassignSecondaryTabsFromModel` — the **placement** half. A tab that moved during the OS session (e.g. D13 cross-drawer launch) and that the non-OS slot puts back in primary kept its host button in the secondary shell, because `reconcile`'s placement step derives each tab's side from the assignment facade (`entryLocationFor` reads the MODEL — deliberate since 2026-07-31), so it never sees the DOM/model divergence. The main mirror then rendered the tab from `model.primary` while the secondary strip still held the host button; neither duplicate could load content (the mirror twin is not in the main sidebar, so `host.activate('primary')` degrades).

**Rule:** a completed layout restore must reconcile secondary assignment in BOTH directions. `sidebar/secondary.tsx` exports the pure `secondaryTabsToUnassign(...)` + the serial `unassignSecondaryTabsNotInModel()` sweep (uses the proven `unassignFromSecondary` path: content root back to main, main button unhidden, active cleared, drawer auto-closed when empty). `bootstrapFromLayout`'s placement pass calls it after `reassignSecondaryTabsFromModel`, **skipped while `_pendingLayout !== null`** (a partial restore's pending merge can still add secondary keys the sweep would wrongly unassign). Do not move the sweep before the placement drain, and do not run it during a partial restore.

**Invariant — OS off ⇒ `model.closed` empty.** A successful slot restore bootstraps from a non-OS slot (no `closedTabIds`), but a missing/empty slot or a partial restore leaves the live closed-set; the Start menu is torn down on disable, so those windows would stay hidden forever. `applyOsModeChange`'s disable branch clears any residual membership via `dispatchBatch(setClosed…false)`, and `buildPersistedBlob` is the persistence backstop: when `!isOsModeEnabled()` the non-OS serialization gets `closedTabIds: []` (the OS slots keep their stored values). Never persist the OS closed-set into a non-OS slot or the top-level blob.

## 14. Motion traps (Start menu + drawer panels, 2026-09-15)

- **Measure the PLACED box, never the pre-position rect.** A `position: fixed`
  element with `left/top: auto` measures at its static position (the body
  flow), not where it is about to be placed. The Start menu's growth origin
  came from that rect, so the Bottom-rail origin sat ~2x too far below the
  placed menu and the open frame started too low (fix `3db6dd0`). Same class as
  the drawer close's capture→cancel→measure order: snapshot the animated state
  first, cancel, then measure the settled/placed rect.
- **An external `transform-origin` + scale IS the movement.** Anchoring the
  origin at the invoking button's center (outside the element box) makes one
  `scale()` both grow/shrink the surface and translate it toward/away from the
  anchor — the "grows out of / collapses into the button" effect. With the host
  `body > * { zoom: var(--lumiverse-ui-scale) }`, transform-origin px are LAYOUT
  px: convert rendered deltas with `/ uiScale` (or use percentages).
- **A duplicate close must not fall through to the slow path.**
  `closeSecondarySidebar` has no early return, and the horizontal bloom keeps
  the wrapper at `translateX(0)` until it settles, so a second close would
  otherwise start the 350 ms slide. `animatePanelToggle` owns idempotence
  (close-during-close no-op, settled-closed early return) and continues
  interrupted tweens from the current inline pose.
- **Parking must wait for the exit animation.** OS D17 parking
  (`data-canvas-os-no-active` → `display:none` on `.sidebar-ux-panel-content`
  plus the title clear) applied at the first frame of the close, so the content
  vanished instantly while only the surface faded. `panel-chrome` defers it:
  `whenPanelParkingReady` (one-frame re-check — the chrome pass can run before
  the close command starts the animation) → `whenPanelMotionSettles`; the sheet
  rule is scoped `:not([data-canvas-panel-animating])`. Deferred callbacks
  re-check the live displayed state (reopen race); a superseding motion drops
  the previous state's listeners.
- **Panel close anchors:** the displayed window's strip button
  (`computePanelAnchor` percentages) when it exists; OS close dismisses the
  window first (async model commit), so `os/actions.ts` sends a one-shot
  `suppressNextCloseAnchor(side)` and the close fades in place. OS minimize
  keeps its button and still collapses toward it. The anchor tracker is a
  dynamic `import('../recon/dispatch')` — keep it out of the static dispatch
  cycle (`dispatch → reconcile → active-tab → main-mirror → panel-motion`).
- **Cancellation hygiene:** `cancelWrapperAnimation(wrapper)` cancels BOTH the
  translate tween and the panel bloom and resets the bloom's inline styles
  (`pointer-events: auto` — clearing to `''` would inherit the wrapper's
  `none`; `will-change` cleared — a persistent `transform` hint makes the drawer
  a containing block for fixed descendants). Every structural writer (restyle
  side, viewport sync, width restore, unmount) cancels first; `drawerLocation`
  flips call `cancelAllWrapperAnimations()`.

## 15. Start-menu visual layer ("Command Deck", 2026-09-15)

- **The observer's `iconSvg` is always empty.** `getDrawerTabs()` prefers the
  observer facade, which hard-codes `iconSvg: ''` (`store/index.ts`) — filling
  the tile straight from the entry leaves every row blank. Resolve from the live
  button first (`tab.root.querySelector('svg')` — also the host-sanitized
  source), then the store fields, then `BUILTIN_ICON_SVGS`, then a monogram
  (`os/start-menu.ts` `resolveEntryIcon`).
- **Puzzle glyphs are placeholders, not icons.** Both the host (lucide
  `lucide-puzzle`) and Canvas (`PUZZLE_ICON_SVG`, the strip's fallback) render
  the puzzle for icon-less tabs. If extraction accepts it, the monogram branch
  is unreachable and the real fallback never shows — treat both as a miss.
- **`--lumiverse-fill` is black-15, not white.** In the default dark theme it
  composites to ~1.01:1 on `--lumiverse-bg-deep`: the tab context menu's hover
  is effectively invisible there. The Start menu deliberately uses
  `--lumiverse-bg-hover` for hover and `--lumiverse-primary-020` for pressed
  (deviation recorded in the plan).
- **Never size the menu with raw `vw`/`vh`.** It is a `body > *` child under
  `body > * { zoom: var(--lumiverse-ui-scale) }` (host reset): width is
  `calc((100vw - 16px) / var(--lumiverse-ui-scale, 1))` and max-height
  `calc(min(60vh, 420px) / …)`, or the box overflows at zoom > 1.
- **State marks are user-directed:** `●` filled dot (open), `○` hollow circle
  (minimized), **no mark node at all** (closed). Do not reintroduce the old `–`
  bar or a closed ring: `STATE_MARK_SVG.closed` is `''` and `createMenuEntry`
  appends the mark only when the SVG is non-empty.
- **Sheet lifecycle:** inject in `buildMenu` (`injectStyles` is idempotent),
  remove in `teardownStartMenu` + the `setup.ts` cleanup sweep. Removing it in
  `hideStartMenu` would strip the styles mid-close-animation.
- **Test-harness footer:** the visual-pins file must keep `FAILED: ${failed}` +
  `process.exitCode = 1` (the runner only fails on non-zero exit /
  `FAILED: [1-9]`); import only leaf modules so `bun run` does not drag the
  store/dispatch graph.

