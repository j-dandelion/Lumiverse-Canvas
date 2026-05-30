// Layout state persisted to backend storage
export interface DetachedTab {
  tabId: string        // extension tab ID from store
  tabTitle: string     // human-readable title (fallback identifier)
  sidebar: 'primary' | 'secondary'
}

export interface SidebarState {
  open: boolean
  width: number        // px
}

export interface LayoutState {
  primary: SidebarState
  secondary: SidebarState
  detachedTabs: DetachedTab[]
}

export const DEFAULT_LAYOUT: LayoutState = {
  primary: { open: false, width: 420 },
  secondary: { open: false, width: 420 },
  detachedTabs: [],
}
