import type { LayoutModel, TabKey, Side, DrawerSide, HostTabEntry, ObservedWorld } from './model'
import type { Intent } from './intents'
import { listForSide, isHidden, visibleToAbsoluteIndex, activeAfterRemoval, keyExists, sideOfKey } from './select'

function removeFrom(list: readonly TabKey[], key: TabKey): TabKey[] {
  return list.filter(k => k !== key)
}

function insertAt(list: readonly TabKey[], key: TabKey, index: number): TabKey[] {
  const next = list.slice()
  next.splice(index, 0, key)
  return next
}

function toggleHidden(hidden: readonly TabKey[], key: TabKey, hide: boolean): readonly TabKey[] {
  const has = hidden.includes(key)
  if (hide && !has) return [...hidden, key]
  if (!hide && has) return hidden.filter(k => k !== key)
  return hidden
}

function applyMove(model: LayoutModel, key: TabKey, to: Side, index: number, activateDest: boolean): LayoutModel {
  const from = sideOfKey(model, key)
  if (!from) return model

  const srcList = listForSide(model, from)
  const idx = srcList.indexOf(key)
  if (idx === -1) return model

  const wasActiveInSource = model.active[from] === key
  const wasActiveInDest = model.active[to] === key

  // Compute source replacement BEFORE removing the key (so
  // activeAfterRemoval can find its position in the original list).
  let sourceReplacement: TabKey | null = null
  if (wasActiveInSource && from !== to) {
    sourceReplacement = activeAfterRemoval(model, from, key)
  }

  let next = model

  if (from === to) {
    const without = removeFrom(srcList, key)
    const absIdx = visibleToAbsoluteIndex({ ...model, [from]: without }, from, index)
    const newList = insertAt(without, key, absIdx)
    next = { ...model, [from]: newList }
  } else {
    const newSrc = removeFrom(srcList, key)
    const destList = listForSide(model, to)
    const absIdx = visibleToAbsoluteIndex(
      { ...model, [from]: newSrc },
      to,
      index,
    )
    const newDest = insertAt(destList, key, absIdx)
    next = {
      ...model,
      [from]: newSrc,
      [to]: newDest,
    }
  }

  if (wasActiveInSource && from !== to) {
    next = { ...next, active: { ...next.active, [from]: sourceReplacement } }
    if (!activateDest && wasActiveInDest) {
      next = { ...next, active: { ...next.active, [to]: key } }
    }
  }

  if (activateDest && !isHidden(next, key)) {
    next = { ...next, active: { ...next.active, [to]: key } }
  }

  return next
}

function applyReorder(model: LayoutModel, key: TabKey, side: Side, index: number): LayoutModel {
  const list = listForSide(model, side)
  const idx = list.indexOf(key)
  if (idx === -1) return model

  const without = removeFrom(list, key)
  const absIdx = visibleToAbsoluteIndex({ ...model, [side]: without }, side, index)
  const newList = insertAt(without, key, absIdx)
  return { ...model, [side]: newList }
}

function applySetHidden(model: LayoutModel, key: TabKey, hide: boolean): LayoutModel {
  if (!keyExists(model, key)) return model

  let next: LayoutModel = { ...model, hidden: toggleHidden(model.hidden, key, hide) }

  if (hide) {
    if (model.active.primary === key) {
      const replacement = activeAfterRemoval(next, 'primary', key)
      next = { ...next, active: { ...next.active, primary: replacement } }
    }
    if (model.active.secondary === key) {
      const replacement = activeAfterRemoval(next, 'secondary', key)
      next = { ...next, active: { ...next.active, secondary: replacement } }
    }
  }

  return next
}

function applyActivate(model: LayoutModel, key: TabKey, side: Side): LayoutModel {
  const list = listForSide(model, side)
  if (!list.includes(key)) return model
  if (isHidden(model, key)) return model
  // Identity-preserving for no-op rounds (same convention as applySetDrawer):
  // a redundant activate for the already-active key returns the ORIGINAL
  // reference so dispatch's `next === _model` gate short-circuits — no
  // reconcile/persist for e.g. the secondary click path when a host-sync
  // already converged the model.
  if (model.active[side] === key) return model
  return { ...model, active: { ...model.active, [side]: key } }
}

/**
 * Adopt BOTH drawers' tracked actives into the model in one round. Unified
 * producer for user activations that don't fire host-syncs: the secondary
 * wrapper lives on document.body (outside the observed subtree) and the
 * taskbar main mirror's clicks don't reliably mutate the observed world, so
 * the model's active would lag the drawer-tracked actives and the STALE key
 * is what layout.json gets persisted. The tracked-active writers
 * (setActiveSecondaryTabId / the mirror's commitState) dispatch this intent.
 *
 * Guards mirror adoptActive (core/reduce.ts): a key is adopted only when it
 * is currently on that side and not hidden. A null key (drawer has no
 * tracked active — e.g. transient teardown) is a no-op for that side, never
 * a clear. Identity-preserving: when neither side changes, the ORIGINAL
 * reference is returned so dispatch's `next === _model` gate short-circuits
 * (restore/placement echoes and redundant rounds cost nothing).
 */
function applySyncActive(
  model: LayoutModel,
  primary: TabKey | null,
  secondary: TabKey | null,
): LayoutModel {
  let next = model
  if (primary !== null && next.active.primary !== primary) {
    const list = listForSide(next, 'primary')
    if (list.includes(primary) && !isHidden(next, primary)) {
      next = { ...next, active: { ...next.active, primary } }
    }
  }
  if (secondary !== null && next.active.secondary !== secondary) {
    const list = listForSide(next, 'secondary')
    if (list.includes(secondary) && !isHidden(next, secondary)) {
      next = { ...next, active: { ...next.active, secondary } }
    }
  }
  return next
}

function applySetDrawer(
  model: LayoutModel,
  side: Side,
  open?: boolean,
  width?: number,
): LayoutModel {
  const current = model.drawers[side]
  const newOpen = open !== undefined ? open : current.open
  const newWidth = width !== undefined ? width : current.width
  // Identity-preserving: a no-op setDrawer (e.g. the secondary shell
  // re-dispatching its own open state after reconcile's host.setDrawer
  // restore) returns the ORIGINAL reference so dispatch's `next === _model`
  // gate short-circuits — no redundant reconcile/persist round.
  if (newOpen === current.open && newWidth === current.width) return model
  return {
    ...model,
    drawers: {
      ...model.drawers,
      [side]: { open: newOpen, width: newWidth },
    },
  }
}

function applySwapSides(model: LayoutModel): LayoutModel {
  const newSide: DrawerSide = model.side === 'left' ? 'right' : 'left'
  return { ...model, side: newSide }
}

function applySyncFromHost(model: LayoutModel, observed: ObservedWorld): LayoutModel {
  // AUTHORITATIVE SNAPSHOT (2026-07-31): the observed world rebuilds both
  // sides wholesale — any tab absent from `observed.tabs` is dropped from
  // the model. This is by design (host reorders/host-driven placement win),
  // but it means the observed world MUST include every model tab:
  // LumiverseHost.observe() therefore emits assignment-derived entries for
  // tabs whose host button is hidden or DOM-placed. A host-sync taken
  // before restored tabs are placed would otherwise wipe them from the
  // model (the restore race — see docs/pitfalls.md §1, §7).
  const observedKeys = new Set(observed.tabs.map(t => t.key))
  const observedMap = new Map<TabKey, HostTabEntry>(
    observed.tabs.map(t => [t.key, t]),
  )

  let next = model

  const removeFromSide = (side: Side, keys: Set<TabKey>): TabKey[] => {
    const list = listForSide(next, side)
    return list.filter(k => keys.has(k))
  }

  // The host snapshot is ordered. Rebuild each side in that order so an
  // external host Settings reorder is reflected in the owned model.
  //
  // Dedup invariant: a malformed host snapshot may publish the same TabKey
  // twice with different `location` values. Without dedup the key would
  // appear in both newPrimary and newSecondary, violating invariant 1 (one
  // side per key). Last-write-wins is the safest semantic for host-reported
  // data: the reducer must be total. The live LumiverseHost adapter does
  // not currently emit duplicates, but the fake host's tests do exercise
  // this path, and the boundary must hold.
  const newPrimary: TabKey[] = []
  const newSecondary: TabKey[] = []
  const seen = new Set<TabKey>()
  for (const tab of observed.tabs) {
    if (seen.has(tab.key)) {
      // Last-write-wins: drop the earlier placement.
      if (tab.location === 'primary') {
        const idx = newPrimary.indexOf(tab.key)
        if (idx >= 0) newPrimary.splice(idx, 1)
        if (newSecondary.includes(tab.key)) {
          const sidx = newSecondary.indexOf(tab.key)
          if (sidx >= 0) newSecondary.splice(sidx, 1)
        }
      } else {
        const idx = newSecondary.indexOf(tab.key)
        if (idx >= 0) newSecondary.splice(idx, 1)
        if (newPrimary.includes(tab.key)) {
          const pidx = newPrimary.indexOf(tab.key)
          if (pidx >= 0) newPrimary.splice(pidx, 1)
        }
      }
    }
    seen.add(tab.key)
    if (tab.location === 'primary') newPrimary.push(tab.key)
    else newSecondary.push(tab.key)
  }

  next = { ...next, primary: newPrimary, secondary: newSecondary }

  next = {
    ...next,
    hidden: next.hidden.filter(k => observedKeys.has(k)),
  }

  // Host is the source of truth for the currently-active tab on each side.
  // User clicks (forwarded via hostBtn.click()) change the host first; the
  // model must follow on the next syncFromHost, otherwise reconcile's
  // diffActive dispatches host.activate(modelActive) and reverts the user's
  // click — producing the visible "flicker then snap back" behaviour.
  //
  // 1. If the host reports an active tab on this side, adopt it.
  // 2. Otherwise, keep the model's current if it is still on the right side
  //    and not hidden (e.g. world emptied, restore-pending, transient
  //    snapshot gaps where host.observe() briefly shows no active).
  // 3. Otherwise, clear to null.
  const adoptActive = (side: Side): TabKey | null => {
    for (const tab of observed.tabs) {
      const isActive =
        side === 'primary' ? tab.isActiveInPrimary : tab.isActiveInSecondary
      // Only adopt a host-flagged active that the observed world still places
      // on this side. A tab the host keeps marking active after it was moved
      // to the other drawer (stale host-drawer DOM active, e.g. taskbar mode
      // where the mirror drives clicks) must not be adopted as this side's
      // active — otherwise the moved tab becomes the primary active key and
      // the main mirror loses its highlight entirely (activeKeys: []).
      if (isActive && tab.location === side && !isHidden(next, tab.key)) {
        return tab.key
      }
    }
    const current = next.active[side]
    const currentTab = current === null ? undefined : observedMap.get(current)
    if (
      current !== null &&
      currentTab?.location === side &&
      !isHidden(next, current)
    ) {
      return current
    }
    return null
  }

  next = {
    ...next,
    active: {
      primary: adoptActive('primary'),
      secondary: adoptActive('secondary'),
    },
  }

  next = {
    ...next,
    side: observed.drawerSide,
    drawers: {
      ...next.drawers,
      primary: { open: observed.primaryOpen, width: observed.primaryWidth },
      secondary: { open: observed.secondaryOpen, width: observed.secondaryWidth },
    },
  }

  // Identity-preserving sync: when the observed world rebuilds the model to
  // the SAME content, return the original reference so dispatch can
  // short-circuit (`next === _model` → no reconcile, no persist, no host
  // writes). Without this, every host-sync — even a pure echo from a
  // sidebar/mirror mutation storm (extension enable/update re-renders) —
  // produced a new object and fired reconcileAndPersist, which re-wrote the
  // identical layout to disk + IPC forever (infinite SAVE_LAYOUT freeze).
  const sameContent =
    sameKeys(next.primary, model.primary) &&
    sameKeys(next.secondary, model.secondary) &&
    sameKeys(next.hidden, model.hidden) &&
    next.active.primary === model.active.primary &&
    next.active.secondary === model.active.secondary &&
    next.side === model.side &&
    next.drawers.primary.open === model.drawers.primary.open &&
    next.drawers.primary.width === model.drawers.primary.width &&
    next.drawers.secondary.open === model.drawers.secondary.open &&
    next.drawers.secondary.width === model.drawers.secondary.width
  if (sameContent) return model

  return next
}

/** Order-sensitive array equality for TabKey lists. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function reduce(model: LayoutModel, intent: Intent): LayoutModel {
  switch (intent.t) {
    case 'move':
      return applyMove(model, intent.key, intent.to, intent.index, intent.activateDest)
    case 'reorder':
      return applyReorder(model, intent.key, intent.side, intent.index)
    case 'setHidden':
      return applySetHidden(model, intent.key, intent.hidden)
    case 'activate':
      return applyActivate(model, intent.key, intent.side)
    case 'syncActive':
      return applySyncActive(model, intent.primary, intent.secondary)
    case 'setDrawer':
      return applySetDrawer(model, intent.side, intent.open, intent.width)
    case 'swapSides':
      return applySwapSides(model)
    case 'syncFromHost':
      return applySyncFromHost(model, intent.observed)
    default: {
      // Exhaustiveness check. If a new intent type is added without a
      // case, TypeScript will fail to compile this assignment.
      const _exhaustive: never = intent
      return model
    }
  }
}

export function foldIntents(model: LayoutModel, intents: readonly Intent[]): LayoutModel {
  let next = model
  for (const intent of intents) {
    next = reduce(next, intent)
  }
  return next
}
