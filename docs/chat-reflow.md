# Chat Reflow &amp; Taskbar Mode Strip Gutters

Two separate systems own different surfaces. Do not merge them.

| System | Setting | What it does | Consumers |
|--------|---------|--------------|-----------|
| **Strip gutters** | `taskbarMode` (+ outer-edge) | Permanent **Welcome/Landing** bounds = **pin-strip width only** (56px). Open drawers **overlay** Welcome. | `[data-component="LandingPage"]` via static CSS |
| **Chat reflow** | `chatReflow` | Open-drawer (and taskbar closed-strip) margins on the **chat column** only (with transition). | `[class*="_chatColumn_"]` only |

## Policy matrix

| taskbarMode (desktop) | chatReflow | Strip gutters | Chat reflow |
|------------------------------|------------|---------------|-------------|
| OFF | OFF | none | none |
| OFF | ON | none | Classic host open-drawer widths on chat column |
| ON | OFF | strip on Landing pin edges | none (chat may sit under pin strips) |
| ON | ON | strip on Landing only | **Active**: mirror open width / closed strip reserve; secondary open or strip |

Mobile (≤600px): both clear / no-op.

**S8 Drawer location (Top/Bottom):** L/R strip reserves are dropped (`isHorizontalStrip()` gates the `mainStrip`/`secStrip` terms) and the Landing gutter vars are cleared — the strip reserve is owned by `HORIZONTAL_STRIP_CSS` as a `margin-top`/`margin-bottom` on the chat column and `[data-component="LandingPage"]`, so it also applies on mobile where `updateChatReflow` early-returns. **2026-09-15:** the reserve also lands on `_chatColumnInner_` (`.chatColumnInner`) as `margin-bottom: var(--sidebar-ux-strip-h, 56px)`. The host `.body` is a flex ROW, so the outer column margin alone does not reduce the column height (`100% + 56px`) and `overflow: clip` cut the composer off in Top mode; the inner is a column-flex child with default `flex-shrink`, so its bottom margin shrinks it to `100% − 56` and keeps the composer inside the visible lane (Bottom: lifts it above the strip). Do not remove the inner rule when touching the reserve. All four reserve rules carry Theme Studio's inert `:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__)` guards — they exist only as a 2-ID specificity tier: TS "strong" overrides compile to `:where(base):not(#a):not(#b) !important`, which otherwise beats the reserve on specificity (a live TS project sets a strong `margin-bottom` on `_chatColumnInner_`). Keep the guards. Free-floating drag/drop geometry for the strip is handled by `tabs/tab-list-dnd.ts` (see [tabs.md](tabs.md)).

---

## Strip gutters (`src/sidebar/strip-gutter.ts`)

Owned by **taskbar mode**, not by chat reflow.

### Behavior

When taskbar mode is effective on desktop:

1. Main edge → reserve `TAB_LIST_WIDTH_PX` (56)
2. Opposite edge → 56 only if a secondary tab list exists
3. Map to left/right from main drawer side
4. Dock composition: `extra = max(0, stripBase - dockInset)` per side (overlap, not sum)
5. **Never** use open-drawer / mirror open width (Welcome only)

### CSS

```css
html.sidebar-ux-strip-gutters [data-component="LandingPage"] {
  margin-left: var(--sidebar-ux-strip-l, 0px) !important;
  margin-right: var(--sidebar-ux-strip-r, 0px) !important;
  /* no transition — stable chrome, not reflow lag */
}
```

Vars live on `document.documentElement`. Chat is **not** a strip-gutter consumer so reflow CSS is not overridden by the more-specific strip selector.

### When updated

- taskbar mode mount / apply / teardown  
- secondary list create/destroy  
- main side change (pin reconcile)  
- dock style changes on `[data-app-root]`  
- viewport cross 600px  

Not observed: drawer/mirror open width.

---

## Chat reflow (`src/chat/reflow.ts`)

### CSS injection

```css
[class*="_chatColumn_"] {
  margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
  margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
  transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
}
```

Welcome/Landing is **not** a reflow consumer.

### Margin calculation (`updateChatReflow`)

1. Mobile → clear + return  
2. Main width:  
   - **Main mirror active** (taskbar mode): open → `MAIN_MIRROR_WIDTH_VAR` (fallback 420); closed → `TAB_LIST_WIDTH_PX`  
   - **Else**: host `isMainDrawerOpen` ? live width : 0; if taskbar mode effective and still 0 → strip reserve  
3. Secondary: open → `--sidebar-ux-secondary-w` (fallback 420); if closed + taskbar mode + secondary list → strip reserve  
4. Subtract dock insets per side  
5. Write `--sidebar-ux-chat-ml/mr` on the **chat column element**

### Drawer shadows (2026-09-15)

The drawer's **real** `box-shadow` (inline `var(--lumiverse-shadow-xl)` on
`.sidebar-ux-drawer`) is the only drawer shadow. It is a child of the shell
wrapper, so it fades/micro-scales with the panel during a Top/Bottom bloom and
fades with the shell during main-persist's boot/mode-switch reveal guards —
no special handling needed. Drawer location does not change it: Top/Bottom
only moves the tab strip; the panel keeps its left/right column geometry (S8).

- **History / don't resurrect:** a chat-owned inset shadow (root
  `data-canvas-chat-shadow`; real shadow suppressed while a drawer was open,
  inset painted on the chat column so it rendered under bubbles) went through
  several rounds — slide-from-edge artifacts, reveal-guard holes, a reverted
  cross-fade — and was ultimately removed: the user prefers the single real
  shadow, accepting that it paints above chat content while a drawer is open.
  The `data-canvas-chat-shadow` attr, its suppression/inset CSS, the guard
  checks, and the `canvas:panel-motion-changed` event are all gone.
- **Closed drawers** must not bleed their 60px shadow into the viewport
  (`styles.ts` `sidebar-ux-shadow-close-suppress`). The rule carries
  `:not([data-canvas-panel-animating])` because `data-drawer-open` flips false
  at close-start — without the guard the close fade would be shadowless
  instead of fading with the panel.
- **Chat reflow margins** still snap on a fresh chat element's first
  application (`data-canvas-reflow-instant`, dropped after one painted frame
  via double rAF): the chat can mount after the drawer is already open (boot
  restore / SPA navigation), and an animated first margin application reads as
  a load-time layout slide. Later margin changes on the same element animate
  normally; Top/Bottom uses the panel-matched 0.27s duration.

### Observers

`startReflowObserver()` (gated on `chatReflow`):

1. Main wrapper class/style → open/close  
2. App style → dock insets  
3. App childList → when chat column appears (SPA navigate into chat)  
4. matchMedia 600px → clear on cross-down, recompute on cross-up  
5. Button tagger (co-located lifecycle)

Also: secondary open/close, main-mirror `bumpReflow()`, taskbar mode apply, and feature toggle call `updateChatReflow()` directly.

`scheduleReflow()` coalesces via `requestAnimationFrame`.

### Mobile

- Early-return + clear  
- Injected CSS zeros margins at ≤600px  
- Cross-down clears leftover chat vars  

### Button tagging

Co-located with reflow (same `chatReflow` lifecycle). `tagMainSidebarButtons()` / `startTagObserver()` tag extension tab buttons with `data-tab-id`.
