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
  /** START-MENU-only hidden set (LUMI-16b) — live tab ids resolved from the
   *  model's `menuHidden` TabKeys. Meaningful only while OS mode is on (the
   *  Start menu is OS chrome); non-OS serializations drop it like
   *  `closedTabIds`, and older layouts without the field hydrate an empty
   *  set. Consumed ONLY by the Start-menu projections — never by strips. */
  menuHiddenTabIds?: string[]
  /** OS-mode closed-set — live tab ids (resolved from the model's closed
   *  TabKeys). Present in the active serialization and the OS slots; the
   *  non-OS slots carry it only as an empty array while OS is off. */
  closedTabIds?: string[]
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

  // START-MENU-only hidden set (LUMI-16b) → menuHidden TabKeys. Same healing
  // rules as the hidden set (unresolvable ids are dropped). Strip surfaces
  // never read this set.
  const menuHidden: TabKey[] = []
  for (const storedId of (layout.menuHiddenTabIds ?? [])) {
    const key = resolveStoredId(storedId, findKey)
    if (key && (primary.includes(key) || secondary.includes(key)) && !menuHidden.includes(key)) {
      menuHidden.push(key)
    }
  }

  // OS-mode closed-set (spec §3.3) → closed TabKeys. Unresolvable ids are
  // dropped (GC at boot — spec §3.4: ghosts of deleted/renamed tabs never
  // survive a restore pass). Same healing rules as the hidden set.
  const closed: TabKey[] = []
  for (const storedId of (layout.closedTabIds ?? [])) {
    const key = resolveStoredId(storedId, findKey)
    if (key && (primary.includes(key) || secondary.includes(key)) && !closed.includes(key)) {
      closed.push(key)
    }
  }

  // Active tabs
  const activePrimaryCandidate = layout.primary?.tabId
    ? resolveStoredId(layout.primary.tabId, findKey)
    : null
  const activeSecondaryCandidate = layout.secondary?.activeTabId
    ? resolveStoredId(layout.secondary.activeTabId, findKey)
    : null
  const activePrimary = activePrimaryCandidate && primary.includes(activePrimaryCandidate) && !hidden.includes(activePrimaryCandidate) && !closed.includes(activePrimaryCandidate)
    ? activePrimaryCandidate
    : null
  const activeSecondary = activeSecondaryCandidate && secondary.includes(activeSecondaryCandidate) && !hidden.includes(activeSecondaryCandidate) && !closed.includes(activeSecondaryCandidate)
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
    menuHidden,
    closed,
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
 * Serialize the model as a SINGLE-drawer layout regardless of the model's
 * shape. When the model still holds secondary tabs (the documented
 * disable-fallback state: the drawer is off but a dual-shaped model was
 * booted from a dual top-level blob), every secondary key is folded into
 * the primary order (primary-then-secondary), detachedTabs is emptied, and
 * the secondary drawer state is neutral. Hidden set, primary geometry and
 * side are preserved — a single-mode "what the user would see if the
 * second drawer were off" projection.
 */
export function serializeModelToSingleLayout(
  model: LayoutModel,
  resolve: (key: TabKey) => string | null,
  version: string,
): LegacyLayout {
  return {
    version,
    primary: {
      open: model.drawers.primary.open,
      width: model.drawers.primary.width,
      tabId: model.active.primary ? resolve(model.active.primary) ?? undefined : undefined,
    },
    secondary: { open: false, width: 420, activeTabId: undefined },
    detachedTabs: [],
    // Fold: secondary keys appended after the primary keys, serialized as
    // live ids exactly like a dual serialization's tabOrder.
    tabOrder: resolveList([...model.primary, ...model.secondary], resolve),
    hiddenTabIds: model.hidden.map(key => resolve(key)).filter(Boolean) as string[],
    menuHiddenTabIds: model.menuHidden.map(key => resolve(key)).filter(Boolean) as string[],
    closedTabIds: model.closed.map(key => resolve(key)).filter(Boolean) as string[],
    drawerSide: model.side,
  }
}

/**
 * Fold a raw serialization into SINGLE shape (deep-review M1): a slot named
 * "single" must never carry `detachedTabs` — restoring a dual-shaped blob
 * from `osSingleLayout` rebuilds a dual model under
 * `secondSidebarEnabled: false`, stranding tabs in `model.secondary` with no
 * shell and contaminating later persist routing. Secondary entries fold into
 * `tabOrder` (appended after the existing ids when a stale/old bundle left
 * them out — `buildModelFromLayout` tolerates that asymmetry, a single
 * restore cannot), `detachedTabs` empties, and the secondary drawer state
 * neutralizes — the same projection `serializeModelToSingleLayout` performs
 * from the model. Hidden set, closed set, primary geometry and side are
 * preserved.
 */
export function foldLayoutToSingleShape(layout: LegacyLayout): LegacyLayout {
  const detached = layout.detachedTabs ?? []
  const order = Array.isArray(layout.tabOrder) ? [...layout.tabOrder] : []
  for (const d of detached) {
    const id = d?.tabId
    if (id && !order.includes(id)) order.push(id)
  }
  return {
    ...layout,
    secondary: { open: false, width: 420, activeTabId: undefined },
    detachedTabs: [],
    tabOrder: order,
  }
}

/**
 * True when a layout blob/profile carries at least one tab — either shape:
 * a single layout lists ids in `tabOrder` (detachedTabs: []), a dual layout
 * lists entries in `detachedTabs`. Used by the mode-switch and boot-recovery
 * restore gates ("restore only a slot that has content; an absent/empty slot
 * means seed from live" — os-mode D11, mode-profiles fallbacks).
 *
 * Lives here (a leaf module) rather than layout/snapshot: three test files
 * mock `layout/snapshot` with under-populated shapes, and Bun throws
 * `SyntaxError: Export named 'X' not found` when a mocked module lacks a
 * named export the real module statically imports.
 */
export function layoutHasTabs(
  layout: { tabOrder?: unknown; detachedTabs?: unknown } | null | undefined,
): boolean {
  if (!layout) return false
  return (
    (Array.isArray(layout.tabOrder) && layout.tabOrder.length > 0) ||
    (Array.isArray(layout.detachedTabs) && layout.detachedTabs.length > 0)
  )
}

/**
 * True when at least one id stored in the slot resolves against the host.
 * Guards the mode-switch restores: a slot whose ids were all renamed/deleted
 * (or never tagged) must NOT replace a live model with an empty one —
 * bootstrapFromLayout would then arm a pending restore that suppresses host
 * adoption for the 30s retry window. Callers fall back to seeding from live
 * instead. `resolveTitle` (optional) lets dual slots test the authoritative
 * `tabTitle` key alongside the live-id `tabId`.
 */
export function slotResolves(
  slot: { tabOrder?: unknown; detachedTabs?: unknown } | null | undefined,
  findKey: (id: string) => string | null,
): boolean {
  if (!slot) return false
  const ids: string[] = []
  if (Array.isArray(slot.tabOrder)) {
    for (const id of slot.tabOrder) if (typeof id === 'string') ids.push(id)
  }
  if (Array.isArray(slot.detachedTabs)) {
    for (const tab of slot.detachedTabs) {
      if (tab && typeof tab === 'object') {
        const t = tab as { tabId?: unknown; tabTitle?: unknown }
        if (typeof t.tabId === 'string') ids.push(t.tabId)
        if (typeof t.tabTitle === 'string') ids.push(t.tabTitle)
      }
    }
  }
  for (const id of ids) {
    if (findKey(id)) return true
  }
  return false
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
    menuHiddenTabIds: model.menuHidden.map(key => resolve(key)).filter(Boolean) as string[],
    closedTabIds: model.closed.map(key => resolve(key)).filter(Boolean) as string[],
    drawerSide: model.side,
  }
}

function resolveList(
  keys: readonly TabKey[],
  resolve: (key: TabKey) => string | null,
): string[] {
  return keys.map(key => resolve(key)).filter(Boolean) as string[]
}
