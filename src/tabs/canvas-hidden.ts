// Canvas-owned Configure hide list (layout.json `hiddenTabIds`).
//
// Lives in a tiny zero-dep module so buttons.ts, persist, and hidden-tabs
// can all read/write without circular imports. LUMI-26: this copy is the
// SOLE hidden-truth input end-to-end — the host drawerSettings.hiddenTabIds
// list is never merged into it (vanilla stays pristine in both directions,
// pitfalls §23).

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

/**
 * Clear the Canvas-owned hidden list (extension teardown, LUMI-21).
 *
 * `_canvasHiddenTabIds` is module-level and survives an off→on toggle; a
 * stale set used to feed the re-enabled session (AC2/AC3: Canvas UI broken
 * until refresh). The teardown chain calls this so the re-enabled session
 * re-seeds from the hydrated layout (`hydrateCanvasHiddenFromLayout`)
 * instead of inheriting the disabled session's in-memory set.
 */
export function resetCanvasHiddenTabIds(): void {
  _canvasHiddenTabIds = []
}

/** Test-only: reset Canvas hidden list. */
export function __resetCanvasHiddenTabIdsForTest(): void {
  resetCanvasHiddenTabIds()
}
