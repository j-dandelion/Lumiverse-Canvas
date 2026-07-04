# Mobile Support

## Overview

Canvas provides mobile-specific behavior for viewports <= 600px. The primary constraint: only one sidebar can be open at a time.

## Viewport Detection

`isMobileViewport()` — `window.matchMedia('(max-width: 600px)').matches`

**Distinct from**: `isPointerResizeActive()` in `resize/handles.ts` which uses `matchMedia('(pointer: coarse)')` for resize-handle suppression. Mobile viewport detection is for layout decisions; pointer detection is for interaction decisions.

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

## CSS Variable Sync

On mobile, the CSS variable `--sidebar-ux-secondary-w` is overwritten to `window.innerWidth` so the close-transform matches the 100vw drawer. On desktop, the saved value is restored.

`syncCssVarToDrawerWidth()` handles save/restore with `_desktopCssVarValue` cache.

## Viewport Crossing

`startMobileExclusion()` registers a `matchMedia` change listener:

- **Cross-down** (desktop → mobile): Close secondary silently, update body classes
- **Cross-up** (mobile → desktop): Clear body classes, restore CSS variable

Additionally, a `resize` listener keeps the CSS variable and wrapper transform in sync on mobile when the user drags the viewport (matchMedia only fires once per boundary crossing).

## Drawer Width on Mobile

- `_updateDrawerWidth()`: On mobile, forces `drawer.style.width = '100vw'`. On desktop, restores `var(--sidebar-ux-secondary-w, 420px)`.
- Cancels any in-flight wrapper animation before updating.
- Updates the wrapper's `translateX` to match the new CSS var.

## Mobile Tab List

CSS in `styles.ts` restructures the secondary tab list on mobile:
- `flex-direction: row` (horizontal)
- `overflow-x: auto` (scrollable)
- Tab buttons: 52x48px uniform size
- Active indicator: bottom underline instead of left border
- Bottom border on the tab list

## Mobile-Specific Behavior in Other Modules

- `assignToSecondary`: does not auto-open secondary drawer on mobile
- `assignTab` (built-in path): does not auto-open secondary on mobile
- `activation-handoff`: Part C (destination activation) is skipped on mobile
- `applyTabListPosition`: no-op on mobile (CSS forces layout)
- `resize/handles`: no handles on mobile
- `chat/reflow`: complete no-op on mobile
- `main-persist/restoreMainDrawerFromDom`: skips width override on mobile
