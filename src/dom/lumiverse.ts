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

export function getMainWrapper(): HTMLElement | null {
  const sidebar = getMainSidebar()
  return sidebar?.closest('[class*="_wrapper_"]') as HTMLElement | null
}

export function getAppElement(): HTMLElement | null {
  return document.querySelector('.app') || document.querySelector('[class*="app"]')
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
