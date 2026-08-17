// Layout persistence lifecycle.
//
// This module owns the *no-op stubs* and lifecycle guards for the
// legacy layout persistence path. The actual write/read path is now
// in src/persist/{layout,settings}-repo.ts, and the owned model in
// src/recon/dispatch.ts is the only writer.
//
// Functions exported here are kept for backward compatibility with
// legacy callers; they no longer write to the backend.
//
// The previous `layout/persist.ts` mixed these lifecycle helpers with
// the snapshot/build functions (now in src/layout/snapshot.ts) and the
// backend context singleton (now in src/persist/backend-ctx.ts). That
// file has been split per concern; this module is one of the three
// resulting files.

import { flushSettingsSave, setLastLoadedLayout, getSettings } from '../settings/state'
import { isLayoutRepoArmed } from './layout-repo'
import { logPersistSave, syncPersistDebugToBackend } from '../debug/persist-debug'
import { getBackendCtx } from './backend-ctx'
import { buildPersistedLayout } from '../layout/snapshot'

/**
 * Retired in Task 10.2. The owned model loads layout via
 * loadLayoutFromDisk in src/persist/layout-repo.ts. This stub
 * remains so existing imports don't break; safe to remove once all
 * callers are migrated to loadLayoutFromDisk directly.
 */
export function loadSavedLayout(): null {
  return null
}

// Guard: true while a load is awaiting the backend response.
let _loadInProgress = false
export function isLoadInProgress(): boolean { return _loadInProgress }

let _loadCancel: (() => void) | null = null

export function cancelLoadSavedLayout(options?: { preserveGuard?: boolean }): void {
  if (_loadCancel) {
    // logPersistLoad is a named export; we lazy-load to avoid a cycle.
    import('../debug/persist-debug').then(({ logPersistLoad }) => {
      logPersistLoad('cancel', {
        reason: options?.preserveGuard ? 'preserve-guard' : 'cancel',
        loadInProgress: _loadInProgress,
      })
    })
    _loadCancel()
  }
  _loadCancel = null
  if (!options?.preserveGuard) _loadInProgress = false
}

// Debounce timer for the legacy persistLayout. Always null in the
// owned-model world; kept so callers that defensively cancel still
// find a defined symbol.
let _saveLayoutTimer: ReturnType<typeof setTimeout> | null = null

export function cancelLayoutSave(): void {
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
}

export function flushPendingSaves(): void {
  if (!isLayoutRepoArmed()) {
    logPersistSave('flush', null, { skipped: 'not-armed', loadInProgress: _loadInProgress })
    return
  }
  if (_loadInProgress) {
    logPersistSave('flush', null, { skipped: 'load-in-progress', loadInProgress: true })
    return
  }
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
  // Flush a pending settings save instead of cancelling it: a toggle made
  // <100ms before unload would otherwise be silently dropped. No-op when
  // nothing is pending.
  flushSettingsSave()
  syncPersistDebugToBackend((msg) => getBackendCtx()?.sendToBackend(msg))
  logPersistSave('flush', null, { loadInProgress: _loadInProgress })
  // No actual write — the owned model handles all persistence.
  // The flush action is logged for diagnostics.
  const layout = buildPersistedLayout()
  setLastLoadedLayout(layout)
}

/**
 * Retired no-op. The owned model (dispatch.ts:reconcileAndPersist)
 * handles all persistence. The drawer open state is tracked in
 * model.drawers and persisted via the model's own write path.
 */
export function persistOpenState(): void {
  // intentionally empty
}

/**
 * Retired no-op. The owned model (dispatch.ts:reconcileAndPersist)
 * handles all persistence. Tab placement, order, hidden state, active
 * state, and drawer metadata are all serialized from the model after
 * every reconcile. Legacy callers that previously called persistLayout()
 * to flush DOM-observed state no longer need to do so.
 */
export function persistLayout(): void {
  // intentionally empty
}

/**
 * Retired no-op. The owned model (dispatch.ts) tracks drawer state in
 * model.drawers. The model reconciles and persists drawer state
 * automatically. Legacy callers that tracked drawer state in this
 * module's local variables no longer affect persistence.
 */
export function setMainDrawerState(_open: boolean, _tabId: string | null): void {
  // intentionally empty
}
