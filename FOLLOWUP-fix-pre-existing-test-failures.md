# Follow-up: Fix pre-existing test failures in canvas_ext

## Status (2026-06-22)

**8 of 9 pre-existing failures resolved by Phase 2 of the cleanup refactor** (see `CANVAS-REFACTOR-PLAN-REVISED.md`):

- `src/context/__tests__/secondary-ctx.test.ts` (44KB) was deleted along with
  `src/context/secondary-ctx.ts` in the Phase 2 commit "delete re-execution
  subsystem". The 8 failures (T4, T5, T14, T15×2, T21) went with the file.
- `src/tabs/__tests__/reposition-tab-clears-display.test.ts` (4 failures: T15,
  T22, T26) was deleted along with the now-removed `repositionTab` in Phase 1.

**1 failure remains in `src/tabs/__tests__/buttons.test.ts`** — 21 inline-style
assertion failures, not the single `ReferenceError: window is not defined`
originally characterized. The test was written to guard a specific
`!important` inline-style fix (commit cb56bc3) that has since been
superseded by CSS-driven styling in `src/sidebar/styles.ts`. The
test-assertion-vs-actual-behavior mismatch will be addressed in Phase 5.2
(rewrite alongside the showSecondaryTab simplification) per the plan.

## Original goal

Fix 9 pre-existing test failures in canvas_ext on branch `feat/spindle-tab-mobility-v2`. These failures were surfaced during the tab-mobility work but are **not caused** by the Option D fix (commit `ecd952c` "fix(tabs): reparent extension tab root on drawer move to preserve state"). The failures were verified pre-existing by git-stash baseline comparison.

## The 9 failures (original list)

### `src/context/__tests__/secondary-ctx.test.ts` — 8 failures — **RESOLVED (file deleted)**

| Test | Approx. error type | Notes |
|------|-------------------|-------|
| T4 | (not yet characterized) | secondary context test |
| T5 | (not yet characterized) | secondary context test |
| T14 | (not yet characterized) | |
| T15 | (not yet characterized) — **2 cases** | counts as 2 failures |
| T21 | (not yet characterized) | |

### `src/tabs/__tests__/buttons.test.ts` — 1 failure — **RECLASSIFIED (21 inline-style failures, deferred to Phase 5.2)**

| Test | Error |
|------|-------|
| (all tests in this file) | `ReferenceError: window is not defined` |

The original `window is not defined` error has since been resolved by adding
a `(globalThis as any).window = ...` stub at `buttons.test.ts:191`. The
remaining 21 failures are assertion mismatches between the test (which
expects `!important` literal `#9370db` inline styles) and the current
production code (which uses CSS rules in `src/sidebar/styles.ts`).

## Prior work to read first

- gbrain page: `orchestrator/tab-state-loss-on-drawer-move` — full investigation that surfaced these failures
- gbrain page: `projects/canvas-extension` — esp. **CRITICAL: Build & Deployment Gotcha** section (after every code change, sync `dist/` to `~/Lumiverse/data/extensions/canvas/repo/dist/`)
- gbrain page: `orchestrator/canvas-builtin-vs-extension-tab-review-v4` — recent audit context
- Recent commit: `ecd952c` on `feat/spindle-tab-mobility-v2` — confirm it is HEAD, do not revert
- State file: `~/.local/share/opencode/orchestrator-tab-state-loss-on-drawer-move.json` — verification record

## Workspace

`/home/jared/canvas_ext`. Branch `feat/spindle-tab-mobility-v2`. Activate Serena project `canvas_ext` first.

## Approach

1. **Re-confirm baseline.** From a clean working tree at HEAD (`ecd952c`), run `bun test 2>&1 | tail -50` to see the current failure list. Confirm the 9 failures are still present and unchanged. **Do not skip this step** — the failure list may have drifted.

2. **Read the test files.** Open `src/context/__tests__/secondary-ctx.test.ts` and `src/tabs/__tests__/buttons.test.ts` in full. Note the test harness pattern, what is mocked, and what the failing tests assert.

3. **For each failure, classify the root cause:**
   - **Test bug** (assertion wrong, mock missing, environment not stubbed) — fix in the test file
   - **Production code bug** (the test correctly catches a real bug) — fix in the production code
   - **Test harness limitation** (the test framework can't exercise this path) — document the limitation, consider removing or skipping the test with a clear comment

4. **For `buttons.test.ts` `window is not defined`:** the fix is likely to add a global stub at the top of the file. Look at `src/sidebar/__tests__/secondary-drawer.test.ts` (which the Option D work just rewrote) for the pattern — it stubs `document.createElement`, `globalThis.window`, etc. Apply the same pattern.

5. **For `secondary-ctx.test.ts` failures T4/T5/T14/T15/T21:** these tests exercise the secondary context (`src/context/secondary-ctx.ts`) which was modified by the recent tab-mobility work. Check git log for `secondary-ctx.ts`:
   ```
   git log --oneline -10 src/context/secondary-ctx.ts
   git log --oneline -10 src/context/__tests__/secondary-ctx.test.ts
   ```
   The failures may be tests that were written before the recent refactor and now exercise changed behavior. Compare the test expectations to the current production behavior; update tests to match (if the production code is correct) or fix production code (if the test correctly catches a regression).

6. **Investigate, then fix.** For each failure:
   - Read the test to understand what it asserts
   - Read the production code to understand actual behavior
   - Run just that test in isolation: `bun run src/context/__tests__/secondary-ctx.test.ts 2>&1 | tail -30` (or `buttons.test.ts`)
   - Diagnose, then fix

## Verification

After all fixes:

1. **Run the targeted test files** to confirm the 9 failures are resolved.
2. **Run the full suite** to confirm no new regressions:
   ```
   bun test 2>&1 | tail -30
   ```
   Expected outcome: **570/570 pass** (or 570 - any tests you intentionally removed with documented reason).
3. **Build:** `bun run build` — must succeed.
4. **Deploy:** `cp dist/frontend.js dist/backend.js ~/Lumiverse/data/extensions/canvas/repo/dist/`.
5. **Check `git status`:** confirm only intended files are modified.

## Build & deploy gotcha

After **every** code change (test or production):
```bash
cd ~/canvas_ext && bun run build
cp dist/frontend.js dist/backend.js ~/Lumiverse/data/extensions/canvas/repo/dist/
```
Skipping the `cp` step is a silent no-op for the running Lumiverse.

## Constraints

- Do **not** revert commit `ecd952c` or any of the Option D work.
- Do **not** modify `src/sidebar/secondary-drawer.ts` — it is the source of truth for the Option D fix and the recent tests depend on it.
- Production code is the ground truth. If a test was written based on stale behavior, update the test, not the production code — unless you find a genuine production bug, in which case fix both and document the regression.
- For `buttons.test.ts` `window is not defined`: the fix is in the test file, not in production code. Buttons production code runs in Lumiverse's browser environment, where `window` exists.
- Do not silence failing tests (`it.skip`, `expect.assertions(0)`, etc.) without an explicit comment explaining why and proposing a follow-up.

## Out of scope

- Do not address the Option D fix itself; it is shipped.
- Do not address the 9 pre-existing failures in a way that requires Lumiverse-side changes (none should be needed; the failures are in canvas_ext test setup).
- Do not refactor unrelated test code.

## Done criteria

- All 9 failures resolved (or removed with documented reason).
- Full test suite: 570/570 pass.
- Build succeeds; dist synced to deployment path.
- Commit message in conventional-commit style, e.g.:
  ```
  test(secondary-ctx): fix 8 pre-existing test failures after tab-mobility refactor
  test(buttons): stub global window to fix ReferenceError
  ```
  (or combined into one commit if the fixes are interrelated).
- A CHANGELOG.md entry noting "Fixed 9 pre-existing test failures" (optional but recommended for hygiene).
