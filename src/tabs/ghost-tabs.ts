// Ghost-tab sweeper (LUMI-29): when an extension that owns a tab is turned
// off, the live inventory loses the tab and observe()'s ghost-grace tracker
// (host/lumiverse/implementation.ts) stops synthesizing it — the next
// authoritative host-sync drops the key from the owned model. The
// model-driven surfaces converge on their own from that commit:
//
//   - main-mirror strip: renderMainMirrorTabs' stale-button sweep
//   - Start menu / Configure Tabs: projections read the model
//   - persistence: serializeModelToLayout serializes the model
//
// The ONE surface that does not converge is the Canvas-OWNED secondary strip
// button: it is imperative DOM (addSecondaryTabButton), and a dead
// extension's liveId no longer resolves, so the liveId-based removal paths
// (DrawerObserver unreg → removeSecondaryTabButton) can never find it. The
// button would keep rendering icon + label with dead click/contextmenu —
// the secondary flavor of the reported ghost.
//
// This sweeper subscribes to model commits and removes secondary buttons
// whose facade key (data-canvas-facade-key, stamped at creation) the model
// no longer carries anywhere — i.e. the key was dropped, not moved: a
// secondary→primary move keeps the key in model.primary and must NOT sweep.

import type { TabKey } from '../core/model'
import { onModelChanged, getModel } from '../recon/dispatch'
import { getSecondaryTabList, getSecondaryWrapper, closeSecondarySidebar } from '../sidebar/secondary'
import { getActiveSecondaryTabId, setActiveSecondaryTabId } from './active-tab'
import { updateDrawerTabVisibility, removeSecondaryTabButton } from './buttons'
import { dlog } from '../debug/log'

/** Unsubscribe handle returned by startGhostTabSweeper. */
export type GhostTabSweeperStop = () => void

let _unsub: (() => void) | null = null
let _prevSecondary: readonly string[] = []

/**
 * Keys that left model.secondary AND model.primary in this commit — the
// model dropped them entirely (extension disabled). Pure + exported for tests.
 */
export function droppedSecondaryKeys(
  prevSecondary: readonly string[],
  model: { primary: readonly string[]; secondary: readonly string[] },
): string[] {
  const out: string[] = []
  for (const key of prevSecondary) {
    if (model.secondary.includes(key)) continue
    if (model.primary.includes(key)) continue
    out.push(key)
  }
  return out
}

/**
 * Remove one dead key's Canvas-owned leftovers: the secondary strip button
 * (found by the facade-key stamp — the liveId is unresolvable for a dead
 * extension) and any orphaned moved root. Clears the tracked active when it
 * pointed at the dead tab and auto-closes the drawer when no secondary tab
 * buttons remain (same end-state contract as the unregistration cleanup in
 * secondary-drawer.ts).
 */
function sweepGhostSecondaryButton(key: string): void {
  if (typeof document === 'undefined') return
  let escaped: string
  try {
    escaped = CSS.escape(key)
  } catch {
    return
  }
  const scope = getSecondaryTabList() ?? getSecondaryWrapper()
  const btn = scope?.querySelector(
    `button[data-canvas-facade-key="${escaped}"]`,
  ) as HTMLElement | null
  // The liveId recorded at creation time (needed for the id-keyed removal
  // helpers); may already be stale — removal falls back to the node itself.
  const liveId = btn?.getAttribute('data-tab-id') || ''
  const wasActive = !!liveId && getActiveSecondaryTabId() === liveId
  dlog('[ghost-tabs] sweeping dead secondary tab', { key, liveId, wasActive })

  // Orphaned content roots (extension teardown usually removed them; a
  // best-effort sweep keeps a detached root from lingering). The root mark
  // is keyed by liveId — only attempt it when we resolved one.
  if (liveId) {
    let roots: Element[] = []
    try {
      roots = Array.from(
        document.querySelectorAll(`[data-canvas-moved="${CSS.escape(liveId)}"]`),
      )
    } catch { /* selector edge — skip */ }
    for (const root of roots) root.remove()
    removeSecondaryTabButton(liveId)
  } else {
    btn?.remove()
  }

  if (!wasActive) return
  // Tracked active pointed at the dead tab: clear it. Model convergence
  // (syncActive / activeAfterRemoval) already replaced the model-side active
  // when the key was dropped; this only fixes the intent-memory cell and the
  // strip highlight. Close the drawer when nothing is left to show.
  setActiveSecondaryTabId(null)
  const list = getSecondaryTabList()
  const remaining = list
    ? Array.from(list.querySelectorAll('button[data-tab-id]')).filter(
        (el) => !(el instanceof HTMLElement && el.style.display === 'none'),
      ).length
    : 0
  if (remaining === 0) {
    closeSecondarySidebar()
    updateDrawerTabVisibility()
  }
}

function onModelCommit(): void {
  const model = getModel()
  if (!model) return
  const prev = _prevSecondary
  _prevSecondary = model.secondary
  for (const key of droppedSecondaryKeys(prev, model)) {
    sweepGhostSecondaryButton(key)
  }
}

/**
 * Start the sweeper. Seeds the previous-secondary snapshot from the current
 * model (a boot commit must never sweep pre-existing buttons) and returns
 * the stop function for registerCleanup.
 */
export function startGhostTabSweeper(): GhostTabSweeperStop {
  stopGhostTabSweeper()
  const model = getModel()
  _prevSecondary = model ? model.secondary : []
  _unsub = onModelChanged(onModelCommit)
  return stopGhostTabSweeper
}

export function stopGhostTabSweeper(): void {
  if (_unsub) {
    _unsub()
    _unsub = null
  }
  _prevSecondary = []
}
