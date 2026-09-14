# Secondary Sidebar System

## Overview

The secondary sidebar is a second drawer on the opposite side of the screen from Lumiverse's main drawer. It hosts extension tabs moved by the user via right-click → "Move to second drawer". Canvas fully owns this sidebar — its DOM, state, animation, and persistence are all Canvas-managed.

## DOM Structure

The secondary sidebar is a wrapper element with this hierarchy:

```
.sidebar-ux-secondary-wrapper          (position: fixed, animated via translateX)
  ├── .sidebar-ux-drawer-tab           (open/close toggle button, mirrors main drawer's tab)
  └── .sidebar-ux-drawer               (the drawer itself)
        ├── .sidebar-ux-tab-list       (column of tab buttons)  [unpinned]
        └── .sidebar-ux-panel          (content area)
              ├── .sidebar-ux-panel-header
              └── .sidebar-ux-panel-content  (hosts reparented extension roots)
```

### `taskbarMode` (pin + Canvas main shell)

When the setting is on (desktop only):

| Drawer | Strategy | Module |
|--------|----------|--------|
| **Secondary** | **Reparent** Canvas-owned `.sidebar-ux-tab-list` onto a body-level `.sidebar-ux-tab-list-pin-host` (`data-pin-owner="secondary"`). A 56px spacer stays in the drawer. Strip stays visible while closed. | `applyTabListPin` / `reconcileTabListPin` in `tab-position.ts` |
| **Main** | **Headless host + Canvas shell** — hide host main chrome via `html.sidebar-ux-canvas-main-active`; mount shared `createDrawerShell({ owner: 'main' })` on Lumiverse drawer side; pin tab list; mirror tab clicks. Host `panelContent` is **soft-reparented into `shell.content`** for the whole mode lifetime (same pattern as secondary parking extension roots). **S3 content single-path:** parking is event-driven only (mount, open, tab activation, assignment moves, boot re-assert, restore settle) — the repark timer-poll was removed; host-first `resolveHostPanelContent` + stale-node eviction handle React remounts at the next event. Open/close = one `animateWrapper` on the shell; resize = CSS width var + flex. No body overlay / fixed layout ticker. | `main-mirror-drawer.ts` + `main-tab-pin.ts` |

Shared chrome comes from `createDrawerShell({ owner: 'main' \| 'secondary', ... })` so main and secondary look the same: same tab-list surface, 48/56 tabs, edge drawer-tab, open/close animation, closed-state active-highlight rules. Both wrappers also carry the public class **`sidebar-ux-shell`** (plus owner-specific wrapper class and `sidebar-ux-side-*`) for one-selector theming. Pin chrome is shared via `applyPinnedTabListChrome`. **No Lumiverse source changes** — host React still owns the panel content node; only its DOM parent changes while mode is active (restored on teardown). Theme authors: [custom-css.md](custom-css.md).

**Main tab strip chrome (S2 flat renderer + S7):** `main-renderer.ts` renders the model-keyed mirror strip — order/hidden/active come from the owned model; chrome is copied read-only from the host twin button (icon svg, short-name label). The **Settings gear is reproduced bottom-docked** in the strip's bottom section (host `.sidebarBottom` parity, click forwards to the host Settings button — it is chrome, never a Canvas tab). **S7 badges:** the twin's extension badge span (`dt.badge` → `span[class*="tabBadge"]` in ViewportDrawer) is copied after the label; its CSS-module class is document-global so the clone styles identically. Badge freshness is snapshot-at-render (same as icons/labels): the host sidebar observer (`childList+subtree`) → `scheduleReconcile` → re-render, with the `data-mirror-html` cache rewriting only on change. The twin's `data-spindle-mount="drawer_tab"` span is **never** copied — the Spindle loader's document-first match would re-portal the extension mount into the mirror (§7 veto: don't steal drawer_tab mounts).

**Drawer side (left/right):** shell anchor, pin host, closed transform (`−width` left / `+width` right), resize handle, and chat reflow all follow `getMainDrawerSide()`. **S4 CSS-only swap:** `applyCanvasSideChange(side)` restyles both Canvas shells in place (`restyleShellSide`) — no remount, no container churn; side-change detection feeds geometry only (see below). **Live-verify #7 geometry rules:** `restyleShellSide` is pin-aware (a wrapper with no `.sidebar-ux-tab-list` = the list was reparented to the pin host, so the spacer needs the outer-edge flex); `refreshSideGeometry` re-runs `reconcileTabListPin()` (the secondary pin host is body-level and cannot move with the wrapper) and re-applies `applyTabListPosition` to the **Canvas main shell** (`getMainMirrorDrawer/TabList/Panel`) in addition to the hidden host nodes; resize handles keep their element across a swap, so `createResizeHandle` takes a direction **provider** resolved at pointerdown.

`position: fixed` alone is not enough: wrappers always have `transform: translateX(...)`, which would become the containing block for fixed descendants and slide the strip off-screen when closed. Dual pin hosts are keyed by `data-pin-owner` so `sweepStrayPinHosts` never deletes the other drawer's host.

**Secondary lifecycle:** both `unmountSecondarySidebar` and `tearDownSecondarySidebar` must unpin first — otherwise the pin host keeps an orphan tab list on `document.body`. On re-pin, the host keeps **exactly one** list (orphans are dropped). `getSecondaryTabList()` resolves wrapper list first (for remount), then the module-owned pin list via `getPinnedTabList()` — never a document-wide first-match that can hit a stale orphan. Remount (`mountSecondarySidebar`) re-applies secondary pin from settings. Side changes restyle both shells in place (S4); `refreshSideGeometry` re-runs **both** pin reconciles (`reconcileMainTabListPin()` + `reconcileTabListPin()`) and the Canvas main-shell position pass — no remount.

**Why not reparent the host sidebar mount:** the main sidebar is host-owned React. Moving `[data-spindle-mount="sidebar"]` would fight reconciliation. Instead Canvas hides host chrome and portals only the panel content node.

### Drawer location (S8: Sides | Top | Bottom)

`drawerLocation` moves **only the tab lists**. Panels keep their left/right side and slide in horizontally; width, resize, animation and persistence are identical in every mode.

- **One always-visible horizontal strip** pinned to the selected viewport edge, full width, safe-area aware. Two zones → each list occupies its half (50%) anchored to its own drawer's edge and growing inward; solo/empty secondary → the main zone takes 100%. Side swaps mirror the zones automatically.
- **Single geometry writer:** `sidebar/tab-position.ts` owns every host/list geometry write (`applyPinHostChrome` writes `data-strip-axis` / `data-strip-edge` + zone anchors in the same wholesale className assignment; `applyPinnedTabListChrome` / `clearPinnedTabListChrome` own the list chrome and full reversal). `sidebar/drawer-location.ts` is presentation/orchestration only: html classes + `--sidebar-ux-strip-h`, shell wrapper edge offsets, handle visibility, consumer knobs, presence subscription, `reconcileDrawerLocation()` (sync + coalesced + generation-guarded), `clearDrawerLocation()`.
- **CSS:** `HORIZONTAL_STRIP_CSS` (in `sidebar/styles.ts`) owns orientation/size/borders/overflow with `!important` (beats the renderer's inline `column` / `overflowX:hidden` / `width:100%`), zone anchoring (`justify-content: flex-start` on the scroller **plus** `margin-left:auto` on the first item — the auto margin right-anchors while the tabs fit and collapses to 0 when they overflow, keeping the full scroll range reachable; **never** `justify-content: flex-end` on a horizontal scroller, it clips the inline-start overflow and makes the strip unscrollable — live bug 2026-09-13), Settings dock at the cluster's inner end, edge-aware active indicator, and the chat/Landing top/bottom reserve. Strip math: 4px + 48px + 4px = 56px.
- **Presence:** zone presence = `secondSidebarEnabled && isSecondaryShellLive() && hasSecondaryAssignedTabs()` (+ list node). The main host re-chromes unconditionally; when the zone collapses it goes back to full width. Reconciles are triggered by the `onModelChanged` presence subscription plus explicit calls at shell mount/teardown, mode switches, viewport crosses and side swaps.
- **Taskbar auto-enable:** selecting Top/Bottom forces `taskbarMode` + `moveControlsToOuterEdge` (normalize invariant); the panel locks those two rows while horizontal and renders the hide-handles row inert-but-checked. Edge handles are hidden on both platforms (the strip is the reopen affordance).
- **Host "Drawer side" convergence (S8 #2):** a host-driven flip restyles via `applyCanvasSideChange` **and** adopts the side into the owned model immediately (`drawer-sync.convergeModelToHostSide`; the 500ms host watcher is the fallback). The comparison is against `getModel().side` — `getMainDrawerSide()` is DOM-first and already flipped, so comparing against it leaves the model stale and the next dispatch's `diffSide` writes the old side back (the strip snaps back when a tab is opened).
- **Mobile:** `isMobileViewport() && !isHorizontalStrip()` preserves Sides-mobile byte-for-byte; horizontal mobile pins the strip like desktop (full-bleed panels unchanged).
- **DnD:** horizontal reorder/move including cross-seam drawer moves and edge auto-scroll; fine-pointer desktop only (≤600px and coarse-pointer devices are no-ops, same policy as resize handles).
- **Boundaries:** never write strip geometry outside `tab-position.ts`; the horizontal list is `position:absolute` inside the fixed zone host — never `fixed` + `width:100%`; `stripPinnedOn` (dock offset) and the reflow L/R strip reserves gate on `!isHorizontalStrip()`. Right-anchored clusters must stay scrollable: anchor with `margin-left:auto` + `flex-start`, never `flex-end` on the scroller (see `docs/pitfalls.md` §11).

## DOM Construction (`secondary.tsx`)

`createSecondarySidebar(options?)` builds the entire DOM tree programmatically:

1. **Wrapper** (`div.sidebar-ux-secondary-wrapper`):
   - `position: fixed`, `z-index: 9990`, `pointer-events: none`
   - Side class: `sidebar-ux-side-left` or `sidebar-ux-side-right`
   - Direction-aware: `flex-direction: row-reverse` (left) or `row` (right)
   - Initial transform from layout width (or 420px default)
   - On mobile: width = `window.innerWidth`

2. **Drawer tab** (`button.sidebar-ux-drawer-tab`):
   - Starts `display: none` (shown by `updateDrawerTabVisibility`)
   - Contains SVG icon (sidebar/panel icon)
   - Click toggles open/close

3. **Drawer** (`div.sidebar-ux-drawer`):
   - `position: relative` (for resize handle positioning)
   - `width: var(--sidebar-ux-secondary-w, 420px)` or `window.innerWidth px` on mobile
   - `isolation: isolate`
   - Contains sidebar (tab list) + panel

4. **Sidebar** (`div.sidebar-ux-tab-list`):
   - 56px wide, vertical column, scrollable
   - `border-right/left: 1px solid var(--lumiverse-primary-020)`

5. **Panel** (`div.sidebar-ux-panel`):
   - `flex: 1`, contains header + content

6. **Panel header** (`div.sidebar-ux-panel-header`):
   - CSS variables for height/padding/border/background (synced from main)
   - Title + close button

7. **Panel content** (`div.sidebar-ux-panel-content`):
   - `flex: 1`, `position: relative` (for absolute-positioned tab roots)
   - `overflow-y: auto`
   - Registered with host bridge via `registerContainer({ id: 'canvas-secondary-drawer', side, element: content })`

## Key Elements

- **Wrapper**: `position: fixed`, animated open/close via `translateX`. The closed transform is `+width` (right side) or `-width` (left side). `pointer-events: none` when closed (drawer has `pointer-events: auto`).
- **Drawer tab**: The clickable toggle button. Mirrors the main drawer's tab dimensions, padding, and vertical position via CSS variables.
- **Drawer**: `position: relative`, contains the tab list and panel content. `isolation: isolate` for z-index stacking.
- **Tab list**: Vertical column of tab buttons (`.sidebar-ux-tab-list button[data-tab-id]`). On mobile, becomes horizontal.
- **Panel content**: Holds reparented extension root elements. Inactive roots are hidden via CSS: `[data-canvas-moved]:not([data-canvas-active]) { display: none !important; }`

## State Machine (`secondary-drawer.ts`)

States: `closed` | `mounting` | `open` | `tab_active`

Note: `mounting` is defined in the type but never used in any transition — `_state` is initialized to `'closed'` and transitions only go to `'open'` or `'tab_active'`.

```
closed → (assignToSecondary) → open/tab_active
tab_active → (unassignFromSecondary last tab) → closed
tab_active → (unassignFromSecondary non-last) → open
```

**`_state` drift pitfall:** the shell module (`secondary.tsx`) owns the physical open state; `_state` lives here. Every physical open/close transition — including the mount-with-`initialOpen` path that bypasses `openSecondarySidebar` — must call `markDrawerOpenState(open)` (exported here) or `_state` stays `'closed'` while the drawer is visibly open and the `openOnClosed` gate can't be trusted. See [pitfalls.md](pitfalls.md) §9.

**Guard flag**: `_restoringFromLayout` — when true, `onTabUnregistered` handlers skip all work. Prevents the restore flow from racing with the state machine.

## Lifecycle

### Mounting (`mountSecondarySidebar`)

1. Create the wrapper DOM (injected styles from `styles.ts`)
2. Set initial width from layout (`--sidebar-ux-secondary-w` CSS variable)
3. Set initial open/closed state via `translateX`
4. Apply initial transform (no animation)
5. Register with host bridge via `ctx.containers.registerContainer()`
6. Inject drawer tab styles, mobile CSS, icon-size styles

### Teardown (`tearDownSecondarySidebar`)

1. If main drawer shows a secondary tab, click a safe fallback button first
2. For each assigned tab: `requestTabLocation({kind:'main-drawer'})` for built-ins; move DOM root back for extensions
3. Show all main tab buttons, clear assignments
4. Remove wrapper, reset state
5. Disconnect observers, clear caches

## Open/Close Lifecycle

### Opening (`openSecondarySidebar`)

1. Mobile exclusion: close the other sidebar first (`enforceExclusionOnOpen('secondary')`)
2. Animate wrapper to `translateX(0)` via `animateWrapper`
3. Set `_secondarySidebarOpen = true` + `markDrawerOpenState(true)`
4. Sync drawer tab settings (dimensions, position)
5. Update drawer tab visibility
6. Sync panel header from main
7. Update chat reflow
8. Re-attach model-assigned tabs via `reassignSecondaryTabsFromModel()` (idempotent `assignToSecondary` calls)
9. Persist open state
10. Set mobile body class

**BAIL-already-open trap:** when the drawer is already open (e.g. open at boot), `openSecondarySidebar` bails before step 8 — restored tabs would stay unplaced in the main drawer. The BAIL path calls `reassignSecondaryTabsFromModel()` itself, and `bootstrapFromLayout` also triggers it with `{ openOnClosed: false, setActiveWhenReady: false }` so a closed drawer is never force-opened. The two calls overlap, so `reassignSecondaryTabsFromModel` coalesces them through a serial **drain** whose returned promise resolves only after all pending runs settle (queued callers' opts merge into the trailing rerun) — awaiting callers (the boot placement pass / reveal hold) must observe true completion. See [pitfalls.md](pitfalls.md) §7.

**Content-restore trap:** the re-assignment loop suppresses auto-activation, and `finalizeAssignToSecondary`'s `showSecondaryTabDisplay` is gated on `!deferActivation` — the loop places tabs but displays none. `reassignSecondaryTabsFromModel` therefore shows the preferred tab afterwards (`activateKey` — the persisted `active.secondary` — or the first placed) when the drawer is open and nothing is active. See [pitfalls.md](pitfalls.md) §8.

### Closing (`closeSecondarySidebar`)

1. Animate wrapper to `getClosedTransformPx()` (direction-aware)
2. Set `_secondarySidebarOpen = false`
3. Sync drawer tab settings + visibility
4. Sync panel header + chat reflow
5. Remove `data-canvas-active` from all moved roots
6. Persist open state (unless `silent: true`)
7. Clear mobile body class

## Tab Assignment Flow

### Moving a Tab to Secondary (`assignToSecondary`)

Signature: `assignToSecondary(tabId, opts?)` — `tabId` is a **liveId**, never a facade TabKey (see [pitfalls.md](pitfalls.md) §1). `opts.openOnClosed` (default `true`) controls whether a closed drawer force-opens; `opts.setActiveWhenReady` (default `false` on the built-in path) controls tab_active promotion. The boot-restore call passes both `false`.

Two paths depending on tab type:

**Extension tabs (has UUID extensionId):**
1. Resolve tab in Zustand store or DrawerObserver
2. Set assignment: `setTabAssignment(id, 'secondary')`
3. Hide main sidebar button: `hideMainTabButton(id)`
4. Open secondary sidebar if closed (not on mobile)
5. **DOM reparent**: Move the extension's root element into `.sidebar-ux-panel-content` via `appendChild` (preserves React state)
6. Mark with `data-canvas-moved` and `data-canvas-active` attributes
7. Create secondary tab button via `addSecondaryTabButton`
8. Persist layout

> **Root-sourcing trap (2026-08-17):** the root for step 5 must come from the **fiber store** (`getHostStoreTabs()` in `store/index.ts`), NOT from the DrawerObserver facade. `getDrawerTabs()`'s observer-derived entries return `root: tab.button` — the HOST BUTTON, not the content root — because the observer only ever sees buttons. Reparenting that button rips it out of the sidebar: the mirror loses the tab, `findMainTabButton` misses ("no button for id=… found among N buttons"), and moving the tab back to primary cannot restore it. `assignExtensionTabToSecondary` rejects button-as-root (`fiberTab.root !== tab.button`) and, for lazily-mounted extensions whose fiber root is `null`, wires the assignment + secondary button **without reparenting anything** — the content root attaches when the host mounts the tab.

**Built-in tabs (Characters, History, Lorebook, Profile):**
1. Prefer shared helper `moveBuiltInTabToSecondaryContainer` (`tabs/builtin-move.ts`) — also used by `assignTab`
2. Resolve via host bridge: `bridge.ui.getBuiltInTabRoot(tabId)`; if missing, `ensureBuiltInTabActiveInMain` + rAF, then re-read root
3. **Never** raw-`appendChild` a host registry root out of main `panelContent` (main-mirror parks that node; stealing its child crashes the host React boundary). **Never** match roots via `textContent.includes(title)`
4. Place via host API: `bridge.ui.requestTabLocation(tabId, { kind: 'container', containerId: 'canvas-secondary-drawer' })`
5. Canvas UI only: assignment map, hide main button, secondary tab button, optional repark of main-mirror `panelContent`
6. Fallback: if host bridge cannot place the tab but the Zustand store has a `root` (dock-panel-shaped LumiScript entries without `extensionId`), reparent that store root only — same ownership model as extensions
7. Persist layout

### Moving a Tab Back to Primary (`unassignFromSecondary`)

1. Move reparented root back to main panel content
2. Clear `data-canvas-moved` and `data-canvas-active` attributes
3. Delete assignment, remove secondary button, show main button
4. Auto-close secondary if last tab moved out
5. Persist layout

## DrawerObserver (`drawer-observer.ts`)

A `MutationObserver`-based tab registration watcher that replaced the old 3s polling interval.

- Observes the main sidebar's tab container for `childList` + `subtree`
- Maintains a `Map<string, ObservedTab>` of registered tabs
- Emits `onTabRegistered` and `onTabUnregistered` events
- Parses `extensionId` from the tab ID format: `spindle:{extId}:tab:{id}:{counter}`

## Cross-Drawer Sync (`drawer-sync.ts`)

Mirrors the main drawer's visual properties onto the secondary:
- Dimensions (width, height, padding, gap, border) via 8 CSS variables
- Vertical position (marginTop in vh)
- Tab label visibility
- Active state (CSS class toggle)

Uses three observers on the main drawer tab:
1. `ResizeObserver` — re-sync on dimension changes
2. `MutationObserver` (class) — re-sync on compact mode toggle
3. `MutationObserver` (style) — re-sync on vertical position changes

Coalescing: `_syncPending` flag + `_lastWrittenDrawerTabVars` cache prevent redundant `setProperty` calls.

## Side-Change Detection (`startSideChangeWatcher`)

When the main drawer's side changes — Canvas swap (Configure "Swap drawer locations" / boot restore) or a host-driven Lumiverse "Drawer side" flip (S4):
1. `MutationObserver` on the wrapper's class attribute fires (plus the 500ms host-settings store watcher for model convergence)
2. `checkSideChanged()` compares against `_lastKnownSide`
3. Shells lag the DOM → `applyCanvasSideChange(side, { syncHost: false })`: restyle both shells in place (`restyleShellSide`), refresh geometry consumers (handles, reflow, gutters, tab-list position, pin reconcile), NO host write and NO `_lastSeenHostSide` stamp — the 500ms watcher must still observe the change to converge the model
4. Same side (settle echo) → light sync only (`syncDrawerTabSettings` + handle refresh)

The intentional path (`host.setSide` → `applyCanvasSideChange(side)` with `syncHost: true`) performs the one guarded host write (patch → settings-API fallback) and settles the side override in the background.

## Mobile Support (`mobile-exclusion.ts`)

On mobile (viewport <= 600px):
- Only one sidebar can be open at a time
- Opening one closes the other (mutual exclusion)
- Body classes (`canvas-ux-mobile-primary-open`, `canvas-ux-mobile-secondary-open`) control which drawer tab is visible
- CSS forces the drawer to full viewport width (window.innerWidth px)
- Tab list becomes horizontal (flex-direction: row)
- Viewport-cross detection: `matchMedia` listener handles 600px boundary crossing
- CSS variable sync: `--sidebar-ux-secondary-w` is overwritten on mobile to match `window.innerWidth`

## Animation (`animation.ts`)

Open/close animation uses `requestAnimationFrame` with easeOutCubic (350ms):
- `animateWrapper(wrapper, targetPx)` — start animation
- `cancelWrapperAnimation()` — cancel in-flight (needed for viewport-cross)
- No CSS transitions, no counter-translate — the wrapper translates and both tab and drawer move together

## Panel Header Sync (`panel-header-sync.ts`)

Keeps the secondary's panel header in sync with the main drawer's:
- Height, padding, font-size, border, background
- Uses `ResizeObserver` + `MutationObserver` on the main header
- Writes 6 CSS variables on the secondary wrapper
- Coalesced via `requestAnimationFrame`

## Persistence

Width is stored in the CSS variable `--sidebar-ux-secondary-w`. Open/closed state is stored in the layout blob. The `snapshotLayout()` function reads both for persistence. The close transform is computed from the width: `getClosedTransformPx()`.
