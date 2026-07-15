# Canvas Code Review Plan: "Judo Moves"

> Finding places where the same behavior can be accomplished with a much more architecturally sound and elegant approach.

## Status

| Move | Description | Status |
|------|-------------|--------|
| 1 | tab-list-dnd.ts — Ad-hoc State Machine → Discriminated Union | ✅ Complete |
| 2 | drawer-sync.ts — Observer Explosion → Unified Observation Bus | ✅ Complete |
| 3 | main-persist.ts — Polling Restore → Promise-based Settlement | ✅ Complete |
| 4 | configure-commit.ts — Imperative Pipeline → Command Queue | ✅ Complete |
| 5 | configure-modal.tsx — useEffect Orchestration → State Machine | ✅ Complete |
| 6 | drawer-sync.ts — Side Settle Polling → One-shot MutationObserver Predicate | ✅ Complete |
| 7 | main-tab-pin.ts — Pin/Unpin Cascade → Transactional State | Pending |
| 8 | shared.ts — Utility Functions → Domain-Specific Modules | Pending |

## Methodology

Reviewed all source files with programmatic complexity analysis (state vars, timers, observers, rAF calls) across 153 TypeScript files (~48.5K lines). Identified hotspots by code density (operations per line), then read full implementations to understand coordination patterns.

## Anticipated Failure Modes

Before diving into individual moves, here are the top ways this refactor breaks things — the "I just implemented this and stuff broke" guesses:

1. **Drag gets stuck in non-idle phase.** If any transition path throws before setting `phase = 'idle'`, all future drags are dead. The current code's "reset 30 fields" approach is messy but self-healing: `cleanupDragVisuals()` runs on pointerup regardless.

2. **Observer coalescing drops a side-change signal.** If a resize and side-change fire in the same rAF frame, they get coalesced. But the side-change path calls `checkSideChanged()` (shell remounts) — heavier than a simple sync. The bus must distinguish heavy from light signals.

3. **Promise-based restore surfaces silent failures.** The current code checks `_stopped` at 5+ points and silently bails. Promises reject or resolve — if the caller doesn't handle rejections, you get unhandled promise warnings. The `finish()` function runs `unsuppressMainDrawer()` inside two nested rAFs; if the Promise resolves before those rAFs fire, the UI reveals before content is painted.

4. **Dynamic import moved to module top-level.** The current code does `void import('./main-mirror-drawer').then(...)` inside `run()`, called lazily on visibility change. If hoisted to top-level, startup latency increases and the mirror module loads even when the user never switches tabs.

5. **Command queue rollback persists config that can't be undone.** Step 3 (`persistConfig`) writes to disk. Step 5 fails. Rollback can't un-write the file. Now persisted config says one thing but UI shows another. The current code doesn't have rollback, so this is a *new* failure mode.

6. **rAF settle loop replaced but hard-timeout semantics lost.** When the hard timeout fires in `settleMainDrawerSideDom`, the code keeps the override and stamps `_lastKnownSide = desired`. A naive Promise-based replacement might reject on timeout, clearing the override — the exact thing the current code avoids because it causes "reverse remounts."

7. **Draft manager API doesn't support drag-to-reorder.** The modal's drag-and-drop modifies the draft array in-place during drag (for live preview). If the draft manager's `moveTab()` creates a new array (immutable update), the drag preview stutters because the component re-renders on every pointer move.

---

## 1. tab-list-dnd.ts — Ad-hoc State Machine → Discriminated Union

**Current state:** 30+ module-level mutable variables (`let _isDragging`, `_dragTabId`, `_dragElement`, `_dragFromSecondary`, `_dragOverlay`, `_dragOverlayInner`, `_dragOffsetX`, `_dragOffsetY`, `_lastDropTarget`, `_insertIndicatorEl`, `_moveHandler`, `_upHandler`, `_clickSuppressor*` ×4, `_rafId`, `_pendingPointerX/Y`, `_overlayTx/Ty`, `_overlayWidth/Height`, `_originalParent/NextSibling`, `_sourceIsInCanvasList`, `_settleTimer`, `_geometryCache`, `_geomDirty`, `_flipPrevRects`, `_flipActiveTimer`). These form an implicit state machine where illegal combinations are possible (e.g., `_isDragging=true` but `_dragTabId=null`).

**Judo move:** Single state object with discriminated union:

```typescript
type DragState =
  | { phase: 'idle' }
  | { phase: 'arming'; tabId: string; pointerX: number; pointerY: number; armTimer: number }
  | { phase: 'dragging'; tabId: string; element: HTMLElement; fromSecondary: boolean; overlay: HTMLElement; ... }
  | { phase: 'settling'; tabId: string; settleTimer: number }
  | { phase: 'dropping'; tabId: string; targetId: string; position: 'before' | 'after' | 'inside' }

let _drag: DragState = { phase: 'idle' }
```

**Why it's better:**
- Illegal states become unrepresentable (can't have `phase: 'dragging'` without a `tabId`)
- Cleanup is just `_drag = { phase: 'idle' }` — no need to reset 30 fields
- State transitions are explicit and auditable
- Each phase's required data is guaranteed present

**Failure modes:**
- **Stuck drag.** If `performDrop()` or `cancelDrag()` throws before resetting phase, all future drags are dead. The current code's 30-field reset is ugly but runs regardless.
- **Click suppressor timing.** The 4 `_clickSuppressor*` vars interact with drag state via `setTimeout`. If they're part of the state object, the click suppressor's timing might change when the state object is replaced.
- **FLIP animation data.** `_flipActiveTimer`, `_geometryCache`, `_flipPrevRects` are used during drag for FLIP animations. If they're part of the `dragging` phase, they get cleaned up when transitioning to `settling` — but FLIP animations may still be running.

**Mitigations:**
- Wrap all state transitions in `try/finally` to guarantee reset to idle:
  ```typescript
  function withDragState<T>(fn: () => T): T {
    try { return fn() }
    finally { _drag = { phase: 'idle' } }
  }
  ```
- Keep click suppressor as a separate module-level variable (it's orthogonal to drag phase)
- Keep FLIP animation data as a separate module-level variable, or add a `flipping` sub-phase
- Add a `resetDragState()` function that's called in `cleanupAll()` as a safety net

**Edge cases:**
- `cancelDrag()` called during `arming` phase (before `startDrag` fires)
- `performDrop()` called when `_drag.phase !== 'dragging'` (race with cancel)
- Tab list mutation during drag (host React re-renders replacing the dragged element's parent)
- Exception thrown inside `performDrop()` — must still reset to idle

**Impact:** High — eliminates the largest source of implicit state coupling in the codebase.

---

## 2. drawer-sync.ts — Observer Explosion → Unified Observation Bus

**Current state:** 4 separate observers per connection (`ResizeObserver` for secondary, `MutationObserver` for class changes, `MutationObserver` for style changes, `MutationObserver` for side changes), each calling into shared mutable state (`_lastKnownSide`, `_lastKnownVerticalPos`, `_syncPending`, `_lastWrittenDrawerTabVars`, etc.). The `syncDrawerTabSettings()` function is called from all observers, with coalescing via `_syncPending` flag. (Historical comments reference a 2s polling interval that has been replaced by MutationObserver-based detection.)

**Judo move:** Single `ObserverCoordinator` that batches all DOM change signals:

```typescript
class ObserverCoordinator {
  private pending = new Map<string, unknown>()  // kind → payload
  private frame: number | null = null

  signal(kind: string, payload?: unknown) {
    this.pending.set(kind, payload ?? null)
    if (this.frame === null) {
      this.frame = requestAnimationFrame(() => {
        this.frame = null
        const entries = [...this.pending]
        this.pending.clear()
        this.flush(entries)
      })
    }
  }

  private flush(entries: [string, unknown][]) {
    // Single sync pass that considers all change kinds
    syncDrawerTabSettings(entries)
  }
}
```

**Why it's better:**
- Eliminates the `_syncPending` flag and the "who called me" parameter to `syncDrawerTabSettings`
- Guarantees exactly one sync per animation frame regardless of how many observers fire
- Makes the observation → sync pipeline explicit and testable
- Removes the need for any residual polling safety nets (observers cover all cases)

**Failure modes:**
- **Side-change coalesced with resize.** The side-change observer fires `checkSideChanged()` which triggers shell remounts. If coalesced with a resize signal, the remount might get skipped or the resize signal might mask it. The bus must prioritize side-change as a "heavy" signal that gets its own handler.
- **Resize payload lost.** The resize observer for secondary drawer needs the entry's `contentBoxSize`. If coalesced with class-change mutations, that data is lost. The bus must carry payloads, not just signal kinds.
- **Observer fires after stop.** If `stop()` is called but `disconnect()` hasn't completed, the observer may fire and schedule a rAF that runs after cleanup. Need to check a `_stopped` flag in the rAF callback.

**Mitigations:**
- Use a `Map<string, unknown>` instead of `Set<string>` to carry payloads (resize entry, mutation records)
- Classify signals as `heavy` (side-change, needs `checkSideChanged`) vs `light` (class/style, needs `syncDrawerTabSettings`). Heavy signals always get their own handler.
- Add a `_stopped` check inside the rAF callback before flushing
- Keep the `_syncPending` pattern as a fallback: if the bus is stopped, the flag prevents stale syncs

**Edge cases:**
- Host replaces wrapper element (React remount) — observer needs rebind
- Multiple observer types fire in same microtask (resize + class change)
- Observer fires after `stop()` but before `disconnect()` completes
- Side-change observer fires during a resize-induced sync (race)

**Impact:** Medium-high — reduces observer count from 4+ per connection to 1, eliminates polling.

---

## 3. main-persist.ts — Polling Restore → Promise-based Settlement

**Current state:** `scheduleRestoreTabThenUnsuppress` (lines 523-671) uses nested closures with shared mutable state (`polls`, `stable`, `contentSettled`, `watchingContent`, `finished`) and a manual polling loop (`setTimeout(poll, RESTORE_TAB_POLL_MS)`). The function re-clicks the target tab every 3 polls and uses MutationObserver for content settle detection.

**Judo move:** Replace polling with `Promise.race` + settle detection:

```typescript
async function restoreTab(targetTabId: string, preferMirror: boolean): Promise<void> {
  const settle = waitForSettle(targetTabId, { timeout: RESTORE_TAB_POLL_MAX * RESTORE_TAB_POLL_MS })
  const clickLoop = clickUntilActive(targetTabId, preferMirror, { interval: RESTORE_TAB_POLL_MS * 3 })

  await Promise.race([settle, clickLoop.timeout()])
  clickLoop.stop()
  await unsuppressAfterTwoPaints()
}
```

**Why it's better:**
- Eliminates the 5 nested closures and their shared mutable state
- Makes the timeout/settle/click-loop independent and composable
- The `finished` flag becomes unnecessary (Promise resolves once)
- Error handling is via try/catch instead of scattered `if (_stopped)` checks

**Failure modes:**
- **Unhandled rejection on stop.** The current code checks `_stopped` at 5+ points and silently bails. A Promise-based version would reject on stop — if the caller doesn't handle rejections, you get unhandled promise warnings. The UI would flash or show stale content.
- **Premature reveal.** The `finish()` function runs `unsuppressMainDrawer()` inside two nested rAFs. If the Promise resolves before those rAFs fire (e.g., settle observer fires immediately), the UI reveals before content is painted.
- **Lazy import lost.** The mirror module is dynamically imported inside `run()`. If hoisted to a top-level import during the refactor, startup latency increases.
- **Cleanup on timeout.** The current `finish()` calls `stopContentSettleWatch()`. If the Promise-based version doesn't clean up the observer on timeout, it leaks.

**Mitigations:**
- Never reject — always resolve, even on stop. Use `AbortSignal` for cancellation:
  ```typescript
  async function restoreTab(targetTabId: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return
    // ...
  }
  ```
- Wrap `unsuppressAfterTwoPaints()` in its own Promise that resolves after two rAFs, so the outer Promise doesn't resolve until paints are done
- Keep the dynamic import inside the function body — don't hoist
- Use `Promise.race` with a cleanup function that stops the settle observer and click loop

**Edge cases:**
- `_stopped` becomes true during the settle wait
- Host tab never becomes active (timeout path)
- Content settle observer never fires (MutationObserver misses the change)
- Mirror module fails to load (network error on dynamic import)

**Impact:** Medium — simplifies one of the most complex restore flows, but the function is called infrequently (only on startup/visibility change).

---

## 4. configure-commit.ts — Monolithic Commit → Command Queue

**Current state:** `commitConfigureDraft` is 200+ lines with nested try/catch, multiple await points, generation counters (`_sideApplyGen`), quiet handoffs, and complex error recovery. The function orchestrates: tab-to-list syncing, side-change application, drawer tab variable syncing, config persistence, and UI state updates.

**Judo move:** Break into a command queue where each step is a discrete, composable command:

```typescript
type CommitStep = {
  name: string
  run: (ctx: CommitContext) => Promise<void>
  rollback?: (ctx: CommitContext) => Promise<void>
}

const commitSteps: CommitStep[] = [
  { name: 'sync-tabs', run: syncTabsToLists },
  { name: 'apply-side', run: applySideChange, rollback: revertSideChange },
  { name: 'sync-drawer-vars', run: syncDrawerVars },
  { name: 'persist-config', run: persistConfig },
  { name: 'update-ui', run: updateUIState },
]

async function commitConfigureDraft(draft: Draft): Promise<void> {
  const ctx = { draft, gen: ++_commitGen }
  for (const step of commitSteps) {
    try {
      await step.run(ctx)
    } catch (err) {
      // Rollback previous steps in reverse
      for (const prev of commitSteps.slice(0, commitSteps.indexOf(step)).reverse()) {
        await prev.rollback?.(ctx)
      }
      throw err
    }
  }
}
```

**Why it's better:**
- Each step is independently testable
- Rollback logic is explicit and composable
- The generation counter pattern becomes a single `ctx.gen` check at each step
- Error recovery doesn't need nested try/catch

**Failure modes:**
- **Rollback persists config that can't be undone.** `persistConfig` writes to disk. If a later step fails, rollback can't un-write the file. Now persisted config says one thing but UI shows another. The current code doesn't have rollback, so this is a *new* failure mode.
- **Quiet handoff not modeled.** The current code skips certain steps when only tab position changed (the "quiet handoff" pattern). If this isn't modeled as conditional step execution, the queue runs unnecessary steps.
- **Rollback order matters.** If `applySideChange` has side effects that `revertSideChange` doesn't fully undo (e.g., shell remount already started), the rollback may leave the UI in an inconsistent state.

**Mitigations:**
- Mark `persistConfig` as `irreversible: true` — it runs last and has no rollback. If it fails, the commit fails but previous steps are rolled back.
- Model quiet handoff as a `shouldRun` predicate on each step:
  ```typescript
  { name: 'apply-side', run: applySideChange, shouldRun: (ctx) => ctx.sideChanged }
  ```
- Document rollback semantics for each step. If a step can't be fully rolled back, note what state it leaves.
- Add a `commitFailed` hook that logs the partial state for debugging.

**Edge cases:**
- Concurrent commits (generation counter discard)
- Step fails after partial side effects (e.g., side changed but config not persisted)
- User cancels modal mid-commit
- Rollback itself throws (need catch-inside-catch)

**Impact:** Medium — the commit function is complex but called infrequently (only on modal save).

---

## 5. configure-modal.tsx — Monolithic Component → Extracted Draft Manager

**Current state:** 1595 lines for a single Preact modal component. Manages draft state (`useSignal<Draft>`), two column lists (drawer tabs, assignment candidates), drag-and-drop within the modal, auto-save with debounce, mode switching (Settings vs Configure), and commit coordination.

**Judo move:** Extract the draft management into a custom hook or separate module:

```typescript
// configure-draft.ts
export function createDraftManager(initialDraft: Draft) {
  const draft = signal(initialDraft)
  const dirty = signal(false)

  return {
    draft,
    dirty,
    addTab: (tabId: string, list: 'drawer' | 'assignment') => { ... },
    removeTab: (tabId: string) => { ... },
    moveTab: (tabId: string, from: number, to: number) => { ... },
    commit: () => commitConfigureDraft(draft.value),
    reset: () => { draft.value = initialDraft; dirty.value = false },
  }
}
```

**Why it's better:**
- The modal component becomes a thin view layer (~500 lines)
- Draft logic is testable without rendering the modal
- The draft manager can be reused by other UIs (e.g., keyboard-driven configure)
- Auto-save debounce logic moves into the manager

**Failure modes:**
- **Drag preview stutters.** The modal's drag-and-drop modifies the draft array in-place during drag (for live preview). If `moveTab()` creates a new array (immutable update), the component re-renders on every pointer move, causing stutter. The current code mutates `.value` directly for performance.
- **Mode switching leaks into draft manager.** The mode switching (Settings vs Configure) affects which tabs are visible and what operations are allowed. This logic may not cleanly separate from the draft.
- **Commit during drag.** If the user drags a tab and then clicks "Save" before releasing, the draft is in an inconsistent state (tab moved but not committed to the list).

**Mitigations:**
- Use mutable array operations in `moveTab()` for drag preview, then create a new array only on drop:
  ```typescript
  moveTab(tabId: string, from: number, to: number, { preview = false } = {}) {
    if (preview) {
      // Mutate in-place for drag preview (no re-render)
      draft.value.tabs.splice(from, 0, draft.value.tabs.splice(to, 1)[0])
    } else {
      // New array on drop (triggers re-render)
      const tabs = [...draft.value.tabs]
      tabs.splice(from, 0, tabs.splice(to, 1)[0])
      draft.value = { ...draft.value, tabs }
    }
  }
  ```
- Keep mode switching in the modal component — it's UI state, not draft state
- Disable "Save" button during drag (check `_drag.phase !== 'idle'`)

**Edge cases:**
- Draft modified while commit is in progress
- Modal closed with unsaved changes
- Tab list changes externally while modal is open
- Drag-and-drop within the modal vs between modal and main drawer

**Impact:** Medium — large file but straightforward UI logic. The real complexity is in the draft state management, which is well-modeled with signals.

---

## 6. drawer-sync.ts — Side Settle Polling → One-shot MutationObserver Predicate

**Current state:** `settleMainDrawerSideDom` (lines 704-742) is a manual rAF polling loop that waits for the host wrapper's class to match the desired side, with a hard timeout of 2500ms. Uses generation counter `_sideApplyGen` to detect stale applies.

**Judo move:** Replace polling with a one-shot MutationObserver that resolves when the predicate is met:

```typescript
function waitForSideSettle(desired: 'left' | 'right', gen: number): Promise<void> {
  return new Promise((resolve) => {
    if (gen !== _sideApplyGen) { resolve(); return }

    const wrapper = getMainWrapper()
    if (!wrapper) { resolve(); return }

    // Check immediately
    if (readMainWrapperSideFromDom() === desired) {
      setMainDrawerSideOverride(null)
      resolve()
      return
    }

    const observer = new MutationObserver(() => {
      if (gen !== _sideApplyGen) { observer.disconnect(); resolve(); return }
      if (readMainWrapperSideFromDom() === desired) {
        observer.disconnect()
        setMainDrawerSideOverride(null)
        resolve()
      }
    })
    observer.observe(wrapper, { attributes: true, attributeFilter: ['class'] })

    // Hard timeout — resolve, don't reject. Keep override.
    setTimeout(() => {
      observer.disconnect()
      if (gen !== _sideApplyGen) { resolve(); return }
      _lastKnownSide = desired
      dwarn(`[drawer-sync] side did not settle within ${SIDE_SETTLE_HARD_MS}ms`)
      resolve()
    }, _sideSettleHardMs)
  })
}
```

**Why it's better:**
- Eliminates the rAF polling loop and its manual frame counting
- MutationObserver fires exactly when the class changes (no wasted frames)
- The timeout is a simple `setTimeout` instead of a loop condition
- The Promise is composable with `Promise.race` if needed

**Failure modes:**
- **Hard timeout clears override.** If the Promise rejects on timeout (instead of resolving), the caller might clear the override — the exact thing the current code avoids because it causes "reverse remounts."
- **Wrapper replaced during settle.** If the host replaces the wrapper element (React remount) while the observer is watching, the observer is attached to a disconnected node. The new wrapper's class won't be observed.
- **reconcileSideOverrideFromDom ordering.** The current code calls `reconcileSideOverrideFromDom()` before `checkSideChanged` in the MO path. If this ordering changes, the side override might not be cleared properly.

**Mitigations:**
- Always resolve, never reject. The hard timeout resolves with a warning but keeps the override.
- Add a wrapper rebind check inside the observer callback:
  ```typescript
  const observer = new MutationObserver(() => {
    if (gen !== _sideApplyGen) { observer.disconnect(); resolve(); return }
    // Rebind if wrapper was replaced
    if (!wrapper.isConnected) {
      observer.disconnect()
      const newWrapper = getMainWrapper()
      if (newWrapper) observer.observe(newWrapper, { attributes: true, attributeFilter: ['class'] })
      return
    }
    if (readMainWrapperSideFromDom() === desired) {
      observer.disconnect()
      setMainDrawerSideOverride(null)
      resolve()
    }
  })
  ```
- Preserve `reconcileSideOverrideFromDom()` call before `checkSideChanged` in the new code

**Edge cases:**
- Wrapper replaced while waiting for settle
- Multiple side changes in quick succession (generation counter)
- DOM class changes but to the wrong side (e.g., both wrapperLeft and wrapperRight removed)
- Observer fires on a disconnected node

**Impact:** Low-medium — simplifies one function but the function is called infrequently.

---

## 7. Cross-file State Coordination → Central Context

**Current state:** Multiple files coordinate through module-level state accessed via imports from `./shared.ts` and direct store access (`getSettings()`, `getHostDrawerSettings()`, `getStoreSnapshot()`, `getTabAssignments()`). Some files dynamically import others (`tab-list-dnd.ts` → `configure-modal`, `second-drawer-mode.ts` → `configure-modal`).

**Judo move:** A central `CanvasContext` that all modules read from:

```typescript
export interface CanvasContext {
  settings: Signal<CanvasSettings>
  hostDrawerSettings: Signal<HostDrawerSettings | null>
  tabAssignments: Signal<TabAssignment[]>
  mainDrawerState: Signal<MainDrawerState>
  // ... etc
}

// Each module receives the context in its init() or mount() hook
export const canvasContext: CanvasContext = {
  settings: signal(getSettings()),
  hostDrawerSettings: signal(getHostDrawerSettings()),
  // ...
}
```

**Why it's better:**
- Eliminates circular import risk (modules import from context, not from each other)
- Makes state dependencies explicit (each module declares what it reads)
- Enables testing with mock context
- Reduces the number of module-level mutable variables

**Failure modes:**
- **Stale context reads.** If a module reads a context value that's stale (signal not yet updated), it makes wrong decisions. This is especially dangerous for settings that affect layout (drawer side, secondary drawer mode).
- **Context initialization order.** If modules read context before it's initialized, they get undefined values. The current code's `getSettings()` call is synchronous and always returns a value.

**Mitigations:**
- Initialize context synchronously in `initCanvas()`, before any module mounts
- Use `.peek()` instead of `.value` for settings reads (avoids unnecessary subscriptions)
- Document which context values are safe to read during init vs mount

**Edge cases:**
- Context updated before all modules are initialized
- Module reads context value that's stale (signal not yet updated)
- Testing with mock context requires careful setup

**Impact:** Low — this is more of a long-term architectural improvement than a specific judo move.

---

## 8. main-tab-pin.ts — Observer-based Sync → Diff-and-patch

**Current state:** 934 lines managing main-mirror tab list synchronization with host tabs via observers. Uses MutationObserver to detect host tab list changes, then syncs the mirror tab list to match.

**Judo move:** Use a diff-and-patch approach instead of observer-triggered full sync:

```typescript
function syncMirrorTabs(hostTabs: TabInfo[], mirrorTabs: TabInfo[]) {
  const diff = computeDiff(mirrorTabs, hostTabs)
  for (const op of diff) {
    switch (op.type) {
      case 'insert': insertMirrorTab(op.tab, op.index); break
      case 'remove': removeMirrorTab(op.tabId); break
      case 'move': moveMirrorTab(op.tabId, op.from, op.to); break
    }
  }
}
```

**Why it's better:**
- Diff is computed once, not scattered across observer callbacks
- Each operation is independent and testable
- The diff can be logged for debugging
- Reduces the number of observer callbacks and their coordination

**Failure modes:**
- **Diff recomputed on every change.** The current observer-based approach reacts to specific DOM changes (e.g., "a tab was added"). The diff approach recomputes the full diff on every change. For large tab lists (20+ tabs), this could be slower.
- **Tab re-render on insert.** Inserting a tab triggers a re-render. If the diff inserts multiple tabs, the re-render fires multiple times. The current code may batch these.
- **Host tab list changes during diff.** If the host tab list changes while the diff is being applied, the diff becomes stale and may apply incorrect operations.

**Mitigations:**
- Batch diff operations into a single DOM mutation:
  ```typescript
  function syncMirrorTabs(hostTabs: TabInfo[], mirrorTabs: TabInfo[]) {
    const diff = computeDiff(mirrorTabs, hostTabs)
    if (diff.length === 0) return
    // Apply all operations, then trigger a single re-render
    for (const op of diff) applyOp(op)
    triggerRerender()
  }
  ```
- Debounce the sync to avoid recomputing on rapid changes
- Use a generation counter to detect stale diffs

**Edge cases:**
- Host tab list changes while diff is being applied
- Tab list has duplicate IDs (shouldn't happen but defensive)
- Mirror tab list is empty (first sync)
- Tab ordering differs but tab set is the same (reorder vs replace)

**Impact:** Medium — simplifies the tab sync logic but may have performance implications.

---

## Prioritization

| # | Move | Impact | Feasibility | Risk | Failure Modes |
|---|------|--------|-------------|------|---------------|
| 1 | tab-list-dnd.ts → Discriminated Union | High | Medium | Medium | Stuck drag, click suppressor timing, FLIP data |
| 2 | drawer-sync.ts → Observer Bus | High | Medium | Medium | Side-change coalescing, payload loss, stop race |
| 3 | main-persist.ts → Promise-based Restore | Medium | High | Low | Unhandled rejection, premature reveal, lazy import |
| 4 | configure-commit.ts → Command Queue | Medium | Medium | Medium | Irreversible rollback, quiet handoff, rollback order |
| 5 | configure-modal.tsx → Extract Draft Manager | Medium | High | Low | Drag stutter, mode leak, commit during drag |
| 6 | drawer-sync.ts → One-shot Settle | Low-Med | High | Low | Hard timeout clears override, wrapper replaced |
| 7 | Cross-file → Central Context | Low | Low | High | Stale reads, init order |
| 8 | main-tab-pin.ts → Diff-and-patch | Medium | Medium | Medium | Diff perf, re-render batching, stale diff |

**Recommended order:** 1 → 5 → 3 → 6 → 2 → 4 → 8 → 7

Start with the highest-impact, most-contained changes (discriminated union for drag state, extracted draft manager), then work outward to the more interconnected changes (observer bus, command queue).

---

## Testing Strategy

- **Existing tests:** Run `npm run test` after each change to verify no regressions. There are 15 test files across `src/slash/__tests__/`, `src/dom/__tests__/`, `src/store/__tests__/`, `src/chat/__tests__/`, `src/tabs/__tests__/`.
- **Type safety:** TypeScript compiler catches many category errors (discriminated unions are exhaustive-checked).
- **Manual testing:** Each judo move affects specific user flows:
  1. Drag-and-drop tabs between main and secondary drawers
  2. Open/close drawers, change drawer side
  3. Configure modal open, edit, save, cancel
  4. Extension startup/restore
  5. Tab pinning/unpinning
- **Snapshot tests:** For state machine transitions, snapshot the state object after each transition.
- **Integration tests:** For the observer bus, test that all observer types trigger a sync within one animation frame.
- **Regression tests for failure modes:** For each anticipated failure mode, write a test that reproduces the failure (e.g., throw inside `performDrop()` and verify drag state resets to idle).

---

## Edge Cases to Watch

1. **Race conditions:** Multiple rapid state changes (drag start → cancel → drag start)
2. **Cleanup completeness:** Every state transition must clean up previous state, including on exception
3. **Observer rebind:** Host React remounts can replace DOM elements, requiring observer rebind
4. **Generation counters:** Stale operations must be discarded (not just ignored)
5. **Dynamic imports:** Circular dependency resolution timing — keep imports lazy
6. **CSS class detection:** Host uses hashed CSS module classes, matched by substring
7. **Settings lag:** Host Zustand store updates may lag behind DOM changes
8. **Irreversible side effects:** Config persistence, shell remounts — can't be rolled back
9. **Render batching:** Multiple DOM mutations should be batched into a single re-render
10. **Abort signals:** Long-running operations (restore, settle) need cancellation support
