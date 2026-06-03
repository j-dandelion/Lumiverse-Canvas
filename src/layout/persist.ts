// Layout persistence.
//
// Reads and writes the layout blob (drawer open/close, width, tab
// assignments) to the backend via the SAVE_LAYOUT / LOAD_LAYOUT IPC.
// The blob also carries the Canvas settings field — see settings/state.ts.
//
// Two write paths:
//   - persistOpenState: synchronous. Used by openSecondarySidebar /
//     closeSecondarySidebar / the resize handle, so an "open then
//     immediately close within 100ms" sequence records the final state.
//   - persistLayout: 500ms debounced. Used by assignTab and the resize
//     handle (the drag is high-frequency).
//
// One read path (loadSavedLayout): sends LOAD_LAYOUT, resolves on the
// first LAYOUT_DATA response or after a 2s safety timeout.
//
// applyLayout restores the saved state. The 90-line polling loop (the
// suffix-drift fallback for tabId suffix drift across sessions) is moved
// here as-is; the rewrite into a MutationObserver callback is Step 5 work.

import { getMainDrawerWidth } from '../dom/lumiverse'
import { getDrawerTabs, isMainDrawerOpen, getMainDrawerSide } from '../store'
import {
  getSecondaryWrapper, isSecondarySidebarOpen, SECONDARY_WIDTH_VAR,
  animateWrapper, getClosedTransformPx,
  openSecondarySidebar, closeSecondarySidebar,
} from '../sidebar/secondary'
import {
  getTabAssignments, hasTabAssignment, repositionTabToSecondary,
} from '../tabs/assignment'
import {
  addSecondaryTabButton, hideMainTabButton, showSecondaryTab, updateDrawerTabVisibility,
} from '../tabs/buttons'
import { dlog, dwarn } from '../debug/log'
import { getSettings } from '../settings/state'

// Module-private state. The backend ctx is owned by the orchestrator
// (setup in frontend.ts) and passed in via setBackendCtx.
let _backendCtx: any = null

export function getBackendCtx(): any { return _backendCtx }
export function setBackendCtx(ctx: any): void { _backendCtx = ctx }

// Debounce timer for persistLayout (tab assignments, width)
let _saveLayoutTimer: ReturnType<typeof setTimeout> | null = null
// Called by sidebar/cleanup.cleanupAll on teardown.
export function cancelLayoutSave(): void {
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
}

/**
 * Build the current layout snapshot from in-memory state. Pure — no side effects.
 */
export function snapshotLayout(): any {
  return {
    primary: {
      open: isMainDrawerOpen(),
      width: getMainDrawerWidth(),
    },
    secondary: {
      open: isSecondarySidebarOpen(),
      width: parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420,
    },
    detachedTabs: Array.from(getTabAssignments().entries())
      .filter(([_, side]) => side === 'secondary')
      .map(([tabId, side]) => {
        const tabs = getDrawerTabs()
        const tab = tabs.find(t => t.id === tabId)
        return { tabId, tabTitle: tab?.title || tabId, sidebar: side }
      }),
  }
}

function isPersistenceEnabled(): boolean {
  return getSettings().layoutPersistence
}

/**
 * Persist the drawer's open/closed state + width synchronously. No debounce —
 * called from openSecondarySidebar / closeSecondarySidebar / the resize handle,
 * so a user opening then immediately closing the drawer (within the 500ms
 * debounce window of persistLayout) still records the final state. The
 * verification case from the plan: "open, immediately close within 100ms —
 * final state on hard-refresh is closed."
 */
export function persistOpenState(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (!isPersistenceEnabled()) return
  if (_saveLayoutTimer !== null) {
    // A debounced persistLayout is in flight; cancel it so we don't double-write.
    clearTimeout(_saveLayoutTimer)
    _saveLayoutTimer = null
  }
  backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout: snapshotLayout() })
}

/**
 * Persist the tab-assignment list + drawer width, debounced 500ms. Called
 * from assignTab and from the resize handle (the width change is frequent
 * during drag; the debounce coalesces to a single write at drag end).
 */
export function persistLayout(): void {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return
  if (!isPersistenceEnabled()) return
  if (_saveLayoutTimer !== null) {
    clearTimeout(_saveLayoutTimer)
  }
  _saveLayoutTimer = setTimeout(() => {
    _saveLayoutTimer = null
    backendCtx.sendToBackend({ type: 'SAVE_LAYOUT', layout: snapshotLayout() })
  }, 500)
}

/**
 * @deprecated Use persistOpenState() for open/close events and persistLayout()
 * for tab-assignment / width changes. Kept as a single-call alias for any
 * code path that genuinely needs to save the whole layout synchronously.
 */
function saveLayout() {
  persistLayout()
}

export function loadSavedLayout(): Promise<any> {
  const backendCtx = getBackendCtx()
  if (!backendCtx) return Promise.resolve(null)
  return new Promise((resolve) => {
    // Phase 3 (finding #13): register a one-shot handler that resolves the
    // promise when LAYOUT_DATA arrives. The handler is replaced by the
    // permanent ctx.onBackendMessage listener in setup() before any other
    // LAYOUT_DATA could come through.
    const handler = (payload: any) => {
      if (payload.type === 'LAYOUT_DATA') {
        resolve(payload.layout)
      }
    }
    backendCtx.onBackendMessage(handler)
    backendCtx.sendToBackend({ type: 'LOAD_LAYOUT' })
    // Safety timeout: if the backend never responds (e.g. corrupt storage),
    // resolve with null so the mount proceeds with defaults rather than
    // hanging the extension. 2s is enough for the file I/O round-trip on
    // a warm cache; longer waits mask real bugs.
    setTimeout(() => resolve(null), 2000)
  })
}

export function applyLayout(layout: any) {
  if (!layout) return

  // Restore secondary sidebar width
  if (layout.secondary?.width) {
    document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${layout.secondary.width}px`)
    // Phase 3 (finding #13): createSecondarySidebar already initialized the
    // wrapper transform with the right width on mount (see the options
    // parameter). No animateWrapper call needed here — that would re-trigger
    // the close animation and cause a flicker. The conditional animateWrapper
    // below is kept as a safety net for the case where applyLayout is called
    // without a prior mountSecondarySidebar(layout) (e.g. from a future
    // "reload layout" debug action that runs after setup).
    if (getSecondaryWrapper() && !isSecondarySidebarOpen()) {
      const currentTransform = getSecondaryWrapper()!.style.transform?.match(/-?[\d.]+/)?.[0]
      // Compare against the sign-aware closed transform. The saved width is
      // always positive, but the rendered transform carries a sign
      // (+width when sec is on the right, -width when sec is on the left),
      // so a direct string match against the saved width would always
      // differ when the secondary is on the left. Use the same sign logic
      // as getClosedTransformPx to compute the desired closed value.
      const desiredClosed = getMainDrawerSide() === 'right'
        ? -layout.secondary.width
        : layout.secondary.width
      if (currentTransform !== String(desiredClosed)) {
        animateWrapper(desiredClosed)
      }
    }
  }

  // Restore tab assignments
  if (layout.detachedTabs?.length) {
    // Wait for extension tabs to register, then restore.
    // Phase 2: match by stable tabId only. Title fallback was removed because
    // tabTitle can drift across sessions (e.g. "LumiBooks" → "LumiBooks v2")
    // and was the source of the "Hone / Prompt Inspector unreliable" symptom.
    // If a stored tabId is no longer in the store (extension uninstalled or
    // id schema changed), we warn and skip — the user can clean up via the
    // future "reset layout" action.
    //
    // Phase 3 (finding #5): polling loop now calls the lighter restore path
    // (set state + update buttons + DOM move) directly, NOT assignTab. This
    // avoids the policy-layer side effects: assignTab would call
    // switchMainDrawerToFallback (which manipulates the main drawer that's
    // already in its saved state) and persistLayout (we just LOADED this
    // layout, no need to write it back).
    //
    // Phase 4.0 (suffix-drift fallback): Lumiverse assigns a session-variant
    // suffix (`:1`, `:2`, `:3`) to extension tab ids in the order they're
    // registered. The suffix in the live DOM is NOT the same as the one in
    // layout.json after a session restart — e.g. layout says
    // `prompt-viewer:2` but live is `prompt-viewer:1`. An exact-match-only
    // restore leaves the user with empty secondary panels after a restart.
    // Fix: if an exact match fails, strip the last `:N` from both the stored
    // id and each live id, and match by the stripped prefix. If exactly one
    // live id matches, use it AND rewrite the stored id in the in-memory
    // layout (so the next persistLayout write self-heals). If multiple live
    // ids match, the stripped prefix is too coarse — warn and skip.
    const stripSuffix = (id: string): string => {
      const lastColon = id.lastIndexOf(':')
      if (lastColon <= 0) return id
      const tail = id.slice(lastColon + 1)
      return /^\d+$/.test(tail) ? id.slice(0, lastColon) : id
    }
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      const tabs = getDrawerTabs()
      for (let i = 0; i < layout.detachedTabs.length; i++) {
        const dt = layout.detachedTabs[i]
        if (hasTabAssignment(dt.tabId)) continue
        // Try exact match first
        let tab = tabs.find(t => t.id === dt.tabId)
        let usedFallback = false
        if (!tab) {
          // Exact match missed — try stripped-suffix match
          const storedPrefix = stripSuffix(dt.tabId)
          const candidates = tabs.filter(t => stripSuffix(t.id) === storedPrefix)
          if (candidates.length === 1) {
            tab = candidates[0]
            usedFallback = true
            dlog(`applyLayout: suffix-drift fallback matched stored "${dt.tabId}" → live "${tab.id}"`)
            // Self-heal: rewrite the in-memory layout so the next persistLayout
            // call stores the live id. No additional save here — the rewrite
            // only takes effect when the user makes another change that
            // triggers persistLayout (open/close, move another tab, etc.).
            layout.detachedTabs[i] = { ...dt, tabId: tab.id }
          } else if (candidates.length > 1) {
            // Ambiguous — multiple live tabs share this stripped prefix.
            // This shouldn't happen in practice (the prefix includes the
            // extension uuid), but log defensively.
            dwarn(`applyLayout: stripped-suffix match for "${dt.tabId}" is ambiguous (${candidates.length} candidates). Skipping.`)
          }
        }
        if (tab) {
          // Lightweight restore: state + button affordances + DOM move.
          // No save (we just loaded). No open/close cascade (mount handled it).
          getTabAssignments().set(tab.id, 'secondary')
          hideMainTabButton(tab.id)
          addSecondaryTabButton(tab)
          updateDrawerTabVisibility()
          repositionTabToSecondary(tab.id)
        } else if (!usedFallback) {
          // Once we've tried a few times and the id is still missing, surface
          // a visible warning. The first few attempts may simply be racing
          // the store's tab registration.
          if (attempts === 5) {
            const knownIds = tabs.map(t => t.id)
            dwarn(`applyLayout: stored detached tabId "${dt.tabId}" not found in store (and no suffix-drift match). Known ids: ${knownIds.join(', ')}. Layout may be stale.`)
          }
        }
      }
      if (attempts > 20 || layout.detachedTabs.every((dt: any) => hasTabAssignment(dt.tabId))) {
        clearInterval(interval)
        // Phase 4 (finding #2): if at least one tab was restored, pick the
        // first one as the active secondary tab. Without this, the
        // secondary panel header stays empty when the user opens the
        // drawer (showSecondaryTab was never called from the lightweight
        // restore path to avoid double-animating the active tab).
        // The first-tab pick is a reasonable default — the user can click
        // any tab button to switch. Future work: persist the active
        // secondary tab id in layout.json so we restore the exact one.
        const restored = layout.detachedTabs.find((dt: any) => hasTabAssignment(dt.tabId))
        if (restored) {
          showSecondaryTab(restored.tabId)
        }
        // Phase 3 (finding #5): the end-of-interval open/close block is gone.
        // The drawer's open/closed state was set at mount time via the
        // initialOpen option on createSecondarySidebar, so by the time we get
        // here the wrapper is already in the correct position. This is the
        // "fully open from the first paint" requirement.
        //
        // Safety net kept for the case where applyLayout is called WITHOUT a
        // prior mountSecondarySidebar(layout) — e.g. a future "reload layout"
        // debug action that re-applies after a session tweak.
        if (layout.secondary?.open === true && !isSecondarySidebarOpen()) {
          openSecondarySidebar()
        } else if (layout.secondary?.open === false && isSecondarySidebarOpen()) {
          closeSecondarySidebar()
        }
      }
    }, 500)
  }
}
