// Main-drawer DOM polling.
//
// Waits for the host's drawer DOM to appear after a hard refresh
// (when the extension runs before React mounts ViewportDrawer).
// Extracted from main-persist.ts to isolate the polling subsystem.

import { getMainDrawer } from '../dom/lumiverse'
import { dlog } from '../debug/log'

// Maximum time (ms) to wait for the host's drawer DOM to appear on
// hard refresh. After this, we give up — the extension will work on
// the next disable+re-enable cycle.
const DOM_POLL_TIMEOUT_MS = 5000

let _domPollTimer: ReturnType<typeof setTimeout> | null = null
let _domPollObserver: MutationObserver | null = null

function _cleanupDomPoll(): void {
  if (_domPollObserver) { _domPollObserver.disconnect(); _domPollObserver = null }
  if (_domPollTimer) { clearTimeout(_domPollTimer); _domPollTimer = null }
}

/**
 * Wait for the host's drawer DOM to appear after a hard refresh.
 * On hard refresh, the extension runs before React mounts ViewportDrawer,
 * so getMainDrawer() returns null. We watch for the sidebar mount node
 * to appear via a MutationObserver on <body>, then initialize normally.
 * This makes hard-refresh behave identically to disable+re-enable.
 */
export function waitForDrawerDOM(
  stoppedRef: { value: boolean },
  initObservers: (drawer: HTMLElement) => void,
): void {
  // Already polling — don't double up
  if (_domPollObserver || _domPollTimer) return

  const initIfReady = (): boolean => {
    const drawer = getMainDrawer()
    if (!drawer || stoppedRef.value) return false
    _cleanupDomPoll()
    dlog('main-persist: host DOM appeared, initializing observers')
    initObservers(drawer)
    return true
  }

  // Fast path: it might already be there
  if (initIfReady()) return

  // Watch for the sidebar mount node to appear in the DOM
  _domPollObserver = new MutationObserver(() => {
    if (initIfReady()) {
      _domPollObserver?.disconnect()
      _domPollObserver = null
    }
  })
  _domPollObserver.observe(document.body, { childList: true, subtree: true })

  // Safety timeout — don't poll forever
  _domPollTimer = setTimeout(() => {
    dlog('main-persist: DOM poll timed out; host drawer never appeared')
    _cleanupDomPoll()
  }, DOM_POLL_TIMEOUT_MS)
}

/** Cleanup polling state. Called on teardown. */
export function cleanupDomPoll(): void {
  _cleanupDomPoll()
}
