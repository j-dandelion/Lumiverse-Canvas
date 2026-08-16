import type { LayoutModel, TabKey, Side, DrawerSide, ObservedWorld } from '../core/model'
import type { Intent } from '../core/intents'
import { listForSide, isHidden, visibleKeys, sideOfKey } from '../core/select'
import type { HostPort, LiveTabId, ReconcileReport, StepReport, DrawerState, EchoInfo } from '../host/port'
import { dlog } from '../debug/log'

let _epochId = 0
let _activeEpoch = false
let _echoDropped = 0
let _nonEchoDetected = 0
let _queuedPostEpoch = false

export function epochState(): EchoInfo & { active: boolean } {
  return {
    active: _activeEpoch,
    echoDropped: _echoDropped,
    nonEcho: _nonEchoDetected,
    postEpochScheduled: _queuedPostEpoch,
  }
}

export function flushMicrotasks(): Promise<void> {
  return new Promise<void>(resolve => queueMicrotask(resolve))
}

export function resetEpochState(): void {
  _epochId = 0
  _activeEpoch = false
  _echoDropped = 0
  _nonEchoDetected = 0
  _queuedPostEpoch = false
}

function modelMatchesWorld(
  model: LayoutModel,
  resolved: Map<TabKey, LiveTabId>,
  world: ObservedWorld,
): boolean {
  for (const side of ['primary', 'secondary'] as Side[]) {
    if (diffSetOrder(model, side, resolved, world) !== null) return false
    if (diffHidden(model, side, resolved, world) !== null) return false
    if (diffActive(model, side, resolved, world) !== null) return false
    if (diffDrawer(model, side, world) !== null) return false
  }
  if (diffSide(model, world) !== null) return false
  return true
}

function mkStep(step: string, status: StepReport['status'], ops: number, reason?: string): StepReport {
  const r: StepReport = { step, status, ops }
  if (reason) r.reason = reason
  return r
}

function mergeSideOrder(
  model: LayoutModel,
  side: Side,
  resolved: Map<TabKey, LiveTabId>,
): LiveTabId[] {
  const list = listForSide(model, side)
  const out: LiveTabId[] = []
  for (const key of list) {
    const id = resolved.get(key)
    if (id) out.push(id)
  }
  return out
}

function observeSideOrder(world: ObservedWorld, side: Side): LiveTabId[] {
  return world.tabs
    .filter(t => t.location === side)
    .map(t => t.liveId)
}

function diffSetOrder(
  model: LayoutModel,
  side: Side,
  resolved: Map<TabKey, LiveTabId>,
  world: ObservedWorld,
): LiveTabId[] | null {
  const want = mergeSideOrder(model, side, resolved)
  const have = observeSideOrder(world, side)
  if (want.length !== have.length) return want
  for (let i = 0; i < want.length; i++) {
    if (want[i] !== have[i]) return want
  }
  return null
}

function diffHidden(
  model: LayoutModel,
  side: Side,
  resolved: Map<TabKey, LiveTabId>,
  world: ObservedWorld,
): LiveTabId[] | null {
  const modelHiddenIds: LiveTabId[] = []
  const list = listForSide(model, side)
  for (const key of list) {
    const id = resolved.get(key)
    if (!id) continue
    if (model.hidden.includes(key)) {
      modelHiddenIds.push(id)
    }
  }

  const tabMap = new Map<TabKey, (typeof world.tabs)[0]>(
    world.tabs.map(t => [t.key, t]),
  )
  const liveHidden = new Map<LiveTabId, boolean>()
  for (const [key, id] of resolved) {
    const obs = tabMap.get(key)
    if (obs && obs.location === side) {
      liveHidden.set(id, obs.isHidden)
    }
  }

  const diff: LiveTabId[] = []
  for (const [key, id] of resolved) {
    const obs = tabMap.get(key)
    if (!obs || obs.location !== side) continue
    const wantHidden = model.hidden.includes(key)
    const isObsHidden = obs.isHidden
    if (wantHidden && !isObsHidden) diff.push(id)
  }

  for (const [key, id] of resolved) {
    const obs = tabMap.get(key)
    if (!obs || obs.location !== side) continue
    const wantHidden = model.hidden.includes(key)
    const isObsHidden = obs.isHidden
    if (!wantHidden && isObsHidden) diff.push(id)
  }

  return diff.length > 0 ? modelHiddenIds : null
}

function diffActive(
  model: LayoutModel,
  side: Side,
  resolved: Map<TabKey, LiveTabId>,
  world: ObservedWorld,
): LiveTabId | null {
  const modelActive = model.active[side]
  if (!modelActive) return null

  const id = resolved.get(modelActive)
  if (!id) return null

  const tabMap = new Map<TabKey, (typeof world.tabs)[0]>(
    world.tabs.map(t => [t.key, t]),
  )
  const obs = tabMap.get(modelActive)

  const isActive =
    side === 'primary'
      ? obs?.isActiveInPrimary ?? false
      : obs?.isActiveInSecondary ?? false

  return isActive ? null : id
}

function diffDrawer(
  model: LayoutModel,
  side: Side,
  world: ObservedWorld,
): DrawerState | null {
  const m = model.drawers[side]
  const wOpen = side === 'primary' ? world.primaryOpen : world.secondaryOpen
  const wWidth = side === 'primary' ? world.primaryWidth : world.secondaryWidth
  if (m.open !== wOpen || m.width !== wWidth) {
    return { open: m.open, width: m.width }
  }
  return null
}

function diffSide(model: LayoutModel, world: ObservedWorld): DrawerSide | null {
  return model.side !== world.drawerSide ? model.side : null
}

export async function reconcile(
  model: LayoutModel,
  host: HostPort,
): Promise<ReconcileReport> {
  const world = host.observe()
  const steps: StepReport[] = []
  let totalOps = 0
  const observedTabMap = new Map<TabKey, (typeof world.tabs)[0]>(
    world.tabs.map(t => [t.key, t]),
  )

  const allKeys = new Set<TabKey>()
  for (const k of model.primary) allKeys.add(k)
  for (const k of model.secondary) allKeys.add(k)

  const resolved = new Map<TabKey, LiveTabId>()
  const unresolved: TabKey[] = []
  let identityOps = 0
  for (const key of allKeys) {
    const id = host.resolve(key)
    if (id) {
      resolved.set(key, id)
      identityOps++
    } else {
      unresolved.push(key)
    }
  }
  steps.push(mkStep('identity',
    unresolved.length === 0 ? 'ok' : 'degraded',
    identityOps,
    unresolved.length ? `${unresolved.length} tab(s) not present in host` : undefined,
  ))
  // Identity is mapping, not world-changing; don't count in totalOps

  // Inventory gate. The dispatcher (enqueueHostSync) uses inventoryIsReady
  // to defer syncFromHost during partial/empty bootstrap, but the reconciler
  // report should still surface the inventory state so callers can see why
  // a reconcile is operating on a partial world. The gate lives in dispatch;
  // this step is informational.
  {
    const status = world.inventory?.status
    const inventoryStatus: StepReport['status'] = status === 'partial' || status === 'empty'
      ? 'degraded'
      : 'ok'
    steps.push(mkStep('inventory', inventoryStatus, 0,
      status === undefined ? 'inventory not reported by host' :
        status === 'partial' ? 'inventory partial' :
        status === 'empty' ? 'inventory empty' :
        status))
  }

  steps.push(mkStep('shell', 'ok', 0))

  const epochId = ++_epochId
  _activeEpoch = true

  // The epoch listener is paired with a try/finally that always closes the
  // epoch and disposes the subscription. Without it, a host write that throws
  // (e.g. setOrder:'throw' test seam) would leave _activeEpoch stuck true and
  // the subscription live — subsequent reconcile calls would register
  // additional listeners that keep mutating _queuedPostEpoch.
  const unsub = host.onWorldChanged(() => {
    if (!_activeEpoch || _epochId !== epochId) {
      _queuedPostEpoch = true
      return
    }
    const w = host.observe()
    if (modelMatchesWorld(model, resolved, w)) {
      _echoDropped++
    } else {
      _nonEchoDetected++
      _queuedPostEpoch = true
    }
  })

  let placeOps = 0
  let placeIssues = 0
  let orderOps = 0
  let orderIssues = 0
  let actOps = 0
  let actIssues = 0
  let drawerOps = 0
  let visOps = 0
  let visDegraded = 0
  let totalOpsLocal = 0
  let scheduled: boolean
  try {
    for (const [key, id] of resolved) {
      const modelSide = sideOfKey(model, key)
      if (!modelSide) continue
      const obs = observedTabMap.get(key)
      if (!obs) continue
      if (obs.location !== modelSide) {
        placeOps++
        const result = await host.placeTab(id, modelSide)
        if (!result.placed) placeIssues++
      }
    }
    steps.push(mkStep('placement',
      placeIssues > 0 ? 'degraded' : 'ok',
      placeOps,
      placeIssues ? `${placeIssues} placement(s) failed` : undefined,
    ))
    totalOps += placeOps

    for (const side of ['primary', 'secondary'] as Side[]) {
      const hids = diffHidden(model, side, resolved, world)
      if (hids !== null) {
        visOps++
        const result = await host.setHidden(side, hids)
        if (result !== 'ok') visDegraded++
      }
    }
    steps.push(mkStep('visibility',
      visDegraded > 0 ? 'degraded' : 'ok',
      visOps,
      visDegraded ? `${visDegraded} visibility write(s) degraded` : undefined,
    ))
    totalOps += visOps

    for (const side of ['primary', 'secondary'] as Side[]) {
      const want = diffSetOrder(model, side, resolved, world)
      if (want !== null) {
        dlog('[reconcile] setOrder', {
          side,
          want,
          observed: observeSideOrder(world, side),
          model: mergeSideOrder(model, side, resolved),
        })
        orderOps++
        const result = await host.setOrder(side, want)
        if (result !== 'ok') orderIssues++
      }
    }
    steps.push(mkStep('order',
      orderIssues > 0 ? 'degraded' : 'ok',
      orderOps,
      orderIssues ? `${orderIssues} order write(s) degraded` : undefined,
    ))
    totalOps += orderOps

    for (const side of ['primary', 'secondary'] as Side[]) {
      const id = diffActive(model, side, resolved, world)
      if (id !== null) {
        actOps++
        // Taskbar mode (2026-07-31): LumiverseHost.activate for the primary
        // side routes through activateMainMirrorFromRestore, which force-
        // sets the mirror key and clicks the host button. The userPicked
        // guard in main-tab-pin.ts blocks it when a user-established key
        // exists, so a stale model active can no longer steal the user's
        // tab — but that also means diffActive is NOT the place to fix host
        // content drift; placementFirstMoveByLiveId re-asserts content
        // explicitly (docs/pitfalls.md §3–§6).
        const result = await host.activate(side, id)
        if (result !== 'ok') actIssues++
      }
    }
    steps.push(mkStep('activation',
      actIssues > 0 ? 'degraded' : 'ok',
      actOps,
      actIssues ? `${actIssues} activation(s) degraded` : undefined,
    ))
    totalOps += actOps

    for (const side of ['primary', 'secondary'] as Side[]) {
      const ds = diffDrawer(model, side, world)
      if (ds) {
        drawerOps++
        await host.setDrawer(side, ds)
      }
    }
    const newSide = diffSide(model, world)
    if (newSide) {
      drawerOps++
      await host.setSide(newSide)
    }
    steps.push(mkStep('drawers', 'ok', drawerOps))
    totalOps += drawerOps

    scheduled = _queuedPostEpoch
  } finally {
    // Always close the epoch and dispose the listener, even if a host write
    // threw. This prevents _activeEpoch from leaking true and stops the
    // listener from continuing to mutate _queuedPostEpoch for this generation.
    _activeEpoch = false
    unsub()
  }

  _queuedPostEpoch = false

  const echoInfo: EchoInfo = {
    echoDropped: _echoDropped,
    nonEcho: _nonEchoDetected,
    postEpochScheduled: scheduled,
  }
  _echoDropped = 0
  _nonEchoDetected = 0

  // Touch locals so the optimizer cannot elide them before the throw. They
  // exist primarily for parity with resetEpochState()'s surface area.
  void placeOps; void placeIssues; void orderOps; void orderIssues
  void actOps; void actIssues; void drawerOps; void visOps; void visDegraded
  void totalOpsLocal

  return { ops: totalOps, steps, unresolved, echo: echoInfo }
}
