import type { LayoutModel, TabKey, Side, DrawerSide } from '../core/model'
import { createEmptyModel, builtinKey, extensionKey, parseBuiltinKey, parseExtensionKey, isBuiltinKey } from '../core/model'
import { stripTabIdSuffix } from './tab-id-heal'

/**
 * Describes a stored tab entry in the legacy layout format.
 */
interface StoredTab {
  tabId: string
  tabTitle: string
  sidebar: 'primary' | 'secondary'
}

/**
 * The legacy layout blob format (subset of what snapshotLayout produces).
 */
export interface LegacyLayout {
  version?: string
  primary?: { open?: boolean; width?: number; tabId?: string }
  secondary?: { open?: boolean; width?: number; activeTabId?: string }
  detachedTabs?: StoredTab[]
  tabOrder?: string[]
  hiddenTabIds?: string[]
  drawerSide?: 'left' | 'right'
}

/**
 * Build a LayoutModel from a legacy layout blob + the host's observed world.
 * Uses suffix healing to map stored ids to live TabKeys.
 */
export function buildModelFromLayout(
  layout: LegacyLayout,
  findKey: (id: string) => TabKey | null,
  side?: DrawerSide,
): LayoutModel {
  const model = createEmptyModel(side ?? 'left')

  if (!layout) return model

  const tabOrder = layout.tabOrder ?? []
  const detached = layout.detachedTabs ?? []

  // Build a set of secondary tab ids (from detachedTabs)
  const secondaryIds = new Set(detached.map(d => d.tabId))
  const isSecondaryStoredId = (id: string): boolean => {
    if (secondaryIds.has(id)) return true
    const base = stripTabIdSuffix(id)
    for (const secondaryId of secondaryIds) {
      if (stripTabIdSuffix(secondaryId) === base) return true
    }
    return false
  }

  // Separate tabOrder into primary and secondary based on detachedTabs membership
  const primary: TabKey[] = []
  const secondary: TabKey[] = []
  const unresolvedIds: string[] = []

  const appendOnce = (list: TabKey[], key: TabKey): void => {
    if (!primary.includes(key) && !secondary.includes(key)) list.push(key)
  }

  for (const storedId of tabOrder) {
    const key = resolveStoredId(storedId, findKey)
    if (!key) {
      unresolvedIds.push(storedId)
      continue
    }
    appendOnce(isSecondaryStoredId(storedId) ? secondary : primary, key)
  }

  // Also include detachedTabs (whether or not their id appeared in tabOrder
  // — a stale tabOrder entry may not have resolved, and the authoritative
  // tabTitle still must place the tab). Resolution prefers `tabTitle` — the
  // authoritative TabKey (REFACTOR-PLAN v2 §4.4) — making restore
  // tagging-state-independent: a saved TabKey resolves to the tab's
  // canonical frozen key regardless of whether the observer entry was
  // tagged since. Old bundles wrote the HUMAN TITLE here; both forms
  // resolve through the same resolver (key-shaped inputs included). The
  // live-id tabId is the fallback for bundles that never wrote tabTitle.
  for (const d of detached) {
    const fromTitle = d.tabTitle ? resolveStoredId(d.tabTitle, findKey) : null
    const key = fromTitle ?? resolveStoredId(d.tabId, findKey)
    if (key && !primary.includes(key) && !secondary.includes(key)) {
      appendOnce(secondary, key)
    }
  }

  // Hidden tab ids → hidden TabKeys
  const hidden: TabKey[] = []
  for (const storedId of (layout.hiddenTabIds ?? [])) {
    const key = resolveStoredId(storedId, findKey)
    if (key && (primary.includes(key) || secondary.includes(key)) && !hidden.includes(key)) {
      hidden.push(key)
    }
  }

  // Active tabs
  const activePrimaryCandidate = layout.primary?.tabId
    ? resolveStoredId(layout.primary.tabId, findKey)
    : null
  const activeSecondaryCandidate = layout.secondary?.activeTabId
    ? resolveStoredId(layout.secondary.activeTabId, findKey)
    : null
  const activePrimary = activePrimaryCandidate && primary.includes(activePrimaryCandidate) && !hidden.includes(activePrimaryCandidate)
    ? activePrimaryCandidate
    : null
  const activeSecondary = activeSecondaryCandidate && secondary.includes(activeSecondaryCandidate) && !hidden.includes(activeSecondaryCandidate)
    ? activeSecondaryCandidate
    : null

  // Drawer state
  const primaryOpen = layout.primary?.open ?? false
  const primaryWidth = layout.primary?.width ?? 420
  const secondaryOpen = layout.secondary?.open ?? false
  const secondaryWidth = layout.secondary?.width ?? 420

  return {
    version: 2,
    primary,
    secondary,
    hidden,
    active: {
      primary: activePrimary ?? null,
      secondary: activeSecondary ?? null,
    },
    drawers: {
      primary: { open: primaryOpen, width: primaryWidth },
      secondary: { open: secondaryOpen, width: secondaryWidth },
    },
    side: layout.drawerSide ?? side ?? 'left',
  }
}

/**
 * Map a stored tab id (from the layout blob) to a stable TabKey.
 * Tries exact match first, then suffix-stripped match.
 */
function resolveStoredId(
  storedId: string,
  findKey: (id: string) => TabKey | null,
): TabKey | null {
  // Try exact match
  const exact = findKey(storedId)
  if (exact) return exact

  // Try suffix-stripped match
  const stripped = stripTabIdSuffix(storedId)
  if (stripped === storedId) return null

  return findKey(stripped) ?? null
}

/**
 * Serialize the current model into the legacy layout format for persistence.
 * The layout blob uses LiveTabIds (session-specific), resolved via the host.
 */
export function serializeModelToLayout(
  model: LayoutModel,
  resolve: (key: TabKey) => string | null,
  version: string,
): LegacyLayout {
  const primary = resolveList(model.primary, resolve)
  const secondary = resolveList(model.secondary, resolve)
  const tabOrder = [...primary, ...secondary]

  const detachedTabs: StoredTab[] = [
    ...model.secondary.map(key => {
      const id = resolve(key)
      return id ? { tabId: id, tabTitle: key, sidebar: 'secondary' as const } : null
    }),
  ].filter(Boolean) as StoredTab[]

  const hiddenTabIds = model.hidden.map(key => resolve(key)).filter(Boolean) as string[]

  return {
    version,
    primary: {
      open: model.drawers.primary.open,
      width: model.drawers.primary.width,
      tabId: model.active.primary ? resolve(model.active.primary) ?? undefined : undefined,
    },
    secondary: {
      open: model.drawers.secondary.open,
      width: model.drawers.secondary.width,
      activeTabId: model.active.secondary ? resolve(model.active.secondary) ?? undefined : undefined,
    },
    detachedTabs,
    tabOrder,
    hiddenTabIds,
    drawerSide: model.side,
  }
}

function resolveList(
  keys: readonly TabKey[],
  resolve: (key: TabKey) => string | null,
): string[] {
  return keys.map(key => resolve(key)).filter(Boolean) as string[]
}
