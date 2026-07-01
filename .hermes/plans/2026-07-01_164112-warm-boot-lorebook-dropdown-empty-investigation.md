# Investigate: Lorebook dropdown empty on warm-boot from layout persistence (NOT a Canvas-bug-confirmed issue)

> **For Hermes:** This is an INVESTIGATION plan, not an implementation plan. The previous plan (`2026-07-01_103948-...md`) shipped three commits that fix the COLD-BOOT case correctly. This plan investigates a SEPARATE warm-boot dropdown-empty symptom with strong evidence the cause is NOT in `canvas_ext`. Do NOT modify `canvas_ext/src/**` until the root cause is confirmed to be Canvas-fixable (see §5 Decision gate).

**Goal:** Determine why the Lorebook dropdown is empty on warm-boot restore (Lorebook already in secondary drawer via `layoutPersistence`) given that the cold-boot case (no persisted tabs → right-click move Lorebook) WORKS, and given that all Canvas-side diagnostics show the warm-boot code path completing end-to-end without error.

**Architecture context:** Lumiverse's Lorebook React component is part of Lumiverse itself (path: `$HOME/Lumiverse/frontend/src/components/world-book/`, `$HOME/Lumiverse/frontend/src/hooks/useFolders.ts`). It is not a third-party extension. Canvas moves tab DOM roots between drawers but does NOT own the Lorebook React component's data-fetch logic.

---

## Live progress

| Task | Title | Status | Commit / Evidence |
| --- | --- | --- | --- |
| 1 | Cold-boot fix (shipped) | ✅ done | `f4650ec` `5e4672a` `4e8ec75` |
| 2 | Diagnostic breadcrumbs for warm-boot path exits (shipped) | ✅ done | `aab95ad` |
| 3 | Revert diagnostic breadcrumbs OR keep them pending parent decision | ⏳ not started | – |
| 4 | Capture Network panel log from COLD-boot working state | ⏳ blocked on user | – |
| 5 | Diagnose which request is the actual root cause | ⏳ blocked on 3 & 4 | – |

---

## 1. What we know with HIGH confidence

### Shipped work — verified correct, do not revert

| Commit | What | Verified |
|---|---|---|
| `f4650ec` | Adds `ensureBuiltInTabActiveInMain(tabId, hooks?)` helper at `src/tabs/assignment.ts:119` | 4/4 unit tests (`bun run src/tabs/__tests__/ensure-builtin-active.test.ts`) |
| `5e4672a` | Wires `await ensureBuiltInTabActiveInMain(tabId)` at the top of `assignTab`'s `if (sidebar === 'secondary')` branch | 4/4 wiring tests (`bun run src/tabs/__tests__/assign-tab-wiring.test.ts`); 0 regressions across `assignment.test.ts`, `activation-handoff.test.ts`, `activation-handoff-lumiscript.test.ts`, `buttons.test.ts` (106 assertions total, all green) |
| `4e8ec75` | Adds three `[canvas-debug] ENSURE_ACTIVE_{BEGIN,CLICK,DONE}` breadcrumbs inside the helper | Pre-existing T4 assertion was updated from `logged.length === 1 && logged[0].includes('button-not-found')` to `logged.some(l => l.includes('button-not-found'))` to accommodate the always-fires BEGIN log |

These three commits together fixed the **cold-boot** case (right-click move Lorebook to secondary → dropdown loads). This is verified by independent test runs and by the user's manual test.

### Warm-boot breadcrumb evidence (from `aab95ad`)

The user reported that warm-boot leaves the Lorebook dropdown empty. The diagnostic commit `aab95ad` added four breadcrumbs to `src/sidebar/secondary-drawer.ts`'s built-in branch. The user's boot log showed:

```
[SecondaryDrawer] assigning lorebook to secondary (ext=unknown)
[canvas-debug] ASSIGN_SEC_BUILTIN_ENTER           tab=lorebook hasStoreTab=false        hasSecondaryContent=true
[canvas-debug] ASSIGN_SEC_BUILTIN_AFTER_DOM_LOOKUP tab=lorebook rootFound=false         rootTagId=null
[canvas-debug] ASSIGN_SEC_BUILTIN_LAZY_MOUNT      tab=lorebook branch=LAZY_MOUNT_OK    getBuiltInTabRootReturned=element
addSecondaryTabButton: id=lorebook title="Lorebook" iconSvg=true iconUrl=false shortName="Lore" showLabels=true
applyLayout: LumiScript fallback matched stored "lorebook" via main button → live "lorebook"
XHRGET  http://localhost:9000/api/v1/settings/worldBookFolders
[HTTP/1.1 404 Not Found 4ms]
```

**Interpretation:**

1. `assignToSecondary('lorebook')` is reached.
2. The Zustand store has not yet populated Lorebook's `root` field (`hasStoreTab=false`) — this is normal during Lumiverse's initial mount phase.
3. The DOM-by-data-attribute fallback does not find Lorebook's root in `_mainContent` (`rootFound=false`), because Lorebook is NOT currently the active tab in main.
4. The lazy-mount fallback at `src/sidebar/secondary-drawer.ts:311-318` succeeds: Lumiverse's `getBuiltInTabRoot('lorebook')` returns a real `HTMLElement` (`branch=LAZY_MOUNT_OK`).
5. The secondary tab button is added normally.
6. A second restore path via the suffix-drift main-button fallback at `src/layout/apply.ts:209` also fires — confirming the warm-boot detection works.
7. **Lorebook's React component successfully mounts and fires `useEffect`** — proven by the next observable action being the XHR.
8. **The XHR returns 404**.

### The 404 is by design (HIGH-confidence refutation)

The Lorebook React component's `useFolders` hook (`$HOME/Lumiverse/frontend/src/hooks/useFolders.ts:13-19`) handles this 404 explicitly:

```ts
useEffect(() => {
  settingsApi
    .get(settingsKey)   // settingsKey = 'worldBookFolders'
    .then((row) => {
      if (Array.isArray(row.value)) {
        setStoredFolders(row.value)
      }
    })
    .catch(() => {
      // Setting doesn't exist yet — that's fine
    })
}, [settingsKey])
```

The 404 is the expected first-call response when no `worldBookFolders` setting row has been written yet. The catch swallows it. The dropdown is meant to derive its options from `storedFolders ∪ items-discovered-folders`, where `items` is the books-list — the 404 doesn't render an empty dropdown on its own.

### Canvas does NOT touch the lorebook fetch URL

- Zero hits for `worldBookFolders` in `/home/jared/canvas_ext/src/**` and zero hits in `/home/jared/canvas_ext/node_modules/**` (verified with `grep -rn`).
- Canvas's `backend.ts` (per prior reads) only handles `SET_DEBUG`, `SAVE_LAYOUT`, `LOAD_LAYOUT`. No lorebook / worldbook path.
- Lumiverse's API contract for worldbooks is `/api/v1/world-books/...` (plural-hyphen, see `$HOME/Lumiverse/src/app.ts:439`). There is no `/api/v1/worldBookFolders` or `/api/v1/lorebook/...`. The 404'd URL is the parameterized settings endpoint with `worldBookFolders` as the `:key` value, which is a legitimate (just empty) URL shape.

### Conclusion so far

**Canvas is doing its job end-to-end on warm-boot.** The Lorebook React component mounts, fires a useEffect, makes a request, and gets back 404. The 404 is by-design and not the proximate cause of the empty dropdown. The actual proximate cause is **some other side of the Lorebook React component's data flow** — most plausibly a *books-list* fetch, which is a separate request from the one we see 404'd, OR a stale-state issue with how Lorebook re-derives its dropdown when its host DOM is moved between drawers.

The empty dropdown is therefore most likely a **Lumiverse-Lorebook-component bug** (or an upstream issue we don't have visibility into), not a Canvas bug.

---

## 2. What is NOT a Canvas-side root cause (ruled out)

| Hypothesis | Ruling-out evidence |
|---|---|
| `getBuiltInTabRoot` returns `undefined` on warm-boot because Lumiverse only mounts active tabs | Refuted: `branch=LAZY_MOUNT_OK getBuiltInTabRootReturned=element` |
| Canvas's DOM-reparenting destroys the React fiber's mount state | Refuted: the XHR fires, proving Lorebook's `useEffect` ran |
| The TabAssignment bookkeeping is wrong on warm-boot | Refuted: `addSecondaryTabButton` succeeded, the drawer renders Lorebook |
| `armMainDrawerActiveRestore` should fire on warm-boot | N/A — that mechanism only exists to recover from the cold-boot `requestTabLocation` re-render; it has no role on warm-boot |
| Canvas's URL construction is wrong | Refuted: Canvas constructs zero URLs that would result in `worldBookFolders` |
| The 404 itself causes the empty dropdown | Refuted: `useFolders.ts:18-20` explicitly handles 404 with `.catch(() => {})` |

---

## 3. Open diagnostic questions

The next agent must answer these in order before writing Canvas-side code:

### Q-DIAG-1: Does the COLD-boot (working) case request the SAME URLs, with the SAME 404 pattern, and still produce a populated dropdown?

**Why it matters:** If cold-boot ALSO requests `/api/v1/settings/worldBookFolders` and ALSO gets 404, then the 404 is irrelevant (confirmed for cold-boot, already known) and the bug is something else — likely a books-list fetch or a stale-state issue affecting the warm-boot path specifically.

**How to verify (USER ACTION):** Hard-refresh Lumiverse with `layoutPersistence` set to OFF (or use a fresh browser profile with no persisted layout). Right-click the Lorebook main button → "Move to second drawer". Open DevTools Network panel. Filter by "lorebook" or "worldbook" or "XHR". Paste the full request list (method, URL, status, size, timing) into a comment or reply.

If cold-boot requests `<5` URLs and all return 200 → the warm-boot requests differ from cold-boot, and the diff is the bug.
If cold-boot requests the same `/api/v1/settings/worldBookFolders` 404 AND has additional requests that warm-boot lacks → the missing additional request is the bug.

### Q-DIAG-2: When Lorebook's React component remounts (or continues from previous session) on warm-boot, what data flow populates its dropdown?

**Why it matters:** Lorebook fetches BOTH a settings row (for stored folder names) AND a books list. The dropdown contents derive from both. If the books-list fetch fires with a different timing on warm-boot vs cold-boot, or with different parameters, the dropdown contents would differ.

**How to verify (NEXT AGENT ACTION):** Read `$HOME/Lumiverse/frontend/src/components/world-book/WorldBookPanel.tsx` and `$HOME/Lumiverse/frontend/src/components/modals/WorldBookEditorModal.tsx`. Find the `useEffect` or `useQuery` that fetches the books list (likely `$HOME/Lumiverse/frontend/src/api/world-books.ts:listBooks` or similar). Check:
- Does the books-list fetch have a dependency array that includes the components-mount timestamp, drawer location, or some other state that differs between cold-boot and warm-boot?
- Is the books-list fetch deduplicated or cached in a way that the warm-boot path skips it?
- Does the `WorldBookPanel` render anything different when it sees its host element arriving via `secondary-drawer.ts`'s lazy-mount vs cold-boot's `assignTab`?

The answer here points to either "this is a Lumiverse bug to file upstream" or "this is a Canvas-fixable bug where we need to re-fire the books-list fetch from Canvas's side."

### Q-DIAG-3: Is the Lorebook dropdown's expected-to-be-populated contents actually empty on cold-boot too — i.e., did the cold-boot "working" report have a populated dropdown, or did you (the user) eyeball a fresh-looking UI and miss that it was also empty?

**Why it matters:** The original plan was triggered by the user's report that cold-boot works. If on inspection cold-boot ALSO has an empty dropdown (just less noticeable because the Lorebook tab is being moved for the first time), then the entire diagnostic chain is downstream of a misclassified symptom and the real bug is in the Lorebook React component regardless of move path.

**How to verify (USER ACTION):** On a cold-boot working state, click into the Lorebook dropdown UI and confirm whether there are entries vs whether it's empty. If empty, the original plan's premise is wrong.

---

## 4. Constraints honored

This plan does NOT propose Canvas-side code changes. Specifically:
- **No edits** to `src/tabs/assignment.ts`, `src/sidebar/secondary-drawer.ts`, `src/layout/apply.ts`, `src/backend.ts`, `src/frontend.ts` until Q-DIAG-1, Q-DIAG-2, Q-DIAG-3 are answered.
- **No edit** to the existing plan file `2026-07-01_103948-fix-lorebook-dropdown-after-tab-move.md` — that plan's three commits already shipped and are correct as far as they go.
- The diagnostic breadcrumbs from `aab95ad` may be kept (useful for future debugging) or reverted (clean up noise) — parent's call (Task 3 in the Live progress table).

If Q-DIAG-1 reveals warm-boot is missing a request cold-boot makes, AND Q-DIAG-2 confirms the Lorebook React component is set up to re-fetch on a specific lifecycle signal that Canvas controls (e.g., `data-canvas-active` attribute change), then a fifth commit may be warranted — extending `ensureBuiltInTabActiveInMain` or adding a sibling helper that fires a synthetic event on the moved root after `requestTabLocation` completes. **Do not write that commit without first confirming Q-DIAG-1.**

---

## 5. Decision gate

The next agent must produce a written verdict in their final assistant message stating ONE of:

1. **"Lumiverse Lorebook bug — not Canvas-fixable."** Document the bug location and code path in Lumiverse source, file upstream against the Lorebook component author, mark Tasks 1-4 ✅. The Canvas-investigation chain is exhausted.

2. **"Canvas-fixable — re-fetch trigger."** Identify which request is missing on warm-boot, design a small Canvas-side hook that re-issues it, ship a fourth commit. Document the fix in a new sibling plan file (e.g., `2026-MM-DD-warm-boot-lorebook-rerefix.md`) — do NOT amend `2026-07-01_103948-...md`.

3. **"User's original report is wrong — cold-boot ALSO has empty dropdown."** Mark Q-DIAG-3 as the resolution. Surface the re-classification to the user. Cancel Tasks 4-5. The three shipped commits may remain (they're harmless) or be reverted if they're known to be unnecessary.

---

## 6. Files & evidence for next agent to re-read

Before writing any verdict, re-read these to confirm line numbers have not drifted:

- `/home/jared/canvas_ext/src/sidebar/secondary-drawer.ts` (currently ~500 lines; diagnostics at the four breadcrumb lines from `aab95ad`)
- `/home/jared/canvas_ext/src/tabs/assignment.ts` (currently 303 lines; helper at `:119`, wiring at `:230`, breadcrumbs at `:129, 147, 156`)
- `/home/jared/canvas_ext/src/layout/apply.ts` (lines 173-219 contain `attemptRestore`; lines 267-282 contain the observer setup)
- `/home/jared/Lumiverse/frontend/src/hooks/useFolders.ts` (confirm lines 13-19 still swallow 404)
- `/home/jared/Lumiverse/frontend/src/components/world-book/WorldBookPanel.tsx` (this is the file Q-DIAG-2 requires reading)
- `/home/jared/Lumiverse/src/app.ts:439` (confirm `/api/v1/world-books` is still mounted)
- `/home/jared/Lumiverse/frontend/src/api/world-books.ts` (books-list API client)

Tests to run before verdict:

```
cd /home/jared/canvas_ext
bun run src/tabs/__tests__/ensure-builtin-active.test.ts
bun run src/tabs/__tests__/assign-tab-wiring.test.ts
bun run src/tabs/__tests__/assignment.test.ts
bun run src/tabs/__tests__/activation-handoff.test.ts
bun run src/tabs/__tests__/activation-handoff-lumiscript.test.ts
bun run src/tabs/__tests__/buttons.test.ts
bun run typecheck
```

All must remain green. If any fail, stop — the previous-commits' state has been disturbed by something; investigate before proceeding.

Working-tree state at plan authorship (must be re-confirmed by next agent):

```
$ git status --short
 M .gitignore       (pre-existing — not yours)
M  dist/frontend.js (staged build artefact from `bash build.sh` — not yours)
?? .hermes/         (pre-existing untracked directory — not yours)
```

---

## 7. Open questions to surface to the user

The next agent who acts on this plan should ask the user (or surface at completion):

- **Q-DIAG-1 (action required):** "Please capture one Network panel log from a cold-boot + right-click-move-Lorebook session with `layoutPersistence` off. Paste the full request list."
- **Q-DIAG-3 (action required):** "When you open Lorebook on cold-boot working state, is the dropdown actually populated with entries, or does it appear empty and you only saw 'working' because the move animation looked smooth?"
- If the user can capture Network panel from WARM-boot also (Q-DIAG-1's other side), that's ideal — two logs side by side.

---

## 8. Risks of this plan being wrong

- **If the user provides the cold-boot Network log and it differs from warm-boot in a way that's actionable:** the next agent will likely produce a Canvas-fixable bug. This is plausible (and the originally-pleasant-looking right-click-move-to-secondary may have hidden the same bug, just less observably).
- **If the cold-boot Network log is identical to warm-boot:** the bug is definitively NOT in Canvas. The next agent should escalate upstream.
- **If the user reports "yes, cold-boot ALSO has empty dropdown":** the original plan's premise is wrong. Mark the warm-boot case as moot. Revert the three implementation commits only if you have explicit user approval.

---

## 9. What to report back when this plan completes

A single assistant message with:

1. Verdict from the §5 Decision gate (one of: Lumiverse bug / Canvas-fixable re-fetch / user-report-wrong).
2. Re-read line numbers verified unchanged from §6.
3. Test run output (all 6 test files + typecheck).
4. Any new commits shipped (only if §5 verdict is #2; should be exactly one new commit).
5. Whether `aab95ad` was kept or reverted.
6. The user's response to Q-DIAG-1 and Q-DIAG-3 (verbatim).

If any §5 verdict is final, also append:

```
## handoff: chain complete

verdict: <#1 / #2 / #3>
chain: 2026-07-01_103948 → 2026-07-01_164112 → (this message)
final state of canvas_ext: <SHAs of all commits in main, ahead of origin/main by N>
```
