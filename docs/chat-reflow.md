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

### Open-drawer shadow ownership (2026-09-15)

The Canvas drawer shells are body-level `position: fixed` layers at
`z-index: 9990`, above the whole host `.app` subtree (`.app` is
`isolation: isolate`), so their real `box-shadow` paints over chat content and
**cannot** be z-ordered underneath it from inside the app. While a reflow lane
is active the real shadow is suppressed and a matching inset `box-shadow` is
painted on the chat column instead: inset shadows render in the element's
background layer, below its content, so bubbles/composer cover the shadow —
underneath on the z axis.

```css
html[data-canvas-chat-shadow] .sidebar-ux-shell[data-drawer-open="true"] > .sidebar-ux-drawer { box-shadow: none !important; }
html[data-canvas-chat-shadow~="left"]  [class*="_chatColumn_"] { box-shadow: inset  60px 0 60px -60px rgba(0,0,0,.5) !important; }
html[data-canvas-chat-shadow~="right"] [class*="_chatColumn_"] { box-shadow: inset -60px 0 60px -60px rgba(0,0,0,.5) !important; }
/* both sides open → later two-shadow rule wins */
```

- `data-canvas-chat-shadow` (root, token list) is set by `updateChatReflow`
  only when: desktop, Sides location, `drawerShadowsDesktop` on, a chat column
  exists, and that side's drawer is **open** (strip reserves do not count;
  `computeContentLaneInsets` returns `openLeft`/`openRight`).
- `clearChatMargins()` removes the attr — mobile/cross-down, `chatReflow`
  off, and the extension-disable cleanup in `setup.ts`.
- Top/Bottom location has no L/R shadow lane → attr stays off.
- The `60px / -60px` inset form mirrors `--lumiverse-shadow-xl`
  (`0 20px 60px rgba(0,0,0,.5)`) edge falloff.

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
