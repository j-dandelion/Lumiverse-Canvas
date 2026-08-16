import type { LayoutModel, TabKey, Side, DrawerSide, HostTabEntry, ObservedWorld } from '../../core/model'
import { builtinKey, extensionKey, parseBuiltinKey, parseExtensionKey, isBuiltinKey } from '../../core/model'
import type { HostPort, LiveTabId, PlaceResult, WriteResult, DrawerState } from '../port'
import { findStoreData, getMainDrawerSide, isMainDrawerOpen } from '../../store'
import { getMainSidebar } from '../../dom/lumiverse'
import { getMainDrawerWidth } from '../../dom/lumiverse'
import { getHostDrawerSettings, patchHostDrawerSettings } from '../../dom/host-settings'
import { getTabAssignments } from '../../tabs/assignment'
import { getHostBridge } from '../../dom/host-bridge'
import { resolvePrimaryActiveTabId, getActiveSecondaryTabId } from '../../tabs/active-tab'
import {
  getCanvasHiddenTabIds,
  mergeHiddenTabIdLists,
  setCanvasHiddenTabIds,
} from '../../tabs/canvas-hidden'
import {
  ensureSecondaryShellMounted,
  getSecondaryWrapper,
  isSecondarySidebarOpen,
  openSecondarySidebar,
  closeSecondarySidebar,
} from '../../sidebar/secondary'
import {
  assignToSecondary,
  unassignFromSecondary,
} from '../../sidebar/secondary-drawer'
import {
  addSecondaryTabButton,
  removeSecondaryTabButton,
  reorderSecondaryTabButtons,
  secondaryTabButtonsReady,
  reorderMainMirrorTabButtons,
  reorderHostMainTabButtons,
  hideMainTabButton,
  showMainTabButton,
  showSecondaryTab,
  applyHiddenTabIdsToSecondary,
} from '../../tabs/buttons'
import { drawerObserver } from '../../sidebar/drawer-observer'
import { getMainMirrorDrawer } from '../../sidebar/main-mirror-drawer'
import { getSecondaryTabList } from '../../sidebar/secondary'
import { readVisibleTabIdsFromList } from '../../tabs/live-tab-order'
import { dlog } from '../../debug/log'

const SECONDARY_WIDTH_VAR = '--canvas-secondary-width'
const DEFAULT_WIDTH = 420

// ---------------------------------------------------------------------------
// Helper: read secondary width from CSS custom property
// ---------------------------------------------------------------------------
function readSecondaryWidth(): number {
  if (typeof document === 'undefined') return DEFAULT_WIDTH
  return parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || DEFAULT_WIDTH
}

// ---------------------------------------------------------------------------
// Helper: classify a drawer tab as 'builtin' or 'extension'
// ---------------------------------------------------------------------------
// The drawer's `extensionId` is parsed from the tabId format
// `spindle:{extId}:tab:{id}:{counter}` (parts[1]). For Lumiverse built-in
// tabs (Personas, Lorebook, Wallpaper, …) the data-tab-id is just the bare
// id with no spindle prefix, so the parser yields `parts[1] = undefined
// → 'unknown'`. The host's `getBuiltInTabRoot` is the source of truth:
// it returns a registry root iff the host knows the tab as built-in.
//
// Classification is stable: once the host bridge is available (after
// `setup()` registers the context), the same tabId always classifies
// the same way, so the model's TabKey doesn't shift across re-observes.
function classifyTab(tabId: string, drawerExtensionId: string): 'builtin' | 'extension' {
  const bridge = getHostBridge()
  if (bridge?.ui?.getBuiltInTabRoot) {
    try {
      if (bridge.ui.getBuiltInTabRoot(tabId)) return 'builtin'
    } catch {
      // Bridge threw (e.g. tab not registered, permission revoked) — fall
      // through to the drawer's signal. The placement pipeline will retry
      // classification at placement time and surface the real cause.
    }
  }
  return (!drawerExtensionId || drawerExtensionId === 'unknown') ? 'builtin' : 'extension'
}

// ---------------------------------------------------------------------------
// Helper: resolve a live drawer tab's TabKey
// ---------------------------------------------------------------------------
function tabKeyFromDrawerTab(t: { id: string; extensionId: string; title: string }): TabKey {
  if (classifyTab(t.id, t.extensionId) === 'builtin') return builtinKey(t.id)
  return extensionKey(t.extensionId || 'unknown', t.title)
}

/** The observer is the host's live tab inventory and preserves DOM order. */
function liveDrawerTabs(): { id: string; extensionId: string; title: string; root: HTMLElement; key: TabKey }[] {
  // Observer-only on purpose: the DrawerObserver registers untagged
  // extension buttons (class-based scan) so this inventory is COMPLETE and
  // STABLE. Unioning the fiber store here instead caused a reconcile/
  // persist cascade — findStoreData(true) inside observe() can land on any
  // extension's partial store (LumiBooks vs Hone vs the root store), so the
  // merged world flip-flopped between rounds and SAVE_LAYOUT never settled.
  return drawerObserver.getAllTabs()
    .map((tab) => ({
      id: tab.tabId,
      extensionId: tab.extensionId === 'unknown' ? '' : tab.extensionId,
      title: tab.title,
      root: tab.button,
      // Frozen identity from the registry. The derivation fallback covers
      // legacy-injected ObservedTab shapes (test doubles) that predate the
      // sticky-key field.
      key: tab.key ?? tabKeyFromDrawerTab({ id: tab.tabId, extensionId: tab.extensionId, title: tab.title }),
    }))
}

// ---------------------------------------------------------------------------
// Helper: resolve a TabKey to a live tab id via the store
// ---------------------------------------------------------------------------
function resolveTabKey(key: TabKey): LiveTabId | null {
  const observedTabs = liveDrawerTabs()
  if (isBuiltinKey(key)) {
    const builtinId = parseBuiltinKey(key)
    const base = builtinId?.includes(':') ? builtinId.slice(0, builtinId.lastIndexOf(':')) : builtinId
    const match = observedTabs.find(t => {
      if (t.id === builtinId) return true
      const tBase = t.id.includes(':') ? t.id.slice(0, t.id.lastIndexOf(':')) : t.id
      return tBase === base
    })
    if (match) return match.id
    // Title fallback (2026-08-16): extension tabs are keyed by their TITLE
    // while untagged ('builtin:Hone'), but the observer re-keys to the real
    // spindle id once the tagger tags the button. Without this, a saved
    // layout containing the pre-tag id could never resolve the tab and its
    // placement/order was silently dropped on restore.
    const titleMatch = builtinId ? observedTabs.find(t => t.title === builtinId) : undefined
    return titleMatch ? titleMatch.id : null
  }
  const parsed = parseExtensionKey(key)
  if (!parsed) return null
  const match = observedTabs.find(
    t => (t.extensionId === parsed.extensionId ||
      // liveDrawerTabs blanks 'unknown' → ''; keys built from the observer
      // carry 'unknown'. Normalize so both directions resolve.
      (!t.extensionId && parsed.extensionId === 'unknown'))
      && t.title === parsed.tabName,
  )
  if (match) return match.id
  // Title fallback: the key's extensionId may be stale (built while the tab
  // was untagged/'unknown', or re-keyed by the tagger since). Never drop a
  // tab the user placed — match by title alone.
  const titleMatch = observedTabs.find(t => t.title === parsed.tabName)
  return titleMatch ? titleMatch.id : null
}

// ---------------------------------------------------------------------------
// Helper: resolve the side for a live tab against the assignment facade.
//
// The assignment facade (tabs/assignment.ts) is derived from the owned model
// and keyed by TabKey ('builtin:wallpaper', 'ext:foo:bar'), NOT by the liveId
// ('wallpaper'). Looking the facade up by liveId always misses, which forces
// every DOM-placed secondary tab back to 'primary' in the observed world —
// applySyncFromHost then reverts the move on the next host-sync and the
// second drawer never sticks (2026-07-31 rClick regression). Resolve the
// TabKey first, then read the facade.
// ---------------------------------------------------------------------------
export function entryLocationFor(
  tab: { id: string; extensionId: string; title: string; key?: TabKey },
  assignments: Map<string, Side>,
): Side {
  const direct = assignments.get(tab.key ?? tabKeyFromDrawerTab(tab))
  if (direct) return direct
  // Re-keyed tab (2026-08-16): the tagger re-keys the observer entry from the
  // title id to the tagged spindle id, so the observed key ('ext:hone/Hone')
  // differs from the model's pre-tag key ('builtin:Hone' or 'ext:old/Hone').
  // The facade lookup above misses and the tab would observe as 'primary',
  // making applySyncFromHost flip a user's secondary placement back to the
  // main drawer on the next sync. Fall back to a TITLE match on the facade —
  // the tab's title is stable across re-keys.
  for (const [facadeKey, side] of assignments) {
    const builtin = parseBuiltinKey(facadeKey)
    if (builtin && builtin === tab.title) return side
    const ext = parseExtensionKey(facadeKey)
    if (ext && ext.tabName === tab.title) return side
  }
  return 'primary'
}

// ---------------------------------------------------------------------------
// Helper: build the HostTabEntry for a given live tab
// ---------------------------------------------------------------------------
function buildHostEntry(tab: { id: string; extensionId: string; title: string; root?: unknown; key: TabKey }): HostTabEntry {
  const assignments = getTabAssignments()
  const location: Side = entryLocationFor(tab, assignments)
  const key = tab.key
  const canvasHidden = new Set(getCanvasHiddenTabIds())
  const hostSettings = getHostDrawerSettings()
  const hostHidden = hostSettings?.hiddenTabIds ? new Set(hostSettings.hiddenTabIds as string[]) : new Set<string>()
  const isHidden = canvasHidden.has(tab.id) || hostHidden.has(tab.id)
  const primaryActive = resolvePrimaryActiveTabId()
  const secondaryActive = getActiveSecondaryTabId()

  return {
    key,
    liveId: tab.id,
    isBuiltin: !tab.extensionId,
    location,
    isHidden,
    isActiveInPrimary: primaryActive === tab.id,
    isActiveInSecondary: secondaryActive === tab.id,
    hasContentRoot: tab.root != null,
  }
}

/**
 * Build a synthetic HostTabEntry for a tab in the assignment map that is
 * NOT in the live drawer inventory. Used for secondary-assigned tabs whose
 * host button was hidden or DOM-placed. The argument is a model TabKey (the
 * key the owned model uses), not a liveId; the entry's `key` must match
 * the model so `applySyncFromHost` does not invent a duplicate.
 */
function buildEntryFromAssignment(tabKey: string): HostTabEntry {
  const assignments = getTabAssignments()
  const location: Side = assignments.get(tabKey) === 'secondary' ? 'secondary' : 'primary'
  const canvasHidden = new Set(getCanvasHiddenTabIds())
  const isHidden = canvasHidden.has(tabKey)
  const primaryActive = resolvePrimaryActiveTabId()
  const secondaryActive = getActiveSecondaryTabId()

  return {
    key: tabKey as TabKey,
    liveId: '',
    isBuiltin: false,
    location,
    isHidden,
    isActiveInPrimary: primaryActive === tabKey,
    isActiveInSecondary: secondaryActive === tabKey,
    hasContentRoot: false,
  }
}

// ===========================================================================
// LumiverseHost — HostPort implementation against live Lumiverse
// ===========================================================================
export class LumiverseHost implements HostPort {
  // Latest dispose function returned by onWorldChanged. Stored so
  // setup.ts can call shutdown() to disconnect all observers (body,
  // sidebar, mirror, and the DrawerObserver registrations) without
  // having to track the unsub function separately. The dispatch
  // layer's shutdown() invokes _unsubscribeWorldChanged first, which
  // is the same dispose function; storing it here lets the host
  // expose its own shutdown() for callers that don't go through
  // dispatch.shutdown().
  private _dispose: (() => void) | null = null

  /**
   * Disconnect all observers owned by this host. Safe to call multiple
   * times. After shutdown(), observe() will still work but no
   * callbacks will fire.
   */
  shutdown(): void {
    this._dispose?.()
    this._dispose = null
  }

  // -----------------------------------------------------------------------
  // observe — one fresh snapshot, bypassing TTL caches
  //
  // CONTRACT: this snapshot is authoritative for applySyncFromHost, which
  // rebuilds the model wholesale — a tab missing here is dropped from the
  // model. Secondary-assigned tabs whose host button is hidden or
  // DOM-placed MUST therefore still appear, via the facade-derived
  // buildHostEntry/buildEntryFromAssignment below (facade reads are keyed
  // by TabKey — see entryLocationFor). Without these entries a host-sync
  // taken before restored tabs are placed would wipe them from the model.
  // -----------------------------------------------------------------------
  observe(): ObservedWorld {
    findStoreData(true)

    const liveTabs = liveDrawerTabs()
    // Dedup by TabKey, not by liveId. The assignment facade is keyed by
    // TabKey (e.g. "ext:foo:bar"); live tabs carry a separate liveId
    // (e.g. "spindle:foo:tab:bar:0"). Deduping by liveId would double-count
    // every assignment entry and grow the model unboundedly each host-sync
    // round, triggering an infinite setOrder cascade.
    const seen = new Set<string>()
    const entries: HostTabEntry[] = []

    // Tabs from the live host inventory (frozen keys from the registry —
    // never re-derived from tagging state).
    for (const t of liveTabs) {
      const key = t.key
      seen.add(key)
      entries.push(buildHostEntry(t))
    }

    // Tabs from the assignment map that aren't in the drawer store
    // (e.g. secondary-assigned tabs whose host button was hidden or DOM-placed).
    // The key here is a model TabKey, so the seen check must compare against
    // the live-tab TabKey space, not the liveId.
    //
    // TITLE-BASED DEDUP (REFACTOR-PLAN v2 §4.3): a facade key whose TITLE
    // matches a live entry is the SAME tab under a legacy pre-canonicalization
    // key (e.g. the model holds 'builtin:Hone' from before sticky keys while
    // the live world carries the frozen 'ext:unknown/Hone'). Key-only dedup
    // would emit both and applySyncFromHost would grow a permanent duplicate
    // (the facade re-derives from the model, so the ghost self-sustains).
    // Skipping same-title facade entries makes legacy→canonical key
    // migration atomic within one sync round. Safe against false positives:
    // builtin keys parse to bare ids ('loom'), never to display titles
    // ('Loom'), and disambiguated extension keys carry the '@N' suffix.
    const liveByTitle = new Map<string, TabKey>()
    for (const t of liveTabs) {
      if (!liveByTitle.has(t.title)) liveByTitle.set(t.title, t.key)
    }
    const assignments = getTabAssignments()
    for (const [tabKey] of assignments) {
      if (seen.has(tabKey)) continue
      const title = parseBuiltinKey(tabKey) ?? parseExtensionKey(tabKey)?.tabName
      if (title && liveByTitle.has(title)) continue
      entries.push(buildEntryFromAssignment(tabKey))
      seen.add(tabKey)
    }

    // Secondary order is Canvas-owned: derive it from the actual secondary
    // tab-list DOM order (data-tab-id sequence) rather than the primary
    // drawer's button sequence. The primary sequence preserves the tabs'
    // ORIGINAL positions, so once a user moves tabs out of primary order the
    // observed secondary order can never match the model — every reconcile
    // then issues a redundant setOrder write (and a phantom order that could
    // fight drag-reorders). Entries without a live secondary button keep
    // their observed position at the end.
    const secondaryIds = readVisibleTabIdsFromList(getSecondaryTabList())
    if (secondaryIds.length > 0) {
      const primaryEntries = entries.filter(e => e.location !== 'secondary')
      const secondaryEntries = entries.filter(e => e.location === 'secondary')
      const byLiveId = new Map(secondaryEntries.map(e => [e.liveId, e]))
      const ordered: HostTabEntry[] = []
      const placed = new Set<string>()
      for (const id of secondaryIds) {
        const entry = byLiveId.get(id)
        if (entry && !placed.has(id)) {
          ordered.push(entry)
          placed.add(id)
        }
      }
      for (const e of secondaryEntries) {
        if (!placed.has(e.liveId)) ordered.push(e)
      }
      entries.length = 0
      entries.push(...primaryEntries, ...ordered)
    }

    const drawerSide: DrawerSide = getMainDrawerSide() === 'left' ? 'left' : 'right'
    const primaryOpen = isMainDrawerOpen()
    const primaryWidth = getMainDrawerWidth() || DEFAULT_WIDTH
    const secondaryOpen = isSecondarySidebarOpen()
    const secondaryWidth = readSecondaryWidth()

    return {
      tabs: entries,
      inventory: drawerObserver.getSnapshot(),
      drawerSide,
      primaryOpen,
      primaryWidth,
      secondaryOpen,
      secondaryWidth,
    }
  }

  // -----------------------------------------------------------------------
  // resolve — map a stable TabKey to a session-specific LiveTabId
  // -----------------------------------------------------------------------
  resolve(key: TabKey): LiveTabId | null {
    return resolveTabKey(key)
  }

  // -----------------------------------------------------------------------
  // findKey — map a LiveTabId back to its stable TabKey
  // -----------------------------------------------------------------------
  findKey(id: LiveTabId): TabKey | null {
    const tabs = liveDrawerTabs()

    // Exact match
    let match = tabs.find(t => t.id === id)
    if (match) return match.key

    // Suffix-stripped match
    const idBase = id.includes(':') ? id.slice(0, id.lastIndexOf(':')) : id
    match = tabs.find(t => {
      const tBase = t.id.includes(':') ? t.id.slice(0, t.id.lastIndexOf(':')) : t.id
      return tBase === id || tBase === idBase
    })
    if (match) return match.key

    // If not in drawer tabs, check the assignment map (secondary-assigned tabs)
    const assignments = getTabAssignments()
    if (assignments.has(id)) {
      // Extension tab: construct key from id
      if (id.includes(':')) {
        return extensionKey(id.slice(0, id.lastIndexOf(':')), id)
      }
      return extensionKey(id, id)
    }

    // Also try suffix-stripped in assignments
    for (const [assignedId] of assignments) {
      const aBase = assignedId.includes(':') ? assignedId.slice(0, assignedId.lastIndexOf(':')) : assignedId
      if (aBase === id || aBase === idBase) {
        if (aBase.includes(':')) {
          return extensionKey(aBase.slice(0, aBase.lastIndexOf(':')), aBase)
        }
        return extensionKey(aBase, aBase)
      }
    }

    // Title fallback (2026-08-16): a move/restore may carry the tab's TITLE
    // as the live id (pre-tag buttons; saved layouts written while the tab
    // was untagged) even though the observer now holds the tagged spindle
    // id. Match by title so the tab still resolves after re-keying.
    match = tabs.find(t => t.title === id)
    if (match) return match.key

    // Button-attribute bridge (2026-08-16): at boot the observer registers
    // extension buttons by TITLE, then the tagger tags the button with the
    // real data-tab-id — but the observer entry is only re-keyed on the next
    // scan. A saved layout written while tagged carries the spindle id, and
    // this stale entry is the only observer record of the tab. Match through
    // the button's current data-tab-id so the restore still resolves.
    // (Phase 1's attribute-aware observer closes the stale window in the
    // live runtime; the bridge remains as the legacy-input path.)
    match = tabs.find(t => {
      const btn = (t as { root?: HTMLElement | null }).root
      return !!btn && btn.getAttribute('data-tab-id') === id
    })
    if (match) return match.key

    return null
  }

  // -----------------------------------------------------------------------
  // placeTab — move a tab between drawers
  // -----------------------------------------------------------------------
  async placeTab(id: LiveTabId, to: Side): Promise<PlaceResult> {
    try {
      const assignments = getTabAssignments()
      // Facade is TabKey-keyed; resolve the liveId first (see entryLocationFor).
      const key = this.findKey(id) ?? id
      const current = assignments.get(key) ?? 'primary'
      if (current === to) return { placed: true }

      ensureSecondaryShellMounted({ initialOpen: false })

      if (to === 'secondary') {
        await assignToSecondary(id)
        return { placed: true }
      } else {
        await unassignFromSecondary(id)
        return { placed: true }
      }
    } catch (e) {
      return { placed: false, reason: String(e) }
    }
  }

  // -----------------------------------------------------------------------
  // setOrder — write the full tab order for one side
  // -----------------------------------------------------------------------
  async setOrder(side: Side, ids: LiveTabId[]): Promise<WriteResult> {
    try {
      dlog('[host] setOrder:start', { side, ids })
      if (side === 'secondary') {
        if (!secondaryTabButtonsReady(ids)) {
          dlog('[host] setOrder:secondary-not-ready', { ids })
          return 'degraded'
        }
        reorderSecondaryTabButtons(ids)
        // Secondary order is Canvas-owned. The host's tabOrder is the primary
        // drawer order; writing secondary ids here would overwrite it.
        return 'ok'
      }

      const current = getHostDrawerSettings()
      const merged = {
        ...(current ?? {}),
        tabOrder: ids,
      }

      // Apply the order to both live primary surfaces before the host's React
      // settings update settles. DnD removes its overlay immediately after
      // reconcile; without this handoff the old DOM order becomes visible and
      // the dropped tab appears to teleport back to its source slot.
      reorderHostMainTabButtons(ids)
      reorderMainMirrorTabButtons(ids)
      dlog('[host] setOrder:dom-reordered', { side, ids })

      const ok = patchHostDrawerSettings(merged)
      dlog('[host] setOrder:settings-written', { side, ids, ok })
      return ok ? 'ok' : 'degraded'
    } catch {
      return 'failed'
    }
  }

  // -----------------------------------------------------------------------
  // setHidden — apply the full hidden set for one side
  // -----------------------------------------------------------------------
  async setHidden(_side: Side, ids: LiveTabId[]): Promise<WriteResult> {
    try {
      const idSet = new Set(ids)

      if (_side === 'secondary') applyHiddenTabIdsToSecondary(idSet)

      const current = getHostDrawerSettings()
      const side = _side
      const sideIds = new Set<string>()
      for (const tab of liveDrawerTabs()) {
        if ((getTabAssignments().get(tab.id) === 'secondary') === (side === 'secondary')) {
          sideIds.add(tab.id)
        }
      }
      for (const [id, assignedSide] of getTabAssignments()) {
        if ((assignedSide === 'secondary') === (side === 'secondary')) sideIds.add(id)
      }
      const currentHidden = Array.isArray(current?.hiddenTabIds)
        ? current.hiddenTabIds as string[]
        : []
      const nextHidden = currentHidden.filter(id => !sideIds.has(id))
      for (const id of ids) {
        if (!nextHidden.includes(id)) nextHidden.push(id)
      }
      const canvasHidden = getCanvasHiddenTabIds().filter(id => !sideIds.has(id))
      setCanvasHiddenTabIds([...canvasHidden, ...ids])
      const merged = {
        ...(current ?? {}),
        hiddenTabIds: mergeHiddenTabIdLists(nextHidden, getCanvasHiddenTabIds()),
      }

      const ok = patchHostDrawerSettings(merged)
      return ok ? 'ok' : 'degraded'
    } catch {
      return 'failed'
    }
  }

  // -----------------------------------------------------------------------
  // activate — make a tab the active one on a side
  // -----------------------------------------------------------------------
  async activate(side: Side, id: LiveTabId): Promise<WriteResult> {
    try {
      if (side === 'secondary') {
        showSecondaryTab(id)
        return 'ok'
      }

      const tabs = liveDrawerTabs()
      const tab = tabs.find(t => t.id === id)
      if (!tab) return 'degraded'

      const hostBtn = document.querySelector<HTMLElement>(
        `button[data-tab-id="${CSS.escape(id)}"]`,
      )
      if (!hostBtn) return 'degraded'

      const { activateMainMirrorFromRestore } = await import(
        '../../sidebar/main-tab-pin'
      )
      activateMainMirrorFromRestore(hostBtn, tab.title)
      return 'ok'
    } catch {
      return 'failed'
    }
  }

  // -----------------------------------------------------------------------
  // setDrawer — open/close/width on one drawer
  // -----------------------------------------------------------------------
  async setDrawer(side: Side, s: DrawerState): Promise<WriteResult> {
    try {
      if (side === 'secondary') {
        if (s.open) {
          openSecondarySidebar()
        } else {
          closeSecondarySidebar()
        }
        if (s.width > 0 && typeof document !== 'undefined') {
          document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${s.width}px`)
        }
        return 'ok'
      }

      const current = getHostDrawerSettings()

      if (current) {
        const patch: Record<string, unknown> = {}
        if (s.width > 0) {
          patch.width = s.width
        }
        patchHostDrawerSettings({ ...current, ...patch })
      }

      const { applyMainMirrorDrawer, openCanvasMainDrawer, closeCanvasMainDrawer } = await import(
        '../../sidebar/main-mirror-drawer'
      )

      if (s.open) {
        openCanvasMainDrawer()
      } else {
        closeCanvasMainDrawer()
      }
      if (s.width > 0) {
        if (typeof document !== 'undefined') {
          document.documentElement.style.setProperty('--canvas-main-mirror-width', `${s.width}px`)
        }
      }

      return 'ok'
    } catch {
      return 'failed'
    }
  }

  // -----------------------------------------------------------------------
  // setSide — swap drawer locations (left ↔ right)
  // -----------------------------------------------------------------------
  async setSide(side: DrawerSide): Promise<WriteResult> {
    try {
      const current = getHostDrawerSettings()
      const merged = { ...(current ?? {}), side }
      const ok = patchHostDrawerSettings(merged)

      // The host settings write is NO-GO in this runtime (setSetting bridge
      // unavailable), so the swap must ALSO go through the Canvas-side flip
      // (drawer-sync's applyMainDrawerSideChange): it sets the side override
      // (which getMainDrawerSide prefers, so the observed world converges
      // and diffSide settles), remounts the secondary shell on the new edge,
      // and repositions the main mirror. Without it, "Swap drawer locations"
      // in Configure only changed the model — nothing moved on screen
      // (2026-07-31).
      try {
        const ds = await import('../../sidebar/drawer-sync')
        await ds.applyMainDrawerSideChange(side)
      } catch (err) {
        dlog('[host] setSide: drawer-sync flip failed', String(err))
      }

      return ok ? 'ok' : 'degraded'
    } catch {
      return 'failed'
    }
  }

  // -----------------------------------------------------------------------
  // onWorldChanged — register a debounced world-change callback
  // -----------------------------------------------------------------------
  onWorldChanged(cb: () => void): () => void {
    let disposed = false
    let scheduled = false
    const notify = () => {
      if (disposed || scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        if (!disposed) cb()
      })
    }

    // DrawerObserver can report several registrations during one React commit.
    // Route those events through the same microtask gate as DOM readiness
    // observers so bootstrap/reconciliation sees one coherent world snapshot.
    const unreg1 = drawerObserver.onTabRegistered(notify)
    const unreg2 = drawerObserver.onTabUnregistered(notify)

    // React can commit the drawer after the initial fiber walk and without
    // emitting a DrawerObserver registration event. Watch the stable host
    // sidebar as a readiness signal so bootstrap cannot get stuck on []/
    // forever. The callback is microtask-coalesced because one React commit
    // commonly inserts several buttons and panel nodes.
    let sidebarObserver: MutationObserver | null = null
    const sidebar = getMainSidebar()
    if (sidebar) {
      sidebarObserver = new MutationObserver(notify)
      sidebarObserver.observe(sidebar, { childList: true, subtree: true })
    }

    let bodyObserver: MutationObserver | null = null
    if (!sidebar && typeof document !== 'undefined' && document.body) {
      bodyObserver = new MutationObserver(() => {
        const readySidebar = getMainSidebar()
        if (!readySidebar || sidebarObserver || disposed) return
        drawerObserver.start()
        sidebarObserver = new MutationObserver(notify)
        sidebarObserver.observe(readySidebar, { childList: true, subtree: true })
        bodyObserver?.disconnect()
        bodyObserver = null
        notify()
      })
      bodyObserver.observe(document.body, { childList: true, subtree: true })
    }

    let mirrorObserver: MutationObserver | null = null
    const mirror = getMainMirrorDrawer()
    if (mirror) {
      mirrorObserver = new MutationObserver(notify)
      mirrorObserver.observe(mirror, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true,
      })
    }

    // Fire immediately if tabs are already present (we missed the initial scan)
    const tabs = liveDrawerTabs()
    if (tabs.length > 0) {
      notify()
    }

    const dispose = () => {
      disposed = true
      unreg1()
      unreg2()
      sidebarObserver?.disconnect()
      bodyObserver?.disconnect()
      mirrorObserver?.disconnect()
    }
    this._dispose = dispose
    return dispose
  }
}
