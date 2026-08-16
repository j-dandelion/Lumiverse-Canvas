// Typed accessor for the Spindle host bridge.
//
// The host does **not** put the extension context on `window.spindle`.
// Lumiverse loader.ts builds a per-extension SpindleFrontendContext and
// passes it only to `setup(ctx)`. Canvas must store that handle via
// `setHostBridgeContext(ctx)` (setup.ts) so ui / containers APIs resolve.
//
// `window.spindle` remains a fallback for unit tests and any host that
// may expose a global later.
//
// Canvas reads:
//   - getBuiltInTabRoot(tabId)     — built-in tab detection + restore
//   - getBuiltInTabTitle(tabId)    — built-in tab button label
//   - requestTabLocation(tabId,…)  — move a tab between drawers
//   - getTabLocation(tabId)        — read-back for the move (verify it stuck)
//   - registerContainer({id,…})    — declare the secondary drawer as a tab
//                                    container so ContainerTabContent can
//                                    route built-in tabs to it
//
// getBuiltInTabRoot / requestTabLocation require the `ui_panels` permission
// (declared in spindle.json). Callers should catch PERMISSION_DENIED.
//
// Returns null when no setup ctx and window.spindle is undefined.

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
  /** Full frontend context when sourced from setup (permissions API, etc.). */
  ctx?: SpindleFrontendContext
}

declare global {
  interface Window {
    spindle?: SpindleFrontendContext
  }
}

/** Injected by setup(ctx). Primary runtime source of the host bridge. */
let _setupCtx: SpindleFrontendContext | null = null

/**
 * Store the SpindleFrontendContext from setup(). Call with null on teardown.
 * This is required: window.spindle is not set by the host loader.
 */
export function setHostBridgeContext(ctx: SpindleFrontendContext | null): void {
  _setupCtx = ctx
}

/** Test / diagnostics: currently injected setup context (may be null). */
export function getHostBridgeContext(): SpindleFrontendContext | null {
  return _setupCtx
}

function resolveCtx(): SpindleFrontendContext | null {
  if (_setupCtx) return _setupCtx
  if (typeof window === 'undefined') return null
  const global = window.spindle
  return global ?? null
}

export function getHostBridge(): HostBridge | null {
  const ctx = resolveCtx()
  if (!ctx) return null
  return {
    ui: ctx.ui as HostBridgeUI,
    containers: ctx.containers as HostBridgeContainers,
    ctx,
  }
}

/**
 * Ensure Canvas has ui_panels (needed for getBuiltInTabRoot + requestTabLocation).
 * No-op when already granted or when permissions API is unavailable.
 * Returns true when ui_panels is present after the call.
 *
 * Note: `permissions.request` exists on the host loader but is not always
 * present on older lumiverse-spindle-types; access it via a narrow cast.
 */
export async function ensureUiPanelsPermission(): Promise<boolean> {
  const ctx = resolveCtx()
  if (!ctx?.permissions) return false
  try {
    const granted = await ctx.permissions.getGranted()
    if (granted.includes('ui_panels')) return true
    const perms = ctx.permissions as {
      getGranted(): Promise<string[]>
      request?(
        permissions: string[],
        options?: { reason?: string },
      ): Promise<string[]>
    }
    if (typeof perms.request !== 'function') return false
    const next = await perms.request(['ui_panels'], {
      reason:
        'Canvas needs panel access to move built-in tabs (Personas, Lorebook, etc.) into the second drawer.',
    })
    return next.includes('ui_panels')
  } catch {
    return false
  }
}
