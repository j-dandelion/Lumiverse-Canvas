// Pure comparison of secondary tab-assignment state (tabs facet only).
// Used when enabling persistTabAssignments to detect live vs last-saved drift.

export type TabAssignmentsSlice = {
  detachedTabs?: Array<{ tabId: string }> | null
  secondary?: { activeTabId?: string | null } | null
}

/** Normalize activeTabId: missing / undefined / null → null. */
export function normalizeActiveTabId(active: string | null | undefined): string | null {
  return active ?? null
}

/** Ordered tab ids from a layout slice (secondary detachedTabs order). */
export function extractSecondaryTabIds(slice: TabAssignmentsSlice | null | undefined): string[] {
  const tabs = slice?.detachedTabs
  if (!Array.isArray(tabs)) return []
  return tabs.map((t) => t.tabId)
}

/**
 * True when live and saved tab-assignment facets match:
 * same secondary tabId *set* (order ignored) and same activeTabId.
 * Does not compare open/width/primary or tabTitle.
 *
 * Order is ignored because Map insertion order can diverge from the
 * last-written detachedTabs array without any user-facing reassignment.
 */
export function tabAssignmentsEqual(
  live: TabAssignmentsSlice | null | undefined,
  saved: TabAssignmentsSlice | null | undefined,
): boolean {
  const liveIds = extractSecondaryTabIds(live)
  const savedIds = extractSecondaryTabIds(saved)
  if (liveIds.length !== savedIds.length) return false
  const savedSet = new Set(savedIds)
  for (const id of liveIds) {
    if (!savedSet.has(id)) return false
  }
  // Duplicate ids in either list would make lengths match while sets differ.
  if (savedSet.size !== liveIds.length) return false
  const liveActive = normalizeActiveTabId(live?.secondary?.activeTabId)
  const savedActive = normalizeActiveTabId(saved?.secondary?.activeTabId)
  return liveActive === savedActive
}
