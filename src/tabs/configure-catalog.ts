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
  /** Short description shown in the configure body row. */
  description?: string
  hideLocked: boolean
  extensionId?: string
  /** SVG markup for extension tab icon (preferred over iconSvg/iconUrl). */
  iconSvg?: string
  /** URL for extension tab icon. */
  iconUrl?: string
}

// Known built-in tab display titles (matching host drawer-tab-registry tabName).
const BUILTIN_TAB_TITLES: Record<string, string> = {
  profile: 'Profile',
  presets: 'Reasoning',
  loom: 'Loom',
  weaver: 'Weaver',
  connections: 'Connections',
  browser: 'Pack Browser',
  characters: 'Characters',
  personas: 'Personas',
  multiplayer: 'Multiplayer',
  lorebook: 'Lorebook',
  cortex: 'Memory Cortex',
  databank: 'Databank',
  create: 'Creator Workshop',
  ooc: 'OOC',
  prompt: 'Composition',
  council: 'Council',
  summary: 'Summary',
  feedback: 'Council Feedback',
  worldinfo: 'World Info',
  imagegen: 'Image Generation',
  wallpaper: 'Wallpaper',
  regex: 'Regex Scripts',
  branches: 'Branch Tree',
  theme: 'Theme',
  spindle: 'Extensions',
}

// Known built-in tab descriptions (matching host drawer-tab-registry tabDescription).
const BUILTIN_TAB_DESCRIPTIONS: Record<string, string> = {
  profile: 'View and edit the active character',
  presets: 'Configure reasoning, chain-of-thought, and prompt behavior',
  loom: 'Configure narrative structure and story beats',
  weaver: 'Craft a character from your idea',
  connections: 'Manage API connections and providers',
  browser: 'Browse and manage content packs',
  characters: 'Browse and manage your character cards',
  personas: 'Manage your user personas',
  multiplayer: 'Host or join a room and chat with bots alongside friends',
  lorebook: 'Edit world book and lorebook entries',
  cortex: 'View and manage memory cortex entries',
  databank: 'Upload and manage reference documents for AI context',
  create: 'Create and edit Lumia items and Loom presets',
  ooc: 'Out-of-character comment display settings',
  prompt: 'Pick Lumia and Loom content, Sovereign Hand, and context filters',
  council: 'Configure the Lumia Council and tool functions',
  summary: 'Configure context summarization and truncation',
  feedback: 'View the latest council execution results',
  worldinfo: 'View currently activated world info entries',
  imagegen: 'Configure and control AI scene generation',
  wallpaper: 'Set global or per-chat background wallpapers',
  regex: 'Create and manage regex find/replace scripts',
  branches: 'View and navigate the chat branch history',
  theme: 'Customize colors, accent, and visual style',
  spindle: 'Manage Spindle extensions',
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
    description: BUILTIN_TAB_DESCRIPTIONS[id] || undefined,
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
    description: t.description || `Open ${t.title || t.id} extension tab`,
    hideLocked: false,
    extensionId: t.extensionId || undefined,
    iconSvg: t.iconSvg || undefined,
    iconUrl: t.iconUrl || undefined,
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
