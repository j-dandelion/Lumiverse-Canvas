// Pure draft model for the Configure Tabs UI.
//
// All functions are pure — they return new ConfigureDraft values without
// side effects. The host bridge writes (commit) are handled separately
// by host-settings.ts.

import { type CatalogTab, BUILTIN_TAB_IDS, isHideLocked } from './configure-catalog'

export type DrawerSide = 'left' | 'right'
export type TabSide = 'primary' | 'secondary'

export type ConfigureDraft = {
  /** Current host drawer side. */
  drawerSide: DrawerSide
  /** Tab ids assigned to the primary drawer (in display order). */
  primaryIds: string[]
  /** Tab ids assigned to the secondary drawer (in display order). */
  secondaryIds: string[]
  /** Built-in tab order (subset of tabOrder from host settings). */
  builtinOrder: string[]
  /** Extension tab order (subset of tabOrder from host settings). */
  extensionOrder: string[]
  /** Tab ids the user has chosen to hide. */
  hiddenIds: Set<string>
}

/** Snapshot of the host state for dirty-checking. */
export type BaseSnapshot = {
  tabOrder: string[]
  hiddenTabIds: string[]
  drawerSide: DrawerSide
  assignments: ReadonlyMap<string, TabSide>
}

// ── Helpers ──

const _builtinIdSet = new Set(BUILTIN_TAB_IDS)

function partitionOrderByCatalog(
  tabOrder: string[],
  catalog: CatalogTab[],
): { builtinOrder: string[]; extensionOrder: string[] } {
  // Keep order from tabOrder but also include any catalog items not in tabOrder.
  const builtinOrder: string[] = []
  const extensionOrder: string[] = []
  const seen = new Set<string>()

  for (const id of tabOrder) {
    if (seen.has(id)) continue
    seen.add(id)
    if (_builtinIdSet.has(id)) {
      builtinOrder.push(id)
    } else {
      extensionOrder.push(id)
    }
  }

  // Append any catalog entries not present in tabOrder.
  for (const tab of catalog) {
    if (!seen.has(tab.id)) {
      seen.add(tab.id)
      if (tab.kind === 'builtin') {
        builtinOrder.push(tab.id)
      } else {
        extensionOrder.push(tab.id)
      }
    }
  }

  return { builtinOrder, extensionOrder }
}

function resolveSide(
  tabId: string,
  assignments: ReadonlyMap<string, TabSide>,
): TabSide {
  return assignments.get(tabId) ?? 'primary'
}

/**
 * Rebuild builtinOrder/extensionOrder by scanning primaryIds + secondaryIds
 * in order, so encodeHostTabOrder reflects the user's reorder within kinds.
 */
function syncKindOrders(draft: ConfigureDraft): {
  builtinOrder: string[]
  extensionOrder: string[]
} {
  const builtinOrder: string[] = []
  const extensionOrder: string[] = []
  const seen = new Set<string>()

  const all = [...draft.primaryIds, ...draft.secondaryIds]
  for (const id of all) {
    if (seen.has(id)) continue
    seen.add(id)
    if (_builtinIdSet.has(id)) {
      builtinOrder.push(id)
    } else {
      extensionOrder.push(id)
    }
  }

  return { builtinOrder, extensionOrder }
}

// ── Draft creation ──

export function createDraft(input: {
  catalog: CatalogTab[]
  tabOrder: string[]
  hiddenTabIds: string[]
  drawerSide: DrawerSide
  assignments: ReadonlyMap<string, TabSide>
}): ConfigureDraft {
  const { catalog, tabOrder, hiddenTabIds, drawerSide, assignments } = input
  const { builtinOrder, extensionOrder } = partitionOrderByCatalog(tabOrder, catalog)
  const hiddenSet = new Set(hiddenTabIds)
  const allOrdered = [...builtinOrder, ...extensionOrder]

  const primaryIds: string[] = []
  const secondaryIds: string[] = []

  for (const id of allOrdered) {
    const side = resolveSide(id, assignments)
    if (side === 'primary') {
      primaryIds.push(id)
    } else {
      secondaryIds.push(id)
    }
  }

  return {
    drawerSide,
    primaryIds,
    secondaryIds,
    builtinOrder,
    extensionOrder,
    hiddenIds: hiddenSet,
  }
}

// ── Serialization ──

/**
 * Encode the draft's tab order back to the host encoding:
 * builtins first, then extensions.
 */
export function encodeHostTabOrder(draft: ConfigureDraft): string[] {
  return [...draft.builtinOrder, ...draft.extensionOrder]
}

// ── BaseSnapshot from Draft ──

/**
 * Build a BaseSnapshot from a ConfigureDraft so that
 * `isDraftDirty(draft, baseSnapshotFromDraft(draft))` is always false.
 *
 * Used by autoCommit() after a successful commit to rebase the dirty-check
 * baseline without re-reading host state (which may lag behind the write).
 */
export function baseSnapshotFromDraft(draft: ConfigureDraft): BaseSnapshot {
  const assignments = new Map<string, TabSide>()
  for (const id of draft.primaryIds) {
    assignments.set(id, 'primary')
  }
  for (const id of draft.secondaryIds) {
    assignments.set(id, 'secondary')
  }
  return {
    tabOrder: encodeHostTabOrder(draft),
    hiddenTabIds: [...draft.hiddenIds],
    drawerSide: draft.drawerSide,
    assignments,
  }
}

// ── Dirty check ──

export function isDraftDirty(
  draft: ConfigureDraft,
  base: BaseSnapshot,
): boolean {
  const order = encodeHostTabOrder(draft)
  if (order.length !== base.tabOrder.length) return true
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== base.tabOrder[i]) return true
  }

  if (draft.hiddenIds.size !== base.hiddenTabIds.length) return true
  for (const id of draft.hiddenIds) {
    if (!base.hiddenTabIds.includes(id)) return true
  }

  if (draft.drawerSide !== base.drawerSide) return true

  // Check assignment changes: compare draft's per-side ids to base assignments.
  for (const id of draft.primaryIds) {
    const baseSide = base.assignments.get(id) ?? 'primary'
    if (baseSide !== 'primary') return true
  }
  for (const id of draft.secondaryIds) {
    const baseSide = base.assignments.get(id) ?? 'primary'
    if (baseSide !== 'secondary') return true
  }

  return false
}

// ── Mutations (all pure — return new ConfigureDraft) ──

export function swapDrawerSide(draft: ConfigureDraft): ConfigureDraft {
  return { ...draft, drawerSide: draft.drawerSide === 'left' ? 'right' : 'left' }
}

/**
 * Move tabId to the given side at the specified index within that side's list.
 * index -1 (or >= length) appends to the end.
 */
export function moveTab(
  draft: ConfigureDraft,
  tabId: string,
  to: TabSide,
  index: number,
): ConfigureDraft {
  const fromList = draft.primaryIds.includes(tabId) ? 'primaryIds' : 'secondaryIds'
  const toList = to === 'primary' ? 'primaryIds' : 'secondaryIds'

  const source = [...draft[fromList]]
  const srcIdx = source.indexOf(tabId)
  if (srcIdx === -1) return draft // not found

  source.splice(srcIdx, 1)

  const target = [...draft[toList]]
  const insertAt = index < 0 ? target.length : Math.min(index, target.length)
  target.splice(insertAt, 0, tabId)

  const next = { ...draft, [fromList]: source, [toList]: target }
  // Sync kind orders so encodeHostTabOrder reflects the move.
  const { builtinOrder, extensionOrder } = syncKindOrders(next)
  return { ...next, builtinOrder, extensionOrder }
}

/**
 * Reorder a tab within the same side's list.
 */
export function reorderWithin(
  draft: ConfigureDraft,
  side: DrawerSide,
  fromIndex: number,
  toIndex: number,
): ConfigureDraft {
  // Map spatial side to the list key.
  // When drawerSide is 'right', left column = secondary, right column = primary.
  // When drawerSide is 'left', left column = primary, right column = secondary.
  const isSecondaryList = (draft.drawerSide === 'right' && side === 'left') ||
    (draft.drawerSide === 'left' && side === 'right')
  const listKey = isSecondaryList ? 'secondaryIds' : 'primaryIds'

  const list = [...draft[listKey]]
  if (fromIndex < 0 || fromIndex >= list.length) return draft
  const [moved] = list.splice(fromIndex, 1)
  const insertAt = toIndex < 0 ? list.length : Math.min(toIndex, list.length)
  list.splice(insertAt, 0, moved)

  const next = { ...draft, [listKey]: list }
  // Sync kind orders so encodeHostTabOrder reflects the reorder.
  const { builtinOrder, extensionOrder } = syncKindOrders(next)
  return { ...next, builtinOrder, extensionOrder }
}

/**
 * Reorder `movedId` among the *visible* subset of `fullIds` (ids not in
 * `hiddenIds`), then write that order back into the full list while keeping
 * hidden slots in place.
 *
 * Live drawer lists only show non-hidden tabs, so hit-test indices are
 * visible-list indices. Applying them as full-list indices (via
 * reorderWithin) can no-op the visible order when hidden tabs exist —
 * the classic "animates then snaps back" bug for primary reorder.
 *
 * `toVisibleIndex` is the post-removal insert index among visible ids
 * (same convention as hitTestDropTarget / reorderWithin).
 */
export function reorderVisibleInList(
  fullIds: readonly string[],
  movedId: string,
  toVisibleIndex: number,
  hiddenIds: ReadonlySet<string>,
): string[] {
  const isVisible = (id: string) => !hiddenIds.has(id)
  const visible = fullIds.filter(isVisible)
  const from = visible.indexOf(movedId)
  if (from === -1) return fullIds.slice()

  const nextVis = visible.slice()
  nextVis.splice(from, 1)
  const insertAt =
    toVisibleIndex < 0
      ? nextVis.length
      : Math.min(toVisibleIndex, nextVis.length)
  nextVis.splice(insertAt, 0, movedId)

  let vi = 0
  return fullIds.map((id) => (isVisible(id) ? nextVis[vi++]! : id))
}

/**
 * Insert `tabId` into `fullIds` at a *visible* insert index (post-removal
 * among non-hidden ids). Removes an existing occurrence first (cross-list
 * move when the id was already present, or same-list safety).
 */
export function insertAtVisibleIndex(
  fullIds: readonly string[],
  tabId: string,
  toVisibleIndex: number,
  hiddenIds: ReadonlySet<string>,
): string[] {
  const without = fullIds.filter((id) => id !== tabId)
  const visibleCount = without.reduce(
    (n, id) => n + (hiddenIds.has(id) ? 0 : 1),
    0,
  )
  const targetVis =
    toVisibleIndex < 0
      ? visibleCount
      : Math.min(toVisibleIndex, visibleCount)

  if (targetVis >= visibleCount) {
    return [...without, tabId]
  }

  let seen = 0
  for (let i = 0; i < without.length; i++) {
    if (hiddenIds.has(without[i]!)) continue
    if (seen === targetVis) {
      const next = without.slice()
      next.splice(i, 0, tabId)
      return next
    }
    seen++
  }
  return [...without, tabId]
}

/**
 * Reorder a tab within primaryIds or secondaryIds using a visible-list
 * hit-test index (live drawer DnD).
 */
export function reorderWithinVisible(
  draft: ConfigureDraft,
  listKey: 'primaryIds' | 'secondaryIds',
  tabId: string,
  toVisibleIndex: number,
): ConfigureDraft {
  const list = draft[listKey]
  const nextList = reorderVisibleInList(
    list,
    tabId,
    toVisibleIndex,
    draft.hiddenIds,
  )
  if (
    nextList.length === list.length &&
    nextList.every((id, i) => id === list[i])
  ) {
    return draft
  }
  const next = { ...draft, [listKey]: nextList }
  const { builtinOrder, extensionOrder } = syncKindOrders(next)
  return { ...next, builtinOrder, extensionOrder }
}

/**
 * Move tabId to the given side at a *visible* insert index (live drawer DnD).
 */
export function moveTabVisible(
  draft: ConfigureDraft,
  tabId: string,
  to: TabSide,
  toVisibleIndex: number,
): ConfigureDraft {
  const fromList = draft.primaryIds.includes(tabId)
    ? 'primaryIds'
    : 'secondaryIds'
  const toList = to === 'primary' ? 'primaryIds' : 'secondaryIds'

  if (fromList === toList) {
    return reorderWithinVisible(draft, fromList, tabId, toVisibleIndex)
  }

  const source = draft[fromList].filter((id) => id !== tabId)
  const target = insertAtVisibleIndex(
    draft[toList],
    tabId,
    toVisibleIndex,
    draft.hiddenIds,
  )
  const next = { ...draft, [fromList]: source, [toList]: target }
  const { builtinOrder, extensionOrder } = syncKindOrders(next)
  return { ...next, builtinOrder, extensionOrder }
}

/**
 * Set a tab's hidden state. No-op if the tab is hide-locked.
 */
export function setHidden(
  draft: ConfigureDraft,
  tabId: string,
  hidden: boolean,
): ConfigureDraft {
  if (isHideLocked(tabId)) return draft

  const next = new Set(draft.hiddenIds)
  if (hidden) {
    next.add(tabId)
  } else {
    next.delete(tabId)
  }
  return { ...draft, hiddenIds: next }
}

// ── Display helpers ──

/**
 * Partition the catalog into two display lists matching the current
 * assignments. Primary list respects primaryIds order; secondary list
 * respects secondaryIds order. Hidden tabs are included so the Configure
 * Tabs modal can display them (with muted styling and a functional
 * hide-toggle to un-hide).
 */
export function partitionDisplayLists(
  draft: ConfigureDraft,
  catalog: CatalogTab[],
): { primary: CatalogTab[]; secondary: CatalogTab[] } {
  const catalogById = new Map(catalog.map(t => [t.id, t]))
  const primary: CatalogTab[] = []
  const secondary: CatalogTab[] = []

  // Secondary list in secondaryIds order (includes hidden tab rows).
  for (const id of draft.secondaryIds) {
    const tab = catalogById.get(id)
    if (!tab) continue
    secondary.push(tab)
  }

  // Primary list in primaryIds order (includes hidden tab rows).
  for (const id of draft.primaryIds) {
    const tab = catalogById.get(id)
    if (!tab) continue
    primary.push(tab)
  }

  return { primary, secondary }
}

/**
 * Spatial column helper: when the main drawer is on the right, the left
 * column visually shows secondary tabs.
 */
export function leftColumnIsSecondary(drawerSide: DrawerSide): boolean {
  return drawerSide === 'right'
}
