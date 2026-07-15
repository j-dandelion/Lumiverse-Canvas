/**
 * Suffix-drift helpers for layout restore.
 *
 * Extension tab ids often gain a session suffix (`prompt-viewer:1`). After a
 * restart the same tab may re-register as `prompt-viewer:2`. Exact match fails;
 * strip-suffix match is unique for a single sibling and ambiguous for multiple.
 *
 * Restore pairs stored ids to live ids as a bipartite assignment:
 * 1. Exact id matches first (consume from available pool).
 * 2. Per strip-prefix group, pair leftover stored vs live by stable sort.
 */

/** Strip trailing `:N` numeric suffix used by multi-instance extensions. */
export function stripTabIdSuffix(id: string): string {
  return id.replace(/:\d+$/, '')
}

/**
 * Pair each stored tab id to a live id (or null if unmatched).
 * Live ids are consumed so two stored rows cannot claim the same live tab.
 */
export function pairStoredToLiveIds(
  storedIds: string[],
  liveIds: string[],
): Map<string, string | null> {
  const result = new Map<string, string | null>()
  const available = new Set(liveIds)

  // Pass 1: exact matches
  for (const stored of storedIds) {
    if (available.has(stored)) {
      result.set(stored, stored)
      available.delete(stored)
    }
  }

  // Group leftovers by strip prefix
  const leftoverStored = storedIds.filter((s) => !result.has(s))
  const byPrefix = new Map<string, { stored: string[]; live: string[] }>()

  for (const stored of leftoverStored) {
    const prefix = stripTabIdSuffix(stored)
    let g = byPrefix.get(prefix)
    if (!g) {
      g = { stored: [], live: [] }
      byPrefix.set(prefix, g)
    }
    g.stored.push(stored)
  }

  for (const live of available) {
    const prefix = stripTabIdSuffix(live)
    const g = byPrefix.get(prefix)
    if (g) g.live.push(live)
  }

  for (const [, g] of byPrefix) {
    g.stored.sort()
    g.live.sort()
    const n = Math.min(g.stored.length, g.live.length)
    for (let i = 0; i < n; i++) {
      result.set(g.stored[i], g.live[i])
      available.delete(g.live[i])
    }
    for (let i = n; i < g.stored.length; i++) {
      result.set(g.stored[i], null)
    }
  }

  // Any stored never placed (no group activity) → null
  for (const stored of storedIds) {
    if (!result.has(stored)) result.set(stored, null)
  }

  return result
}

/**
 * Pick a single live id for one stored id from candidates (already filtered).
 * Prefer exact, then unique candidate, then null if ambiguous (caller may use
 * full bipartite pairing instead).
 */
export function pickSingleHealCandidate(
  storedId: string,
  candidates: string[],
): string | null {
  if (candidates.length === 0) return null
  if (candidates.includes(storedId)) return storedId
  if (candidates.length === 1) return candidates[0]
  return null
}

/**
 * True when `tabId` is covered by the hidden set given the current live pool.
 *
 * Uses bipartite suffix pairing (not raw prefix equality) so hiding one of
 * two multi-instance siblings does not hide both. When `liveIds` is omitted,
 * only exact membership is checked (safe default for call sites without a
 * live pool).
 */
export function isTabIdHidden(
  tabId: string,
  hiddenIds: ReadonlySet<string> | readonly string[],
  liveIds?: readonly string[],
): boolean {
  if (!tabId) return false
  const stored = hiddenIds instanceof Set
    ? [...hiddenIds]
    : [...hiddenIds]
  if (stored.includes(tabId)) return true
  if (!liveIds || liveIds.length === 0) return false
  const pairing = pairStoredToLiveIds(stored, [...liveIds])
  for (const live of pairing.values()) {
    if (live === tabId) return true
  }
  return false
}

export type HealHiddenOptions = {
  /**
   * When true (write-back / host merge), keep stored ids that have no live
   * counterpart yet — extensions often register after first sync. Dropping
   * them would permanently unhide those tabs.
   * When false (DOM apply against a known strip), drop unmatched so we only
   * hide buttons that actually exist.
   */
  keepUnmatched?: boolean
}

/**
 * Map stored hidden ids onto currently live tab ids (exact first, then
 * suffix-drift bipartite pairing).
 */
export function healHiddenTabIds(
  storedHidden: readonly string[],
  liveIds: readonly string[],
  opts?: HealHiddenOptions,
): string[] {
  if (!storedHidden.length) return []
  const keepUnmatched = opts?.keepUnmatched === true
  const pairing = pairStoredToLiveIds([...storedHidden], [...liveIds])
  const out: string[] = []
  const seen = new Set<string>()
  for (const stored of storedHidden) {
    const live = pairing.get(stored) ?? null
    if (live) {
      if (seen.has(live)) continue
      seen.add(live)
      out.push(live)
      continue
    }
    if (keepUnmatched && !seen.has(stored)) {
      seen.add(stored)
      out.push(stored)
    }
  }
  return out
}
