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
- **Never `justify-content: flex-end` on a horizontal scroller (live bug 2026-09-13).** flex-end pushes overflow past the inline-start edge, which is not part of the scrollable region — `scrollWidth` collapses to `clientWidth`, max `scrollLeft` is 0, and the earliest tabs are clipped and unreachable. This hit the **default right-side main drawer**: the strip was unscrollable from the moment the tabs overflowed (desktop wide windows masked it; mobile exposed it). Right-anchor with `margin-left: auto` on the first item + `justify-content: flex-start` instead: the auto margin absorbs only *positive* free space, so the cluster hugs the drawer's edge while the tabs fit and the strip scrolls normally once they overflow.
- **No force remount on auto-enable.** Selecting Top/Bottom forces `taskbarMode` + `moveControlsToOuterEdge`; on that diff the tabPosition/taskbar features stand down (`prev.drawerLocation !== next.drawerLocation`) and `drawerLocationFeature` reconciles, so the shells are never force-remounted. `taskbarModeFeature.apply`'s pin calls deliberately have no `{force:true}`; the late `scheduleReconcile` rAF re-checks the effective pin gate at execution.
- **Spacers sync unconditionally.** The secondary and main 56px pin spacers are created inside the reparent branch, but `syncSpacerForLocation` must run on every force re-pin (including when the list is already on the host) — `0×0` horizontal, `56px` sides. Skipping the already-pinned case leaves a 56px column inside the horizontal layout.
- **Presence is not location.** Zone presence (`secondSidebarEnabled && shell live && tabs present`) must re-split the host even when the location is unchanged; the reconcile skip-cache includes presence + shell liveness. During a mode-switch window the main host re-chromes full width and the next presence pass re-splits.
- **Host side flips must converge the OWNED MODEL as they happen (live bug 2026-09-14).** A Lumiverse "Drawer side" flip restyles geometry via `applyCanvasSideChange`, but the convergence check must compare the host setting against `getModel().side` — **never** `getMainDrawerSide()`. That getter is DOM-first and already reflects the flipped wrapper by the time either callback runs, so the old comparison silently no-opped and the model kept the old side. The next dispatch (opening a tab) then ran reconcile's `diffSide` (model→host), wrote the old side back to the host, and the strip snapped back. Fix: `drawer-sync.convergeModelToHostSide` — called from `checkSideChanged`'s changed branch immediately and from `startHostSideWatcher` (500ms poll) as fallback; it dispatches `swapSides` only when the model differs. Canvas-initiated swaps are unaffected: `applyCanvasSideChange` stamps `_lastKnownSide` before the host flips, so the echo never enters the changed branch (and `_lastCanvasSwapMs` guards the window).

## 12. Debugging workflow that found all of the above

Instrument the *decision points* (open gates, heal, adoption, restore clicks) with `dlog`, deploy, and have the user paste the console slice around one repro. Absence of a log line is itself evidence: the mirror key changed with **no** `[main-mirror] click` and **no** `healed/seeded` log → the setter is a direct `commitState` path (`activateMainMirrorFromRestore` / `adoptMainMirrorNeighbor`). `closeSecondarySidebar` logs a 3-frame caller stack to answer "who closed it".
