# Mobile Support

## Overview

Canvas provides mobile-specific behavior for viewports <= 600px. The primary constraint: only one sidebar can be open at a time.

## Viewport Detection

`isMobileViewport()` — `window.matchMedia('(max-width: 600px)').matches`

**Distinct from**: `isPointerResizeActive()` in `resize/handles.ts` which uses `matchMedia('(pointer: coarse)')` for resize-handle suppression. Mobile viewport detection is for layout decisions; pointer detection is for interaction decisions.

`isHostMobileDrawerViewport()` — `isMobileViewport() || (pointer: coarse)`. Matches Lumiverse's `useIsMobile` hook. Used **only** for host main drawer full-width forcing — NOT for layout/exclusion/main-mirror decisions (which use the stricter `isMobileViewport()`).

## Mutual Exclusion (`sidebar/mobile-exclusion.ts`)

When a sidebar opens on mobile, the other must close:

- **Primary opens**: Close secondary silently (`closeSecondarySidebar({ silent: true })` — preserves `secondary.open = true` in layout.json)
- **Secondary opens**: Close primary by clicking its toggle button (host-owned, no API)

### Body CSS Classes

- `canvas-ux-mobile-primary-open` — set when primary is open on mobile
- `canvas-ux-mobile-secondary-open` — set when secondary is open on mobile

CSS rules in `styles.ts` use these classes to:
- Hide the inactive sidebar's drawer tab button
- Show a backdrop overlay behind the open drawer

### Backdrop

```css
body.canvas-ux-mobile-secondary-open::before {
  content: '';
  position: fixed;
  inset: 0;
  background: var(--lumiverse-fill-heavy);
  z-index: 9989;
  pointer-events: none;
}
```

Purely visual — touch interactions pass through.

## Scaled Viewport Width (Host Alignment)

Lumiverse applies `zoom: var(--lumiverse-ui-scale)` to top-level body children. On mobile the host drawer uses:

```css
var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1)))
```

Canvas previously used raw `window.innerWidth` px for the mobile drawer width, which diverges from the host's CSS-resolved width under zoom ≠ 1. Now Canvas uses the **same CSS expression** for the drawer's inline `width`, so both drawers agree on the rendered size regardless of zoom.

`syncCssVarToDrawerWidth()` reads `drawer.offsetWidth` (the actual rendered size after the CSS expression resolves) and stores it in `--sidebar-ux-secondary-w` so JS transform computation stays in sync. When the drawer isn't mounted yet, it falls back to `Math.round(window.innerWidth / uiScale)`.

## CSS Variable Sync

On mobile, the CSS variable `--sidebar-ux-secondary-w` is overwritten to match the **measured** drawer width (via `drawer.offsetWidth`), not `window.innerWidth`. On desktop, the saved value is restored.

`syncCssVarToDrawerWidth()` handles save/restore with `_desktopCssVarValue` cache.

## Viewport Crossing

`startMobileExclusion()` registers a `matchMedia` change listener:

- **Cross-down** (desktop → mobile): Close secondary silently, update body classes
- **Cross-up** (mobile → desktop): Clear body classes, restore CSS variable

Additionally, a `resize` listener keeps the CSS variable and wrapper transform in sync on mobile when the user drags the viewport (matchMedia only fires once per boundary crossing).

**S8 Drawer location:** both cross directions also call `reconcileDrawerLocation()` and `invalidateDndGeometry()`. A horizontal strip (Top/Bottom) **pins on mobile too** — the central gate is `isMobileViewport() && !isHorizontalStrip()`, so Sides-mobile keeps the S6 no-pin behavior byte-for-byte while Top/Bottom behaves like desktop (strip visible, panels full-bleed, edge handles hidden).

## Drawer Width on Mobile

- `_updateDrawerWidth()`: On mobile, forces `drawer.style.width = 'calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px)'`. On desktop, restores `var(--sidebar-ux-secondary-w, 420px)`.
- Cancels any in-flight wrapper animation before updating.
- Updates the wrapper's `translateX` to match the new CSS var.

## Host Main Drawer Full-Bleed on Larger Mobile

The host main drawer is forced to full viewport width when `isHostMobileDrawerViewport()` returns true:

- **≤600px**: Canvas clears any `!important` width override from `restoreMainDrawerFromDom` (set by previous desktop sessions) so the host CSS media query enforcing `--drawer-panel-w: calc(... + 1px)` takes effect.
- **>600px with coarse pointer** (tablets, phone landscape): The host treats the viewport as mobile (backdrop) but its `@media (max-width: 600px)` CSS does not fire. Canvas JS forces `--drawer-panel-w` to the scaled full-viewport `+1px` expression on the wrapper with `!important`.

This is synchronized on viewport-cross (`startMobileExclusion` matchMedia `change` handler), resize events, and one-shot mount reconciliation via `syncHostMainDrawerToMobileWidth()` in `mobile-exclusion.ts`.

Key guard points:
- `restoreMainDrawerFromDom` — three width-stamp paths gated with `!isHostMobileDrawerViewport()`. When mobile, the saved desktop `clampedWidth` is not stamped and any existing inline width/`--drawer-panel-w` is cleared.
- `teardownMainMirror` — the `--drawer-panel-w` stamp from mirror width is gated with `!isHostMobileDrawerViewport()` so cross-down to mobile does not underfill.
- `resize/handles.ts` — handles never mount on touch devices (`isPointerResizeActive()`), so they don't set width on mobile.
- Resize listener in `startMobileExclusion` calls `syncHostMainDrawerToMobileWidth()` on every resize frame.

## Mobile Full-Bleed Width: +1px Oversize

On mobile, both drawers (Canvas secondary and host main) use the **scaled viewport width + 1px** to fill the visual viewport. Under fractional zoom/AA, `--app-scaled-viewport-width` can resolve ~1px short, leaving a 1px underfill gap when the drawer is open (`translateX(0)`).

The +1px is applied via `calc(... + 1px)` at three sites:

1. **Canvas secondary drawer** — `drawer-shell.ts` `fullViewportWidth` branch sets `width: calc(var(--app-scaled-viewport-width, ...) + 1px)`.
2. **Canvas secondary drawer (viewport cross)** — `mobile-exclusion.ts` `_updateDrawerWidth()` sets `drawer.style.width` to the same `calc(... + 1px)` expression.
3. **Host main drawer** — CSS rule injected via `styles.ts` `SECONDARY_MOBILE_CSS` sets `--drawer-panel-w` on `[class*="wrapperLeft"], [class*="wrapperRight"]` to the `calc(... + 1px)` expression with `!important`.

The closed path already measures `offsetWidth` and adds a +1 transform overshoot, so the wider drawer still fully hides when closed — no change needed there.

## Shadow Suppression When Closed

When the secondary drawer is closed (`data-drawer-open="false"` on the wrapper), CSS forces `box-shadow: none !important` on the drawer element. Without this, the shadow spread from `var(--lumiverse-shadow-xl)` could bleed 4–24px into the viewport past the closed edge. The data attribute is toggled by `openSecondarySidebar` / `closeSecondarySidebar`.

Default `drawerShadowsMobile` is `false` but users can enable it — shadow suppression applies regardless of the setting when the drawer is off-screen.

## Mobile Tab List

CSS in `styles.ts` restructures the secondary tab list on mobile:
- `flex-direction: row` (horizontal)
- `overflow-x: auto` (scrollable)
- Tab buttons: 52x48px uniform size
- Active indicator: bottom underline instead of left border
- Bottom border on the tab list

### Main shell strip (S7 renderer structure)

The main mirror strip is host-shaped: the renderer
(`ensureMirrorListStructure`, `main-renderer.ts`) wraps the buttons in
`.sidebar-ux-tab-list-main` (scrollable) + `.sidebar-ux-tab-list-bottom`
(Settings dock) and forces **inline `flex-direction: column`** on both for the
desktop edge strip. `MAIN_MIRROR_MOBILE_CSS` must flip **both inner sections**
to rows on mobile, size mirror buttons (renderer writes `width: 100%` inline),
and give the Settings dock the host `.sidebarBottom` mobile chrome
(`border-left` separator, no top border). Horizontalizing only the outer
`.sidebar-ux-tab-list` leaves every button stacked vertically.

## Mobile exclusion is interactive, not just visual

The mutual-exclusion body classes also gate interaction:

- While the secondary is open, the entire main shell (`.sidebar-ux-main-mirror-wrapper`
  and all descendants) gets `pointer-events: none !important` — the drawer
  re-enables `pointer-events: auto` inline, and off-screen/stacked chrome could
  otherwise receive taps.
- Symmetric rule for the secondary shell while the main drawer is open.
- Both Canvas edge handles use the class `.sidebar-ux-drawer-tab`
  (hyphenated). The host's camelCase `[class*="drawerTab"]` selector does NOT
  match it — the secondary-open hide rule must name the Canvas class explicitly.

## Host drawer side effects while Canvas owns the surface

Canvas pre-activates built-in tabs by clicking host main tab buttons
(`hostBtn.click()`, `builtin-move.ts`). The host's `handleTabClick` calls
`openDrawer()` as a side effect, so the **headless host main drawer opens and
closes during normal second-drawer placement**. Two guards are required while
the Canvas main shell is active:

1. `main-persist`'s wrapper class observer ignores host `wrapperOpen` churn
   entirely (`isMainMirrorActive()` gate). Otherwise it treats the programmatic
   open as a user open: `enforceExclusionOnOpen('primary')` closes the second
   drawer and `setMobileOpenClass('primary', true)` stamps the primary-open
   class (which switches on the inert-shell rules).
2. The host mobile backdrop (rendered as a **sibling** of the host wrapper,
   z 9991 > Canvas shells' 9990) is hidden via `injectHostHideStyles` —
   scoped with `div:has(> [class*="_wrapper_"] [data-spindle-mount="sidebar"]) > [class*="_backdrop_"]`
   so unrelated `_backdrop_` modal layers are untouched. Without it the
   backdrop sits over the Canvas drawers and swallows every tap.

## Active-tab taps do not toggle-close on mobile

Tapping the active tab toggles the drawer closed on desktop (parity between
the secondary and the main mirror). On mobile the drawer is full-bleed, so the
rightmost tab row overlaps the opposite drawer's edge-handle position at the
same screen edge. The surprise close exposed the other handle under the user's
finger, and the follow-up tap opened the wrong drawer (live report
2026-09-12). Both toggle-close paths are gated off on mobile
(`tabs/buttons.ts` secondary buttons, `main-renderer.ts` mirror buttons); the
header X and the edge handles remain the mobile close affordances.

## Mobile-Specific Behavior in Other Modules

- `assignToSecondary`: does not auto-open secondary drawer on mobile
- `assignTab` (built-in path): does not auto-open secondary on mobile
- `placementFirstMoveByLiveId` (right-click "Move to …", both context menus): does not auto-open the destination drawer on mobile — desktop keeps the open-so-the-move-is-visible behavior
- `activation-handoff`: Part C (destination activation) is skipped on mobile
- `applyTabListPosition`: no-op on mobile (CSS forces layout)
- drawer edge toggles (`updateDrawerTabVisibility`, `updateMainMirrorDrawerTabVisibility`): the `hideDrawerOpenCloseButtons` setting is **desktop-only**. The mobile shell never mounts the taskbar pin strip, so the edge toggle is the only main-drawer reopen affordance; hiding it stranded the main drawer (live report 2026-09-12). Body classes still hide the inactive toggle while the other drawer is open.
- active-tab toggle-close: disabled on mobile for both drawers (see above)
- `resize/handles`: no handles on mobile
- `chat/reflow`: complete no-op on mobile
- `main-persist/restoreMainDrawerFromDom`: skips width override on mobile
- `main-persist` wrapper class observer: ignores host `wrapperOpen` churn while the Canvas main shell is active (programmatic pre-activation opens; see above)
