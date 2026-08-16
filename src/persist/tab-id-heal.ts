/** Suffix-drift helpers for persisted tab ids. */

export function stripTabIdSuffix(id: string): string {
  return id.replace(/:\d+$/, '')
}

export function pairStoredToLiveIds(
  storedIds: string[],
  liveIds: string[],
): Map<string, string | null> {
  const result = new Map<string, string | null>()
  const available = new Set(liveIds)
  for (const stored of storedIds) {
    if (available.has(stored)) {
      result.set(stored, stored)
      available.delete(stored)
    }
  }
  const groups = new Map<string, { stored: string[]; live: string[] }>()
  for (const stored of storedIds.filter((id) => !result.has(id))) {
    const key = stripTabIdSuffix(stored)
    const group = groups.get(key) ?? { stored: [], live: [] }
    group.stored.push(stored)
    groups.set(key, group)
  }
  for (const live of available) groups.get(stripTabIdSuffix(live))?.live.push(live)
  for (const group of groups.values()) {
    group.stored.sort()
    group.live.sort()
    const count = Math.min(group.stored.length, group.live.length)
    for (let i = 0; i < count; i++) {
      result.set(group.stored[i]!, group.live[i]!)
      available.delete(group.live[i]!)
    }
    for (let i = count; i < group.stored.length; i++) result.set(group.stored[i]!, null)
  }
  for (const stored of storedIds) if (!result.has(stored)) result.set(stored, null)
  return result
}

export function isTabIdHidden(
  tabId: string,
  hiddenIds: ReadonlySet<string> | readonly string[],
  liveIds?: readonly string[],
): boolean {
  const stored = [...hiddenIds]
  if (stored.includes(tabId)) return true
  if (!liveIds?.length) return false
  return [...pairStoredToLiveIds(stored, [...liveIds]).values()].includes(tabId)
}

export function healHiddenTabIds(
  storedHidden: readonly string[],
  liveIds: readonly string[],
  opts?: { keepUnmatched?: boolean },
): string[] {
  const pairing = pairStoredToLiveIds([...storedHidden], [...liveIds])
  const out: string[] = []
  const seen = new Set<string>()
  for (const stored of storedHidden) {
    const live = pairing.get(stored)
    const id = live ?? (opts?.keepUnmatched ? stored : null)
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
