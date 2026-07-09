# Chat Reflow

## Overview

Chat reflow shifts the chat column's margins so neither sidebar covers it. When a drawer opens, the chat column is recentered in the remaining visible area.

## How It Works

### CSS Injection

Injected style (`sidebar-ux-reflow`):
```css
[class*="_chatColumn_"] {
  margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
  margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
  transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
}
@media (max-width: 600px) {
  [class*="_chatColumn_"] {
    margin-left: 0 !important;
    margin-right: 0 !important;
    transition: none !important;
  }
}
```

### Margin Calculation (`updateChatReflow`)

1. Read main drawer side and width:
   - If **Canvas main mirror** is active (`keepTabListVisible` desktop): use Canvas open state + `--sidebar-ux-main-mirror-w` when open, else `TAB_LIST_WIDTH_PX` (56). Ignore host `wrapperOpen`.
   - Else: host open → `getMainDrawerWidth()`; host closed + pin setting → 56px
2. Read secondary drawer open state and width (from CSS variable)
3. When secondary is closed but `keepTabListVisible` is on and a secondary tab list exists, reserve `TAB_LIST_WIDTH_PX` (56px)
4. Read LumiScript dock panel insets (`--spindle-dock-left`, `--spindle-dock-right`)
5. Subtract dock insets from drawer widths (they overlap, don't double-count)
6. Set `--sidebar-ux-chat-ml` and `--sidebar-ux-chat-mr` on the chat column

### Observer Architecture

`startReflowObserver()` installs:

1. **Main wrapper observer**: `MutationObserver` on `class`/`style` attributes → fires on drawer open/close
2. **App element observer**: `MutationObserver` on `[data-app-root]` style → fires on dock panel changes
3. **Chat column observer**: `MutationObserver` on `[data-app-root]` childList → fires when chat appears
4. **Chat column attribute observer**: detects host re-renders that reset margins
5. **Viewport-cross listener**: `matchMedia('(max-width: 600px)')` → clears stale desktop vars on cross-down, re-runs on cross-up

### Scheduling

`scheduleReflow()` coalesces via `requestAnimationFrame` — multiple observers firing in the same tick produce only one `updateChatReflow()` call.

### Mobile Behavior

On mobile (<=600px), reflow is a complete no-op:
- `updateChatReflow()` early-returns after clearing stale vars
- The injected CSS overrides margin to 0
- Cross-down clears any leftover inline vars

## Button Tagging

Co-located with reflow because they share the same lifecycle (gated on `chatReflow` setting).

`tagMainSidebarButtons()` walks the store's `drawerTabs` and sets `data-tab-id` on extension tab buttons by title-matching. This enables the fast id-based `findMainTabButton` lookup.

`startTagObserver()` installs a `MutationObserver` on the sidebar for childList+subtree, re-tagging on tab add/replace. Initial tag pass runs once the sidebar is in the DOM.
