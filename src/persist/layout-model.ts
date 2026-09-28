import type { LayoutModel, TabKey, Side, DrawerSide } from '../core/model'
import { createEmptyModel, builtinKey, extensionKey, parseBuiltinKey, parseExtensionKey, isBuiltinKey, isExtensionKey } from '../core/model'
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
  findKeyHost?: (id: string) => TabKey | null,
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
    // LUMI-26 precedence: a HOST-resolved tabTitle (the authoritative TabKey)
    // wins; otherwise the tabId (a stale/garbage tabTitle must not override a
    // live id the host still resolves — enable-captures-single-slot); the
    // layout-owned fallback for the tabTitle applies LAST (the recovered
    // record whose live id the host no longer renders).
    let key: TabKey | null = null
    if (d.tabTitle) {
      key = findKeyHost ? findKeyHost(d.tabTitle) : null
      if (!key) {
        const viaId = resolveStoredId(d.tabId, findKey)
        key = viaId ?? resolveStoredId(d.tabTitle, findKey)
      }
    } else {
      key = resolveStoredId(d.tabId, findKey)
    }
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
 * LUMI-26: layout-owned stored-id → TabKey fallback for the boot resolver.
 *
 * Live finding (LUMI-25 repro): when the HOST React filters a tab's button
 * out of the drawer DOM (vanilla `drawerSettings.hiddenTabIds`), the
 * observer inventory loses it and `host.findKey` can no longer resolve its
 * stored id — `buildModelFromLayout` GC'd the tab from the model at boot,
 * the strips dropped it, and Canvas's Configure menu lost it. The ONLY
 * Canvas-side namespace that still knows the tab is the LAYOUT BLOB
 * (tabOrder / detachedTabs tabId↔tabTitle / hiddenTabIds) — never the host
 * store (S2/da972ae: Canvas never writes host drawerSettings, and the host
 * list must not be re-adopted as truth), never the fiber walk.
 *
 * This resolver is the boot-path supplement: a stored id the layout blob
 * owns resolves to a canonical TabKey even with no live button. Strictness
 * (ghost protection — spec §3.4):
 *   - key-shaped ids (`builtin:x` / `ext:e/N`) must be OWNED by the blob;
 *   - bare builtin ids must be owned AND known to this Lumiverse instance
 *     (host `tabOrder`, else the static builtin list as the test-mode
 *     fallback) — a builtin id the instance never had stays unresolved;
 *   - extension live ids (`spindle:…`) resolve ONLY through a
 *     `detachedTabs` tabId→tabTitle mapping — a primary extension tab (no
 *     detached record) stays unresolved (deferred-restore retry semantics
 *     for late registration are untouched — partial-restore-retry.test).
 * Pure: no host/DOM access — unit-testable (layout-model.test.ts).
 */
export function resolveLayoutOwnedStoredId(
  storedId: string,
  layout: unknown,
  builtinIds: readonly string[],
  hostTabOrder?: readonly string[] | null,
): TabKey | null {
  if (!layout || typeof layout !== 'object' || !storedId) return null
  const blob = layout as {
    tabOrder?: unknown
    hiddenTabIds?: unknown
    detachedTabs?: unknown
  }
  const owned = new Set<string>()
  const add = (v: unknown): void => {
    if (typeof v === 'string' && v.length) owned.add(v)
  }
  if (Array.isArray(blob.tabOrder)) blob.tabOrder.forEach(add)
  if (Array.isArray(blob.hiddenTabIds)) blob.hiddenTabIds.forEach(add)
  const detachedByTabId = new Map<string, { tabId?: unknown; tabTitle?: unknown }>()
  if (Array.isArray(blob.detachedTabs)) {
    for (const d of blob.detachedTabs) {
      if (!d || typeof d !== 'object') continue
      const rec = d as { tabId?: unknown; tabTitle?: unknown }
      add(rec.tabId)
      add(rec.tabTitle)
      if (typeof rec.tabId === 'string') detachedByTabId.set(rec.tabId, rec)
    }
  }

  const candidates = [storedId]
  const stripped = stripTabIdSuffix(storedId)
  if (stripped !== storedId) candidates.push(stripped)

  // 1. Key-shaped stored ids (canonical TabKeys written by detachedTabs
  //    tabTitle) — resolve to themselves when the blob owns them.
  for (const c of candidates) {
    if (owned.has(c) && (isBuiltinKey(c) || isExtensionKey(c))) { return c as TabKey }
  }
  // 1b. Key-shaped masquerade whose PARSED base the blob owns as a bare id
  //     (legacy 'builtin:{title}' slots over bare stored ids).
  for (const c of candidates) {
    const parsedBuiltin = parseBuiltinKey(c as TabKey)
    if (parsedBuiltin && (owned.has(c) || owned.has(parsedBuiltin) || [...owned].some((o) => stripTabIdSuffix(o) === parsedBuiltin))) {
      return builtinKey(parsedBuiltin)
    }
  }

  // 2. detachedTabs liveId → tabTitle key mapping (extension live ids whose
  //    key the layout also carries — the model-stored liveId/key mapping).
  for (const c of candidates) {
    const rec = detachedByTabId.get(c)
    const title = typeof rec?.tabTitle === 'string' ? rec.tabTitle : null
    if (title && (isBuiltinKey(title) || isExtensionKey(title))) { return title as TabKey }
  }

  // 3. Bare builtin id — owned + known to this Lumiverse instance.
  for (const c of candidates) {
    if (c.includes(':')) continue
    if (!builtinIds.includes(c)) continue
    const hostKnows = hostTabOrder ? hostTabOrder.includes(c) : true
    if (!hostKnows) continue
    if (owned.has(c) || [...owned].some((o) => stripTabIdSuffix(o) === c)) {
      return builtinKey(c)
    }
  }

  return null
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

/**
 * LUMI-26 rework: a human display title for a recovered model key from the
 * layout blob, preferred over the generic humanizer when available. Modern
 * detachedTabs entries store the model KEY in tabTitle (no human title to
 * add — callers fall through to `humanTabTitleForKey`); legacy partial-restore
 * entries store a human title with a live id in tabId, matched back via
 * `resolveLayoutOwnedStoredId`. Returns null when the blob has nothing.
 */
export function getLayoutOwnedTabTitle(key: TabKey): string | null {
  // Lazy import: settings/state is a heavier module graph (settings store);
  // layout-model must stay importable from pure-test contexts.
  let layout: unknown = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const state = require('../settings/state') as { getLastLoadedLayout?: () => unknown }
    layout = state.getLastLoadedLayout?.() ?? null
  } catch {
    return null
  }
  if (!layout || typeof layout !== 'object') return null
  const detached = (layout as { detachedTabs?: unknown }).detachedTabs
  if (!Array.isArray(detached)) return null
  // Lazy requires keep layout-model free of the store/graph edge at module
  // load (same pattern as the settings/state lookup above).
  let builtinIds: readonly string[] = []
  try {
    const catalog = require('../tabs/configure-catalog') as { BUILTIN_TAB_IDS?: readonly string[] }
    builtinIds = catalog.BUILTIN_TAB_IDS ?? []
  } catch {
    return null
  }
  for (const d of detached) {
    if (!d || typeof d !== 'object') continue
    const { tabId, tabTitle } = d as { tabId?: unknown; tabTitle?: unknown }
    if (typeof tabTitle !== 'string' || !tabTitle || typeof tabId !== 'string' || !tabId) continue
    // Modern shape: tabTitle IS the model key — no human title in the blob.
    if (tabTitle === key) return null
    if (isBuiltinKey(tabTitle) || isExtensionKey(tabTitle)) continue
    // Legacy shape: human title + live id. Match only when the live id
    // resolves (through the owned fallback) to exactly this key.
    if (resolveLayoutOwnedStoredId(tabId, layout, builtinIds, null) === key) return tabTitle
  }
  return null
}
