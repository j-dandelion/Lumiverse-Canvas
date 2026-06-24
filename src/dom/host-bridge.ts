// Typed accessor for the Spindle host bridge.
//
// The host exposes its API on `window.spindle` (Lumiverse loader.ts:1032-1087).
// Canvas reads several methods off this bridge:
//
//   - getBuiltInTabRoot(tabId)     — built-in tab detection + restore
//   - getBuiltInTabTitle(tabId)    — built-in tab button label
//   - requestTabLocation(tabId,…)  — move a tab between drawers
//   - getTabLocation(tabId)        — read-back for the move (verify it stuck)
//   - registerContainer({id,…})    — declare the secondary drawer as a tab
//                                    container so ContainerTabContent can
//                                    route built-in tabs to it
//
// The official type lives in lumiverse-spindle-types (SpindleFrontendContext).
// getTabLocation is an undocumented extension to the bridge; the production
// code handles its absence gracefully.
//
// Returns null when window.spindle is undefined (LumiScript not installed
// or pre-init). Callers must narrow before invoking methods.

import type { SpindleFrontendContext, SpindleTabLocation } from 'lumiverse-spindle-types'

export type { SpindleTabLocation }

export interface HostBridgeUI {
  getBuiltInTabRoot?: (tabId: string) => HTMLElement | undefined
  getBuiltInTabTitle?: (tabId: string) => string | undefined
  requestTabLocation?: (tabId: string, loc: SpindleTabLocation) => void
  /** Undocumented bridge extension. Returns null if not implemented. */
  getTabLocation?: (tabId: string) => SpindleTabLocation | null
}

export interface HostBridgeContainers {
  registerContainer?: (entry: {
    id: string
    side: 'left' | 'right' | 'top' | 'bottom'
    element: HTMLElement
  }) => void
  unregisterContainer?: (id: string) => void
}

export interface HostBridge {
  ui: HostBridgeUI
  containers: HostBridgeContainers
}

declare global {
  interface Window {
    spindle?: SpindleFrontendContext
  }
}

export function getHostBridge(): HostBridge | null {
  if (typeof window === 'undefined') return null
  const ctx = window.spindle
  if (!ctx) return null
  return {
    ui: ctx.ui as HostBridgeUI,
    containers: ctx.containers as HostBridgeContainers,
  }
}
