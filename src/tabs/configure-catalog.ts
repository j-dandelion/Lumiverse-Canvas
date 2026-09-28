// Versioned built-in catalog + extension adapter for the Configure Tabs UI.
//
// BUILTIN_CATALOG_VERSION is a string literal that changes when the
// Lumiverse DRAWER_TABS ordering or built-in set is updated. The catalog
// itself is hardcoded from the known IDs — there's no runtime dependency
// on Lumiverse internals. Extensions come from the store's drawerTabs
// (getDrawerTabs()).
//
// Core hide-locked (9): profile, presets, loom, characters, personas,
// branches, spindle, theme, lorebook. All other built-ins can hide.
// The lock is a UI gate; the `coreTabsHidden` setting unlocks it (OS mode
// forces that setting on). The set itself lives in the `./core-tabs` leaf so
// os/actions can consult it without importing the store graph.

import { type DrawerTab, getDrawerTabs } from '../store'
import { CORE_HIDE_LOCKED, isCoreTabId } from './core-tabs'
import { parseExtensionKey, parseBuiltinKey, type TabKey } from '../core/model'

export { CORE_HIDE_LOCKED } from './core-tabs'

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
 * True when a DrawerTab from the live inventory represents an actual
 * extension tab (not a host built-in). getDrawerTabs() is a general tab
 * inventory: built-ins (bare data-tab-id buttons) and extensions
 * (spindle-placement tabs) are mixed together.
 *   - Tagged extensions always carry a real extensionId.
 *   - Untagged host extension buttons carry the host extension class
 *     (`tabBtnExtension`); host built-ins never do.
 *   - Pre-observer fiber-store drawerTabs are spindle-placement slices
 *     whose ids are store ids (`spindle:…`); bare ids are built-ins.
 */
function isExtensionDrawerTab(t: DrawerTab): boolean {
  if (t.extensionId) return true
  const root = t.root as HTMLElement | null
  if (root && typeof root.className === 'string' && root.className.includes('tabBtnExtension')) {
    return true
  }
  return t.id.includes(':')
}

/**
 * Extension tabs currently registered in the host store, as CatalogTab entries.
 * Host built-ins observed in the same inventory are excluded so the catalog
 * never labels them as extensions. Returns an empty array when the store is
 * unavailable.
 */
export function getExtensionCatalog(): CatalogTab[] {
  const tabs = getDrawerTabs()
  if (!tabs || tabs.length === 0) return []

  return tabs
    .filter(isExtensionDrawerTab)
    .map((t: DrawerTab) => ({
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

/**
 * Drop catalog entries that exist in NO namespace the commit can resolve:
 * the live drawer inventory (host.findKey) or the owned model (liveId
 * projection). The static builtin list can contain tabs absent from a given
 * Lumiverse instance; a draft carrying such phantom ids fails
 * commitDraftToOwnedModel's resolution guard ("A tab changed while Configure
 * Tabs was open") and blocks EVERY Configure/DnD commit on that instance.
 * The liveId projection covers DOM-placed builtins whose host button was
 * removed (findKey misses them).
 */
export function filterCatalogToLive(
  catalog: CatalogTab[],
  host: { findKey(id: string): string | null } | null,
  knownLiveIds: ReadonlySet<string>,
): CatalogTab[] {
  if (!host) return catalog
  return catalog.filter(
    (tab) => host.findKey(tab.id) !== null || knownLiveIds.has(tab.id),
  )
}

/** Minimal model shape the supplement reads (LayoutModel subset). */
export type RecoveredEntriesModel = {
  primary: readonly string[]
  secondary: readonly string[]
  hidden: readonly string[]
} | null

/**
 * LUMI-26 Part 2: supplement the catalog with model-owned tabs the live
 * inventory lost.
 *
 * When the host React filters a tab's button out of the drawer DOM (vanilla
 * `drawerSettings.hiddenTabIds`), the observer inventory loses it — the
 * full catalog (live-inventory-derived extension entries) no longer names
 * it and `filterCatalogToLive` drops it, so the tab VANISHED from Canvas's
 * Configure Tabs with no recovery path. The owned model still holds the
 * tab's key (boot re-adopts layout-owned ids — resolveLayoutOwnedStoredId);
 * this supplement re-adds one entry per model-owned key-shaped id missing
 * from the filtered catalog, carrying the KEY itself as the entry id. The
 * commit resolves key ids via its model-owned fallback (owned-commit.ts),
 * so a recovered entry never trips the resolution guard.
 *
 * The phantom-id guard stays intact: ids the model does NOT own are never
 * supplemented — a stale catalog id still fails the commit guard exactly as
 * before. Builtins are always fully enumerated by the static catalog and
 * their keys resolve totally (liveIdForKey), so they never need this path.
 */
export function supplementCatalogWithRecoveredEntries(
  catalog: CatalogTab[],
  model: RecoveredEntriesModel,
): CatalogTab[] {
  if (!model) return catalog
  const ids = new Set(catalog.map((t) => t.id))
  const out = catalog.slice()
  const seen = new Set<string>()
  for (const raw of [...model.primary, ...model.secondary, ...model.hidden]) {
    if (seen.has(raw)) continue
    seen.add(raw)
    if (ids.has(raw)) continue
    const parsedExt = parseExtensionKey(raw)
    if (parsedExt) {
      out.push({
        id: raw,
        kind: 'extension',
        title: parsedExt.tabName,
        description: `Open ${parsedExt.tabName} extension tab`,
        hideLocked: false,
        extensionId: parsedExt.extensionId,
      })
      continue
    }
    const parsedBuiltin = parseBuiltinKey(raw)
    if (parsedBuiltin && !ids.has(parsedBuiltin)) {
      // Legacy masquerade key ('builtin:{title}') — keep the key id so the
      // commit's model-owned fallback resolves it.
      out.push({
        id: raw,
        kind: 'builtin',
        title: humanizeTabId(parsedBuiltin),
        hideLocked: isCoreTabId(parsedBuiltin),
      })
    }
  }
  return out
}

/** True when the given tab id is in the CORE_HIDE_LOCKED set. */
export function isHideLocked(tabId: string): boolean {
  return isCoreTabId(tabId)
}
