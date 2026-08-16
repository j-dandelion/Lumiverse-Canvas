import type { TabKey, Side, DrawerSide, ObservedWorld } from '../core/model'

export type LiveTabId = string

export interface PlaceResult {
  placed: boolean
  reason?: string
}

export type WriteResult = 'ok' | 'degraded' | 'failed'

export interface DrawerState {
  open: boolean
  width: number
}

export interface StepReport {
  step: string
  status: 'ok' | 'degraded' | 'failed'
  reason?: string
  ops: number
}

export interface EchoInfo {
  echoDropped: number
  nonEcho: number
  postEpochScheduled: boolean
}

export interface ReconcileReport {
  ops: number
  steps: StepReport[]
  unresolved: TabKey[]
  echo?: EchoInfo
}

export interface HostPort {
  observe(): ObservedWorld
  resolve(key: TabKey): LiveTabId | null
  findKey(id: LiveTabId): TabKey | null
  placeTab(id: LiveTabId, to: Side): Promise<PlaceResult>
  setOrder(side: Side, ids: LiveTabId[]): Promise<WriteResult>
  setHidden(side: Side, ids: LiveTabId[]): Promise<WriteResult>
  activate(side: Side, id: LiveTabId): Promise<WriteResult>
  setDrawer(side: Side, s: DrawerState): Promise<WriteResult>
  setSide(side: DrawerSide): Promise<WriteResult>
  onWorldChanged(cb: () => void): () => void
}
