// Stub for the deleted activation-handoff module. The owned model
// (tabs/owned-commit.ts) replaces the cross-drawer handoff logic; this
// stub provides the type signatures and no-op implementations that
// tabs/assignment.ts still references. assignment.ts is slated for
// deletion in Task 10.6; until then, this keeps the build green.
import { dwarn } from '../debug/log'

export type TestHooks = Record<string, never>

export interface HandoffArgs {
  tabId: string
  source: 'primary' | 'secondary'
  destination: 'primary' | 'secondary'
  sourceList: string[]
  /** true = rClick; false = live DnD / Configure quiet */
  activateDestination?: boolean
  preMoveSourceActiveTab?: boolean
  activeAtGestureStart?: unknown
  hooks?: TestHooks
}

export type PrimaryActivePreserve = {
  disconnect: () => void
  reassert: () => void
}

export async function captureSourceList(
  _side: 'primary' | 'secondary',
  _h?: TestHooks,
): Promise<string[]> {
  return []
}

export function pickSourceReplacement(
  _tabId: string,
  _sourceList: string[],
): string | null {
  return null
}

export function buildCrossDrawerHandoff(args: HandoffArgs): HandoffArgs {
  return args
}

export function armPreservePrimaryActiveOnToSecondary(
  _tabIds: string[],
): PrimaryActivePreserve {
  return { disconnect: () => {}, reassert: () => {} }
}

export async function runHandoff(_handoff: HandoffArgs): Promise<void> {
  dwarn('[activation-handoff-stub] runHandoff called on deleted module')
}

export async function reassertPrimaryNeighborAfterHandoff(
  _tabId: string,
  _preMoveSourceList: string[],
): Promise<void> {
  dwarn('[activation-handoff-stub] reassertPrimaryNeighborAfterHandoff called on deleted module')
}
