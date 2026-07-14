# Custom CSS & Theming

Guide for power users and theme authors who want Canvas drawers (secondary + main-mirror) and host main chrome to share one stylesheet with minimal dual-mode branching.

## Why host main ≠ main-mirror

| Mode | Main drawer chrome | What your CSS sees |
|------|--------------------|--------------------|
| **Taskbar mode off** | Host React drawer + CSS-module hashes (`tabBtn…`, `_panel_…`, `wrapperOpen`, etc.) | Host selectors only |
| **Taskbar mode on** | Canvas shell (`sidebar-ux-*`); host chrome hidden via `html.sidebar-ux-canvas-main-active` | Canvas selectors only for chrome |

**Main-mirror is not a clone of host class names.** It is the same Canvas shell factory as secondary (`createDrawerShell`), so tab strip, drawer tab, panel chrome, and open/close animation match **secondary**, not the host CSS modules.

Host module selectors (`[class*="tabBtn"]`, `[class*="_panelHeader_"]`, …) therefore:

- Work on host main when taskbar mode is **off**
- Do **not** style main-mirror or secondary chrome when taskbar mode is **on**

Panel **content** is still host/extension DOM (reparented into the Canvas shell slot). Content-oriented rules often still apply; **chrome** rules need Canvas selectors (or tokens).

---

## Best path: CSS variables

Override Lumiverse theme tokens and Canvas layout vars on `:root` / `html`. Tokens flow into both host UI and Canvas shells without per-drawer selectors.

### Lumiverse tokens used by Canvas shells

Drawn from `drawer-shell.ts` and `styles.ts` (non-exhaustive; host may define more):

| Token | Typical use in Canvas |
|-------|------------------------|
| `--lumiverse-bg-deep` | Drawer background |
| `--lumiverse-bg` / `--lumiverse-bg-hover` | Drawer-tab surface / hover |
| `--lumiverse-primary` | Active tab accent, mixes |
| `--lumiverse-primary-008` … `--lumiverse-primary-050` | Header, hover fills, borders |
| `--lumiverse-text` / `--lumiverse-text-muted` / `--lumiverse-text-dim` | Titles, labels, icons |
| `--lumiverse-border-hover` | Drawer-tab border |
| `--lumiverse-shadow-xl` | Drawer elevation |
| `--lumiverse-fill-heavy` | (styles surfaces) |
| `--lumiverse-ui-scale` | Zoom / mobile width math |
| `--lumiverse-font-scale` | Label / title font sizing |
| `--lcs-glass-bg` | Optional glass fallback for drawer-tab |

Example:

```css
:root {
  --lumiverse-primary: #7c6af7;
  --lumiverse-bg-deep: #0e0e14;
  --lumiverse-text: #f2f2f7;
}
```

Token overrides apply everywhere those vars are consumed (host + both Canvas drawers).

### Canvas layout / chrome vars

| Variable | Role |
|----------|------|
| `--sidebar-ux-secondary-w` | Secondary drawer width (px) |
| `--sidebar-ux-main-mirror-w` | Main-mirror drawer width (px) |
| `--sidebar-ux-chat-ml` / `--sidebar-ux-chat-mr` | Chat reflow margins (chat column) |
| `--sidebar-ux-strip-l` / `--sidebar-ux-strip-r` | Taskbar strip gutters (Landing) |
| `--sidebar-ux-panel-header-h` / `-pt` / `-pb` / `-font-size` / `-border-bottom` / `-bg` | Panel header geometry (stamped on shells) |
| `--sidebar-ux-drawer-tab-*` | Edge open/close tab size/padding/border (synced from host when available) |
| `--sidebar-ux-content-pt` / `-pr` / `-pb` / `-pl` | Panel content padding (on `.sidebar-ux-panel-content`) |

Prefer tokens for color/type; use layout vars only when intentionally resizing chrome.

---

## Stable Canvas selector map (public API)

These classes and attributes are intentional hooks. Prefer them over scraped hashed host modules for Canvas chrome.

### Wrappers / ownership

| Selector | Meaning |
|----------|---------|
| **`.sidebar-ux-shell`** | Both Canvas drawer wrappers (main-mirror + secondary). Prefer this for shared chrome rules. |
| `.sidebar-ux-main-mirror-wrapper` | Main Canvas shell only (`data-drawer-owner="main"`) |
| `.sidebar-ux-secondary-wrapper` | Secondary shell only (`data-drawer-owner="secondary"`) |
| `[data-drawer-owner="main"\|"secondary"]` | Owner attribute on the wrapper |
| `.sidebar-ux-side-left` / `.sidebar-ux-side-right` | Anchor edge (wrapper and pin hosts) |
| `[data-drawer-open="true"\|"false"]` | Open state on the wrapper |

Exact class string on a shell (example, secondary right):

```text
sidebar-ux-secondary-wrapper sidebar-ux-shell sidebar-ux-side-right
```

Main-mirror left:

```text
sidebar-ux-main-mirror-wrapper sidebar-ux-shell sidebar-ux-side-left
```

### Inner chrome

| Selector | Meaning |
|----------|---------|
| `.sidebar-ux-drawer` | Drawer body |
| `.sidebar-ux-drawer-tab` | Edge open/close control |
| `.sidebar-ux-tab-list` | Vertical tab strip |
| `.sidebar-ux-panel` | Panel column |
| `.sidebar-ux-panel-header` | Title bar |
| `.sidebar-ux-panel-content` | Content slot (hosts reparented roots) |
| `.sidebar-ux-panel-title` | Header title text |
| `.sidebar-ux-close-btn` | Header close control |
| `.sidebar-ux-resize-handle` | Drag-to-resize handle |

### Tab buttons

| Selector | Meaning |
|----------|---------|
| `button[data-tab-id]` | Secondary (and many Canvas) tab buttons |
| `.sidebar-ux-main-tab-mirror-btn` | Main-mirror tab buttons |
| `.sidebar-ux-tab-active` | Active highlight (Canvas) |
| `.sidebar-ux-tab-labeled` | Labels visible |
| `.sidebar-ux-tab-label` | Label text node |

### Pin hosts (taskbar mode)

When tabs stay visible with the drawer closed, the strip may be reparented onto `document.body`:

| Selector | Meaning |
|----------|---------|
| `.sidebar-ux-tab-list-pin-host` | Body-level pin strip container |
| `.sidebar-ux-tab-list-pin-host[data-pin-owner="main"]` | Main pin host |
| `.sidebar-ux-tab-list-pin-host[data-pin-owner="secondary"]` | Secondary pin host |

Do not style tab-strip chrome only as `.sidebar-ux-shell .sidebar-ux-tab-list …` if you care about the pinned state — include pin hosts (see recipes).

### Document markers

| Selector | Meaning |
|----------|---------|
| `html.sidebar-ux-canvas-main-active` | Taskbar main shell active; host main chrome is hidden |
| `html.sidebar-ux-canvas-main-open` | Canvas main drawer open |
| `html.sidebar-ux-strip-gutters` | Landing strip gutters active |

---

## Copy-paste recipes

### 1. Theme tokens only

```css
:root {
  --lumiverse-primary: #8b5cf6;
  --lumiverse-bg-deep: #12121a;
  --lumiverse-text: #ececf1;
  --lumiverse-text-muted: #a1a1aa;
}
```

### 2. Both Canvas drawers + pin strips in one rule

```css
/* Shared shell chrome (open drawer surfaces) */
.sidebar-ux-shell .sidebar-ux-drawer {
  /* example: slightly stronger elevation */
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--lumiverse-primary) 18%, transparent),
    var(--lumiverse-shadow-xl);
}

/* Tab buttons: inside shells OR body-level pin hosts */
.sidebar-ux-shell .sidebar-ux-tab-list button[data-tab-id],
.sidebar-ux-shell .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn,
.sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id],
.sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn {
  border-radius: 10px;
}

/* Optional: one owner only */
[data-drawer-owner="secondary"] .sidebar-ux-panel-header {
  /* secondary-only header tweak */
}
```

### 3. Dual-mode: host main (taskbar off) + Canvas strips (taskbar on)

When you still support users with taskbar mode **off**, pair host module attribute selectors with Canvas classes:

```css
/* Host main tab buttons (hashed modules — prefix match) */
[class*="tabBtn"]:not(.sidebar-ux-main-tab-mirror-btn),
/* Canvas secondary + main-mirror + pin strips */
.sidebar-ux-shell .sidebar-ux-tab-list button[data-tab-id],
.sidebar-ux-shell .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn,
.sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id],
.sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn {
  /* shared intent; may still need specificity tweaks for Canvas !important active states */
}
```

Prefer tokens when possible so both modes pick up color without fighting active/hover `!important` rules in `styles.ts`.

---

## Pitfalls

1. **Host module selectors miss main-mirror.** `[class*="tabBtn"]` / `_panelHeader_` do not match Canvas chrome under taskbar mode.
2. **Canvas active/hover often uses `!important`.** Token overrides or matching Canvas selectors (same specificity, same `!important`) beat partial host-style rules.
3. **Panel content ≠ chrome.** Content inside `.sidebar-ux-panel-content` is still host/extension UI; content CSS may apply. Chrome (header, strip, drawer-tab) is Canvas-owned.
4. **Pin host reparenting.** With taskbar mode, tab lists can leave the wrapper and live under `.sidebar-ux-tab-list-pin-host` on `body`. Rules scoped only under `.sidebar-ux-shell …` miss pinned strips.
5. **Do not depend on host class names on mirror buttons.** Canvas deliberately does not copy host CSS-module classes onto mirror tabs (fragile across host rebuilds).

---

## What Canvas will not do

- **No automatic host→mirror CSS rewriting.** Themes are not rewritten at runtime to map host modules onto Canvas classes.
- **No aliasing of host CSS-module class names** onto main-mirror buttons or wrappers.
- **No guarantee** that hashed host prefixes stay stable forever — for dual-mode themes, keep host selectors as attribute substring matches and keep Canvas on the stable map above.

For architecture of shells and taskbar mode, see [sidebar.md](sidebar.md). For chat margins, see [chat-reflow.md](chat-reflow.md).
