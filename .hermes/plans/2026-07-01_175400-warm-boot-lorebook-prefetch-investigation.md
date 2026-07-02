# Investigation: Warm-boot lorebook dropdown empty — pendingActiveTabReset preempts panel's loadBooks()

> **For Hermes:** This is an INVESTIGATION plan, not an implementation plan. Two prior plans shipped three commits (`f4650ec`, `5e4672a`, `4e8ec75`) for the cold-boot fix and one diagnostic commit (`aab95ad`) for the warm-boot case. Then two more attempts in this session (`ec00327`, `dc910bd`, `9c2a03f`) failed silently. This plan documents the **confirmed root cause**, proposes a minimal fix, and **incorporates the peer-review feedback from a critic subagent** (2026-07-01). Another agent will execute.

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
| 7 | Peer-review by critic subagent (plan refined, see §11) | 🟡 partial | session `20260701_181312_*` |
| 8 | Fix: delay `requestTabLocation` so panel's first effect commits with `drawerTab='lorebook'`; **same commit reverts all diagnostic logs** | ⏳ not started | – |

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

The `useStore` selectors `drawerOpen` (`WorldBookPanel.tsx:84`) and `drawerTab` (`WorldBookPanel.tsx:85`) subscribe to Lumiverse's Zustand store. So when `drawerTab` changes, the panel re-renders, recomputes `isVisible`, and the useEffect re-runs.

### The cold-boot fix and its mechanism

The cold-boot path in `src/tabs/assignment.ts:243-303` calls `await ensureBuiltInTabActiveInMain(tabId)` (line 263) BEFORE `bridge.ui.requestTabLocation` (line 282). The helper:
1. Calls `findMainTabButton(tabId)` to get the main-drawer button (DOM querySelector — works because the main sidebar's button has `data-tab-id="lorebook"`).
2. Calls `btn.click()` to trigger Lumiverse's React onClick.
3. Waits one `requestAnimationFrame` for React to commit.
4. Calls `bridge.ui.getBuiltInTabRoot(tabId)` to confirm the panel mounted.

The `btn.click()` is the **proven mechanism** to flip `drawerOpen`/`drawerTab` via Lumiverse's event system. The Lumiverse store does not expose a `setDrawerTab`/`openDrawer` action via the spindle bridge (`Lumiverse/frontend/src/lib/spindle/loader.ts:472-543` exposes only `mount`, `registerDrawerTab`, `registerCharacterEditorTab`, `createFloatWidget`, `requestDockPanel`, `requestTabLocation`, `getBuiltInTabTitle`, `getTabLocation`, `getBuiltInTabRoot`, `mountApp`, `registerInputBarAction`, `characterEditor.*` — **no** `setDrawerTab`/`openDrawer`/`subscribe`).

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
},
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

**The race condition (with timing acknowledgements from the critic):**

| t | Step | Store state | Panel state |
| --- | --- | --- | --- |
| 0 | Helper clicks main button. `handleTabClick('lorebook')` fires. `setDrawerTab('lorebook')` + `openDrawer('lorebook')` scheduled. | `drawerOpen=true, drawerTab='lorebook'` (after React commits) | (not mounted yet — `_registryRoots` Map empty) |
| +ε | `ensureRegistryRoot(tabId)` is called. **Synchronously:** creates a detached `<div>`, calls `tab.mount(root)` → `mountReactComponent` (line 105-116) which calls `createRoot(root).render(...)`. The DOM element is returned **synchronously**. The React tree commit is **scheduled asynchronously** by the React 18 scheduler. | same | DOM element returned; **React tree not yet committed** |
| 16ms | Helper awaits rAF. React has flushed by now. | same | React tree committed (panel's first effect did or didn't run yet) |
| 16ms+δ | Helper calls `getBuiltInTabRoot` → returns the DOM element. Wiring then calls `getBuiltInTabRoot` AGAIN at line 356 (cached lookup). Wiring calls `requestTabLocation` at line 364 synchronously — no `await`, no delay. → `moveTabTo` → `pendingActiveTabReset='lorebook'`. | `tabLocations['lorebook']={container}` + `pendingActiveTabReset='lorebook'` | Panel's first effect may or may not have run yet |
| 16ms+2δ | React flushes from `pendingActiveTabReset`. `ViewportDrawer`'s reset effect runs. `setDrawerTab('profile')` (fallback). | `drawerTab='profile'` | Panel's first effect runs after this — `isVisible = true && 'profile' === 'lorebook' = false` → `loadBooks` does NOT fire |

**Critic-confirmed nuance:** the panel's React commit happens *after* `ensureRegistryRoot` returns synchronously. React 18's detached roots schedule commits to microtasks/tasks, not synchronously. This confirms the panel's first effect runs *later* than the wiring code that called `ensureRegistryRoot`. Whether it runs before or after `requestTabLocation`'s `pendingActiveTabReset` effect is what we're trying to influence.

The panel's `createRoot(root).render(<WorldBookPanel />)` (called from `ensureRegistryRoot` at `Lumiverse/frontend/src/lib/drawer-tab-registry.tsx:106`) creates a SEPARATE React root on the detached DOM element. **This detached root renders on a later tick than the main app's React tree.** By the time `<WorldBookPanel>` first runs `isVisible = drawerOpen && drawerTab === 'lorebook'`, `drawerTab` is already `'profile'` → `isVisible=false` → `loadBooks` never fires.

The single XHR (`worldBookFolders` 404) is `useFolders`'s unconditional mount effect. The missing XHR (`world-books`) is the gated `loadBooks` fetch. The `bookPickerOptions` dropdown stays empty because `books=[]` (initial state at `WorldBookPanel.tsx:94`).

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
| Q-DIAG-3: Is the lorebook dropdown actually empty on cold-boot too? | No. Cold-boot works. Cold-boot uses `ensureBuiltInTabActiveInMain` (assignment.ts:263), clicks the main button, satisfies the gate. |

---

## 4. Constraints honored

- No edits to `src/tabs/assignment.ts` `ensureBuiltInTabActiveInMain` semantics — the helper is the proven cold-boot mechanism; only its **timing** matters.
- The custom helper from `ec00327` was reverted in `dc910bd` — do not reintroduce it.
- All 6 prior test files + sidebar/tabs test files must remain green.
- Diagnostic `console.log` breadcrumbs from `00094e7` and `9c2a03f` are still in production code; **revert them in the SAME commit as Option A** (peer-reviewer feedback — see §11).

---

## 5. Proposed fix (for next agent to evaluate and execute)

**Option A — minimal: delay `requestTabLocation` so the panel's first effect commits with `drawerTab='lorebook'`.**

In `src/sidebar/secondary-drawer.ts:325-364` (the LAZY_MOUNT_OK branch — note: line numbers have drifted from earlier plans; see §7):

1. **Revert the 2 diagnostic `console.log` lines at 351-352 and 354-355** (the `[Canvas-DIAG] WARMBOOT_LAZY_MOUNT_OK_*` calls). These are noise in production.
2. **Re-introduce** `await ensureBuiltInTabActiveInMain(resolvedId)` (replacing whatever is there from `dc910bd`).
3. **Add one extra `requestAnimationFrame` delay** to give React time to commit the panel's first render:
   ```ts
   await ensureBuiltInTabActiveInMain(resolvedId)
   // Extra rAF: React 18 detached root commits are scheduled async; one
   // rAF (~16ms) is comfortably more than the typical React scheduler
   // flush latency (~1-5ms). This lets <WorldBookPanel>'s first useEffect
   // run with isVisible=true (drawerTab still 'lorebook') so loadBooks()
   // fires. Then the pendingActiveTabReset to 'profile' below flips
   // isVisible=false, but wasVisibleRef is already true so no refetch.
   await new Promise<void>((r) => requestAnimationFrame(() => r()))
   ```
4. Call `getBuiltInTabRoot(tabId)` as before.
5. **Defer the `requestTabLocation` call (line 364) by one additional `requestAnimationFrame`** so the panel's first effect has fired `loadBooks()` BEFORE `moveTabTo` sets `pendingActiveTabReset`:
   ```ts
   _root = _lazyRoot
   await new Promise<void>((r) => requestAnimationFrame(() => r()))
   wSpindleUi.requestTabLocation(tabId, { kind: 'container', containerId: 'canvas-secondary-drawer' })
   ```

**The reasoning:** if `loadBooks()` fires once (with `isVisible=true`) before the reset runs, `books` state is populated. The subsequent reset to `drawerTab='profile'` makes `isVisible=false` but `wasVisibleRef.current` is now `true` (set in the first effect run), so `becameVisible=false` — `loadBooks` does NOT re-fire (good, no duplicate fetch). The dropdown remains populated from the first fetch.

**Option A's verification criterion: the next agent MUST observe the `GET /api/v1/world-books` XHR fire in the user's console.** Currently absent per the diagnostic logs at lines 88-90. The dropdown UI being populated is *downstream* of that XHR — a passing dropdown with no XHR means a regression.

**Option B — explicit dispatch via Zustand subscribe (more invasive).**

Use `useStore.subscribe` (exported from Lumiverse's spindle loader.ts but currently NOT exposed via the bridge). Would require extending the spindle bridge contract — touching `Lumiverse/frontend/src/lib/spindle/loader.ts`, `Lumiverse/frontend/src/store/slices/ui.ts`, and a version bump of Lumiverse. **Skip unless Option A fails.**

**Option C — wait for the XHR.**

Hook `worldBooksApi.list` via a fetch interceptor. On warm-boot, the XHR firing confirms `loadBooks` ran. Then call `requestTabLocation`. Most fragile option — too invasive.

**Option D (suggested by critic; out of scope for this fix): make `loadBooks` unconditional on mount.** This eliminates the data-dependency-on-active-tab entirely and would be the cleanest fix but requires editing `Lumiverse/frontend/src/components/panels/world-book/WorldBookPanel.tsx`. File as a follow-up Lumiverse upstream issue.

**Recommended: Option A.** It's a one-rAF delay plus the existing helper. Reuses the proven mechanism. Should work given the race-condition analysis.

---

## 6. Decision gate

The next agent should produce ONE of:

1. **"Option A works."** Ship a single commit that:
   - Adds the two rAF delays (one before `getBuiltInTabRoot`, one before `requestTabLocation`).
   - Reverts all 15 diagnostic `console.log` breadcrumbs (see §10 for the exact list).
   - Updates the textual test `secondary-drawer-warm-boot-builtin.test.ts` to ALSO assert the new rAF delays exist as text patterns AND adds a new behavioral test (see §5.5).
   - Runs all tests + typecheck + build + deploy.
   - Captures the user's console output. The `GET /api/v1/world-books` XHR MUST appear in the warm-boot path. Include before/after diff in commit message body.

2. **"Option A insufficient — propose Option B."** Document why Option A failed (new ground-truth diagnostics). Pivot to bridge contract change (Option B).

3. **"Other root cause discovered."** The 9c2a03f diagnostics ruled out the click-doesn't-reach-React hypothesis and the fiber-walker hypothesis. New diagnostics should target a specific alternative (e.g., `isVisible` at panel render time, panel's `useState` initialization order, `tab.mount(root)` exception).

### 5.5 New test (required for Option A success)

The existing `src/sidebar/__tests__/secondary-drawer-warm-boot-builtin.test.ts` is a **purely textual** source scan (lines 34-78 of that test file). It would PASS even if Option A's `await new Promise(r => requestAnimationFrame(...))` wrapper were silently removed. Add a behavioral test:

- File: `src/sidebar/__tests__/secondary-drawer-warm-boot-builtin-defer.test.ts`
- Mock `ensureBuiltInTabActiveInMain` to resolve on next microtask (or stub to call `requestAnimationFrame` internally).
- Mock `requestTabLocation` to record the call timestamp (`performance.now()`).
- Capture the timestamp of when `getBuiltInTabRoot` returns (or stub the second call).
- Assert: the `requestTabLocation` call timestamp is **≥ 32ms** after the helper's start (≥2 rAFs). This pins the timing.
- Also extend the existing textual test to assert the substring `requestAnimationFrame` appears at least 2 times inside the LAZY_MOUNT_OK branch.

---

## 7. Files & evidence for next agent to re-read

**LINE NUMBERS DRIFTED FROM THE ORIGINAL PLAN. Use these current locations:**

- `src/sidebar/secondary-drawer.ts` (542 lines; LAZY_MOUNT_OK branch now at lines **330-364**, not 308-364). Helper call at line **353**, wiring's `getBuiltInTabRoot` at line **356**, `requestTabLocation` at line **364**. Diagnostic `WARMBOOT_LAZY_MOUNT_OK_*` `console.log` sites at lines 351-352 and 354-355.
- `src/tabs/assignment.ts` (332 lines; `ensureBuiltInTabActiveInMain` at line **119**, NOT 119 — drift +29 lines for `await ensureBuiltInTabActiveInMain` reference, now at line **263**, not 234). Diagnostic `ENSURE_ACTIVE_*` logs at lines 136, 142, 147, 155, 166, 168, 171, 178, 180, 184. The `_dlog` default at line 127 is `() => {}` — known limitation; production breadcrumbs are silenced, hence the `console.log` diagnostic fallback.
- `src/tabs/buttons.ts` (348 lines; `findMainTabButton` at line 47). Diagnostic log at lines 51, 56.
- `src/tabs/active-tab.ts` (81 lines; `isTabActiveInMainDrawer` at line 59). Diagnostic log at line 62.
- `Lumiverse/frontend/src/lib/drawer-tab-registry.tsx:105-116` `mountReactComponent` (creates separate React root on detached DOM element — **DOM is synchronous, React commit is asynchronous**).
- `Lumiverse/frontend/src/lib/drawer-tab-registry.tsx:398, 409-430` `ensureRegistryRoot` (persistent module-level Map; panel mounts on first call). The Map is **rebuilt per page load** — no stale-cache risk on warm-boot.
- `Lumiverse/frontend/src/components/panels/world-book/WorldBookPanel.tsx:84-178` (the `useStore` selectors at 84-85, the `isVisible` gating useEffect at 165-178, `useState<WorldBook[]>([])` at 94).
- `Lumiverse/frontend/src/components/panels/ViewportDrawer.tsx:117-123` (the `pendingActiveTabReset` useEffect).
- `Lumiverse/frontend/src/store/slices/spindle-placement.ts:389-401` (`moveTabTo` sets `pendingActiveTabReset` when `location.kind !== 'main-drawer'`).
- `Lumiverse/frontend/src/store/slices/ui.ts:27-33` (`openDrawer` and `setDrawerTab` are defined on UISlice but NOT exposed via the bridge).
- `Lumiverse/frontend/src/lib/spindle/loader.ts:472-543` (the `ui` interface exposed via spindle — confirmed: no `setDrawerTab`/`openDrawer`/`subscribe`).
- `Lumiverse/frontend/src/lib/spindle/placement-helper.ts:462-466` (`requestTabLocation` calls `getStore().moveTabTo(...)` synchronously — note this propagates to the store immediately).

Tests to run before verdict (all must remain green):

```bash
cd /home/jared/canvas_ext
bun run src/sidebar/__tests__/secondary-drawer-warm-boot-builtin.test.ts
bun run src/tabs/__tests__/ensure-builtin-active.test.ts
bun run src/tabs/__tests__/assign-tab-wiring.test.ts
bun run src/tabs/__tests__/assignment.test.ts
bun run src/tabs/__tests__/activation-handoff.test.ts
bun run src/tabs/__tests__/activation-handoff-lumiscript.test.ts
bun run src/tabs/__tests__/buttons.test.ts
bun run typecheck
```

If any fail, stop — the prior-commits' state has been disturbed; investigate before proceeding.

**New test to add (§5.5):**

```bash
bun run src/sidebar/__tests__/secondary-drawer-warm-boot-builtin-defer.test.ts
```

---

## 8. Risks of this plan being wrong

- **The `ensureRegistryRoot` DOM-vs-React distinction.** `mountReactComponent` (line 105-116) calls `createRoot(root).render(...)`. The DOM element is returned **synchronously** by `ensureRegistryRoot`. The React tree commit is **asynchronous** (React 18 detached roots schedule to microtasks/tasks). One rAF (~16ms) is more than the React scheduler's typical flush latency (~1-5ms), so the margin is comfortable. The plan's risk is **NOT** "the commit is synchronous" — it never is. The actual risk is "the React scheduler is unusually slow on the user's machine" — unlikely under any realistic main-thread load.

- **The reset effect might not fire on warm-boot at all.** If `pendingActiveTabReset` is consumed by some other code path before our `requestTabLocation` runs, the race described wouldn't happen. Worth checking by adding a diagnostic log in Lumiverse's reset effect (or by reading the user's next diagnostic output if Option A still fails). Note: the `dc910bd` evidence (click reaches React, panel mounts, `loadBooks` doesn't fire) already implies `pendingActiveTabReset` IS firing — otherwise `drawerTab` wouldn't have flipped and `isVisible` would've stayed true.

- **The `setDrawerTab(fallback)` may set `drawerTab` to the same value (lorebook) if lorebook is the only built-in tab.** Unlikely (DRAWER_TABS has profile, loom, lumi, lorebook, presets, browser, connections, characters, etc.) but possible in custom configurations. Option A's logic is robust: even if the fallback IS lorebook, `wasVisibleRef.current=true` already, so no refetch.

- **`_registryRoots` Map survives HMR but is rebuilt per page load.** No stale-cache risk on warm-boot. Cold-boot and warm-boot have identical mount paths.

- **The existing `secondary-drawer-warm-boot-builtin.test.ts` is purely textual.** It would pass even if Option A's `await new Promise(r => requestAnimationFrame(...))` wrapper were silently removed. **This is why §5.5 mandates a new behavioral test.**

---

## 9. What to report back when this plan completes

A single assistant message with:

1. Verdict from §6 (Option A works / Option A insufficient / Other).
2. **Diff of the user's console output: before (no `GET /api/v1/world-books` XHR) vs after (XHR fires).** This is the true ground-truth; "dropdown populates" is downstream.
3. New commit SHA(s) (if Option A or B succeeded).
4. Confirmation that all 15 diagnostic `console.log` breadcrumbs from `00094e7` and `9c2a03f` were reverted in the same commit.
5. Confirmation that the new behavioral test in §5.5 was added and passes.
6. User's live verification: lorebook dropdown populates after reload with `layoutPersistence` on.

If §6 verdict is final, also append:

```markdown
## handoff: chain complete

verdict: <#1 / #2 / #3>
chain: 2026-07-01_103948 → 2026-07-01_164112 → 2026-07-01_175400 → (this message)
final state of canvas_ext: <SHAs of all commits in main, ahead of origin/main by N>
diagnostic logs: <kept / reverted>
```

---

## 10. Diagnostic console.log sites to revert in the same commit as Option A

**Verified 2026-07-01 against live source — these 15 sites are the diagnostic breadcrumbs deployed by `00094e7` and `9c2a03f`:**

```ts
// src/tabs/assignment.ts (10 sites)
src/tabs/assignment.ts:136    console.log('[Canvas-DIAG] ENSURE_ACTIVE_BEGIN tab=' + tabId)
src/tabs/assignment.ts:142    console.log('[Canvas-DIAG] ENSURE_ACTIVE_isActive tab=' + tabId + ' isActive=' + _isActiveResult)
src/tabs/assignment.ts:147    console.log('[Canvas-DIAG] ENSURE_ACTIVE_isMobile tab=' + tabId + ' mobile=' + _isMobileResult)
src/tabs/assignment.ts:155    console.log('[Canvas-DIAG] ENSURE_ACTIVE_findBtn tab=' + tabId + ' btn=' + ...)
src/tabs/assignment.ts:166    console.log('[Canvas-DIAG] ENSURE_ACTIVE_preClickClass tab=' + tabId + ' class=' + ...)
src/tabs/assignment.ts:168    console.log('[Canvas-DIAG] ENSURE_ACTIVE_clicking tab=' + tabId)
src/tabs/assignment.ts:171    console.log('[Canvas-DIAG] ENSURE_ACTIVE_clicked tab=' + tabId + ' awaiting rAF')
src/tabs/assignment.ts:178    console.log('[Canvas-DIAG] ENSURE_ACTIVE_postClickClass tab=' + tabId + ' class=' + ...)
src/tabs/assignment.ts:180    console.log('[Canvas-DIAG] ENSURE_ACTIVE_afterRaf tab=' + tabId + ' about to call getBuiltInTabRoot')
src/tabs/assignment.ts:184    console.log('[Canvas-DIAG] ENSURE_ACTIVE_rootResult tab=' + tabId + ' root=' + ...)

// src/tabs/buttons.ts (2 sites)
src/tabs/buttons.ts:51        console.log('[Canvas-DIAG] findMainTabButton tab=' + tabId + ' sidebar=null')
src/tabs/buttons.ts:56        console.log('[Canvas-DIAG] findMainTabButton tab=' + tabId + ' sidebar=present childButtons=' + ...)

// src/tabs/active-tab.ts (1 site)
src/tabs/active-tab.ts:62     console.log('[Canvas-DIAG] isTabActiveInMainDrawer tab=' + tabId + ' active=' + JSON.stringify(active))

// src/sidebar/secondary-drawer.ts (2 sites)
src/sidebar/secondary-drawer.ts:352  console.log('[Canvas-DIAG] WARMBOOT_LAZY_MOUNT_OK_before_ensure tab=' + resolvedId)
src/sidebar/secondary-drawer.ts:355  console.log('[Canvas-DIAG] WARMBOOT_LAZY_MOUNT_OK_after_ensure tab=' + resolvedId)
```

**Keep these — they are production-silent:**

- `src/tabs/assignment.ts:127` `_dlog = ...` default `() => {}` — silent in production.
- All `dlog(` and `dwarn(` call sites — silent in production.
- `src/debug/log.ts:29 console.log('[Canvas]', ...args)` — only fires when explicitly enabled.
- `src/debug/fiber-scan.ts` — only fires when explicitly invoked.

**Do NOT touch:**

- `console.log` calls inside `__tests__/*.ts` files (those are test PASS/FAIL/SKIP reporters).
- `console.log` in `src/sidebar/__tests__/secondary-drawer-warm-boot-builtin.test.ts:82` — test reporter.

Each of the 15 sites is bracketed by `// eslint-disable-next-line no-console` comments. Removing the `console.log` AND its `// eslint-disable-next-line` comment is the cleanest revert.

---

## 11. Peer-review note (added 2026-07-01)

This plan was reviewed by a critic subagent before execution. Key findings:

1. **All 5 cited Lumiverse file paths and their cited line numbers were verified against current source.** One spot-check exception: the §2 race table conflates "DOM element returned by `ensureRegistryRoot`" (synchronous) with "React tree committed" (asynchronous). Clarified in §8 risk #1.

2. **The current source line numbers have drifted** from earlier plans (`assignment.ts:234 → 263`, `secondary-drawer.ts:308 → 330`). §7 corrected all references.

3. **The mechanism (Option A) is plausible but timing-dependent.** React 18 detached roots commit in 1-5ms typical flush latency; one rAF delay (~16ms) is sufficient margin. Verification-then-pivot structure is appropriate.

4. **The existing textual test is insufficient.** It would pass even if Option A's `await new Promise(r => requestAnimationFrame(...))` were silently removed. §5.5 mandates a new behavioral test.

5. **Diagnostic logs should revert in the SAME commit as Option A**, not after verification. Production noise is unnecessary. §10 enumerates the 15 exact sites.

6. **Verification criterion must be the XHR**, not the dropdown UI state. The dropdown is downstream; if the XHR doesn't fire, a regression snuck in even if the UI somehow looks fine (e.g., from a stale cache). §6.1 strengthened.

7. **Option D (out of scope) suggested:** make `loadBooks` unconditional on mount. This eliminates the data-dependency-on-active-tab entirely. File as a follow-up Lumiverse upstream issue — not part of this fix.

**Reviewer recommended:** "modify first, then ship." This plan is the "modify first" result. Adopt it as-written.
