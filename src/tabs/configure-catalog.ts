// Versioned built-in catalog + extension adapter for the Configure Tabs UI.
//
// BUILTIN_CATALOG_VERSION is a string literal that changes when the
// Lumiverse DRAWER_TABS ordering or built-in set is updated. The catalog
// itself is hardcoded from the known IDs — there's no runtime dependency
// on Lumiverse internals. Extensions come from the store's drawerTabs
// (getDrawerTabs()).
//
// CORE hide-locked (9): profile, presets, loom, characters, personas,
// branches, spindle, theme, lorebook. All other built-ins can hide.

import { type DrawerTab, getDrawerTabs } from '../store'

/** Opaque version string bumped when the source-of-truth set/order changes. */
export const BUILTIN_CATALOG_VERSION = 'lumiverse-drawer-tabs-2026-07'

/** Lumiverse DRAWER_TABS built-in ids, in host order. */
export const BUILTIN_TAB_IDS: readonly string[] = [
  'profile', 'presets', 'loom', 'weaver', 'connections', 'browser',
  'characters', 'personas', 'multiplayer', 'lorebook', 'cortex',
  'databank', 'create', 'ooc', 'prompt', 'council', 'summary',
  'feedback', 'worldinfo', 'imagegen', 'wallpaper', 'regex',
  'branches', 'theme', 'spindle',
]

/** Built-in tab ids that cannot be hidden in the Configure Tabs UI. */
export const CORE_HIDE_LOCKED: ReadonlySet<string> = new Set([
  'profile', 'presets', 'loom',
  'characters', 'personas',
  'branches', 'spindle', 'theme', 'lorebook',
])

export type CatalogTab = {
  id: string
  kind: 'builtin' | 'extension'
  title: string
  hideLocked: boolean
  extensionId?: string
}

// Known built-in tab display titles (humanized).
const BUILTIN_TAB_TITLES: Record<string, string> = {
  profile: 'Profile',
  presets: 'Presets',
  loom: 'Loom',
  weaver: 'Weaver',
  connections: 'Connections',
  browser: 'Browser',
  characters: 'Characters',
  personas: 'Personas',
  multiplayer: 'Multiplayer',
  lorebook: 'Lorebook',
  cortex: 'Cortex',
  databank: 'Data Bank',
  create: 'Create',
  ooc: 'OOC',
  prompt: 'Prompt',
  council: 'Council',
  summary: 'Summary',
  feedback: 'Feedback',
  worldinfo: 'World Info',
  imagegen: 'Image Gen',
  wallpaper: 'Wallpaper',
  regex: 'Regex',
  branches: 'Branches',
  theme: 'Theme',
  spindle: 'Spindle',
}

/**
 * Humanize a tab id into a display title.
 * Built-in ids use the known-title map. Extension ids fall through to a
 * general algorithm (split on capitals, hyphens, or underscores).
 */
export function humanizeTabId(id: string): string {
  const known = BUILTIN_TAB_TITLES[id]
  if (known) return known
  // Split on capitals or hyphens/underscores.
  const words = id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  return words.join(' ')
}

/** All built-in tabs as CatalogTab entries, in BUILTIN_TAB_IDS order. */
export function getBuiltinCatalog(): CatalogTab[] {
  return BUILTIN_TAB_IDS.map(id => ({
    id,
    kind: 'builtin' as const,
    title: humanizeTabId(id),
    hideLocked: CORE_HIDE_LOCKED.has(id),
  }))
}

/**
 * Extension tabs currently registered in the host store, as CatalogTab entries.
 * Returns an empty array when the store is unavailable.
 */
export function getExtensionCatalog(): CatalogTab[] {
  const tabs = getDrawerTabs()
  if (!tabs || tabs.length === 0) return []

  return tabs.map((t: DrawerTab) => ({
    id: t.id,
    kind: 'extension' as const,
    title: t.title || humanizeTabId(t.id),
    hideLocked: false,
    extensionId: t.extensionId || undefined,
  }))
}

/**
 * Full catalog: built-ins first (in BUILTIN_TAB_IDS order) followed by
 * extensions (in store order).
 */
export function getFullCatalog(): CatalogTab[] {
  return [...getBuiltinCatalog(), ...getExtensionCatalog()]
}

/** True when the given tab id is in the CORE_HIDE_LOCKED set. */
export function isHideLocked(tabId: string): boolean {
  return CORE_HIDE_LOCKED.has(tabId)
}
