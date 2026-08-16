import type { LayoutModel, TabKey, Side } from './model'

export function listForSide(model: LayoutModel, side: Side): readonly TabKey[] {
  return side === 'primary' ? model.primary : model.secondary
}

export function visibleKeys(model: LayoutModel, side: Side): TabKey[] {
  const list = listForSide(model, side)
  return list.filter(k => !model.hidden.includes(k))
}

export function isHidden(model: LayoutModel, key: TabKey): boolean {
  return model.hidden.includes(key)
}

export function visibleToAbsoluteIndex(
  model: LayoutModel,
  side: Side,
  visibleIndex: number,
): number {
  const list = listForSide(model, side)
  if (visibleIndex < 0) return list.length
  let vi = 0
  for (let i = 0; i < list.length; i++) {
    if (!isHidden(model, list[i]!)) {
      if (vi === visibleIndex) return i
      vi++
    }
  }
  return list.length
}

export function absoluteToVisibleIndex(
  model: LayoutModel,
  side: Side,
  absoluteIndex: number,
): number {
  const list = listForSide(model, side)
  if (absoluteIndex < 0 || absoluteIndex >= list.length) return -1
  let vi = 0
  for (let i = 0; i < absoluteIndex; i++) {
    if (!isHidden(model, list[i]!)) vi++
  }
  return isHidden(model, list[absoluteIndex]!) ? -1 : vi
}

/**
 * Returns the nearest selectable neighbour after `removed` leaves `side`.
 * Prefers the visible tab immediately above (lower index), else the visible
 * tab immediately below (higher index). Skips hidden tabs.
 * Returns null only when no selectable tab remains.
 */
export function activeAfterRemoval(
  model: LayoutModel,
  side: Side,
  removed: TabKey,
): TabKey | null {
  const list = listForSide(model, side)
  const idx = list.indexOf(removed)
  if (idx === -1) return null

  for (let i = idx - 1; i >= 0; i--) {
    const key = list[i]!
    if (!isHidden(model, key)) return key
  }

  for (let i = idx + 1; i < list.length; i++) {
    const key = list[i]!
    if (!isHidden(model, key)) return key
  }

  return null
}

export function keyExists(model: LayoutModel, key: TabKey): boolean {
  return model.primary.includes(key) || model.secondary.includes(key)
}

export function sideOfKey(model: LayoutModel, key: TabKey): Side | null {
  if (model.primary.includes(key)) return 'primary'
  if (model.secondary.includes(key)) return 'secondary'
  return null
}

export function visibleCount(model: LayoutModel, side: Side): number {
  return visibleKeys(model, side).length
}
