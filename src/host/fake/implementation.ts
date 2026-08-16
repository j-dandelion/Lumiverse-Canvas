import type { TabKey, Side, DrawerSide, ObservedWorld, HostTabEntry } from '../../core/model'
import type {
  HostPort, LiveTabId, PlaceResult, WriteResult, DrawerState, ReconcileReport,
} from '../port'

export interface LiveTab {
  key: TabKey
  liveId: LiveTabId
  location: Side
  hidden: boolean
  activeInPrimary: boolean
  activeInSecondary: boolean
  hasContentRoot: boolean
  isBuiltin: boolean
}

function clone(l: LiveTab): LiveTab {
  return { ...l }
}

export type FailureMode =
  | 'none'
  | 'degraded'
  | { custom: PlaceResult }

type OpState = 'idle' | 'writing' | 'closedEpoch'

export interface FakeHostFailureConfig {
  placeTab?: { result: PlaceResult }
  setOrder?: WriteResult | 'throw'
  setHidden?: WriteResult
  activate?: WriteResult
  setDrawer?: WriteResult
  setSide?: WriteResult
  /** Number of microtask ticks before writes take effect (simulates React commit lag). */
  commitLagTicks?: number
}

export class FakeHost implements HostPort {
  private _tabs: LiveTab[] = []
  private _side: DrawerSide = 'left'
  private _primaryOpen = false
  private _primaryWidth = 420
  private _secondaryOpen = false
  private _secondaryWidth = 420
  private _changeListeners: Array<() => void> = []
  private _opState: OpState = 'idle'
  _failureConfig: FakeHostFailureConfig = {}
  /** Counts placeTab calls per tab id (for bridge→store→DOM retry simulation). */
  _placeTabCalls: Map<LiveTabId, number> = new Map()

  constructor(tabs: LiveTab[] = [], side: DrawerSide = 'left') {
    this._tabs = tabs.map(clone)
    this._side = side
  }

  observe(): ObservedWorld {
    return {
      tabs: this._tabs.map(t => ({
        key: t.key,
        liveId: t.liveId,
        isBuiltin: t.isBuiltin,
        location: t.location,
        isHidden: t.hidden,
        isActiveInPrimary: t.activeInPrimary,
        isActiveInSecondary: t.activeInSecondary,
        hasContentRoot: t.hasContentRoot,
      })),
      drawerSide: this._side,
      primaryOpen: this._primaryOpen,
      primaryWidth: this._primaryWidth,
      secondaryOpen: this._secondaryOpen,
      secondaryWidth: this._secondaryWidth,
    }
  }

  resolve(key: TabKey): LiveTabId | null {
    const t = this._tabs.find(t => t.key === key)
    return t ? t.liveId : null
  }

  findKey(id: LiveTabId): TabKey | null {
    const t = this._tabs.find(t => t.liveId === id)
    return t ? t.key : null
  }

  /**
   * Change a tab's liveId while keeping its key stable.
   * Simulates suffix drift across sessions (e.g. myext:1 → myext:2).
   */
  changeLiveId(key: TabKey, newLiveId: LiveTabId): void {
    const t = this._tabs.find(t => t.key === key)
    if (t) t.liveId = newLiveId
  }

  /**
   * PlaceTab fails on first attempt (bridge NO-GO), succeeds on retry (store fallback).
   * Set `_placeTabFailCount` to N to fail the first N attempts.
   */
  _placeTabFailCount = 0

  async placeTab(id: LiveTabId, to: Side): Promise<PlaceResult> {
    if (this._failureConfig.placeTab) return this._failureConfig.placeTab.result

    const count = (this._placeTabCalls.get(id) ?? 0) + 1
    this._placeTabCalls.set(id, count)

    if (this._placeTabFailCount >= count) {
      return { placed: false, reason: `simulated NO-GO attempt ${count}` }
    }

    const t = this._tabs.find(t => t.liveId === id)
    if (!t) return { placed: false, reason: 'tab not found' }
    if (!t.hasContentRoot) return { placed: false, reason: 'no content root' }
    t.location = to
    if (to === 'primary') {
      t.activeInSecondary = false
    } else {
      t.activeInPrimary = false
    }
    this._notify()
    return { placed: true }
  }

  async setOrder(side: Side, ids: LiveTabId[]): Promise<WriteResult> {
    if (this._failureConfig.setOrder === 'throw') {
      throw new Error('simulated setOrder failure')
    }
    if (this._failureConfig.setOrder) return this._failureConfig.setOrder
    const sideLocs = this._tabs.filter(t => t.location === side)
    const idSet = new Set(ids)
    const reordered = ids
      .map(id => sideLocs.find(t => t.liveId === id))
      .filter((t): t is LiveTab => t != null)
    const rest = sideLocs.filter(t => !idSet.has(t.liveId))
    const newSide = [...reordered, ...rest]
    const others = this._tabs.filter(t => t.location !== side)
    this._tabs = [...others, ...newSide]
    this._notify()
    return 'ok'
  }

  async setHidden(side: Side, ids: LiveTabId[]): Promise<WriteResult> {
    if (this._failureConfig.setHidden) return this._failureConfig.setHidden
    const idSet = new Set(ids)
    for (const t of this._tabs) {
      if (t.location === side) {
        t.hidden = idSet.has(t.liveId)
      }
    }
    this._notify()
    return 'ok'
  }

  async activate(side: Side, id: LiveTabId): Promise<WriteResult> {
    if (this._failureConfig.activate) return this._failureConfig.activate
    const t = this._tabs.find(t => t.liveId === id)
    if (!t || t.location !== side) return 'degraded'
    if (side === 'primary') {
      for (const tb of this._tabs) tb.activeInPrimary = tb.liveId === id
    } else {
      for (const tb of this._tabs) tb.activeInSecondary = tb.liveId === id
    }
    this._notify()
    return 'ok'
  }

  async setDrawer(side: Side, s: DrawerState): Promise<WriteResult> {
    if (this._failureConfig.setDrawer) return this._failureConfig.setDrawer
    if (side === 'primary') {
      this._primaryOpen = s.open
      this._primaryWidth = s.width
    } else {
      this._secondaryOpen = s.open
      this._secondaryWidth = s.width
    }
    this._notify()
    return 'ok'
  }

  async setSide(side: DrawerSide): Promise<WriteResult> {
    if (this._failureConfig.setSide) return this._failureConfig.setSide
    this._side = side
    this._notify()
    return 'ok'
  }

  onWorldChanged(cb: () => void): () => void {
    this._changeListeners.push(cb)
    return () => {
      this._changeListeners = this._changeListeners.filter(l => l !== cb)
    }
  }

  addTab(key: TabKey, liveId: LiveTabId, location: Side): LiveTab {
    const t: LiveTab = {
      key, liveId, location,
      hidden: false,
      activeInPrimary: false,
      activeInSecondary: false,
      hasContentRoot: true,
      isBuiltin: key.startsWith('builtin:'),
    }
    this._tabs.push(t)
    this._notify()
    return t
  }

  removeTab(liveId: LiveTabId): void {
    this._tabs = this._tabs.filter(t => t.liveId !== liveId)
    this._notify()
  }

  setContentRoot(liveId: LiveTabId, hasRoot: boolean): void {
    const t = this._tabs.find(t => t.liveId === liveId)
    if (t) t.hasContentRoot = hasRoot
  }

  stealActivation(side: Side, liveId: LiveTabId): void {
    if (side === 'primary') {
      for (const t of this._tabs) t.activeInPrimary = t.liveId === liveId
    } else {
      for (const t of this._tabs) t.activeInSecondary = t.liveId === liveId
    }
    this._notify()
  }

  tabInSide(id: LiveTabId, side: Side): boolean {
    return this._tabs.some(t => t.liveId === id && t.location === side)
  }

  tabHidden(id: LiveTabId, side: Side): boolean {
    return this._tabs.some(t => t.liveId === id && t.location === side && t.hidden)
  }

  tabActive(side: Side, id: LiveTabId): boolean {
    return this._tabs.some(t =>
      t.liveId === id &&
      t.location === side &&
      (side === 'primary' ? t.activeInPrimary : t.activeInSecondary),
    )
  }

  private _notify(): void {
    const ticks = this._failureConfig.commitLagTicks ?? 0
    if (ticks > 0) {
      for (let i = 0; i < ticks; i++) {
        queueMicrotask(() => {})
      }
      queueMicrotask(() => {
        for (const l of this._changeListeners) l()
      })
    } else {
      for (const l of this._changeListeners) l()
    }
  }
}
