// CSS injection for the secondary sidebar — drawer tab styles, mobile
// layout, and the CSS variable holding the saved width.
//
// Extracted from sidebar/secondary.tsx.

import { injectStyles } from '../debug/styles'

// CSS variable holding the saved width in pixels. The drawer reads it
// via `width: var(SECONDARY_WIDTH_VAR, 420px)` and snapshotLayout reads
// it for persistence.
export const SECONDARY_WIDTH_VAR = '--sidebar-ux-secondary-w'

// Mobile CSS — scoped to @media (max-width: 600px). Restructures the
// secondary sidebar to match Lumiverse's main sidebar mobile pattern:
// full-width drawer, horizontal tab bar, bottom indicator, mutual
// exclusion via body classes.
const SECONDARY_MOBILE_CSS = `
@media (max-width: 600px) {
  .sidebar-ux-secondary-wrapper > .sidebar-ux-drawer {
    flex-direction: column !important;
  }
  .sidebar-ux-secondary-wrapper > .sidebar-ux-drawer > .sidebar-ux-tab-list {
    width: 100% !important;
    flex-direction: row !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    border-bottom: 1px solid var(--lumiverse-primary-020) !important;
    border-left: none !important;
    border-right: none !important;
    padding: 6px 8px !important;
  }
  /* Tab buttons: match main sidebar's mobile tabBtn/tabBtnLabeled sizes.
     Main sidebar uses 42×42 (no labels) / 52×48 (with labels).
     Keep vertical layout (column) — same as main sidebar on mobile. */
  .sidebar-ux-tab-list button[data-tab-id] {
    width: 42px !important;
    height: 42px !important;
    min-width: 0;
    padding: 6px 4px !important;
    border-radius: 8px !important;
  }
  .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-labeled {
    width: 52px !important;
    height: 48px !important;
  }
  /* Side-aware alignment: single tab sits on the edge the sidebar opens from. */
  .sidebar-ux-secondary-wrapper.sidebar-ux-side-right > .sidebar-ux-drawer > .sidebar-ux-tab-list {
    justify-content: flex-end !important;
  }
  /* Active tab indicator: bottom underline, top corners rounded.
     Matches main sidebar's mobile .tabBtnActive exactly.
     Same specificity as the desktop rule so it overrides on mobile. */
  .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active {
    box-shadow: inset 0 -3px 0 var(--lumiverse-primary, #9370db) !important;
    border-radius: 8px 8px 0 0 !important;
  }
  /* Hide secondary's drawerTab when primary is open on mobile */
  body.canvas-ux-mobile-primary-open .sidebar-ux-drawer-tab {
    display: none !important;
    pointer-events: none !important;
  }
  /* Hide main's drawerTab when secondary is open on mobile */
  body.canvas-ux-mobile-secondary-open [class*="drawerTab"] {
    display: none !important;
    pointer-events: none !important;
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
    /* Base button color — matches main drawer .tabBtn
       (ViewportDrawer.module.css:213). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] {
      color: var(--lumiverse-text-muted);
    }
    /* Label color — matches main drawer .tabLabel
       (ViewportDrawer.module.css:245). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label {
      color: var(--lumiverse-text-dim);
    }
    /* Per-tab hover — mirrors Lumiverse's .tabBtn:hover
       (ViewportDrawer.module.css:222-225). Rounded corners. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id]:hover {
      background: var(--lumiverse-primary-015);
      color: var(--lumiverse-text);
      border-radius: 8px;
    }
    /* Active tab hover: icon turns white, label stays colored.
       Target the SVG directly so we only change the icon color. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active:hover svg {
      color: var(--lumiverse-text) !important;
    }
    /* Smooth color transition for SVG icons (matches the tabBtn
       transition: all 0.2s ease which only covers the button). */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] svg {
      transition: color 0.2s ease;
    }
    /* Smooth color transition for labels. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id] .sidebar-ux-tab-label {
      transition: color 0.2s ease, opacity 0.2s ease, height 0.2s ease, margin 0.2s ease;
    }
    /* Per-tab active state — mirrors Lumiverse's .tabBtnActive
       (ViewportDrawer.module.css:227-237) exactly: box-shadow
       indicator + directional border-radius. */
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active {
      background: var(--lumiverse-primary-020, rgba(147, 112, 219, 0.2)) !important;
      color: var(--lumiverse-primary, #9370db) !important;
      box-shadow: inset 3px 0 0 var(--lumiverse-primary, #9370db) !important;
      border-radius: 0 8px 8px 0 !important;
    }
    .sidebar-ux-secondary-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active {
      box-shadow: inset -3px 0 0 var(--lumiverse-primary, #9370db) !important;
      border-radius: 8px 0 0 8px !important;
    }
    .sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active .sidebar-ux-tab-label {
      color: var(--lumiverse-primary, #9370db) !important;
    }
  `)

  // Icon-size styles — separate injection so the consistentIconSize toggle
  // can remove/re-inject without affecting the rest of the drawer tab styles.
  injectStyles('sidebar-ux-icon-size-styles', `
    .sidebar-ux-tab-list button[data-tab-id] > span > svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
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
  // Scope the hide rule to the secondary panel content. Without this
// scoping, a built-in root that lost its data-canvas-active attribute
// (e.g. removed by the safety-net movedRoots loop when other built-ins
// were activated in secondary) stays hidden via display:none after
// being moved back to the main drawer — TabPanelContent just moves the
// root, it doesn't re-set data-canvas-active.
injectStyles('canvas-moved-active-toggle', `
    .sidebar-ux-panel-content [data-canvas-moved]:not([data-canvas-active]) {
      display: none !important;
    }
  `)
}
