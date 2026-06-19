// ExtensionReExecutor: re-executes an extension bundle in the secondary drawer
// with a CanvasSecondaryCtx. Manages teardown lifecycle.
//
// When a tab is assigned to the secondary drawer, the extension's bundle is
// dynamically imported and its setup() is called with a secondary-scoped context.
// The context's registerDrawerTab is intercepted to route activation through the
// SecondaryDrawer state machine.
//
// If the same extension is re-executed (e.g. the user moves a different tab from
// the same extension to the secondary), the old instance is torn down first.

import { buildCanvasSecondaryCtx, clearSecondaryTabs, type CanvasSecondaryCtx } from '../context/secondary-ctx'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { dlog, dwarn } from '../debug/log'

interface ReExecution {
  ctx: CanvasSecondaryCtx
  teardown: () => void
  bundleUrl: string
}

const _executions: Map<string, ReExecution> = new Map()

/**
 * Re-execute an extension bundle in the secondary context.
 * If the extension is already running in the secondary, tears down the old
 * instance first.
 *
 * @returns the ReExecution record (ctx + teardown) for the new instance.
 */
export async function reExecuteExtension(opts: {
  bundleUrl: string
  extensionId: string
  primaryCtx: SpindleFrontendContext
  onActivate?: (tabId: string) => void
}): Promise<ReExecution> {
  const { bundleUrl, extensionId, primaryCtx, onActivate } = opts

  // Tear down existing instance if any
  await teardownExtension(extensionId)

  // Look up the target extension's backend bus. When the re-executed
  // extension calls ctx.sendToBackend(...), the message MUST be routed
  // to the target extension's worker (not canvas_ext's). The bridge
  // `window.spindle.ui.getExtensionBackend` returns the target's
  // sendToBackend/onBackendMessage, which close over the target's
  // extensionId and backendHandlers Set. If the target isn't loaded
  // (rare), we fall back to primaryCtx — messages will be misrouted but
  // at least the wrapper won't crash.
  const targetBackend =
    (typeof window !== 'undefined'
      ? (window as any).spindle?.ui?.getExtensionBackend?.(extensionId)
      : null) ?? null

  const secondaryCtx = buildCanvasSecondaryCtx(
    primaryCtx,
    extensionId,
    targetBackend,
    onActivate,
  )

  // Fetch the bundle as a blob and import via a blob URL — matches the
  // host's pattern in Lumiverse's spindle/loader.ts:148-165. Direct
  // import() of the /api/v1/spindle/{uuid}/frontend URL fails with
  // "Error resolving module specifier" because the response is served
  // with a non-ESM MIME type and the browser's import resolver can't
  // handle it directly. The blob URL trick sidesteps that.
  dlog(`[ExtensionReExecutor] fetching ${extensionId} from ${bundleUrl}`)
  const response = await fetch(bundleUrl)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${bundleUrl}`)
  }
  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)
  let mod: any
  try {
    mod = await import(/* @vite-ignore */ blobUrl)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
  if (typeof mod.setup !== 'function') {
    throw new Error(`Extension ${extensionId} has no setup() function`)
  }

  const teardown: () => void = mod.setup(secondaryCtx as unknown as SpindleFrontendContext) || (() => {})

  const execution: ReExecution = { ctx: secondaryCtx, teardown, bundleUrl }
  _executions.set(extensionId, execution)
  dlog(`[ExtensionReExecutor] ${extensionId}: re-executed successfully`)
  return execution
}

/**
 * Tear down a re-executed extension. Calls its teardown function and removes
 * its secondary tab handles.
 */
export async function teardownExtension(extensionId: string): Promise<void> {
  const execution = _executions.get(extensionId)
  if (!execution) return

  dlog(`[ExtensionReExecutor] tearing down ${extensionId}`)
  try {
    execution.teardown()
  } catch (err) {
    // best-effort teardown — don't throw
  }

  // Clear secondary tab handles for THIS extension only (not all extensions)
  clearSecondaryTabs(extensionId)

  _executions.delete(extensionId)
}

/**
 * Tear down all re-executed extensions. Called on Canvas disable.
 */
export function teardownAllExtensions(): void {
  for (const [extId] of _executions) {
    try {
      teardownExtension(extId)
    } catch (err) {
      dwarn(`[ExtensionReExecutor] teardownAll: ${extId} failed:`, err)
    }
  }
  _executions.clear()
}
