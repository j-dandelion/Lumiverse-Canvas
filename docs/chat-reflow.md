# Chat Reflow & Keep-tabs Strip Gutters

Two separate systems own page/chat insets. Do not merge them.

| System | Setting | What it does | Consumers |
|--------|---------|--------------|-----------|
| **Strip gutters** | `keepTabListVisible` (+ outer-edge) | Permanent page bounds = **pin-strip width only** (56px). Open drawers **overlay**. | Chat column + Welcome/Landing via static CSS |
| **Chat reflow** | `chatReflow` | Open-drawer margins on the **chat column** only (with transition). | `[class*="_chatColumn_"]` only |

## Policy matrix

| keepTabListVisible (desktop) | chatReflow | Strip gutters | Chat reflow |
|------------------------------|------------|---------------|-------------|
| OFF | OFF | none | none |
| OFF | ON | none | Classic open-drawer widths on chat column |
| ON | OFF | strip on active pin edges | none |
| ON | ON | strip owns page bounds | **no-op** (clears chat margins) |

Mobile (≤600px): both clear / no-op.

---

## Strip gutters (`src/sidebar/strip-gutter.ts`)

Owned by **keep tab lists visible**, not by chat reflow.

### Behavior

When keep-tabs is effective on desktop:

1. Main edge → reserve `TAB_LIST_WIDTH_PX` (56)
2. Opposite edge → 56 only if a secondary tab list exists
3. Map to left/right from main drawer side
4. Dock composition: `extra = max(0, stripBase - dockInset)` per side (overlap, not sum)
5. **Never** use open-drawer / mirror open width

### CSS

```css
html.sidebar-ux-strip-gutters [class*="_chatColumn_"],
html.sidebar-ux-strip-gutters [data-component="LandingPage"] {
  margin-left: var(--sidebar-ux-strip-l, 0px) !important;
  margin-right: var(--sidebar-ux-strip-r, 0px) !important;
  /* no transition — stable chrome, not reflow lag */
}
```

Vars live on `document.documentElement`. Dual leaf selectors are intentional keep-tabs chrome (not reflow proliferation): both routes share the same strip bounds without a drawer open/close observer loop.

### When updated

- keep-tabs mount / apply / teardown  
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
2. Keep-tabs effective → clear chat margins + return (strip gutters own bounds)  
3. Else classic:  
   - Main open → live drawer width; closed → 0  
   - Secondary open → `--sidebar-ux-secondary-w`; closed → 0  
   - Subtract dock insets per side  
   - Write `--sidebar-ux-chat-ml/mr` on the **chat column element**

### Observers

`startReflowObserver()` (gated on `chatReflow`):

1. Main wrapper class/style → open/close  
2. App style → dock insets  
3. App childList → when chat column appears (SPA navigate into chat)  
4. matchMedia 600px → clear on cross-down, recompute on cross-up  
5. Button tagger (co-located lifecycle)

`scheduleReflow()` coalesces via `requestAnimationFrame`.

### Mobile

- Early-return + clear  
- Injected CSS zeros margins at ≤600px  
- Cross-down clears leftover chat vars  

### Button tagging

Co-located with reflow (same `chatReflow` lifecycle). `tagMainSidebarButtons()` / `startTagObserver()` tag extension tab buttons with `data-tab-id`.
