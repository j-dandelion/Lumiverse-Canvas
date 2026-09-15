// Secondary drawer Start dock — the wrapper that owns the Start↔tabs divider
// chrome. It mirrors the main drawer's Settings dock exactly:
// `.sidebar-ux-tab-list-bottom` (border-top + 8px gap + bottom anchor), so the
// separator is container-owned, never button chrome.
//
// The dock must remain the LAST child of the secondary tab list. Every
// tab-button writer (buttons.ts add/reorder, tab-list-dnd insert) routes its
// end-of-order insert through `appendSecondaryTabNode` so it never crosses
// the divider. Lives in a leaf module (no imports) so os/start-menu.ts,
// tabs/buttons.ts and tabs/tab-list-dnd.ts share one definition without
// cycles.

export const SECONDARY_START_DOCK_CLASS = 'sidebar-ux-secondary-start-dock'

/** The dock wrapper, when present, as a direct child of the tab list. */
export function getSecondaryStartDock(list: HTMLElement): HTMLElement | null {
  return list.querySelector(`:scope > .${SECONDARY_START_DOCK_CLASS}`) as HTMLElement | null
}

/**
 * Append/move a tab node to the end of the secondary tab order WITHOUT
 * crossing the Start dock (a plain appendChild would put the tab after the
 * divider). Falls back to a plain append when no dock exists (main-mirror
 * sections, legacy lists).
 */
export function appendSecondaryTabNode(list: HTMLElement, node: HTMLElement): void {
  const dock = getSecondaryStartDock(list)
  if (dock) list.insertBefore(node, dock)
  else list.appendChild(node)
}
