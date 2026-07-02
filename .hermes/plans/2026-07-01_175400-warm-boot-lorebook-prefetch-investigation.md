# Investigation: Warm-boot lorebook dropdown empty — pendingActiveTabReset preempts panel's loadBooks()

> **For Hermes:** This is an INVESTIGATION plan, not an implementation plan. Two prior plans shipped three commits (`f4650ec`, `5e4672a`, `4e8ec75`) for the cold-boot fix and one diagnostic commit (`aab95ad`) for the warm-boot case. Then two more attempts in this session (`ec00327`, `dc910bd`, `9c2a03f`) failed silently. This plan documents the **confirmed root cause** and proposes a minimal fix; another agent will execute.

**Goal:** Restore the Lorebook dropdown data on warm-boot restore from `layoutPersistence`. The Lorebook panel's books-list fetch never fires on warm-boot, leaving the dropdown empty after reload.

---

## Live progress

| Task | Title | Status | Commit / Evidence |
| --- | --- | --- | --- |
| 1 | Cold-boot fix (shipped) | ✅ done | `f4650ec` `5e4672a` `4e8ec75` |
| 2 | Diagnostic breadcrumbs for warm-boot path (shipped) | ✅ done | `aab95ad` |
| 3 | Custom fiber-store helper attempt (failed — fiber walker unreliable at warm-boot) | ❌ reverted | `ec00327` (kept in history) |
| 4 | ensureBuiltInTabActiveInMain attempt (failed — panel mounts with wrong `isVisible`) | ❌ superseded | `dc910bd` |
| 5 | Diagnostic `console.log` breadcrumbs (still deployed for ground-truth) | 🟡 partial | `00094e7` |
| 6 | Diagnostic pre/post-click class checks (confirmed click works) | 🟡 partial | `9c2a03f` |
| 7 | Fix: delay `requestTabLocation` so panel's first effect commits with `drawerTab='lorebook'` | ⏳ not started | – |

---

## 1. Original goal (unchanged across plans)

Restore Lorebook (and any other built-in tab moved to secondary) dropdown data on warm-boot restore. The cold-boot right-click "Move to second drawer" path works; the warm-boot restore from `layoutPersistence` does not.

---

## 2. What we know with HIGH confidence (re-confirmed via `9c2a03f` diagnostics)

### The Lorebook panel's loadBooks is gated on `isVisible`

`Lumiverse/frontend/src/components/panels/world-book/WorldBookPanel.tsx:165-178`:

```ts
const isVisible = drawerOpen && drawerTab === 'lorebook'
const wasVisibleRef = useRef(false)
const prevModalRef = useRef<string | null>(activeModal)
useEffect(() => {
  const becameVisible = isVisible && !wasVisibleRef.current
  ...
  if (becameVisible || worldBookEditorClosed) {
    void loadBooks()
  }
  wasVisibleRef.current = isVisible
  prevModalRef.current = activeModal
}, [activeModal, isVisible, loadBooks])
```

The books-list fetch (the one populating `bookPickerOptions` at line 113-116) only fires on `isVisible` false→true transition. On cold-boot, `ensureBuiltInTabActiveInMain` (`src/tabs/assignment.ts:119`) clicks the main button to set `drawerOpen=true, drawerTab='lorebook'` via Lumiverse's React onClick handler — this satisfies the gate. On warm-boot, no click happens, so the gate is never satisfied.

### The cold-boot fix and its mechanism

`src/tabs/assignment.ts:234`: `await ensureBuiltInTabActiveInMain(tabId)` runs BEFORE `bridge.ui.requestTabLocation` in `assignTab`'s built-in branch. The helper:
1. Calls `findMainTabButton(tabId)` to get the main-drawer button (DOM querySelector — works because the main sidebar's button has `data-tab-id="lorebook"`).
2. Calls `btn.click()` to trigger Lumiverse's React onClick.
3. Waits one `requestAnimationFrame` for React to commit.
4. Calls `bridge.ui.getBuiltInTabRoot(tabId)` to confirm the panel mounted.

The `btn.click()` is the **proven mechanism** to flip `drawerOpen`/`drawerTab` via Lumiverse's event system. The Lumiverse store does not expose a `setDrawerTab`/`openDrawer` action via the spindle bridge (`Lumiverse/frontend/src/lib/spindle/loader.ts:472-535` exposes only `getBuiltInTabRoot`/`getTabLocation`/`requestTabLocation`/`getBuiltInTabTitle`/`containers.*`).

### Diagnostic ground-truth from `9c2a03f` (THIS IS THE KEY EVIDENCE)

User's console output from the warm-boot path (filtered to `[Canvas-DIAG]` lines and the relevant dlogs):

```
[Canvas-DIAG] findMainTabButton tab=lorebook sidebar=present childButtons=26
[Canvas] [SecondaryDrawer] assigning lorebook to secondary (ext=unknown)
[Canvas] [canvas-debug] ASSIGN_SEC_BUILTIN_ENTER tab=lorebook hasStoreTab=false hasSecondaryContent=true
[Canvas] [canvas-debug] ASSIGN_SEC_BUILTIN_AFTER_DOM_LOOKUP tab=lorebook rootFound=false rootTagId=null
[Canvas-DIAG] WARMBOOT_LAZY_MOUNT_OK_before_ensure tab=lorebook
[Canvas-DIAG] ENSURE_ACTIVE_BEGIN tab=lorebook
[Canvas-DIAG] isTabActiveInMainDrawer tab=lorebook active={"state":"active","id":"Profile"}
[Canvas-DIAG] ENSURE_ACTIVE_isActive tab=lorebook isActive=false
[Canvas-DIAG] ENSURE_ACTIVE_isMobile tab=lorebook mobile=false
[Canvas-DIAG] findMainTabButton tab=lorebook sidebar=present childButtons=26
[Canvas-DIAG] ENSURE_ACTIVE_findBtn tab=lorebook btn=<BUTTON data-tab-id=lorebook class=_tabBtn_1pf93_207 _tabBtnLabeled_1pf93_224>
[Canvas-DIAG] ENSURE_ACTIVE_preClickClass tab=lorebook class=_tabBtn_1pf93_207 _tabBtnLabeled_1pf93_224
[Canvas-DIAG] ENSURE_ACTIVE_clicking tab=lorebook
[Canvas-DIAG] ENSURE_ACTIVE_clicked tab=lorebook awaiting rAF
[Canvas] applyLayout: LumiScript fallback matched stored "lorebook" via main button → live "lorebook"
[Canvas-DIAG] ENSURE_ACTIVE_postClickClass tab=lorebook class=_tabBtn_1pf93_207 _tabBtnLabeled_1pf93_224 _tabBtnActive_1pf93_233
[Canvas-DIAG] ENSURE_ACTIVE_afterRaf tab=lorebook about to call getBuiltInTabRoot
[Canvas-DIAG] ENSURE_ACTIVE_rootResult tab=lorebook root=null                         ← panel not mounted yet
[Canvas-DIAG] WARMBOOT_LAZY_MOUNT_OK_after_ensure tab=lorebook
[Canvas] [canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT tab=lorebook branch=LAZY_MOUNT_OK getBuiltInTabRootReturned=element
[Canvas] addSecondaryTabButton: id=lorebook title="Lorebook" iconSvg=true iconUrl=false shortName="Lore" showLabels=true
XHRGET http://localhost:9000/api/v1/settings/worldBookFolders
[HTTP/1.1 404 Not Found 9ms]                                                          ← useFolders fired (panel mounted)
                                                                                       ← NO world-books XHR ← loadBooks did NOT fire
```

**Interpretation:**
1. `preClickClass` → `postClickClass` adds `_tabBtnActive_1pf93_233`. **The click reached Lumiverse's React onClick handler.** `handleTabClick('lorebook')` ran. `setDrawerTab('lorebook')` + `openDrawer('lorebook')` updated the store. (Earlier hypothesis that the click was being swallowed was wrong.)
2. Helper's `getBuiltInTabRoot` returns `null` (panel not yet mounted). Wiring's subsequent `getBuiltInTabRoot` returns element (panel mounted by then).
3. `useFolders` effect fires unconditionally on mount → 404 XHR. **Panel mounted.**
4. **No `GET /api/v1/world-books` XHR.** `loadBooks()` did NOT fire. Panel mounted with `isVisible=false`.

### The actual root cause (refined from earlier speculation)

The `requestTabLocation` call (`secondary-drawer.ts:364`, the line after `getBuiltInTabRoot`) routes through Lumiverse's `bridge.ui.requestTabLocation` → `useStore.getState().moveTabTo(tabId, { kind: 'container', ... })`. **In Lumiverse's `Lumiverse/frontend/src/store/slices/spindle-placement.ts:389-401`:**

```ts
moveTabTo: (tabId: string, location: TabLocation) => {
  set((state) => {
    const next = { ...state.tabLocations, [tabId]: location }
    let pendingActiveTabReset = state.pendingActiveTabReset
    if (location.kind !== 'main-drawer') {
      pendingActiveTabReset = tabId                          // ← sets the reset flag
    }
    return { tabLocations: next, pendingActiveTabReset }
  })
}
```

The reset flag triggers a useEffect in `Lumiverse/frontend/src/components/panels/ViewportDrawer.tsx:117-123`:

```ts
useEffect(() => {
  if (!pendingActiveTabReset) return
  const fallback = allTabs.find((t) => t.id !== pendingActiveTabReset)
  setDrawerTab(fallback?.id ?? 'profile')                    // ← resets drawerTab to a fallback
  clearPendingReset()
}, [pendingActiveTabReset, allTabs, setDrawerTab, clearPendingReset])
```

**The race condition:**

| t | Step | Store state | Panel state |
| --- | --- | --- | --- |
| 0 | Helper clicks main button. `handleTabClick('lorebook')` fires. `setDrawerTab('lorebook')` + `openDrawer('lorebook')` scheduled. | `drawerOpen=true, drawerTab='lorebook'` (after React commits) | (not mounted yet) |
| 16ms | Helper awaits rAF. | same | (not mounted yet) |
| 16ms+ε | Helper calls `getBuiltInTabRoot('lorebook')` — `ensureRegistryRoot` mounts the panel root and schedules a render. | same | Panel root created, **render not yet committed** |
| 16ms+δ | Helper returns. Wiring calls `getBuiltInTabRoot(tabId)` again → returns element. Wiring calls `requestTabLocation(tabId, { container, ... })` → `moveTabTo` → `pendingActiveTabReset='lorebook'`. | `tabLocations['lorebook']={container}` + `pendingActiveTabReset='lorebook'` | Panel render still pending |
| 16ms+2δ | React commits the ViewportDrawer render caused by `pendingActiveTabReset`. Reset effect runs. `setDrawerTab('profile')` (fallback). | `drawerTab='profile'` | Panel render still pending |
| 16ms+3δ | React commits the panel's first render (from `mountReactComponent`). Panel reads `drawerOpen=true, drawerTab='profile'`. **`isVisible = true && 'profile' === 'lorebook' = false`.** Panel's `useEffect` runs with `isVisible=false`. `becameVisible = false`. `loadBooks` does NOT fire. | `drawerTab='profile'` | Panel mounted, **but books never fetched** |

The panel's `createRoot(root).render(<WorldBookPanel />)` (called from `ensureRegistryRoot` at `Lumiverse/frontend/src/lib/drawer-tab-registry.tsx:106`) creates a SEPARATE React root on the detached DOM element. **This detached root renders on a later tick than the main app's React tree.** By the time `<WorldBookPanel>` first reads from the Zustand store, the reset has already flipped `drawerTab` to a fallback. The panel's `isVisible` is false at first effect run. `loadBooks` never fires.

The single XHR (`worldBookFolders` 404) is `useFolders`'s unconditional mount effect. The missing XHR (`world-books`) is the gated `loadBooks` fetch. The `bookPickerOptions` dropdown stays empty because `books=[]` (initial state).

### Why earlier attempts failed

| Commit | Approach | Why it failed |
| --- | --- | --- |
| `ec00327` | `ensureBuiltInTabPanelLoaded` helper — calls `store.openDrawer`/`closeDrawer`/`setDrawerTab` directly via fiber-extracted Zustand snapshot. | The fiber walker (`src/store/index.ts:95`) is unreliable at warm-boot. "Could not find drawerTabs in fiber tree" warnings confirm. Helper bails silently. |
| `dc910bd` | Revert custom helper; call `ensureBuiltInTabActiveInMain` (the existing cold-boot helper) from `assignToSecondary`'s LAZY_MOUNT_OK branch. | Click DOES reach React (proven by `9c2a03f`'s `postClickClass` adding `tabBtnActive`), but `requestTabLocation`'s `pendingActiveTabReset` fires before the panel's first render commits, resetting `drawerTab` to a fallback. Panel mounts with `isVisible=false`. `loadBooks` does not fire. |

---

## 3. Open diagnostic questions (answered)

| Q | Answer |
| --- | --- |
| Q-DIAG-1: Does the cold-boot case request the same URLs with the same 404 pattern? | Yes. Cold-boot right-click works; Lorebook dropdown populates. The 404 on `worldBookFolders` is by-design and unrelated to the dropdown emptiness. |
| Q-DIAG-2: When Lorebook's React component remounts on warm-boot, what data flow populates its dropdown? | The `loadBooks` useEffect gated on `isVisible = drawerOpen && drawerTab === 'lorebook'` (panel.tsx:165-178). The `bookPickerOptions` dropdown (panel.tsx:113-116) derives from `books` state populated only by `loadBooks`. |
| Q-DIAG-3: Is the lorebook dropdown actually empty on cold-boot too? | No. Cold-boot works. Cold-boot uses `ensureBuiltInTabActiveInMain` (assignment.ts:234), clicks the main button, satisfies the gate. |

---

## 4. Constraints honored

- No edits to `src/tabs/assignment.ts` `ensureBuiltInTabActiveInMain` semantics — the helper is the proven cold-boot mechanism; only its **timing** matters.
- The custom helper from `ec00327` was reverted in `dc910bd` — do not reintroduce it.
- Diagnostic `console.log` breadcrumbs from `00094e7` and `9c2a03f` are still in production code; revert them once the fix is verified.
- All 6 prior test files + sidebar/tabs test files must remain green.

---

## 5. Proposed fix (for next agent to evaluate and execute)

**Option A — minimal: delay `requestTabLocation` so the panel's first effect commits with `drawerTab='lorebook'`.**

In `src/sidebar/secondary-drawer.ts:308-364` (the LAZY_MOUNT_OK branch):

1. Replace the current `await ensureBuiltInTabActiveInMain(resolvedId)` (line 353) with a wrapper that:
   - Calls `ensureBuiltInTabActiveInMain(resolvedId)` (existing click + 1 rAF).
   - Then `await new Promise<void>(r => requestAnimationFrame(() => r()))` (one more rAF) to give React time to commit `<TabPanelContent>` → `ensureRegistryRoot` → panel root creation → panel's first render.
2. Call `getBuiltInTabRoot(tabId)` as before.
3. **Defer the `requestTabLocation` call (line 364) by one additional `requestAnimationFrame`** so the panel's first effect has fired `loadBooks()` BEFORE `moveTabTo` sets `pendingActiveTabReset`.

The reasoning: if `loadBooks()` fires once (with `isVisible=true`) before the reset runs, `books` state is populated. The subsequent reset to `drawerTab='profile'` makes `isVisible=false` but `wasVisibleRef.current` is now true (set in the first effect run), so `becameVisible=false` — `loadBooks` does NOT re-fire (good, no duplicate fetch). The dropdown remains populated from the first fetch.

**Option B — explicit dispatch via Zustand subscribe (more invasive).**

Use `useStore.subscribe` (exported from Lumiverse's spindle loader.ts but currently NOT exposed via the bridge). Would require extending the spindle bridge contract. Skip unless Option A fails.

**Option C — wait for the XHR.**

Hook `worldBooksApi.list` via a fetch interceptor. On warm-boot, the XHR firing confirms `loadBooks` ran. Then call `requestTabLocation`. Most fragile option — too invasive.

**Recommended: Option A.** It's a one-rAF delay plus the existing helper. Reuses the proven mechanism. Should work given the race-condition analysis.

---

## 6. Decision gate

The next agent should produce ONE of:

1. **"Option A works."** Ship a single commit that adds the rAF delay + deferred `requestTabLocation`. Update wiring test (and add unit test if helper refactored). Revert diagnostic `console.log` breadcrumbs from `00094e7` and `9c2a03f`. Verify with all 6 test files + typecheck + build + deploy. User confirms lorebook dropdown populates after reload.

2. **"Option A insufficient — propose Option B or C."** Document why Option A failed (new ground-truth diagnostics). Pivot to bridge contract change (Option B) or XHR interceptor (Option C).

3. **"Other root cause discovered."** The 9c2a03f diagnostics ruled out the click-doesn't-reach-React hypothesis and the fiber-walker hypothesis. New diagnostics should target a specific alternative (e.g., `isVisible` at panel render time, panel's `useState` initialization order, `tab.mount(root)` exception).

---

## 7. Files & evidence for next agent to re-read

- `src/sidebar/secondary-drawer.ts` (now 542 lines; my call at line 353, wiring's `getBuiltInTabRoot` at line 356, `requestTabLocation` at line 364). Diagnostic `WARMBOOT_LAZY_MOUNT_OK_*` logs at lines 351-355.
- `src/tabs/assignment.ts` `ensureBuiltInTabActiveInMain` at line 119. Diagnostic `ENSURE_ACTIVE_*` logs at lines 132-180. The `_dlog` default at line 127 is `() => {}` — known limitation; production breadcrumbs are silenced, hence the `console.log` diagnostic fallback.
- `src/tabs/buttons.ts` `findMainTabButton` at line 47. Diagnostic `findMainTabButton` log at line 53.
- `src/tabs/active-tab.ts` `isTabActiveInMainDrawer` at line 59. Diagnostic log at line 63.
- `Lumiverse/frontend/src/lib/drawer-tab-registry.tsx:105-116` `mountReactComponent` (creates separate React root on detached DOM element).
- `Lumiverse/frontend/src/lib/drawer-tab-registry.tsx:409-430` `ensureRegistryRoot` (persistent module-level Map; panel mounts on first call).
- `Lumiverse/frontend/src/components/panels/world-book/WorldBookPanel.tsx:165-178` (the `isVisible` gating useEffect).
- `Lumiverse/frontend/src/components/panels/ViewportDrawer.tsx:117-123` (the `pendingActiveTabReset` useEffect).
- `Lumiverse/frontend/src/store/slices/spindle-placement.ts:389-401` (`moveTabTo` sets `pendingActiveTabReset` when `location.kind !== 'main-drawer'`).

Tests to run before verdict:

```bash
cd /home/jared/canvas_ext
bun run src/tabs/__tests__/ensure-builtin-active.test.ts
bun run src/tabs/__tests__/assign-tab-wiring.test.ts
bun run src/tabs/__tests__/assignment.test.ts
bun run src/tabs/__tests__/activation-handoff.test.ts
bun run src/tabs/__tests__/activation-handoff-lumiscript.test.ts
bun run src/tabs/__tests__/buttons.test.ts
bun run src/sidebar/__tests__/secondary-drawer-warm-boot-builtin.test.ts
bun run typecheck
```

All must remain green. If any fail, stop — the prior-commits' state has been disturbed; investigate before proceeding.

---

## 8. Risks of this plan being wrong

- **The `ensureRegistryRoot` mount may be synchronous after all.** If `tab.mount(root)` synchronously commits the panel (e.g., via `createRoot(root).render(...)` flushSync, or via a custom renderer that doesn't defer), the panel's first effect could run BEFORE `requestTabLocation`. In that case, Option A's extra rAF delay is unnecessary and `requestTabLocation` is fine as-is. The diagnostics from `9c2a03f` (root=null on helper's first call, root=element on wiring's second call) suggest the mount IS asynchronous — but the deferred commit might still happen before `requestTabLocation` in some cases.
- **The reset effect might not fire on warm-boot at all.** If `pendingActiveTabReset` is consumed by some other code path before our `requestTabLocation` runs, the race I described wouldn't happen. Worth checking by adding a diagnostic log in Lumiverse's reset effect (or by reading the user's next diagnostic output if Option A still fails).
- **The `setDrawerTab(fallback)` may set `drawerTab` to the same value (lorebook) if lorebook is the only built-in tab.** Unlikely (DRAWER_TABS has profile, loom, lumi, lorebook, etc.) but possible in custom configurations.

---

## 9. What to report back when this plan completes

A single assistant message with:

1. Verdict from §6 (Option A works / Option A insufficient / Other).
2. Test run output (verbatim).
3. New commit SHA(s) (if Option A or B succeeded).
4. Whether diagnostic `console.log` breadcrumbs from `00094e7` and `9c2a03f` were reverted.
5. User's live verification: lorebook dropdown populates after reload with `layoutPersistence` on.

If §6 verdict is final, also append:

```markdown
## handoff: chain complete

verdict: <#1 / #2 / #3>
chain: 2026-07-01_103948 → 2026-07-01_164112 → 2026-07-01_175400 → (this message)
final state of canvas_ext: <SHAs of all commits in main, ahead of origin/main by N>
diagnostic logs: <kept / reverted>
```