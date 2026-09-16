// CSS injection for the secondary sidebar — drawer tab styles, mobile
// layout, and the CSS variable holding the saved width.
//
// Extracted from sidebar/secondary.tsx.

import { injectStyles } from '../debug/styles'

// CSS variable holding the saved width in pixels. The drawer reads it
// via `width: var(SECONDARY_WIDTH_VAR, 420px)` and snapshotLayout reads
// it for persistence.
export const SECONDARY_WIDTH_VAR = '--sidebar-ux-secondary-w'

/** Canvas main mirror drawer width (taskbarMode desktop mode). */
export const MAIN_MIRROR_WIDTH_VAR = '--sidebar-ux-main-mirror-w'

/** @deprecated Host class hide was removed (fought React). Use document markers. */
export const HOST_MAIN_HIDDEN_CLASS = 'sidebar-ux-host-main-hidden'

/** DocumentElement marker while main mirror mode is active. */
export const CANVAS_MAIN_ACTIVE_CLASS = 'sidebar-ux-canvas-main-active'

/** DocumentElement marker while Canvas main shell is open (reveal host panel content). */
export const CANVAS_MAIN_OPEN_CLASS = 'sidebar-ux-canvas-main-open'

/** Secondary tab-strip width in px (construction, pin, spacer, reflow). */
export const TAB_LIST_WIDTH_PX = 56

// Mobile CSS — scoped to @media (max-width: 600px). Restructures the
// secondary sidebar to match Lumiverse's main sidebar mobile pattern:
// full-width drawer, horizontal tab bar, bottom indicator, mutual
// exclusion via body classes.
export const SECONDARY_MOBILE_CSS = `
@media (max-width: 600px) {
  .sidebar-ux-secondary-wrapper > .sidebar-ux-drawer {
    flex-direction: column !important;
    overflow: hidden !important;
  }
  .sidebar-ux-secondary-wrapper > .sidebar-ux-drawer > .sidebar-ux-tab-list {
    width: 100% !important;
    flex-direction: row !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
    border-bottom: 1px solid var(--lumiverse-primary-020) !important;
    border-left: none !important;
    border-right: none !important;
    padding: 6px 8px !important;
  }
  /* Hide webkit scrollbar */
  .sidebar-ux-secondary-wrapper > .sidebar-ux-drawer > .sidebar-ux-tab-list::-webkit-scrollbar {
    display: none !important;
  }
  /* Tab buttons: uniform width on mobile horizontal layout.
     Matches main sidebar's mobile tabBtnLabeled size (52×48). */
  .sidebar-ux-tab-list button[data-tab-id] {
    width: 52px !important;
    min-width: 0;
    flex-shrink: 0;
    padding: 6px 4px !important;
  }
  .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-labeled {
    width: 52px !important;
    height: 48px !important;
  }
  /* OS Start button parity: the mobile row pins the same 52×48 geometry
     (the base OS_START_BUTTON_CSS width:100% would stretch the row). */
  .sidebar-ux-tab-list button[data-canvas-os-start] {
    width: 52px !important;
    height: 48px !important;
    min-width: 0;
    flex-shrink: 0;
    padding: 6px 4px !important;
  }
  /* OS Start dock on the mobile Sides row (this sheet turns the list into a
     row): same inline treatment as the main mirror's Settings dock — no top
     border, divider on the tab-facing left edge, 4px gaps. Top/Bottom keeps
     the HORIZONTAL_STRIP_CSS dock rules (location-scoped, more specific). */
  .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list > .sidebar-ux-tab-list-bottom {
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    flex-shrink: 0 !important;
    margin-top: 0 !important;
    padding-top: 0 !important;
    padding-left: 4px !important;
    margin-left: 4px !important;
    border-top: none !important;
    border-left: 1px solid var(--lumiverse-primary-020) !important;
    gap: 2px !important;
  }
  /* Active tab: bottom underline on mobile. Must match
     .sidebar-ux-side-left specificity and use !important —
     desktop rules set inset 3px/–3px with !important and
     would otherwise win. */
  .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
  .sidebar-ux-secondary-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
  .sidebar-ux-secondary-wrapper.sidebar-ux-side-right .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active {
    box-shadow: inset 0 -3px 0 var(--lumiverse-primary) !important;
    border-radius: 8px 8px 0 0 !important;
  }
  /* Hide secondary's drawerTab when primary is open on mobile */
  body.canvas-ux-mobile-primary-open .sidebar-ux-drawer-tab {
    display: none !important;
    pointer-events: none !important;
  }
  /* Hide main's drawerTab when secondary is open on mobile.
     The Canvas shell's handle class is .sidebar-ux-drawer-tab (hyphenated),
     which does NOT contain the host camelCase substring drawerTab — the
     [class*="drawerTab"] selector only covers the host chrome. Match the
     Canvas class explicitly or the main edge toggle stays visible over the
     open secondary. */
  body.canvas-ux-mobile-secondary-open [class*="drawerTab"],
  body.canvas-ux-mobile-secondary-open .sidebar-ux-drawer-tab {
    display: none !important;
    pointer-events: none !important;
  }
  /* Mutual exclusion must be interactive too, not just visual. The drawer
     re-enables pointer-events:auto inline, and while the main shell is
     covered/stacked behind the open secondary a tap on the exposed edge
     could still hit main-shell chrome and open the main drawer. Make the
     whole covered shell inert (descendants included). */
  body.canvas-ux-mobile-secondary-open .sidebar-ux-main-mirror-wrapper,
  body.canvas-ux-mobile-secondary-open .sidebar-ux-main-mirror-wrapper * {
    pointer-events: none !important;
  }
  /* Symmetric: the secondary shell is inert while the main drawer is open. */
  body.canvas-ux-mobile-primary-open .sidebar-ux-secondary-wrapper,
  body.canvas-ux-mobile-primary-open .sidebar-ux-secondary-wrapper * {
    pointer-events: none !important;
  }
    /* Host main drawer on mobile: oversize by 1px to match the +1px oversize
     on Canvas secondary drawers.  Under fractional zoom/AA the host's
     --app-scaled-viewport-width resolves ~1px short of the visual viewport,
     leaving a 1px underfill gap when the drawer is open (translateX(0)).
     Adding 1px to the width via calc() fills that gap.
     The extra 1px is harmless on desktop (@media >600px scoped below). */
  [class*="wrapperLeft"],
  [class*="wrapperRight"] {
    --drawer-panel-w: calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px) !important;
  }
  /* Backdrop: full-viewport overlay that darkens the screen (including the
     safe area at the top) when the secondary drawer is open on mobile.
     Mirrors Lumiverse's main-drawer .backdrop element
     (ViewportDrawer.module.css:101-109 + ViewportDrawer.tsx:174-184).
     The secondary wrapper itself stays at top: env(safe-area-inset-top)
     so the drawer tab aligns vertically with the main drawer tab; the
     backdrop is a SEPARATE fixed-position layer behind the wrapper that
     fills the entire viewport (inset:0), so the safe-area-inset-top zone
     is also darkened. Body class is toggled by setMobileOpenClass() in
     mobile-exclusion.ts:99-110 (called from openSecondarySidebar /
     closeSecondarySidebar). pointer-events: none — purely visual, so
     chat/touch interactions underneath are unaffected (the user closes
     via the X button in the secondary header). */
  body.canvas-ux-mobile-secondary-open::before {
    content: '';
    position: fixed;
    inset: 0;
    background: var(--lumiverse-fill-heavy);
    z-index: 9989;
    pointer-events: none;
  }
}
`

// S6: main shell on mobile — horizontal tab list + full-bleed, mirroring
// the secondary's SECONDARY_MOBILE_CSS layout. Scoped to the main mirror
// wrapper so desktop (and the secondary) are untouched. Injected at main
// mirror mount (mobile) via injectMainMirrorMobileStyles.
export const MAIN_MIRROR_MOBILE_CSS = `
@media (max-width: 600px) {
  .sidebar-ux-main-mirror-wrapper > .sidebar-ux-drawer {
    flex-direction: column !important;
    overflow: hidden !important;
    /* Belt-and-braces full-bleed: matches the JS inline width set by
       createDrawerShell(fullViewportWidth) / syncMainMirrorToViewport.
       Same +1px oversize (fractional zoom/AA underfill). Literal is
       inlined (drawer-shell ↔ styles cycle: styles is a leaf module). */
    width: calc(var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1))) + 1px) !important;
  }
  .sidebar-ux-main-mirror-wrapper > .sidebar-ux-drawer > .sidebar-ux-tab-list {
    width: 100% !important;
    flex-direction: row !important;
    align-items: center !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
    border-bottom: 1px solid var(--lumiverse-primary-020) !important;
    border-top: none !important;
    border-left: none !important;
    border-right: none !important;
    padding: 6px 8px !important;
    gap: 2px !important;
  }
  .sidebar-ux-main-mirror-wrapper > .sidebar-ux-drawer > .sidebar-ux-tab-list::-webkit-scrollbar {
    display: none !important;
  }
  /* S7 host-shaped strip: [ .sidebar-ux-tab-list-main, .sidebar-ux-tab-list-bottom ]
     live INSIDE the list, each forced to inline flex-direction: column by
     the renderer (ensureMirrorListStructure, main-renderer.ts) for the desktop
     vertical layout. Without flipping them here the outer row has a single
     column child and every button still stacks vertically on mobile. Class
     names are literal (main-renderer imports styles — no cycle). */
  .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list > .sidebar-ux-tab-list-main {
    flex-direction: row !important;
    align-items: center !important;
    flex: 1 1 auto !important;
    min-width: 0 !important;
    min-height: auto !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
    gap: 2px !important;
  }
  .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list > .sidebar-ux-tab-list-main::-webkit-scrollbar {
    display: none !important;
  }
  /* Settings dock inline at the row end (host .sidebarBottom mobile rules). */
  .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list > .sidebar-ux-tab-list-bottom {
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    flex-shrink: 0 !important;
    margin-top: 0 !important;
    padding-top: 0 !important;
    padding-left: 4px !important;
    margin-left: 4px !important;
    border-top: none !important;
    border-left: 1px solid var(--lumiverse-primary-020) !important;
    gap: 2px !important;
  }
  /* The renderer writes width: 100% inline on every mirror button (correct
     for the desktop vertical strip). In the mobile row that would stretch
     each button to the full scroller width — pin the host mobile geometry. */
  .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn {
    width: 52px !important;
    height: 48px !important;
    min-width: 0 !important;
    flex-shrink: 0 !important;
    padding: 6px 4px !important;
  }
  /* OS Start button parity — same mobile row geometry (base width:100% would
     stretch the row). Kept as a separate rule so the mirror selector above
     stays a stable convention anchor (mobile-active-tab-css test). */
  .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-canvas-os-start] {
    width: 52px !important;
    height: 48px !important;
    min-width: 0 !important;
    flex-shrink: 0 !important;
    padding: 6px 4px !important;
  }
  .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-labeled {
    width: 52px !important;
    height: 48px !important;
  }
  /* Active tab: bottom underline on mobile. Must beat the desktop
     .sidebar-ux-side-left/right inset rules → same shape as the
     secondary block (wrapper-scoped + !important). */
  .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
  .sidebar-ux-main-mirror-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
  .sidebar-ux-main-mirror-wrapper.sidebar-ux-side-right .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active {
    box-shadow: inset 0 -3px 0 var(--lumiverse-primary) !important;
    border-radius: 8px 8px 0 0 !important;
  }
  /* Panel content fills below the horizontal list. */
  .sidebar-ux-main-mirror-wrapper > .sidebar-ux-drawer > .sidebar-ux-panel {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    width: 100% !important;
  }
}
`

// ── S8 Drawer location (Sides | Top | Bottom) ──

/** DocumentElement location classes (exactly one active at a time). */
export const LOCATION_CLASS_SIDES = 'sidebar-ux-location-sides'
export const LOCATION_CLASS_TOP = 'sidebar-ux-location-top'
export const LOCATION_CLASS_BOTTOM = 'sidebar-ux-location-bottom'

/** Horizontal strip height: 4px padding + 48px button + 4px padding. */
export const STRIP_HEIGHT_PX = 56

/** CSS var carrying the strip height (buttons/wrapper offsets size from it). */
export const STRIP_HEIGHT_VAR = '--sidebar-ux-strip-h'

/**
 * S8: horizontal strip chrome (Top/Bottom). Everything is !important because
 * the renderer writes inline column / overflow-x:hidden / width:100% on the
 * list and buttons — only !important CSS can rotate them.
 *
 * Ownership split: JS (tab-position.applyPinHostChrome) owns the HOST
 * geometry (position/top/bottom/left/right/width/height) and list position;
 * this sheet owns orientation, sizing, borders, overflow, zone anchoring and
 * the chat/Landing reserve.
 *
 * Strip arithmetic: 4px + 48px + 4px = 56px = --sidebar-ux-strip-h.
 */
export const HORIZONTAL_STRIP_CSS = `
/* List fills the fixed zone host absolutely (never fixed + width:100% —
   a fixed element's containing block is the viewport, which would span a
   half-zone list across the whole screen). */
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] > .sidebar-ux-tab-list,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] > .sidebar-ux-tab-list {
  position: absolute !important;
  inset: 0 !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  width: auto !important;
  height: 100% !important;
  padding: 4px 8px !important;
  gap: 2px !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
  border-top: none !important;
  border-right: none !important;
  border-bottom: none !important;
  border-left: none !important;
  pointer-events: auto !important;
}
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] > .sidebar-ux-tab-list::-webkit-scrollbar,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] > .sidebar-ux-tab-list::-webkit-scrollbar {
  display: none !important;
}

/* Buttons: square 48x48 (56 - 4 - 4). Beats the renderer inline width:100%
   and the OS Start button's base width:100% (OS_START_BUTTON_CSS) — a row
   must never stretch it. */
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button[data-tab-id],
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button[data-tab-id],
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn,
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button[data-canvas-os-start],
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button[data-canvas-os-start] {
  width: 48px !important;
  height: 48px !important;
  min-width: 48px !important;
  flex-shrink: 0 !important;
  padding: 0 !important;
}

/* Main strip's inner section: row + fills the zone. Cluster anchoring lives
   on the SECTION (not the outer list) via the host's drawer-side class. */
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] .sidebar-ux-tab-list > .sidebar-ux-tab-list-main,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] .sidebar-ux-tab-list > .sidebar-ux-tab-list-main {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  flex: 1 1 auto !important;
  min-width: 0 !important;
  min-height: auto !important;
  height: 100% !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
  gap: 2px !important;
}
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] .sidebar-ux-tab-list > .sidebar-ux-tab-list-main::-webkit-scrollbar,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] .sidebar-ux-tab-list > .sidebar-ux-tab-list-main::-webkit-scrollbar {
  display: none !important;
}
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"].sidebar-ux-side-left .sidebar-ux-tab-list > .sidebar-ux-tab-list-main,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"].sidebar-ux-side-left .sidebar-ux-tab-list > .sidebar-ux-tab-list-main {
  justify-content: flex-start !important;
}
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"].sidebar-ux-side-right .sidebar-ux-tab-list > .sidebar-ux-tab-list-main,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"].sidebar-ux-side-right .sidebar-ux-tab-list > .sidebar-ux-tab-list-main {
  justify-content: flex-start !important;
}
/* Right-anchored clusters (2026-09-15, final form): a zero-width
   pseudo-element is ALWAYS the first flex item and absorbs the positive free
   space with margin-left:auto — NEVER justify-content:flex-end on the
   scroller. flex-end pushes the overflow past the inline-start edge, which
   is not part of the scrollable region — scrollWidth collapses to
   clientWidth and the earliest tabs become unreachable (live bug 2026-09-13,
   right-side main drawer is the host default). The auto margin absorbs only
   POSITIVE free space: it right-anchors while the tabs fit and resolves to 0
   once they overflow, leaving flex-start with a fully reachable scroll range.
   The anchor is a PSEUDO, not a class on a button: button-identity stamping
   (first visible / skip hidden / re-stamp after add-remove-reorder) broke
   three times in three days — a hidden first button (2026-09-14), a removed
   or mid-drag reparented anchor button (2026-09-15), and finally the DnD
   drop-slot placeholder being excluded, so the overlay settled on the
   un-anchored slot while the post-commit real button jumped to the anchored
   one (2026-09-15). The pseudo exists in EVERY state — hidden/removed/
   reparented buttons, empty lists, placeholder slot holders — so no JS
   participant and no lifecycle remain. Fit-case geometry is pixel-identical
   to the old class marker (verified in-browser); under overflow the pseudo's
   own flex gap adds 2px of leading space, harmless. */
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"].sidebar-ux-side-right .sidebar-ux-tab-list > .sidebar-ux-tab-list-main::before,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"].sidebar-ux-side-right .sidebar-ux-tab-list > .sidebar-ux-tab-list-main::before {
  content: '' !important;
  flex: 0 0 0 !important;
  width: 0 !important;
  min-width: 0 !important;
  height: 0 !important;
  margin: 0 0 0 auto !important;
  padding: 0 !important;
  border: none !important;
  pointer-events: none !important;
}

/* Secondary list (buttons are direct children): anchor to the drawer edge. */
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"].sidebar-ux-side-left > .sidebar-ux-tab-list,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"].sidebar-ux-side-left > .sidebar-ux-tab-list {
  justify-content: flex-start !important;
}
/* Explicit flex-start on the right-side scrollers too — the anchor is the
   pseudo's auto margin below; the scroller itself must never be flex-end
   (S8 #1 scroll-lock). */
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"].sidebar-ux-side-right > .sidebar-ux-tab-list,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"].sidebar-ux-side-right > .sidebar-ux-tab-list {
  justify-content: flex-start !important;
}
/* Same pseudo spacer for the leaf scroller: the secondary list, and the
   outer main-mirror list in the legacy flat fallback (buttons as direct
   children). On the structured outer list the section's flex-grow consumes
   the free space first, so the auto margin here is inert (probe-verified:
   dock and section positions unchanged). */
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"].sidebar-ux-side-right > .sidebar-ux-tab-list::before,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"].sidebar-ux-side-right > .sidebar-ux-tab-list::before {
  content: '' !important;
  flex: 0 0 0 !important;
  width: 0 !important;
  min-width: 0 !important;
  height: 0 !important;
  margin: 0 0 0 auto !important;
  padding: 0 !important;
  border: none !important;
  pointer-events: none !important;
}

/* Settings dock: pinned to the drawer-side screen edge (outer end), tabs grow
   inward from it. The dock comes BEFORE the tabs on a left-side host
   (order:-1 — the DOM order is [main, bottom]) and AFTER them on a right-side
   host (plain DOM order), so it always sits flush against the host's outer
   edge instead of the cluster's inner end (which was mid-bar whenever both
   zones were present — live feedback 2026-09-14). The divider always faces
   the tabs; the opposite-side spacing/border is cleared so only one divider
   can win (the S6 mobile sheet writes left-side values at lower specificity). */
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] .sidebar-ux-tab-list > .sidebar-ux-tab-list-bottom,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] .sidebar-ux-tab-list > .sidebar-ux-tab-list-bottom {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  flex-shrink: 0 !important;
  margin-top: 0 !important;
  padding-top: 0 !important;
  border-top: none !important;
  gap: 2px !important;
}
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"].sidebar-ux-side-left .sidebar-ux-tab-list > .sidebar-ux-tab-list-bottom,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"].sidebar-ux-side-left .sidebar-ux-tab-list > .sidebar-ux-tab-list-bottom {
  order: -1 !important;
  margin-left: 0 !important;
  padding-left: 0 !important;
  border-left: none !important;
  margin-right: 4px !important;
  padding-right: 4px !important;
  border-right: 1px solid var(--lumiverse-primary-020) !important;
}
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"].sidebar-ux-side-right .sidebar-ux-tab-list > .sidebar-ux-tab-list-bottom,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"].sidebar-ux-side-right .sidebar-ux-tab-list > .sidebar-ux-tab-list-bottom {
  order: 0 !important;
  margin-right: 0 !important;
  padding-right: 0 !important;
  border-right: none !important;
  margin-left: 4px !important;
  padding-left: 4px !important;
  border-left: 1px solid var(--lumiverse-primary-020) !important;
}

/* Active indicator on the panel-facing side: top-edge strip -> bottom inset,
   bottom-edge strip -> top inset. */
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
html.${LOCATION_CLASS_TOP} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active {
  box-shadow: inset 0 -3px 0 var(--lumiverse-primary) !important;
  border-radius: 8px 8px 0 0 !important;
}
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
html.${LOCATION_CLASS_BOTTOM} [data-strip-axis="horizontal"] .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active {
  box-shadow: inset 0 3px 0 var(--lumiverse-primary) !important;
  border-radius: 0 0 8px 8px !important;
}

/* Chat + Landing top/bottom reserve. CSS-owned so it works with the
   L/R-only reflow contract and on mobile (reflow early-returns there).

   Host structure: .body is a flex ROW (height:100%) whose child
   .chatColumn has height:100%. A cross-axis margin on a row flex item does
   NOT reduce its height, so the column becomes 100% + 56px and the host's
   overflow:clip cuts the bottom 56px — the composer. The reserve therefore
   also lands on .chatColumnInner (a column-flex child with default
   flex-shrink): margin-bottom:56 shrinks it to 100% - 56, which lifts the
   composer above the strip in BOTTOM mode and (combined with the outer top
   margin) makes the inner exactly fill the visible lane in TOP mode.
   User-confirmed local fix (2026-09-15) productized; only CSS-owned so it
   applies on mobile too where updateChatReflow early-returns.

   SPECIFICITY: the selectors carry the :not(#__theme_studio_authority_a/b__)
   guards. They are INERT for matching (no element carries those ids), but they
   add the 2-ID authority tier used by Theme Studio's "strong" overrides
   (:where(base):not(#a):not(#b)), whose !important rules would otherwise
   beat Canvas on specificity and drop the reserve (verified against a live
   Theme Studio project that sets a strong margin-bottom on
   _chatColumnInner_). Keep the guards on every rule that owns the reserve —
   an unguarded rule loses to a themed override even with !important. */
html.${LOCATION_CLASS_TOP} [class*="_chatColumn_"]:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__) {
  margin-top: var(--sidebar-ux-strip-h, 56px) !important;
}
html.${LOCATION_CLASS_BOTTOM} [class*="_chatColumn_"]:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__) {
  margin-bottom: var(--sidebar-ux-strip-h, 56px) !important;
}
html.${LOCATION_CLASS_TOP} [class*="_chatColumnInner_"]:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__),
html.${LOCATION_CLASS_BOTTOM} [class*="_chatColumnInner_"]:not(#__theme_studio_authority_a__):not(#__theme_studio_authority_b__) {
  margin-bottom: var(--sidebar-ux-strip-h, 56px) !important;
}
html.${LOCATION_CLASS_TOP} [data-component="LandingPage"] {
  margin-top: var(--sidebar-ux-strip-h, 56px) !important;
}
html.${LOCATION_CLASS_BOTTOM} [data-component="LandingPage"] {
  margin-bottom: var(--sidebar-ux-strip-h, 56px) !important;
}
`

/**
 * OS-mode Start button (src/os/start-menu.ts) — injected into the Canvas tab
 * strip; visual parity with the Options/Settings dock button. The declarations
 * are the host `.tabBtn` chrome (ViewportDrawer.module.css:207-231) as
 * reproduced by the Canvas mirror group in injectDrawerTabStyles below:
 * full-width 48px row, 8px radius, transparent until hover, `all .2s ease`,
 * hover `--lumiverse-primary-015` + text color. The glyph is the only
 * intended difference (20px icon box, same as the mirror's forced icon size).
 *
 * Hook: the `data-canvas-os-start` attribute (already the menu's identity) —
 * deliberately NOT `.sidebar-ux-main-tab-mirror-btn`: the renderer's
 * stale-drop (main-renderer.ts), DnD install (tab-list-dnd.ts) and
 * live-order scan (live-tab-order.ts) all treat that class as a real tab
 * (delete / drag / phantom-count the Start button).
 *
 * Row modes must re-pin the size with !important — the base `width: 100%`
 * stretches a flex row (HORIZONTAL_STRIP_CSS and the two *_MOBILE_CSS carry
 * the overrides).
 */
export const OS_START_BUTTON_CSS = `
  .sidebar-ux-tab-list button[data-canvas-os-start] {
    width: 100%;
    height: 48px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 0;
    box-sizing: border-box;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--lumiverse-text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .sidebar-ux-tab-list button[data-canvas-os-start]:hover {
    background: var(--lumiverse-primary-015);
    color: var(--lumiverse-text);
    border-radius: 8px;
  }
  .sidebar-ux-tab-list button[data-canvas-os-start] > svg {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    transition: color 0.2s ease;
  }
  .sidebar-ux-tab-list button[data-canvas-os-start]:hover > svg {
    color: var(--lumiverse-text);
  }
`

/** Inject the horizontal strip stylesheet once (idempotent by id). */
export function injectHorizontalStripStyles(): void {
  injectStyles('sidebar-ux-location-horizontal', HORIZONTAL_STRIP_CSS)
}

export function injectDrawerTabStyles(): void {
  injectStyles('sidebar-ux-drawer-tab-styles', `
    .sidebar-ux-drawer-tab {
      flex-shrink: 0;
      align-self: flex-start;
      width: var(--sidebar-ux-drawer-tab-w, 48px);
      height: var(--sidebar-ux-drawer-tab-h, auto);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--sidebar-ux-drawer-tab-gap, 8px);
      padding-top: var(--sidebar-ux-drawer-tab-pt, 16px);
      padding-right: var(--sidebar-ux-drawer-tab-pr, 8px);
      padding-bottom: var(--sidebar-ux-drawer-tab-pb, 20px);
      padding-left: var(--sidebar-ux-drawer-tab-pl, 8px);
      border: var(--sidebar-ux-drawer-tab-border, 1px solid var(--lumiverse-border-hover));
      background: var(--lcs-glass-bg, var(--lumiverse-bg));
      color: var(--lumiverse-text-muted);
      cursor: pointer;
      pointer-events: auto;
      transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    }
    .sidebar-ux-drawer-tab:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab--active:hover {
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg));
      border-color: var(--lumiverse-primary-050);
      color: var(--lumiverse-text);
    }
    .sidebar-ux-drawer-tab-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--lumiverse-primary);
    }
    /* Icon container — matches main drawer .extIconSvg
       (ViewportDrawer.module.css:284-290). */
    .sidebar-ux-tab-list button[data-tab-id] > span:first-child {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    /* Label typography — matches main drawer .tabLabel
       (ViewportDrawer.module.css:241-252). The base selector covers every
       button carrying data-tab-id (secondary + mirror after the host tagger
       runs); the two mirror selectors cover mirror buttons WITHOUT
       data-tab-id — extension tabs are not tagged by host React, so a mirror
       button whose host never received Canvas's data-tab-id tag would
       otherwise drop out of this rule and render its label at the inherited
       (larger) font size. Same selector pattern as the label-color rule
       below. */
    .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label {
      font-size: calc(9px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      line-height: 1;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 48px;
      flex-shrink: 0;
    }
    /* Base button color — matches main drawer .tabBtn
       (ViewportDrawer.module.css:213). */
    /* Tab-list button chrome — under secondary wrapper (unpinned) or the
       body-level pin host (secondary reparent + main mirror strip).
       Main mirror buttons use .sidebar-ux-main-tab-mirror-btn (may lack
       data-tab-id until the host tagger runs). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id],
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id],
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id],
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn {
      color: var(--lumiverse-text-muted);
      border-radius: 8px;
      background: transparent;
      border: none;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      /* Square tabs matching Lumiverse tabBtn (48) / tabBtnLabeled (56).
         Host .tabBtn has no padding — only explicit height. */
      width: 100%;
      height: 48px;
      flex-shrink: 0;
      gap: 1px;
      padding: 0;
      box-sizing: border-box;
      transition: all 0.2s ease;
    }
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-labeled,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-labeled,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-labeled,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-labeled,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-labeled {
      height: 56px;
    }
    /* Label color — matches main drawer .tabLabel
       (ViewportDrawer.module.css:245). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label {
      color: var(--lumiverse-text-dim);
    }
    /* Per-tab hover — mirrors Lumiverse's .tabBtn:hover
       (ViewportDrawer.module.css:222-225). Rounded corners. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn:hover,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id]:hover,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn:hover {
      background: var(--lumiverse-primary-015);
      color: var(--lumiverse-text);
      border-radius: 8px;
    }
    /* Hover icon color is set on the SVG itself (not only inherited from
       the button) so removing .sidebar-ux-tab-active mid-hover does not
       flash purple: without this, the SVG briefly inherits the active
       button color (primary) and transitions 0.2s back to text/white. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn:hover svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id]:hover svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn:hover svg,
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active:hover svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active:hover svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active:hover svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active:hover svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active:hover svg {
      color: var(--lumiverse-text);
    }
    /* Smooth color transition for SVG icons (matches the tabBtn
       transition: all 0.2s ease which only covers the button). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id] svg,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id] svg,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn svg {
      transition: color 0.2s ease;
    }
    /* Smooth color transition for labels. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn .sidebar-ux-tab-label {
      transition: color 0.2s ease, opacity 0.2s ease, height 0.2s ease, margin 0.2s ease;
    }
    /* Per-tab active state — mirrors Lumiverse's .tabBtnActive
       (ViewportDrawer.module.css:227-237) exactly: box-shadow
       indicator + directional border-radius. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active {
      /* !important so leftover inline styles cannot kill the fill */
      background: var(--lumiverse-primary-020, rgba(139, 92, 246, 0.2)) !important;
      color: var(--lumiverse-primary, #a78bfa) !important;
      box-shadow: inset 3px 0 0 var(--lumiverse-primary, #a78bfa) !important;
      border-radius: 0 8px 8px 0;
    }
    .sidebar-ux-secondary-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-main-mirror-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-main-mirror-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active,
    .sidebar-ux-tab-list-pin-host.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active,
    .sidebar-ux-tab-list-pin-host.sidebar-ux-side-left .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active {
      box-shadow: inset -3px 0 0 var(--lumiverse-primary, #a78bfa) !important;
      border-radius: 8px 0 0 8px;
    }
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active .sidebar-ux-tab-label,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active .sidebar-ux-tab-label,
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn.sidebar-ux-tab-active .sidebar-ux-tab-label {
      color: var(--lumiverse-primary);
    }
  `)

  // Icon-size styles — always-on with drawer tab styles (id kept for a stable
  // style element). Covers secondary (data-tab-id) and main-mirror buttons.
  injectStyles('sidebar-ux-icon-size-styles', `
    .sidebar-ux-tab-list button[data-tab-id] > span > svg,
    .sidebar-ux-tab-list button.sidebar-ux-main-tab-mirror-btn > span > svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
  `)

  // OS-mode Start button parity (see OS_START_BUTTON_CSS above). Base chrome
  // only; the mobile / horizontal sheets below (and HORIZONTAL_STRIP_CSS)
  // re-pin the row geometry with !important.
  injectStyles('sidebar-ux-os-start-button', OS_START_BUTTON_CSS)

  // Panel-header actions cluster + OS chrome hide (os/panel-chrome.ts). The
  // cluster keeps the minimize button adjacent to the X under the header's
  // `space-between`; the hidden attribute (a sheet rule, not inline display)
  // hides both buttons when no window is displayed (D17) without clobbering
  // the shell buttons' own chrome when OS chrome unmounts.
  injectStyles('sidebar-ux-os-header-actions', `
    .sidebar-ux-panel-header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .sidebar-ux-panel-header [data-canvas-os-hidden] {
      display: none !important;
    }
    /* D17 parking: no displayed window → no stale parked content when the
       drawer is (re)opened via the edge toggle. Keep the parked host DOM —
       this is display suppression, never unmount (spec §4.6).
       The :not([data-canvas-panel-animating]) guard: while a close fade is
       running the content must stay visible and fade with the panel (feedback
       2026-09-15 — parking mid-fade made the content vanish instantly). The
       attribute is set/cleared by sidebar/animation.ts (PANEL_ANIMATING_ATTR;
       literal here because this module is a leaf on purpose). */
    .sidebar-ux-main-mirror-wrapper[data-canvas-os-no-active]:not([data-canvas-panel-animating]) .sidebar-ux-panel-content {
      display: none !important;
    }
  `)

  // Closed-drawer shadow suppression: when the secondary drawer is off-screen
  // (translateX ≠ 0), its box-shadow must not bleed into the viewport —
  // even with the +1px overshoot, shadow spread can extend 4–24px past the
  // element edge.  The data-drawer-open attribute is toggled by open/close
  // in secondary.tsx; the inline `box-shadow` style on the drawer element
  // is always present, so we need !important to override it.
  injectStyles('sidebar-ux-shadow-close-suppress', `
    .sidebar-ux-secondary-wrapper[data-drawer-open="false"] > .sidebar-ux-drawer {
      box-shadow: none !important;
    }
  `)

  // Mobile CSS — scoped to @media (max-width: 600px)
  injectStyles('canvas-ux-secondary-mobile', SECONDARY_MOBILE_CSS)
  // Hide inactive moved tabs via a CSS rule keyed on data attributes, so we
  // never touch the extension's inline `display` style. Previously Canvas
  // did `setProperty('display', 'none', 'important')` and `removeProperty('display')`
  // on moved roots, which OVERWROTE the extension's `display: flex` (or any
  // other display value the extension set) and left the root as `display: block`
  // when the active-tab branch ran removeProperty. The visible symptom: a
  // Creator Notes-like extension that sets `display:flex` on tab.root
  // collapses to ~150px iframe in the secondary drawer because the inner
  // flex:1 iframeContainer becomes a non-flex-child and shrinks to its
  // content's intrinsic height.
  // Scope hide to the *secondary* shell only. Both secondary and main-mirror
  // use `.sidebar-ux-panel-content`; without `.sidebar-ux-secondary-wrapper`,
  // a root still tagged data-canvas-moved (no data-canvas-active) that the
  // host moved back into main-mirror's parked panelContent stays
  // display:none forever — blank content when activating a formerly
  // inactive secondary tab in main-mirror. Host/main-mirror must not match.
injectStyles('canvas-moved-active-toggle', `
    .sidebar-ux-secondary-wrapper .sidebar-ux-panel-content [data-canvas-moved]:not([data-canvas-active]) {
      display: none !important;
    }
  `)
  // Main-mirror strip: host-shaped layout (scrollable tabs + Settings dock).
  // Mirrors ViewportDrawer.module.css .tabListWrap / .sidebarBottom so the
  // Settings button sits at the end of the pin strip with a top separator.
  injectStyles('canvas-main-mirror-tab-list-structure', `
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list.sidebar-ux-main-tab-list-mirror,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list.sidebar-ux-main-tab-list-mirror {
      overflow-y: hidden;
      min-height: 0;
    }
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list-main,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list-main {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      /* Host .tabList gap is 2px, not sidebar's 4px. */
      gap: 2px;
      overflow-x: hidden;
      overflow-y: auto;
      scrollbar-width: none;
    }
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list-main::-webkit-scrollbar,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list-main::-webkit-scrollbar {
      display: none;
    }
    .sidebar-ux-tab-list-pin-host .sidebar-ux-tab-list-bottom,
    .sidebar-ux-main-mirror-wrapper .sidebar-ux-tab-list-bottom,
    /* Secondary drawer's OS Start dock (unpinned fallback — the pinned case
       already matches the host selector above): same divider chrome as the
       main drawer's Settings dock, owned by the container, not the button. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list-bottom {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: auto;
      padding-top: 8px;
      border-top: 1px solid var(--lumiverse-primary-020);
    }
  `)
}
