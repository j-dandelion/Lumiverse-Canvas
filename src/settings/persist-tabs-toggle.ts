// Intercept OFF→ON for persistTabAssignments: if live tab assignments differ
// from the last loaded layout, show a conflict dialog before enabling.

import { tabAssignmentsEqual } from '../layout/tab-assignments-diff'
import {
  applyLayout,
  cancelLayoutSave,
  flushPendingSaves,
  snapshotLayout,
  syncLastLoadedFromPersistedLayout,
} from '../layout/persist'
import {
  cancelSettingsSave,
  getLastLoadedLayout,
  getSettings,
  setSettings,
} from './state'
import {
  hideTabAssignmentsConflictDialog,
  showTabAssignmentsConflictDialog,
} from './tab-assignments-conflict'

function enableAndSaveCurrent(): void {
  setSettings({ persistTabAssignments: true })
  flushPendingSaves()
  // Always refresh freeze base from the merged layout (covers no-backend /
  // early-return flush so the next OFF→ON compare stays consistent).
  syncLastLoadedFromPersistedLayout()
  hideTabAssignmentsConflictDialog()
}

async function enableAndLoadPrevious(): Promise<void> {
  const saved = getLastLoadedLayout()
  if (!saved) {
    setSettings({ persistTabAssignments: true })
    hideTabAssignmentsConflictDialog()
    return
  }

  setSettings({ persistTabAssignments: true })
  // Prevent the post-setSettings debounced write from clobbering disk with
  // pre-restore live tabs before applyLayout finishes.
  cancelSettingsSave()
  cancelLayoutSave()

  try {
    await applyLayout(saved)
  } finally {
    flushPendingSaves()
    // Post-restore live may heal tabIds; freeze base must match what is now
    // in memory/disk so a later OFF→ON without further edits is a no-op.
    syncLastLoadedFromPersistedLayout()
    hideTabAssignmentsConflictDialog()
  }
}

/**
 * Toggle handler for "Remember tab assignments".
 * - OFF: set immediately (existing freeze / cancel-save behavior).
 * - ON with no saved layout or equal assignments: enable immediately.
 * - ON with drift: show Save current / Load previous / dismiss dialog.
 */
export function requestPersistTabAssignments(next: boolean): void {
  if (!next) {
    // While the facet was ON, live tabs are the remembered state. Sync the
    // freeze base from the last merged write first so turning OFF freezes
    // what was actually on disk after recent saves (not a stale boot load).
    // If a debounced write is still pending, flush it while still ON.
    if (getSettings().persistTabAssignments) {
      flushPendingSaves()
      syncLastLoadedFromPersistedLayout()
    }
    setSettings({ persistTabAssignments: false })
    hideTabAssignmentsConflictDialog()
    return
  }

  if (getSettings().persistTabAssignments) {
    return
  }

  const live = snapshotLayout()
  const saved = getLastLoadedLayout()

  if (!saved || tabAssignmentsEqual(live, saved)) {
    setSettings({ persistTabAssignments: true })
    return
  }

  showTabAssignmentsConflictDialog({
    onSaveCurrent: () => {
      enableAndSaveCurrent()
    },
    onLoadPrevious: () => enableAndLoadPrevious(),
    onDismiss: () => {
      hideTabAssignmentsConflictDialog()
      // Leave persistTabAssignments false; toggle visual stays off.
    },
  })
}
