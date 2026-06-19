// Lumiverse DOM query helpers. The Spindle host (data-spindle-mount="sidebar")
// and its structural ancestors are the canonical entry points for Canvas
// feature code that needs to inspect the main sidebar, drawer, panel, and
// chat column. CSS-module class names are hashed in production builds; we
// match the prefix only (e.g. "[class*=\"_panelContent_\"]"), not the
// full hash, so this code is stable across Lumiverse rebuilds.

export function getMainSidebar(): HTMLElement | null {
  return document.querySelector('[data-spindle-mount="sidebar"]')
}

export function getMainDrawer(): HTMLElement | null {
  const sidebar = getMainSidebar()
  return sidebar?.parentElement as HTMLElement | null
}

export function getMainPanel(): HTMLElement | null {
  const sidebar = getMainSidebar()
  return sidebar?.parentElement?.querySelector('[class*="_panel_"]') as HTMLElement | null
}

export function getMainPanelContent(): HTMLElement | null {
  const panel = getMainPanel()
  return panel?.querySelector('[class*="_panelContent_"]') as HTMLElement | null
}

/**
 * Find the main drawer's panel header. The panel is a flex column with the
 * header on top and `[class*="_panelContent_"]` below. The header is what
 * shows the active tab's title (e.g. "Profile", "Memory") plus a
 * settings/menu affordance on the right.
 *
 * Primary selector: `[class*="_panelHeader_"]` (matches the CSS-module
 * prefix, stable across Lumiverse hash rebuilds). Falls back to the first
 * non-content direct child of the panel, in case the host renames the
 * prefix in a future version.
 *
 * Returns `null` if the host hasn't mounted the panel yet, or if the
 * panel was removed by a transient state. Callers must handle the
 * `null` case (e.g. via a 48px CSS-default fallback).
 */
export function getMainPanelHeader(): HTMLElement | null {
  const panel = getMainPanel()
  if (!panel) return null
  // Primary: class prefix match
  const byClass = panel.querySelector('[class*="_panelHeader_"]') as HTMLElement | null
  if (byClass) return byClass
  // Fallback: first direct child whose class doesn't contain "_panelContent_"
  // (the content element is the OTHER sibling; we want the header).
  for (let i = 0; i < panel.children.length; i++) {
    const child = panel.children[i] as HTMLElement
    if (!child.className || !String(child.className).includes('_panelContent_')) {
      return child
    }
  }
  return null
}

export function getMainWrapper(): HTMLElement | null {
  const sidebar = getMainSidebar()
  return sidebar?.closest('[class*="_wrapper_"]') as HTMLElement | null
}

export function getChatColumn(): HTMLElement | null {
  // .chatColumn is the flex child of .body that contains .chatColumnInner
  // .body has data-chat-constrained when a max-width is active
  const body = document.querySelector('[class*="_body_"][data-chat-constrained]')
    || document.querySelector('[class*="_body_"]')
  if (!body) return null
  // .chatColumn is the flex child that contains the chat content
  // It's identifiable by having align-items: center and containing .chatColumnInner
  const candidates = body.querySelectorAll('[class*="_chatColumn_"]')
  if (candidates.length === 1) return candidates[0] as HTMLElement
  // Fallback: find by structure — it contains the chat toolbar
  for (const el of body.children) {
    if ((el as HTMLElement).querySelector('[class*="_chatToolbar_"]')) {
      return el as HTMLElement
    }
  }
  return null
}

export function getMainDrawerWidth(): number {
  const drawer = getMainDrawer()
  if (!drawer) return 420
  return drawer.getBoundingClientRect().width
}
