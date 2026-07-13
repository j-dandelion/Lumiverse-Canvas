# Adversarial review — unpushed main vs origin/main

- **REVIEW_ID:** 0265d5d1
- **Date:** 2026-07-10
- **HEAD:** 2f95dc13
- **Merge-base:** a3837d75
- **Range:** 39 commits; 66 files; +14108 / −4658
- **Counts:** 5 bugs · 8 suggestions · 3 nits
- **Note:** Pass artifacts under `/tmp` were ephemeral; this file is the source of truth.

---

## Summary

39 commits, ~10k LoC delta, primary work is a one-shot Promise/observer/timeout `applyLayout` rewrite, a 614-LoC main-mirror drawer module with 800 ms host poll, a 4-mechanism restore-pending hide stack, a facet-gated `buildPersistedLayout`, and an `assignToSecondary` refactor. Direction is sound — the suffix self-heal, replace-vs-merge unassign, and the 3 s unsuppress safety net are real fixes. Five concrete bugs remain: a cancel race that clobbers the next call's suppress flags, two `.then`-only dynamic imports that silently strand the host, a built-in early-return that misses bare-id roots, an unguarded `persistSettings` mid-restore write, and a suffix self-heal that fails on sibling tabs. Several structural cleanups (stacked hide mechanisms, god-function, 4-call duplication) compound the longer the slice sits.

## Adversarial checklist

| #  | Question                                                                       | Verdict | Notes |
|----|--------------------------------------------------------------------------------|---------|-------|
| 1  | Multi-completion (two restores) leave UI inconsistent?                         | risk    | Issue 1 (cancel race): `cancelApplyLayoutInterval` doesn't flip prior `_restoreFinished`, so prior `kickAssign.finally` clobbers next call's suppress flags. |
| 2  | Untyped layout blob — is there a validation boundary?                           | risk    | Issue 6: `applyLayout(layout: any)` reaches into nested fields with no schema check; `parseLayoutBlob` boundary missing. |
| 3  | Host poll exhaust leaves drawer hidden?                                        | ok      | `RESTORE_TAB_POLL_MAX=50`×16 ms=800 ms → `finish('poll-max')` → `unsuppressMainDrawer`; 3 s `UNSUPPRESS_TIMEOUT_MS` is second belt. |
| 4  | Guard flag stuck combinations?                                                 | ok      | Four state bits coordinated by single `unsuppressMainDrawer()`; second `beginMainDrawerRestoreGuard` is idempotent. |
| 5  | !important CSS cascade flash?                                                  | ok      | Mirror hide injected before `CANVAS_MAIN_ACTIVE_CLASS`; `restore-pending` selectors more specific than parked-content reveal. |
| 6  | Repark timer leak on re-apply?                                                 | risk    | `startReparkWatch` is recursive `setTimeout` forever at 500 ms steady state, no max/idle. See Issue 9. |
| 7  | Suffix self-heal picks wrong id?                                               | risk    | Issue 5: sibling tabs (`ext:1`, `ext:2`) both strip to `ext` → `candidates.length===2` → skip, wanted tab never restored. |
| 8  | Dead `SecondaryDrawerState.mounting` intentional?                              | ok      | Not intentional — dead union member never assigned (Issue 14 nit). Related assign asymmetry (bare vs composite early-return) is Issue 4 (bug). |
| 9  | Restore flow confidence without direct tests?                                  | risk    | `main-mirror-drawer.ts` (614 LoC) and the 16 ms `scheduleRestoreTabThenUnsuppress` loop have **zero direct test coverage**; `main-tab-pin.test.ts` stubs host tree. See Issue 8. |
| 10 | Dynamic import `.then` swallow → silent break?                                 | risk    | Issue 2: `finishRestore` and `applyMainDrawer` import paths have no `.catch`; rejection strands primary restore guard until 3 s timeout. Six more `void import(...).catch(()=>{})` in main-persist.ts:434/537/591/627/893 mask parse errors via the same timeout. |

## Issues

### Issue 1 — Severity: bug
- File: src/layout/apply.ts:69-83, 380-393
- Category: race-condition
- Confidence: high
- Host-justified?: no
- Description: `cancelApplyLayoutInterval()` disconnects observer, clears timeout, releases suppress flags, and resolves awaiter — but never sets the previous closure's `_restoreFinished = true`. The prior `kickAssign.finally` still calls `attemptRestore()` → `finishRestore()`, which clobbers the new call's freshly-set `setRestoringFromLayout(false)` / `setSuppressAutoActivation(false)` and resolves the new Promise early before `startAssignPhase` runs. Net: a second `applyLayout` mid-restore (two "Load previous" clicks, settings re-apply) leaves the next restore without suppress guards; late auto-activations overpaint the saved active tab.
- Suggestion: In `cancelApplyLayoutInterval`, set the previous closure's `_restoreFinished = true` (module-level flag or closure ref). The prior `kickAssign.finally` then short-circuits at its own `if (_restoreFinished) return 0` check and no longer mutates shared flags.
- Status: addressed

### Issue 2 — Severity: bug
- File: src/layout/apply.ts:327-330; src/layout/persist.ts:383-385
- Category: host-workaround
- Confidence: high
- Host-justified?: no
- Description: Two `import('../sidebar/main-persist').then(...)` paths in `finishRestore` and `applyMainDrawer` have no `.catch`. If the import rejects (bundle error, teardown race, circular dep) or the called function throws, the rejection is swallowed: `unsuppressMainDrawer()` and `ensureRestoredPrimaryTab()` never run, the host stays hidden behind the restore-pending guard until the 3 s safety net — and the user sees an empty page with no console signal pointing at the cause.
- Suggestion: Add `.catch((err) => dwarn('applyLayout: ... failed:', err))` at both sites; consolidate into one helper.
- Status: addressed

### Issue 3 — Severity: bug
- File: src/settings/state.ts:124-140
- Category: correctness
- Confidence: medium
- Host-justified?: no
- Description: `persistSettings` does not gate on `isLayoutRestoreActive()`. `persistOpenState` (persist.ts:287) and `persistLayout` (persist.ts:312) both guard with `if (isLayoutRestoreActive()) return;` to prevent mid-restore SAVE_LAYOUT thrash. `enableAndLoadPrevious` does `setSettings({persistTabAssignments:true})` then `await applyLayout(saved)`; an unrelated `setSettings` from the user during the same await re-arms the 100 ms debounce and fires mid-restore, writing a partial snapshot. Worst case: a 2-IPC duplicate write; same class of race the other two paths defend against.
- Suggestion: Add `if (isLayoutRestoreActive()) return;` after the `_loadInProgress` check in `persistSettings`. Symmetrical with the other two persist paths.
- Status: addressed

### Issue 4 — Severity: bug
- File: src/sidebar/secondary-drawer.ts:305
- Category: correctness
- Confidence: medium
- Host-justified?: no
- Description: Built-in early-return in `assignToSecondary` queries `[data-canvas-moved="${CSS.escape(resolvedId)}"]` only. The same function's extension-path early-return (line 215) and `unassignFromSecondary` (lines 499-507) both try the bare id as a fallback. `moveBuiltInTabToSecondaryContainer` tags the root with the *parameter* `tabId` (builtin-move.ts:81). When a caller passes a bare id (context-menu path), `tabId` is bare and `resolvedId` is composite — the early-return misses and the function falls through to the full re-assign path, re-running the lazy-mount branch and `setAttribute('data-canvas-active','')` race that the early-return was supposed to skip.
- Suggestion: Mirror the dual-id pattern from `unassignFromSecondary`:
  ```ts
  const idsToTry = resolvedId !== tabId ? [resolvedId, tabId] : [resolvedId]
  for (const id of idsToTry) { const hit = ...; if (hit) { /* early-return */; break } }
  ```
- Status: addressed

### Issue 5 — Severity: bug
- File: src/layout/apply.ts:425-441, 446-450
- Category: correctness
- Confidence: medium
- Host-justified?: no
- Description: Suffix-drift self-heal requires `candidates.length === 1`, but `stripSuffix` is too coarse for sibling tabs: `prompt-viewer:1` and `prompt-viewer:2` both strip to `prompt-viewer` → `candidates.length === 2` → skip with `dwarn`. LumiScript fallback (line 446) then also misses: `findMainTabButton(dt.tabId)` keys on the **stored** id, but the live button's `data-tab-id` is the drifted live id. Net: a session-restart layout where sibling registration order changed loses tabs silently (warning only).
- Suggestion: (a) When suffix match is ambiguous but all candidates share a known common prefix with the stored id, prefer the candidate whose full id is a `stripSuffix(stored) + ':' + newSuffix` rewrite. (b) For the LumiScript fallback, walk `findMainTabButton` by stripped prefix when exact id misses.
- Status: addressed

### Issue 6 — Severity: suggestion
- File: src/layout/apply.ts:118-119, 165, 220-225, 408-409; src/tabs/tab-assignments-diff.ts
- Category: type-safety
- Confidence: high
- Host-justified?: no
- Description: `applyLayout(layout: any)` reaches into `layout.secondary?.width`, `layout.primary?.tabId`, `layout.detachedTabs[i].tabId`, `layout.secondary.activeTabId` with no schema check. A malformed/old-version layout silently half-applies: `parseFloat` → NaN falls through, the tab loop iterates `undefined.length` and exits, the caller sees a resolved Promise with no visible effect. The new `tab-assignments-diff.ts` introduces a clean `tabAssignmentsEqual` seam that is the obvious validation home; `applyLayout` does not use it.
- Suggestion: Add `parseLayoutBlob(input: unknown): LayoutState | null` returning null on schema mismatch (with `dlog` of which field), and use it at the top of `applyLayout` and `applyMainDrawer`.
- Status: addressed

### Issue 7 — Severity: suggestion
- File: src/sidebar/main-persist.ts:111-167, 189-204, 209-217, 296-298, 309-318; src/sidebar/main-mirror-drawer.ts:248-310
- Category: architecture (stacked guards)
- Confidence: high
- Host-justified?: partial (one mechanism needed; four is sprawl)
- Description: Five overlapping hide mechanisms for the same drawer during restore: (1) `RESTORE_PENDING_CLASS` CSS rules, (2) per-element `style.setProperty('visibility','hidden','important')` via `stampPanelBodyHide`, (3) `RESTORE_HIDE_ATTR` data attribute, (4) inline wrapper `style.setProperty` in `suppressMainDrawer`, (5) mirror's `injectHostHideStyles`. The `scheduleRestoreTabThenUnsuppress` 16 ms poll re-stamps (2) every tick because (1) alone is not enough on host reparent. Code-judo: delete (3) and (4); the class rule + `_panelHideObserver` already cover descendants.
- Suggestion: Drop `RESTORE_HIDE_ATTR` and inline wrapper hide; keep the class rule + observer as the only mechanism.
- Status: addressed

### Issue 8 — Severity: suggestion
- File: src/sidebar/main-mirror-drawer.ts (614 LoC, 0 tests); src/sidebar/main-persist.ts:530-643 (16 ms poll, 0 tests)
- Category: test-gap
- Confidence: high
- Host-justified?: no
- Description: `main-tab-pin.test.ts` (1040 LoC) covers button reconcile / click / settings-dock / stale-key heal / exclusivity but stubs the host tree and never exercises `mountMainMirror`, `teardownMainMirror`, `openCanvasMainDrawer`/`closeCanvasMainDrawer`, `startReparkWatch`, or the `scheduleRestoreTabThenUnsuppress` poll loop. The 800 ms host poll with `RESTORE_HOST_STABLE_POLLS=2` / `RESTORE_CONTENT_QUIET_MS=40` constants has no behavior assertion. A regression in `resolveContentSettleRoot`, `stampPanelBodyHide` rAF dedup, or the `polls%3` re-click cadence would only be caught by manual QA.
- Suggestion: Add (a) `main-mirror-drawer.test.ts` mounting shell, parking/reparking a fake panel body; (b) `restore-poll.test.ts` driving `scheduleRestoreTabThenUnsuppress` with stubbed `isHostPrimaryTabActive` flipping on poll N, asserting `unsuppressMainDrawer` fires after N+`RESTORE_HOST_STABLE_POLLS`.
- Status: addressed

### Issue 9 — Severity: suggestion
- File: src/sidebar/main-mirror-drawer.ts:540-563
- Category: complexity
- Confidence: high
- Host-justified?: partial (repark justified; interval not)
- Description: `startReparkWatch` is a self-rescheduling `setTimeout(tick, tickMs())` running forever while mirror mode is active. `tickMs()` switches 50 ms / 500 ms based on the `restore-pending` class, but there is no max lifetime, no idle detection, no "host stayed parked" metric. 500 ms forever is the steady state.
- Suggestion: Replace with `setInterval` at 200 ms that stops when `resolveHostPanelContent().parentElement === _shell.content` is true for N consecutive ticks; or only tick while a host-mutation observer reports flux.
- Status: addressed

### Issue 10 — Severity: suggestion
- File: src/sidebar/secondary-drawer.ts:142-451; src/tabs/assignment.ts:247-251
- Category: complexity / duplication
- Confidence: high
- Host-justified?: no
- Description: `assignToSecondary` is a 440-line god-function mixing extension/built-in branches, each with early-return, primary path, reparent-or-store-root fallback, header write, open-sidebar decision, and final showSecondaryTab/persist tail. The 5-call `setTabAssignment → hideMainTabButton → addSecondaryTabButton → updateDrawerTabVisibility → persistLayout` (plus `openSecondarySidebar`/`runHandoff`) is repeated verbatim in three places. `moveBuiltInTabToSecondaryContainer` factored the placement half but left the finalize half copy-pasted.
- Suggestion: Split into `assignExtensionTabToSecondary` / `assignBuiltInTabToSecondary` with a shared `finalizeAssignToSecondary(tab, root, opts)` helper in `tabs/assignment.ts`; public `assignToSecondary(tabId)` becomes a 5-line dispatcher.
- Status: addressed

### Issue 11 — Severity: suggestion
- File: src/types.ts:160; src/settings/state.ts:65-72
- Category: type-safety
- Confidence: high
- Host-justified?: no
- Description: `mergeCanvasSettings` returns `Required<CanvasSettings>` but does not call `normalizeCanvasSettings`; the `taskbarMode ⇒ moveControlsToOuterEdge` invariant is enforced by `hydrateSettings` and `setSettings` only. The exported `FullCanvasSettings` type and `mergeCanvasSettings` together imply a fully-consistent object, but only the test harness wraps correctly (state.test.ts:132 explicitly calls `normalizeCanvasSettings(mergeCanvasSettings(...))`). Latent in production; future direct callers will be silently broken. (Note: setting renamed from `keepTabListVisible` → `taskbarMode` in 2026-07-12.)
- Suggestion: Either call `normalizeCanvasSettings` at the end of `mergeCanvasSettings` (single source of truth) or rename to `mergeCanvasSettingsRaw` and route callers through a `getSettings` wrapper that normalizes.
- Status: addressed

### Issue 12 — Severity: suggestion
- File: src/sidebar/main-mirror-drawer.ts:170, 200, 379-385, 499
- Category: complexity
- Confidence: medium
- Host-justified?: no
- Description: 7 `void import(...)` calls in `main-mirror-drawer.ts`. Three are unjustified: line 170 `import('../layout/persist')` is a one-way dep (no cycle); lines 200/204 `import('../chat/reflow')` / `import('../resize/handles')` fire on every `mountMainMirror` and `bumpReflow()`; lines 379-385 `drawer-sync` / `panel-header-sync` are static siblings. The legitimate dynamic imports (e.g. main-persist.ts:893 breaking the `main-persist → main-mirror → main-persist` init cycle) are mixed in with cosmetic ones, masking which `.catch(()=>{})` is real.
- Suggestion: Convert top-level sibling imports to static; keep dynamic only for `main-mirror-drawer` ↔ `main-persist` mutual references. Drop `.catch(()=>{})` on survivors — at minimum `dlog` so parse errors surface.
- Status: addressed

### Issue 13 — Severity: suggestion
- File: src/sidebar/main-persist.ts:530-643
- Category: complexity
- Confidence: high
- Host-justified?: no (per-poll work is local, not a host fight)
- Description: `scheduleRestoreTabThenUnsuppress` 16 ms poll up to 50× calls `stampPanelBodyHide()` (which `querySelectorAll`s every panel body and `setProperty('visibility','hidden','important')` on each) on **every tick**, plus a `void import('./main-mirror-drawer')` + `ensureHostContentParkedPublic()` round-trip on `polls%3===0`. In mirror mode the panel body is already hidden by wrapper `visibility:hidden` from the restore-pending CSS, so `stampPanelBodyHide` is redundant double-work.
- Suggestion: Split loop into "host still wrong → re-click + 50 ms setTimeout" (cheap) and "host now correct → settle content" (observer + stamp once). Skip `stampPanelBodyHide` in mirror mode. Move the import out of the per-poll path.
- Status: addressed

### Issue 14 — Severity: nit
- File: src/sidebar/secondary-drawer.ts:32
- Category: dead-code
- Confidence: high
- Host-justified?: no
- Description: `SecondaryDrawerState = 'closed' | 'mounting' | 'open' | 'tab_active'` includes `'mounting'`, but no code path ever assigns it; readers (`getSecondaryDrawerState`, tests) only compare against `'closed' | 'tab_active'`. Misleading affordance for future readers.
- Suggestion: Drop `'mounting'` from the union.
- Status: addressed

### Issue 15 — Severity: nit
- File: src/sidebar/main-persist.ts:344
- Category: dead-code
- Confidence: high
- Host-justified?: no
- Description: TabId suffix-match branch has duplicate `targetTabId.includes(\`:tab:${id}\`)` clause (the third term is a strict subset of the second, which already matches `:tab:foo` and any string containing it).
- Suggestion: Drop the third clause.
- Status: addressed

### Issue 16 — Severity: nit
- File: src/layout/persist.ts:170-179
- Category: dead-code
- Confidence: medium
- Host-justified?: no
- Description: `readPrimaryWidth()` falls back to `420` whenever `getMainDrawerWidth()` returns `<= 0`, but a host-side closed drawer legitimately measures 0. A user with a saved width of 380 gets `420` snapshotted on the next persist when their drawer is closed, locking the wrong value for the whole "tabs facet off" window.
- Suggestion: Distinguish "host drawer closed" (keep last-known width or read CSS var) from "measurement failed" (fall back to 420). Snapshot width on the open→close transition only.
- Status: addressed

## Praise

- Suffix-drift self-heal (`apply.ts:425-441`) is a real fix and the `candidates.length === 1` guard is correct for the non-sibling case.
- `readPrimaryOpen/Width` host-vs-mirror dispatch (`persist.ts`) is a clean factoring — single shape, two backends.
- `moveBuiltInTabToSecondaryContainer` extraction (builtin-move.ts:81) cleanly separates placement from finalize, even if finalize is still duplicated.
- `tab-assignments-conflict.ts` correctly handles the "X-during-busy" race via `if (_busy) return` and the host-swap via `if (_host === host) setBusy(false)`; idempotent under all observed sequences.
- `requestPersistTabAssignments(false)` ordering — `flushPendingSaves` + `syncLastLoadedFromPersistedLayout` **before** `setSettings(false)` — correctly captures the freeze base.
- `normalizeCanvasSettings` test additions (state.test.ts:131-150) exercise the realistic production call and verify the invariant directly.

## Test confidence

- **High:** `tab-assignments-diff.ts` (new diff module), `state.ts` invariant tests, `main-tab-pin.test.ts` button-reconcile paths, `main-persist-host-active.test.ts`.
- **Medium:** `applyLayout` happy path (Promise resolves, suppress flags set) — covered by integration but the cancel race (Issue 1) and the bare-id early-return miss (Issue 4) have no targeted assertion.
- **Low:** `main-mirror-drawer.ts` 614 LoC has **zero direct tests**. The 16 ms `scheduleRestoreTabThenUnsuppress` poll, `stampPanelBodyHide` rAF dedup, `_panelHideObserver`, `startReparkWatch`, and the four-mechanism hide stack (Issue 7) are un-tested. A regression in any of them would only be caught by manual QA.
- **Missing:** No test for `parseLayoutBlob` boundary (Issue 6) — there is no boundary to test. No test for `persistSettings` mid-restore gate (Issue 3). No test for sibling-tab suffix self-heal ambiguity (Issue 5).

## Counts

bugs: 5 (Issues 1-5) · suggestions: 8 (Issues 6-13) · nits: 3 (Issues 14-16)

---

## Remediation (2026-07-10)

All 16 issues addressed in working tree (not yet committed as a single remediation commit at review time). Summary:

| # | Fix |
|---|-----|
| 1 | `_restoreGeneration` token; cancel bumps gen; finishRestore/kickAssign/attemptRestore short-circuit |
| 2 | `.catch(dwarn)` on finishRestore + applyMainDrawer import paths; unsuppress on applyMainDrawer failure |
| 3 | `persistSettings` gates on `isLayoutRestoreActive()` |
| 4 | Built-in early-return dual-id (`idsToTry` resolvedId + tabId) |
| 5 | `tab-id-heal.ts` bipartite `pairStoredToLiveIds`; apply.ts uses shared strip + heal |
| 6 | `parseLayoutBlob` + tests; applyLayout / applyMainDrawer gate |
| 7 | Dropped `RESTORE_HIDE_ATTR` + wrapper inline hide; keep class CSS + stamp + observer |
| 8 | `main-mirror-drawer.test.ts`, `restore-poll.test.ts` |
| 9 | Repark idle-stop after `REPARK_IDLE_STOP_COUNT` consecutive parked ticks |
| 10 | `finalizeAssignToSecondary` + `assignExtensionTabToSecondary` / `assignBuiltInTabToSecondary` |
| 11 | `mergeCanvasSettings` ends with `normalizeCanvasSettingsFields` |
| 12 | Static imports in main-mirror-drawer for reflow/handles/persist/drawer-sync/panel-header-sync |
| 13 | Lighter poll: hoist mirror import; skip stamp in mirror mode; phase split |
| 14 | Dropped dead `'mounting'` from `SecondaryDrawerState` |
| 15 | Dropped redundant `:tab:${id}:` clause |
| 16 | `readPrimaryWidth` keeps `_lastKnownPrimaryWidth` when host measures 0 |

Also: apply-restore T19 cancel-race; parse-layout + tab-id-heal unit tests.
