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
| **Main** | **Headless host + Canvas shell** — hide host main chrome via `html.sidebar-ux-canvas-main-active`; mount shared `createDrawerShell({ owner: 'main' })` on Lumiverse drawer side; pin tab list; mirror tab clicks. Host `panelContent` is **soft-reparented into `shell.content`** for the whole mode lifetime (same pattern as secondary parking extension roots). **S3 content single-path:** parking is event-driven only (mount, open, tab activation, assignment moves, boot re-assert, restore settle) — the repark timer-poll was removed; host-first `resolveHostPanelContent` + stale-node eviction handle React remounts at the next event. Open/close = mode-routed panel motion (`panel-motion.ts`: Sides `translateX` slide, Top/Bottom rail bloom); resize = CSS width var + flex. No body overlay / fixed layout ticker. | `main-mirror-drawer.ts` + `main-tab-pin.ts` |

Shared chrome comes from `createDrawerShell({ owner: 'main' \| 'secondary', ... })` so main and secondary look the same: same tab-list surface, 48/56 tabs, edge drawer-tab, open/close animation, closed-state active-highlight rules. Both wrappers also carry the public class **`sidebar-ux-shell`** (plus owner-specific wrapper class and `sidebar-ux-side-*`) for one-selector theming. Pin chrome is shared via `applyPinnedTabListChrome`. **No Lumiverse source changes** — host React still owns the panel content node; only its DOM parent changes while mode is active (restored on teardown). Theme authors: [custom-css.md](custom-css.md).

**Main tab strip chrome (S2 flat renderer + S7):** `main-renderer.ts` renders the model-keyed mirror strip — order/hidden/active come from the owned model; chrome is copied read-only from the host twin button (icon svg, short-name label). The **Settings gear is reproduced bottom-docked** in the strip's bottom section (host `.sidebarBottom` parity, click forwards to the host Settings button — it is chrome, never a Canvas tab). **S7 badges:** the twin's extension badge span (`dt.badge` → `span[class*="tabBadge"]` in ViewportDrawer) is copied after the label; its CSS-module class is document-global so the clone styles identically. Badge freshness is snapshot-at-render (same as icons/labels): the host sidebar observer (`childList+subtree`) → `scheduleReconcile` → re-render, with the `data-mirror-html` cache rewriting only on change. The twin's `data-spindle-mount="drawer_tab"` span is **never** copied — the Spindle loader's document-first match would re-portal the extension mount into the mirror (§7 veto: don't steal drawer_tab mounts).

**Drawer side (left/right):** shell anchor, pin host, closed transform (`−width` left / `+width` right), resize handle, and chat reflow all follow `getMainDrawerSide()`. **S4 CSS-only swap:** `applyCanvasSideChange(side)` restyles both Canvas shells in place (`restyleShellSide`) — no remount, no container churn; side-change detection feeds geometry only (see below). **Live-verify #7 geometry rules:** `restyleShellSide` is pin-aware (a wrapper with no `.sidebar-ux-tab-list` = the list was reparented to the pin host, so the spacer needs the outer-edge flex); `refreshSideGeometry` re-runs `reconcileTabListPin()` (the secondary pin host is body-level and cannot move with the wrapper) and re-applies `applyTabListPosition` to the **Canvas main shell** (`getMainMirrorDrawer/TabList/Panel`) in addition to the hidden host nodes; resize handles keep their element across a swap, so `createResizeHandle` takes a direction **provider** resolved at pointerdown.

`position: fixed` alone is not enough: wrappers always have `transform: translateX(...)`, which would become the containing block for fixed descendants and slide the strip off-screen when closed. Dual pin hosts are keyed by `data-pin-owner` so `sweepStrayPinHosts` never deletes the other drawer's host.

**Secondary lifecycle:** both `unmountSecondarySidebar` and `tearDownSecondarySidebar` must unpin first — otherwise the pin host keeps an orphan tab list on `document.body`. On re-pin, the host keeps **exactly one** list (orphans are dropped). `getSecondaryTabList()` resolves wrapper list first (for remount), then the module-owned pin list via `getPinnedTabList()` — never a document-wide first-match that can hit a stale orphan. Remount (`mountSecondarySidebar`) re-applies secondary pin from settings. Side changes restyle both shells in place (S4); `refreshSideGeometry` re-runs **both** pin reconciles (`reconcileMainTabListPin()` + `reconcileTabListPin()`) and the Canvas main-shell position pass — no remount.

**Why not reparent the host sidebar mount:** the main sidebar is host-owned React. Moving `[data-spindle-mount="sidebar"]` would fight reconciliation. Instead Canvas hides host chrome and portals only the panel content node.

### Drawer location (S8: Sides | Top | Bottom)

`drawerLocation` moves **only the tab lists**. Panels keep their left/right side; Sides slides them in/out horizontally, Top/Bottom runs the **rail bloom** instead (the wrapper transform snaps structurally and the panel fades + micro-scales anchored at the strip edge, emerging from under the rail — see Animation below). Width, resize and persistence are identical in every mode.

- **One always-visible horizontal strip** pinned to the selected viewport edge, full width, safe-area aware, **one painted surface**: the main host is always `width:100%` and its list paints `TAB_STRIP_BACKGROUND` across the whole strip. With the second drawer enabled, the secondary host is a **transparent overlay** anchored to its own screen edge (z above the main host), width = `--sidebar-ux-hsplit`, so its cluster floats on the shared surface with no background of its own. The boundary is user-draggable: the handle writes the var live and `CanvasSettings.horizontalSplit` (fraction 0.5 default, clamped 0.1–0.9 + a 64px-per-side floor) persists on release. The main list's secondary-facing side is padded by the same var plus both safe-area insets (`max(8px, calc(env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px) + var(--sidebar-ux-hsplit, calc(-1 * (env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px)))))))`; the insets are added because the overlay edge is inset-anchored — zero insets give exactly the var, and the negated-inset fallback collapses an absent var to the 8px gutter), so the main lane starts exactly at the split — same percentage basis as the fixed host width, which is why the edges coincide at every split (a margin on the inner section would resolve against the list's padded content box and drift up to 8px). No seam overlap is needed any more; the old asymmetric `calc(50% + 1px)`/`50%` zone split is retired. Solo/absent secondary → the var is cleared and the main lane is the full strip. Side swaps mirror automatically (rules are side-scoped).
- **Single geometry writer:** `sidebar/tab-position.ts` owns every host/list geometry write (`applyPinHostChrome` writes `data-strip-axis` / `data-strip-edge`, owner+axis width/z-index and zone anchors in the same wholesale className assignment; the host width is written **inline with `!important`** via `setImportant` so stale theme CSS with a sheet `!important` width cannot freeze the split — live bug 2026-09-16; `applyPinnedTabListChrome` / `clearPinnedTabListChrome` own the list chrome and full reversal; `syncHorizontalSplit` / `setHorizontalSplitPct` are the sole writers of `--sidebar-ux-hsplit`). `sidebar/drawer-location.ts` is presentation/orchestration only: html classes + `--sidebar-ux-strip-h`, shell wrapper edge offsets, handle visibility, consumer knobs, presence subscription, `reconcileDrawerLocation()` (sync + coalesced + generation-guarded — it calls `syncHorizontalSplit()` before the skip-cache so a list-node transition the key misses still applies), `clearDrawerLocation()` (also clears the split var).
- **CSS:** `HORIZONTAL_STRIP_CSS` (in `sidebar/styles.ts`) owns orientation/size/borders/overflow with `!important` (beats the renderer's inline `column` / `overflowX:hidden` / `width:100%`), the **split overlay chrome** (secondary list `background: transparent !important` + `box-shadow: none !important` — the main list is the single surface and the separator token is translucent, so a second paint would darken the line; main lane `padding-left/right: max(8px, calc(env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px) + var(--sidebar-ux-hsplit, calc(-1 * (env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px))))))) !important` per host side (the insets are added because the overlay edge is inset-anchored); the boundary handle: hidden by default, `display: block` only horizontal + owner-secondary, side-anchored `right:-6px` / `left:-6px`, 12px hit zone + a **1px border** `::after` line (zero-width pseudo, `border-left: 1px solid --lumiverse-primary-020`; `--lumiverse-primary-050` on hover/drag — the border paint path stays visible at fractional browser zoom where a 1px background antialiases away, live report 2026-09-16). The line is `opacity: 0` at rest and fades (150ms) only while the pointer is inside the strip band and within 100px of the boundary — a document-level JS tracker toggles `--near` (a CSS `:hover` zone wide enough for the radius would swallow tab clicks); hover/`:focus-visible`/drag reveal unconditionally. Hidden under `@media (max-width:600px), (pointer:coarse)`), zone anchoring (`justify-content: flex-start` on the scroller **plus** a zero-width `::before` pseudo spacer with `margin-left:auto` — the auto margin right-anchors while the tabs fit and collapses to 0 when they overflow, keeping the full scroll range reachable; **never** `justify-content: flex-end` on a horizontal scroller, it clips the inline-start overflow and makes the strip unscrollable — live bug 2026-09-13. The spacer is a pseudo, not a class on a button: button-identity stamping broke three times — hidden first button 2026-09-14, removed/mid-drag anchor 2026-09-15, DnD placeholder exclusion 2026-09-15), Settings dock pinned to the drawer-side screen edge in Top/Bottom (`order` flips it before/after the tabs by drawer side; divider always faces the tabs — live feedback 2026-09-14), edge-aware active indicator, the OS Start's own `.sidebar-ux-tab-list-bottom` dock in the second drawer (the divider is container-owned — identical chrome to the main Settings dock; the dock must stay the list's LAST child: tab writers insert via `appendSecondaryTabNode`/`getSecondaryStartDock` in `tabs/secondary-start-dock.ts`, never a plain append — live report 2026-09-15. The split handle is a **host** child, not a list child, so it can never displace the dock), and the chat/Landing top/bottom reserve (the chat reserve includes a `_chatColumnInner_` bottom margin — the host `.body` is a flex row, so the outer column margin alone clips the composer; see `docs/chat-reflow.md`). Strip math: 4px + 48px + 4px = 56px.
- **Presence:** zone presence = `secondSidebarEnabled && isSecondaryShellLive() && hasSecondaryAssignedTabs()` (+ list node — the strict predicate that gates the split var). Presence never re-chromes the main host width (always 100%); it only shows/hides the transparent secondary overlay, writes/clears the split var and creates/removes the boundary handle. Reconciles are triggered by the `onModelChanged` presence subscription plus explicit calls at shell mount/teardown, mode switches, viewport crosses and side swaps.
- **Split handle (`tab-position.ts`):** a `div.sidebar-ux-hsplit-handle` child of the secondary pin host, created with the pin and removed in `destroyPinChrome` **before** its child-reparent loop (otherwise it would land in the drawer as an invisible `pointer-events:auto` strip). Drag: pointerdown gated on horizontal + fine pointer (not mobile/coarse), live `setHorizontalSplitPct` writes (drag-ownership flag blocks reconciles from clobbering), `setSettings({horizontalSplit})` on a clean release, double-click resets to 0.5. `pointercancel` / window `blur` / host teardown / release-outside restore the pre-drag value; a full-viewport transparent overlay (`z-index:13000`, the DnD pattern) keeps drawer iframes from swallowing pointermove. `horizontalSplit` lives in `CanvasSettings` (settings.json) and survives reload and mode switches. Reveal: the `::after` line is hidden at rest and fades in only when the pointer is in the strip band and within 100px of the boundary (`shouldRevealSplitHandle`, toggled by a document-level rAF-coalesced tracker that is torn down with the handle; a capture-phase `pointerout` hides the line when the pointer leaves the strip straight into a drawer iframe, where no document pointermove fires) — hover/focus/drag reveal unconditionally.
- **Taskbar auto-enable + restore:** selecting Top/Bottom forces `taskbarMode` + `moveControlsToOuterEdge` (normalize invariant); the panel locks those two rows while horizontal and renders the hide-handles row inert-but-checked. Returning to Sides restores the user's pre-excursion Sides values from `sidesChromePrefs` (recorded by `setSettings` on an explicit chrome toggle while on Sides; defaults when no record exists) — it does not leave the forced values behind (live feedback 2026-09-14). Edge handles are hidden on both platforms (the strip is the reopen affordance).
- **OS-mode panel-header controls (`os/panel-chrome.ts`):** both drawers' panel headers get the injected `–` minimize control left of the shell-owned X while OS mode is on. `osWindowControls` (default on) gates the pair: ON — `–` minimizes the displayed window, `X` closes it (D2/D9 seam via `os/header-close.ts`); OFF — only the X shows and it MINIMIZES (vanilla Lumiverse drawer behavior; the strip button stays), with close still available from the tab button's right-click/long-press menu. The X branch reads the setting at click time, so a live toggle only needs the chrome pass (`applyOsWindowControlsChange`); no displayed window hides both (D17).
- **OS-mode Start button (`os/start-menu.ts`):** styled with the Options/Settings dock chrome — `OS_START_BUTTON_CSS` in `styles.ts` keyed on `data-canvas-os-start` (full-width 48px row, 8px radius, `--lumiverse-primary-015` hover, 20px icon); `HORIZONTAL_STRIP_CSS` + the mobile sheets re-pin 48×48 / 52×48 with `!important`. The markup carries **no inline styles** and **never** the mirror button class (renderer stale-drop, DnD install and live-order scan treat that class as a real tab). The ensure pass subscribes to `canvas:drawer-shell-created` (same signal panel-chrome uses), so a second-drawer enable / side remount while OS mode is already on re-creates the secondary Start button (live report 2026-09-15); install/remove is idempotent and teardown removes the listener. **Location (2026-09-19, replaces the `osSecondaryStartMenu` boolean):** `startButtonLocation` (`left`/`right`/`both`/`null` = main drawer) resolves through `resolveChromeSides(value, mainSide, secondEnabled)` (`sidebar/chrome-sides.ts`); the requested side with no drawer falls back to the main drawer, so the launcher is never unreachable; legacy `osSecondaryStartMenu: true` migrates to `both`. Each button is stamped `data-canvas-start-side` so per-side removal (`removeStartChromeForSide`) is a document-wide sweep that can never take the other side's button; the shared secondary dock is removed only when it has no content left (the Options gear may still live in it). `applyStartButtonLocationChange` re-runs the reconcile; the main drawer's Start menu still lists every window from both drawers. **Start edge anchor:** `startButtonAlwaysOnScreenEdge` (default on, Top/Bottom only) toggles the root class `sidebar-ux-start-edge-inner` on `<html>`; `HORIZONTAL_STRIP_CSS` keys the Start `order` on it — the outer rules are the unstamped default, the inner classes override with higher specificity, so a missing class keeps the shipped screen-edge anchoring and pin-host recreation cannot drop the variant. **Sides strip-top anchor (2026-09-27, `startButtonAtStripTop`, default off):** the Sides bottom dock is pinned by `margin-top: auto` (container chrome, not DOM order), so CSS `order` cannot lift Start — when the setting is on (desktop viewports, >600px), `ensureStartButtonForSide` instead inserts the button as the FIRST child of the vertical tab list (the dock with the Options gear stays bottom-anchored in both variants, and turning the setting off re-docks the button / removes a stranded empty dock). The variant carrier is the root class `sidebar-ux-start-at-strip-top` (toggled in `reconcileChromeLocations`, cleared in teardown); `START_STRIP_TOP_CSS` + `START_STRIP_TOP_DIVIDER_CSS` style only the top position (the divider is a dedicated `sidebar-ux-start-strip-top-divider` list child between the button and the strip — container-owned line with an 8px gap on each side, matching normal mode's dock construction; LUMI-15 — the original button-owned `border-bottom` was rejected by the member) and are scoped `@media (min-width: 601px)` so the mobile row layout is untouched.
- **OS-mode Start menu (`os/start-menu.ts` + `os/start-menu-styles.ts`):** context-menu chassis (surface = the tab strip's own background — `TAB_STRIP_BACKGROUND` in `sidebar/styles.ts`, shared with the drawer shell's inline tab-list background and pin-asserted, user request 2026-09-16; 1px `--lumiverse-border`, 10px radius, a **softened negative-spread shadow** (`0 8px 24px -6px`) — mirrored upward when the menu opens upward, `data-open-upward`, so it never paints over the bottom taskbar/tab strip; user report 2026-09-16: too intense/elongated — `4px` surface padding, divider `4px 8px`, `body[data-glass]` + blur gated on `not (pointer: coarse)`). Each entry is a 28px icon tile + state rail + status slot: marks are `●` open, `○` minimized, **none** closed (eye-hidden tabs present like closed — they have no strip button either). hover/`:focus-visible` fill the row and swap the mark for the action verb (Focus/Restore/Launch). Icons resolve live strip button (puzzle placeholders count as a miss) → store `iconSvg`/`iconUrl` → `BUILTIN_ICON_SVGS` → monogram. **Per-drawer launch (2026-09-16):** each entry launches into the INVOKING menu's drawer — the inventory stays global (both menus list every window), but a window living in the other drawer moves here and is displayed (no minimized arrival). A window whose strip button was not already in the target drawer (closed, hidden, or other-drawer) lands at that drawer's launch end: bottom in Sides; in Top/Bottom the end closest to the screen middle (append for a left drawer, prepend for a right drawer, because the right cluster is edge-anchored). A window already in the target drawer keeps its slot (`os/actions.ts` `launchEndVisibleIndex`). Moves OUT of the second drawer also run the source handoff: the stale source button is unassigned (the secondary removal half is not model-driven) and, when the moved window was displayed there, the captured nearest neighbor is activated — no ghost button/header on an empty panel. The re-home runs BEFORE the target content click (a click against a root still owned by the secondary wrapper leaves the target panel empty). All static chrome lives in the `canvas-os-start-menu-styles` sheet (leaf module); position/`transform-origin` stay inline (motion coordinate contract), and the sheet is removed in `teardownStartMenu` + the setup sweep — never in `hideStartMenu` (the close animation needs it). Viewport width/max-height divide by `--lumiverse-ui-scale` (the menu is a `body > *` child under the host zoom). Traps: `docs/pitfalls.md` §15.
- **Host "Drawer side" convergence (S8 #2):** a host-driven flip restyles via `applyCanvasSideChange` **and** adopts the side into the owned model immediately (`drawer-sync.convergeModelToHostSide`; the 500ms host watcher is the fallback). The comparison is against `getModel().side` — `getMainDrawerSide()` is DOM-first and already flipped, so comparing against it leaves the model stale and the next dispatch's `diffSide` writes the old side back (the strip snaps back when a tab is opened).
- **Mobile:** `isMobileViewport() && !isHorizontalStrip()` preserves Sides-mobile byte-for-byte; horizontal mobile pins the strip like desktop (full-bleed panels unchanged). The persisted split applies on mobile too, but the boundary handle is CSS/JS-hidden for `≤600px` / coarse pointers (same policy as DnD and resize handles).
- **DnD:** horizontal reorder/move including cross-seam drawer moves and edge auto-scroll; fine-pointer desktop only (≤600px and coarse-pointer devices are no-ops, same policy as resize handles). The drop containers (secondary list `[edge, split]` + main `.sidebar-ux-tab-list-main` `[split, dock]`) tile at the split because the lane insets via list padding — `seamChoice` resolves exactly at the boundary. Do not switch the lane to a margin: it would open an ~8px gap and shift the seam by half the gutter.
- **Boundaries:** never write strip geometry outside `tab-position.ts` (the split var included); the horizontal list is `position:absolute` inside the fixed zone host — never `fixed` + `width:100%`; `stripPinnedOn` (dock offset) and the reflow L/R strip reserves gate on `!isHorizontalStrip()`. The main lane boundary is **list padding** (`max(8px, calc(env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px) + var(--sidebar-ux-hsplit, calc(-1 * (env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px)))))))`, both safe-area insets added because the overlay edge is inset-anchored), never a margin on the inner section — a percentage margin resolves against the list's padded content box (a different basis from the fixed host width) and drifts by up to 8px. The secondary overlay must keep `background: transparent` + `box-shadow: none` (the main list is the only surface); never raise the vertical pinned-list z-index or the wrapper z. Right-anchored clusters must stay scrollable: anchor with the `::before` auto-margin spacer + `flex-start`, never `flex-end` on the scroller (see `docs/pitfalls.md` §11). The pin path owns the drawer orientation while pinned on Sides (`pinTabList` / `pinMainMirrorShellTabList`: side-right `row-reverse`, side-left `row`) — `applyTabListPosition` skips pinned lists, so a location flip must re-assert it there (live bug 2026-09-14).

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
2. Animate open via `animateDrawerOpen` (mode-routed: Sides `animateWrapper` translateX slide / Top-Bottom `animatePanelToggle` rail bloom — see Animation)
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

## Animation (`animation.ts` + `panel-motion.ts`)

Two mode-routed open/close motions — `sidebar/panel-motion.ts` picks by `isHorizontalStrip()`:

- **Sides** — the original `requestAnimationFrame` translateX slide, easeOutCubic 350ms: `animateWrapper(wrapper, targetPx)`. The wrapper translates and the tab list + drawer move as one unit (no counter-translate, no CSS transitions). Since 2026-09-17 the slide also marks the wrapper with `data-canvas-panel-animating` and reports in-flight state through `isPanelAnimating`/`whenPanelMotionSettles`, so OS parking and the CSS guards (content visible, real shadow held) cover the slide exactly like the bloom; settle listeners registered on a tween transfer to a superseding motion.
- **Top/Bottom ("rail bloom")** — the wrapper's translateX is purely structural (snaps to the open slot pre-paint, to the closed slot after the exit) while `animatePanelToggle` drives `.sidebar-ux-drawer` opacity + a rail tuck + 1.5% scale; `.sidebar-ux-panel` resolves last (phase-shifted UI channel): **270ms open / 270ms close** (`PANEL_OPEN_MS`/`PANEL_CLOSE_MS`, user-tuned 2026-09-15), easeOutCubic. The rail (pin host z-index 10000) paints above the wrapper (9990), hiding the tuck; direction is mirrored per edge.
  - **D17 parking is deferred to the settle (both locations):** the wrapper carries `data-canvas-panel-animating` while a motion runs (bloom OR Sides slide); OS "no displayed window" parking (`applyNoActiveParking`: `setCanvasMainNoActive` → `display:none` on the content slot, title clear, and the X/– hide) is registered with `whenPanelMotionSettles` instead of applying immediately, and the sheet's content-hide rule is scoped `:not([data-canvas-panel-animating])`. Without this the content/title vanished at the first frame of the close (user feedback 2026-09-15 for the bloom; 2026-09-17 for Sides, where the settle gate had been blind to the translate tween and the header controls hid synchronously in the commit).
  - **Anchoring (`panel-motion.ts`):** the origin is the *displayed window's strip button* (`computePanelAnchor`, percentages of the drawer box — zoom-safe, may fall outside the box), so the close visibly collapses into that tab and the open grows out of it. The tracker follows the model's per-side active via `onModelChanged` (dynamic import — keeps panel-motion out of the dispatch cycle), keeping the last displayed window for closes.
  - **No associated button → pure fade:** OS close dismisses the window first, so `os/actions.ts` calls `suppressNextCloseAnchor(side)` (one-shot, guarded on the drawer being open) and the close fades in place with no transform movement. OS *minimize* does not suppress — the button remains, so the panel still collapses toward it. Unanchored opens fall back to the rail center.
- `cancelWrapperAnimation(wrapper?)` cancels both tweens and resets the bloom's inline styles (restores `pointer-events: auto`); `cancelAllWrapperAnimations()` settles every live wrapper (location flips). `prefers-reduced-motion` skips both animations (instant end states).
- **Drawer shadow = the real box-shadow (2026-09-15, final):** `.sidebar-ux-drawer` carries the inline `var(--lumiverse-shadow-xl)` and that is the only drawer shadow — a child of the shell wrapper, so it fades/micro-scales with the Top/Bottom rail bloom and fades with the shell during main-persist's boot/mode-switch reveal guards, with no special handling. Closed drawers are suppressed (`sidebar-ux-shadow-close-suppress`) with a `:not([data-canvas-panel-animating])` guard: `data-drawer-open` flips false at close-start, so without it the close fade would be shadowless. A chat-owned inset-shadow mechanism (root `data-canvas-chat-shadow`, real-shadow suppression + inset on the chat column so the shadow rendered under chat content) went through several rounds (edge-slide, reveal-guard holes, a reverted cross-fade) and was **removed** — the user prefers the single real shadow, accepting that it paints above chat content while a drawer is open. Do not resurrect it. A fresh chat element's first margin application still snaps (`data-canvas-reflow-instant`) so load never animates the layout.
- Inline `will-change` exists only for the bloom's duration — a persistent `will-change: transform` would make the drawer a containing block for fixed descendants.

## Panel Header Sync (`panel-header-sync.ts`)

Keeps the secondary's panel header in sync with the main drawer's:
- Height, padding, font-size, border, background
- Uses `ResizeObserver` + `MutationObserver` on the main header
- Writes 6 CSS variables on the secondary wrapper
- Coalesced via `requestAnimationFrame`

## Persistence

Width is stored in the CSS variable `--sidebar-ux-secondary-w`. Open/closed state is stored in the layout blob. The `snapshotLayout()` function reads both for persistence. The close transform is computed from the width: `getClosedTransformPx()`.
