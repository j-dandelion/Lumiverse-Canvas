// Main drawer restoration from a persisted layout blob.
//
// This module is invoked once at boot with the raw layout blob loaded
// from the backend. It validates the blob, gates on the
// `persistDrawerOpenState` / `persistDrawerWidth` settings, then
// delegates to `restoreMainDrawerFromDom` (in sidebar/main-persist.ts)
// which owns the actual DOM/CSS application.
//
// Lives in `layout/` (instead of alongside main-persist.ts) because it
// is the only bridge between the persistence layer and the main
// drawer's DOM restore. Keeping it isolated makes the dependency
// direction explicit: persistence → restore → DOM.

import { dwarn } from '../debug/log'
import { isOpenStatePersistenceEnabled, isWidthPersistenceEnabled } from './snapshot'
import { parseLayoutBlob } from './parse-layout'

export function applyMainDrawer(layout: any): void {
  const restoreOpen = isOpenStatePersistenceEnabled()
  const restoreWidth = isWidthPersistenceEnabled()

  if (layout != null) {
    const parsed = parseLayoutBlob(layout)
    if (!parsed) {
      dwarn('applyMainDrawer: layout blob failed validation; unsuppress only')
      import('../sidebar/main-persist')
        .then(({ unsuppressMainDrawer }) => { unsuppressMainDrawer() })
        .catch((err) => { dwarn('applyMainDrawer: unsuppressMainDrawer failed:', err) })
      return
    }
    layout = parsed
  }

  if (!restoreOpen && !restoreWidth) {
    import('../sidebar/main-persist')
      .then(({ unsuppressMainDrawer }) => { unsuppressMainDrawer() })
      .catch((err) => { dwarn('applyMainDrawer: unsuppressMainDrawer failed:', err) })
    return
  }

  if (!layout || !layout.primary) {
    import('../sidebar/main-persist')
      .then(({ unsuppressMainDrawer }) => { unsuppressMainDrawer() })
      .catch((err) => { dwarn('applyMainDrawer: unsuppressMainDrawer failed:', err) })
    return
  }

  import('../sidebar/main-persist')
    .then(({ restoreMainDrawerFromDom }) => {
      restoreMainDrawerFromDom(
        layout.primary.open === true,
        typeof layout.primary.tabId === 'string' ? layout.primary.tabId : null,
        restoreWidth && typeof layout.primary.width === 'number' ? layout.primary.width : undefined,
        { restoreOpen, restoreWidth },
      )
    })
    .catch((err) => {
      dwarn('applyMainDrawer: restoreMainDrawerFromDom failed:', err)
      import('../sidebar/main-persist')
        .then(({ unsuppressMainDrawer }) => { unsuppressMainDrawer() })
        .catch((e2) => { dwarn('applyMainDrawer: unsuppress after restore failure also failed:', e2) })
    })
}
