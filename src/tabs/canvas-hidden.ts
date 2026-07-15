// Canvas-owned Configure hide list (layout.json `hiddenTabIds`).
//
// Lives in a tiny zero-dep module so buttons.ts, persist, and hidden-tabs
// can all read/write without circular imports. Host drawerSettings.hiddenTabIds
// is best-effort; this is the durable source for dual-drawer strips.

let _canvasHiddenTabIds: string[] = []

export function normalizeHiddenIds(ids: readonly unknown[] | undefined | null): string[] {
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id.length) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Current Canvas-owned hidden tab ids (session + last layout hydrate). */
export function getCanvasHiddenTabIds(): string[] {
  return _canvasHiddenTabIds.slice()
}

/**
 * Replace the Canvas-owned hidden list. Does not persist — callers that
 * change user intent (Configure commit) must also `persistLayout()`.
 */
export function setCanvasHiddenTabIds(ids: readonly string[]): void {
  _canvasHiddenTabIds = normalizeHiddenIds(ids)
}

/**
 * Hydrate Canvas hidden list from a loaded layout blob.
 * Only overwrites when the blob has a `hiddenTabIds` array (including `[]`).
 * Older layouts without the field leave the in-memory list unchanged so a
 * mid-session re-seed cannot wipe a just-committed hide.
 */
export function hydrateCanvasHiddenFromLayout(layout: unknown): void {
  if (!layout || typeof layout !== 'object') return
  const raw = (layout as { hiddenTabIds?: unknown }).hiddenTabIds
  if (!Array.isArray(raw)) return
  _canvasHiddenTabIds = normalizeHiddenIds(raw)
}

/** Union host + canvas lists (order: host first, then canvas-only). */
export function mergeHiddenTabIdLists(
  hostIds: readonly string[] | undefined | null,
  canvasIds: readonly string[] | undefined | null,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of [...normalizeHiddenIds(hostIds), ...normalizeHiddenIds(canvasIds)]) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Test-only: reset Canvas hidden list. */
export function __resetCanvasHiddenTabIdsForTest(): void {
  _canvasHiddenTabIds = []
}
