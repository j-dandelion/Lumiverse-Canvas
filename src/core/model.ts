export type TabKey = string

export type Side = 'primary' | 'secondary'

export type DrawerSide = 'left' | 'right'

export interface LayoutModel {
  readonly version: 2
  readonly primary: readonly TabKey[]
  readonly secondary: readonly TabKey[]
  readonly hidden: readonly TabKey[]
  readonly active: {
    readonly primary: TabKey | null
    readonly secondary: TabKey | null
  }
  readonly drawers: {
    readonly primary: { readonly open: boolean; readonly width: number }
    readonly secondary: { readonly open: boolean; readonly width: number }
  }
  readonly side: DrawerSide
}

export interface HostTabEntry {
  readonly key: TabKey
  readonly liveId: string
  readonly isBuiltin: boolean
  readonly location: Side
  readonly isHidden: boolean
  readonly isActiveInPrimary: boolean
  readonly isActiveInSecondary: boolean
  readonly hasContentRoot: boolean
}

export interface ObservedWorld {
  readonly tabs: readonly HostTabEntry[]
  /** Live host inventory state used to reject partial bootstrap snapshots. */
  readonly inventory?: {
    readonly status: 'empty' | 'partial' | 'ready' | 'degraded'
    readonly revision: number
  }
  readonly drawerSide: DrawerSide
  readonly primaryOpen: boolean
  readonly primaryWidth: number
  readonly secondaryOpen: boolean
  readonly secondaryWidth: number
}

const BUILTIN_PREFIX = 'builtin:'
const EXT_PREFIX = 'ext:'

export function builtinKey(id: string): TabKey {
  return `${BUILTIN_PREFIX}${id}`
}

export function extensionKey(extensionId: string, tabName: string): TabKey {
  return `${EXT_PREFIX}${extensionId}/${tabName}`
}

export function isBuiltinKey(key: TabKey): boolean {
  return key.startsWith(BUILTIN_PREFIX)
}

export function isExtensionKey(key: TabKey): boolean {
  return key.startsWith(EXT_PREFIX)
}

export function parseBuiltinKey(key: TabKey): string | null {
  if (!isBuiltinKey(key)) return null
  return key.slice(BUILTIN_PREFIX.length)
}

export function parseExtensionKey(key: TabKey): { extensionId: string; tabName: string } | null {
  if (!isExtensionKey(key)) return null
  const rest = key.slice(EXT_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash === -1) return null
  return { extensionId: rest.slice(0, slash), tabName: rest.slice(slash + 1) }
}

export function createEmptyModel(side: DrawerSide = 'left'): LayoutModel {
  return {
    version: 2,
    primary: [],
    secondary: [],
    hidden: [],
    active: { primary: null, secondary: null },
    drawers: {
      primary: { open: false, width: 420 },
      secondary: { open: false, width: 420 },
    },
    side,
  }
}
