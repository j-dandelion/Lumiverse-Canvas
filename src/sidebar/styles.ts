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
  /* Active tab indicator: bottom underline, matching main sidebar's
     tabBtnActive mobile style. Top corners rounded, bottom flat. */
  .sidebar-ux-secondary-wrapper button[class*="tab-active"] {
    box-shadow: inset 0 -3px 0 var(--lumiverse-primary) !important;
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
}
