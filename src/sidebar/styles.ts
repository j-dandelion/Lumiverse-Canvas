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
  /* Tab buttons: shrink to content width on mobile horizontal layout. */
  .sidebar-ux-tab-list button[data-tab-id] {
    width: auto !important;
    min-width: 32px;
    padding: 6px 8px !important;
  }
  /* Side-aware alignment: single tab sits on the edge the sidebar opens from. */
  .sidebar-ux-secondary-wrapper.sidebar-ux-side-right > .sidebar-ux-drawer > .sidebar-ux-tab-list {
    justify-content: flex-end !important;
  }
  /* Active tab indicator: bottom underline (was left border on desktop) */
  .sidebar-ux-secondary-wrapper button[class*="tab-active"] {
    box-shadow: inset 0 -3px 0 var(--lumiverse-primary) !important;
  }
  .sidebar-ux-drawer-tab { width: 32px !important; }
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
      width: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px 8px 20px;
      background: var(--lcs-glass-bg, var(--lumiverse-bg));
      border: 1px solid var(--lumiverse-border-hover);
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
    .sidebar-ux-drawer-tab--compact {
      width: 32px;
      padding: 8px 6px;
      gap: 0;
    }
    .sidebar-ux-drawer-tab-icon {
      color: var(--lumiverse-primary);
    }
    /* Force a 20×20 size on the tab-list SVG icons. */
    .sidebar-ux-tab-list button[data-tab-id] > span > svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
  `)
  // Mobile CSS — scoped to @media (max-width: 600px)
  injectStyles('canvas-ux-secondary-mobile', SECONDARY_MOBILE_CSS)
}
