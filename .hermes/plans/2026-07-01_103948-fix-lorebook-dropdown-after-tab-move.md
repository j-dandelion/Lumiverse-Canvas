# Fix: Lorebook dropdown doesn't load after moving the Lorebook tab to the secondary drawer

> **For Hermes:** This plan calls for code changes in `/home/jared/canvas_ext`. Use `test-driven-development` skill during implementation.

## Live progress

| Task | Title | Status | Commit |
| --- | --- | --- | --- |
| 1 | `ensureBuiltInTabActiveInMain` helper (TDD) | ✅ done | `f4650ec` |
| 2 | Wire pre-activation into `assignTab` secondary path | ✅ done | `5e4672a` |
| 3 | dlog breadcrumbs + manual verification (commit only; Q2/Q4 deferred to user) | ✅ done | `4e8ec75` |

**Goal:** Make the Lorebook tab fully functional when moved to the secondary drawer, including the lorebook-picker dropdown, even when the user did **not** activate the Lorebook tab in the main drawer first.

**Architecture:** New helper `ensureBuiltInTabActiveInMain(tabId)` in `src/tabs/assignment.ts`. At the top of `assignTab`'s secondary-side branch (before the `builtInRoot` check), the helper activates the tab in the main drawer by clicking its main-sidebar button — which triggers Lumiverse to mount the built-in root (and run any mount-time data fetch, including Lorebook's). On the next line, `getBuiltInTabRoot(tabId)` returns the just-mounted root, the `builtInRoot && bridge` gate passes, and the existing built-in branch handles the rest of the move. The helper is a no-op when the tab is already active or on mobile (where the main sidebar is hidden).

**Tech Stack:** Bun, TypeScript, Preact, Lumiverse Spindle host bridge (`window.spindle`).

---

## 1. Current context / assumptions

### Verified contract (post-critic review, 2026-07-01)

| Contract | Source | Verified |
|----------|--------|----------|
| `bridge.ui.getBuiltInTabRoot(tabId): HTMLElement \| undefined` | `src/dom/host-bridge.ts:26`, exposes Lumiverse type at `node_modules/.pnpm/lumiverse-spindle-types@*/.../src/dom.ts:820` | ✅ |
| `bridge.ui.requestTabLocation(tabId, loc)` | `host-bridge.ts:28`, `dom.ts:816` | ✅ |
| `findMainTabButton(tabId): Element \| null` (note: `Element`, not `HTMLElement`) | `src/tabs/buttons.ts:47` | ✅ |
| `isTabActiveInMainDrawer(tabId): boolean` with DOM fallback | `src/tabs/active-tab.ts:59` | ✅ |
| `isMobileViewport(): boolean` (uses `matchMedia('(max-width: 600px)')`) | `src/sidebar/mobile-exclusion.ts:73` | ✅ |
| Built-in tabs are tagged with `data-tab-id="lorebook"` (and similar) by Lumiverse's `ViewportDrawer.tsx`, NOT by `tagMainSidebarButtons` (which only re-tags extension tabs) | `src/sidebar/secondary-drawer.ts:118-122`, `src/chat/tag-buttons.ts:35-64` | ✅ |
| Bun provides `requestAnimationFrame` in headless test mode (existing tests use it via `setTimeout(…,0)` stub pattern) | `src/tabs/__tests__/assign-tab-wiring.test.ts:51-54` | ✅ |
| `requestTabLocation` call sits in built-in branch at `src/tabs/assignment.ts:147-182` | direct read | ✅ |

### Root cause (corrected after critic review)

Critic flagged that my original framing was wrong. The *actual* contract, per the comment at `src/sidebar/secondary-drawer.ts:266-275`:

> **"BUILT-IN TAB LIMITATION**: Lumiverse only renders the ACTIVE tab's root in the main panel content. For built-in tabs (extensionId='unknown'), the only way to get the root is to make the tab active."

This means **root absence, not "root present but component un-mounted."** Concretely:

- The Lorebook tab's root element does not exist in the DOM at all until Lumiverse decides to render it as the active built-in.
- When the user moves Lorebook to secondary *without first activating it in main*, the root has never been mounted, so Lorebook's React component has never run, so no mount-time data fetch has occurred, so the dropdown has no entries.
- When the user *does* open Lorebook in main first, Lumiverse mounts the root + the React component runs + the data fetch fires. `appendChild` of an already-mounted root preserves the React fiber (and any state/fetched data on it) when Canvas reparents it to the secondary drawer.

So the fix is: **activate Lorebook in main before `requestTabLocation`.** That makes Lumiverse mount the root + run the component + complete the data fetch. Then `requestTabLocation` reparents an already-mounted root, and the dropdown data travels with the React fiber.

### Existing pitfalls the fix must navigate

1. **`armMainDrawerActiveRestore` ordering** (`src/tabs/assignment.ts:73-87`): this MutationObserver arms *after* our pre-activation, captures Lumiverse's `pendingActiveTabReset` useEffect re-clicking the originally-active tab after `requestTabLocation`. Our pre-activation must NOT disturb this mechanism. Since `armMainDrawerActiveRestore` only reads `restoreBtn` synchronously at line 81-82 and the post-`requestTabLocation` swap happens in Lumiverse's React commit (~16-200ms after), there's no race: pre-activation runs first, then the arm runs with Lorebook as the active tab, then `requestTabLocation` triggers the swap, then the arm's observer catches the swap.

2. **`runHandoff` Part A / Part C** (`src/tabs/activation-handoff.ts:428-444`): after the move, `runHandoff` activates the moved tab in secondary. Part C is unconditional on desktop, mobile-skipped on mobile. The pre-activation's effect (Lorebook now active in main) is consumed by `requestTabLocation`'s move — once the root is in the secondary, "active in main" no longer applies.

3. **`findMainTabButton` returns hidden buttons too** (resolves by `data-tab-id` regardless of `display`). This is fine for our purposes — we want to click the Lorebook button even if Canvas previously hid it from a prior session, because the bug case is exactly "user has not interacted with Lorebook in main yet."

### Constraints honored by the fix

- Mobile (`isMobileViewport()` returns true): skip pre-activation entirely (main sidebar hidden). Mobile is covered only if Lumiverse's `requestTabLocation` paths mount the root lazily inside the secondary drawer. If not, mobile will exhibit the bug and we'll address it as a follow-up.
- Already-active in main: no-op (avoid reactive flicker that would briefly empty an already-populated dropdown).
- No `requestTabLocation` or `getSecondaryWrapper` calls from the helper — it is a pure "click and wait for commit" step.

---

## 2. Proposed approach

One helper, one wiring test, one wiring step. Three tasks total (mobile retry dropped as YAGNI per critic).

### Why this is the right seam

- The data fetch lives inside Lorebook's React component, mounted only when Lumiverse decides to render Lorebook as the active built-in. We cannot trigger that mount any other way through the documented bridge surface (`spindle.ui.*` has no `mountBuiltin`/`setTabData` style method). Clicking the tab button is the supported mechanism.
- We do not fabricate the root or shadow Lumiverse's React — `requestTabLocation` remains the authoritative mover; pre-activation just makes sure the root exists before the move.
- The fix is purely a setup step before the `builtInRoot` check. No CSS changes, no DOM mutations outside the main sidebar, no backend changes.

---

## 3. Step-by-step plan

### Task 1: `ensureBuiltInTabActiveInMain` helper (TDD)

**Files:**
- Create: `src/tabs/__tests__/ensure-builtin-active.test.ts`
- Modify: `src/tabs/assignment.ts` — add new exported helper

**Step 1: Write failing test**

```ts
// src/tabs/__tests__/ensure-builtin-active.test.ts
import {
  ensureBuiltInTabActiveInMain,
  type EnsureActiveHooks,
} from '../assignment'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

async function main() {
  // T1: no-op when isTabActiveInMainDrawer says true
  {
    let clicks = 0
    await ensureBuiltInTabActiveInMain('lorebook', {
      isTabActiveInMainDrawer: () => true,
      findMainTabButton: () =>
        ({ click() { clicks++ } }) as unknown as Element | null,
      isMobileViewport: () => false,
      getBuiltInTabRoot: () => document.createElement('div'),
    })
    ok(clicks === 0, 'T1: no click when tab already active')
  }

  // T2: clicks once when not active and not mobile
  {
    let clicks = 0
    await ensureBuiltInTabActiveInMain('lorebook', {
      isTabActiveInMainDrawer: () => false,
      findMainTabButton: () =>
        ({ click() { clicks++ } }) as unknown as Element | null,
      isMobileViewport: () => false,
      getBuiltInTabRoot: () => document.createElement('div'),
    })
    ok(clicks === 1, 'T2: clicks once when not active and not mobile')
  }

  // T3: skips click on mobile even when not active
  {
    let clicks = 0
    await ensureBuiltInTabActiveInMain('lorebook', {
      isTabActiveInMainDrawer: () => false,
      findMainTabButton: () =>
        ({ click() { clicks++ } }) as unknown as Element | null,
      isMobileViewport: () => true,
      getBuiltInTabRoot: () => document.createElement('div'),
    })
    ok(clicks === 0, 'T3: no click on mobile')
  }

  // T4: emits dlog breadcrumb when main button not found (defensive)
  {
    let clicks = 0
    let logged: string[] = []
    await ensureBuiltInTabActiveInMain('lorebook', {
      isTabActiveInMainDrawer: () => false,
      findMainTabButton: () => null,
      isMobileViewport: () => false,
      getBuiltInTabRoot: () => undefined,
      dlog: (...a) => logged.push(a.join(' ')),
    })
    ok(clicks === 0, 'T4: no click when main button not found')
    ok(
      logged.length === 1 && logged[0].includes('button-not-found'),
      'T4: emits dlog breadcrumb when button not found',
    )
  }

  // T5: T1 runs again to verify (T1-T4 above are independent)
  console.log(`ensure-builtin-active: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
```

**Step 2: Run test to verify failure**

Run: `cd /home/jared/canvas_ext && bun run src/tabs/__tests__/ensure-builtin-active.test.ts`
Expected: import error — `ensureBuiltInTabActiveInMain` and `EnsureActiveHooks` are not exported yet.

**Step 3: Implement minimal helper**

```ts
// src/tabs/assignment.ts — new export, near other helpers (after line 90)

export interface EnsureActiveHooks {
  isTabActiveInMainDrawer?: (tabId: string) => boolean
  findMainTabButton?: (tabId: string) => Element | null
  isMobileViewport?: () => boolean
  getBuiltInTabRoot?: (tabId: string) => HTMLElement | undefined
  dlog?: (...args: unknown[]) => void
}

/**
 * Bug fix: built-in tabs (Lorebook, Databank, etc.) don't have their root
 * in the DOM unless Lumiverse decides to render them as the active tab.
 * Per the BUILT-IN TAB LIMITATION comment in src/sidebar/secondary-drawer.ts:
 * "Lumiverse only renders the ACTIVE tab's root in the main panel content."
 * Most built-ins populate dropdowns/tables via a React useEffect that fires
 * on component mount. So moving a never-activated built-in tab to the
 * secondary drawer reparents *nothing* — the root never existed.
 *
 * The supported mechanism to mount a built-in root is to make the tab
 * active in the main drawer, which Lumiverse does on tab-button click.
 * This helper does that activation as a setup step before requestTabLocation.
 *
 * No-op when the tab is already active in main (avoids a re-click that
 * would briefly empty an already-populated dropdown via React re-mount).
 * No-op on mobile (the main sidebar is hidden; clicks land on the wrong
 * element via the mobile flyout pattern). Mobile edge case is unhandled
 * in this fix; follow up if a mobile user reports it.
 *
 * See Task 3 (current plan) for caveats on the "clicking destroys the
 * sidebar" risk the existing code at secondary-drawer.ts:266-275 warns
 * about — in the user's specific workflow (stay-on-same-side swap) this
 * is benign because the existing addSecondaryTabButton path at
 * assignment.ts:177-181 already survives the same re-render on the
 * working "open in main first" path.
 */
export async function ensureBuiltInTabActiveInMain(
  tabId: string,
  h: EnsureActiveHooks = {},
): Promise<void> {
  const _isActive = h.isTabActiveInMainDrawer ?? isTabActiveInMainDrawer
  const _findBtn = h.findMainTabButton ?? findMainTabButton
  const _isMobile = h.isMobileViewport ?? isMobileViewport
  const _getRoot = h.getBuiltInTabRoot ?? (() => undefined)
  const _dlog = h.dlog ?? (() => {})

  if (_isActive(tabId)) return

  if (_isMobile()) {
    _dlog(`[tabmove] ensure-active: mobile, skipping pre-activation for "${tabId}"`)
    return
  }

  const btn = _findBtn(tabId)
  if (!btn) {
    _dlog(
      `[tabmove] ensure-active: main button-not-found for "${tabId}", ` +
      `relying on host lazy-mount`,
    )
    return
  }
  // btn is Element (per buttons.ts:47) — narrow at click site.
  ;(btn as HTMLElement).click()

  // Wait for one rAF (~16ms) so Lumiverse commits the activation and
  // Lorebook's mount useEffect fires. 1-16ms is the documented latency
  // of Lumiverse's pendingActiveTabReset useEffect
  // (see activation-handoff.ts:299-305); one rAF is above the floor
  // and below user-perceptible latency.
  await new Promise<void>(r => requestAnimationFrame(() => r()))

  const root = _getRoot(tabId)
  if (!root) {
    _dlog(
      `[tabmove] ensure-active: post-click root still null for "${tabId}"; ` +
      `move will fall through to host lazy-mount`,
    )
  }
}
```

**Step 4: Run test to verify pass**

Run: `cd /home/jared/canvas_ext && bun run src/tabs/__tests__/ensure-builtin-active.test.ts`
Expected: `ensure-builtin-active: 4 passed, 0 failed` (the body has 4 assertions, but the loop runs them each inside their own `{...}` block).

**Step 5: Commit**

```bash
git add src/tabs/__tests__/ensure-builtin-active.test.ts src/tabs/assignment.ts
git commit -m "feat(tabs): add ensureBuiltInTabActiveInMain helper for built-in pre-activation"
```

---

### Task 2: Wire pre-activation at the top of `assignTab`'s secondary path

**Insight from re-reading the code path:** the bug case is when `getBuiltInTabRoot(tabId)` returns `undefined` at `assignment.ts:146` — i.e., the user never activated the tab in main. In that case the built-in branch is skipped and code falls through to `assignToSecondary`. The pre-activation must therefore run **before** the `builtInRoot` check, so Lumiverse mounts the root and the subsequent check passes.

**Files:**
- Modify: `src/tabs/assignment.ts:142-144` (top of `if (sidebar === 'secondary')`) and `:147-181` (built-in branch)
- Create: `src/tabs/__tests__/assign-tab-wiring.test.ts`

**Step 1: Write failing wiring test**

```ts
// src/tabs/__tests__/assign-tab-wiring.test.ts
import { readFileSync } from 'fs'
import { join } from 'path'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

// T-WIRE-1: ensureBuiltInTabActiveInMain(tabId) must be called inside the
// secondary path of assignTab (guarded by `if (sidebar === 'secondary')`),
// and it must run BEFORE the `if (builtInRoot && bridge)` check that gates
// the built-in branch.
// This pins the call ordering: pre-activation first, so getBuiltInTabRoot
// returns a real (mounted) root, so the built-in branch matches.

const src = readFileSync(
  join(process.cwd(), 'src/tabs/assignment.ts'),
  'utf8',
)

const secondaryPath = src.match(
  /if\s*\(\s*sidebar\s*===\s*['"]secondary['"]\s*\)\s*\{[\s\S]*?\n\s*\}/,
)
ok(secondaryPath !== null, 'T-WIRE-1: assignTab secondary path found')

if (secondaryPath) {
  const body = secondaryPath[0]
  const ensureIdx = body.indexOf('ensureBuiltInTabActiveInMain(')
  // Built-in check is `if (builtInRoot && bridge)`. Match that exact
  // opening so we test against the right gate.
  const builtInGateIdx = body.search(/if\s*\(\s*builtInRoot\s*&&\s*bridge\s*\)/)
  ok(
    ensureIdx !== -1,
    'T-WIRE-1: ensureBuiltInTabActiveInMain is called inside secondary path',
  )
  ok(
    builtInGateIdx !== -1,
    'T-WIRE-1: built-in branch gate is present',
  )
  ok(
    ensureIdx !== -1 && builtInGateIdx !== -1 && ensureIdx < builtInGateIdx,
    'T-WIRE-1: ensureBuiltInTabActiveInMain runs BEFORE the built-in branch gate',
  )
}

console.log(`assign-tab-wiring: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
```

**Step 2: Run test to verify failure**

Run: `cd /home/jared/canvas_ext && bun run src/tabs/__tests__/assign-tab-wiring.test.ts`
Expected: `FAIL: T-WIRE-1: ensureBuiltInTabActiveInMain is called inside secondary path`

**Step 3: Add pre-activation at the top of the secondary path**

Modify `src/tabs/assignment.ts:142-144` — the very start of `if (sidebar === 'secondary')`:

```ts
  if (sidebar === 'secondary') {
    // BUG: Lorebook dropdown empty after move without pre-activation.
    // Lumiverse only renders the active built-in's root
    // (src/sidebar/secondary-drawer.ts:266-275). The Lorebook component
    // fetches its dropdown data on mount; a never-activated tab has no
    // root, so reparenting an absent root into secondary yields an empty
    // dropdown. Pre-activate so Lumiverse mounts the root + the useEffect
    // fires; subsequent `getBuiltInTabRoot(tabId)` will return a mounted
    // root and the built-in branch will handle the move normally
    // (requestTabLocation reparents a mounted React fiber, preserving
    // the fetched data).
    //
    // Caveat: clicking a main-sidebar tab *can* trigger a Lumiverse
    // re-render that destroys the main sidebar (see comment at
    // src/sidebar/secondary-drawer.ts:266-275). In the user's specific
    // workflow (stay-on-same-side swap) this is benign — the existing
    // addSecondaryTabButton path at assignment.ts:177-181 already
    // survives the same re-render on the working "open in main first"
    // path.
    await ensureBuiltInTabActiveInMain(tabId)
    // Built-in tabs: delegate to the host's requestTabLocation API.
    // Extension tabs fall through to SecondaryDrawer.assignToSecondary.
    const bridge = getHostBridge()
    const builtInRoot = bridge?.ui.getBuiltInTabRoot?.(tabId)
```

Leave the rest of the built-in branch unchanged. (`armMainDrawerActiveRestore` at line 157 already handles the post-`requestTabLocation` swap; the helper's no-op when already-active path means double-clicking the same button doesn't fire — Lumiverse's click handler is idempotent for the same target tab.)

**Step 4: Run test to verify pass**

Run: `cd /home/jared/canvas_ext && bun run src/tabs/__tests__/assign-tab-wiring.test.ts`
Expected: `assign-tab-wiring: 1 passed, 0 failed`

**Step 5: Run regression suite**

Run:
```
cd /home/jared/canvas_ext
bun run src/tabs/__tests__/assignment.test.ts
bun run src/tabs/__tests__/activation-handoff.test.ts
bun run src/tabs/__tests__/activation-handoff-lumiscript.test.ts
bun run src/tabs/__tests__/buttons.test.ts
```
Expected: all pass with no regressions.

**Step 6: Commit**

```bash
git add src/tabs/assignment.ts src/tabs/__tests__/assign-tab-wiring.test.ts
git commit -m "fix(tabs): pre-activate built-in tab in main before secondary move so dropdown loads"
```

---

### Task 3: Debug breadcrumbs + manual verification + deferred Q&A

**Files:**
- Modify: `src/tabs/assignment.ts` (add three `dlog` calls in the new code)
- Manual verification only — no test files

**Step 1: Add three dlog breadcrumbs**

Inside `ensureBuiltInTabActiveInMain`:

```ts
// (a) At the start, log intent:
// _dlog(`[canvas-debug] ENSURE_ACTIVE_BEGIN tab=${tabId} isActive=${_isActive(tabId)} mobile=${_isMobile()}`)
// (b) At the click site, before .click():
// _dlog(`[canvas-debug] ENSURE_ACTIVE_CLICK tab=${tabId}`)
// (c) At post-rAF, after the root re-check:
// _dlog(`[canvas-debug] ENSURE_ACTIVE_DONE tab=${tabId} rootAfter=${root?.tagName ?? 'null'}`)
```

Guarded by `DEBUG` flag in `src/debug/log.ts:24-26` (cost is zero in production).

**Step 2: Manual test plan**

In Lumiverse with Canvas loaded, CanvasDebug enabled:

1. Hard refresh. Navigate to a non-Lorebook tab (e.g. Profile) so Lorebook has never been activated.
2. Right-click the Lorebook main button → "Move to second drawer".
3. Open Lumiverse's devtools console.
4. Confirm: `[canvas-debug] ENSURE_ACTIVE_BEGIN tab=lorebook isActive=false mobile=false` → `ENSURE_ACTIVE_CLICK` → `ENSURE_ACTIVE_DONE rootAfter=DIV` log sequence. (If `rootAfter` is null after the click, Lumiverse did NOT mount the root despite the click — escalate, the host bridge contract is broken in this version of Lumiverse.)
5. Open Lorebook in secondary. Verify the lorebook-picker dropdown is populated.
6. Move Lorebook back to main. Verify dropdown still populated (no regression).
7. With Network panel open: confirm Lorebook's dropdown data fetch fires during ENSURE_ACTIVE_DONE (not after — the timing matters: React commit happens inside the rAF, so the fetch should fire on the same task as ENSURE_ACTIVE_DONE).

**Step 3: Verify the workaround still works**

1. Open Lorebook in main → dropdown loads → right-click → move to secondary → confirm dropdown still populated. (`isActive` check should return true → no pre-activation → no regression.)
2. Move Lorebook back to main → confirm dropdown still populated. (Move-back path is in the `else` branch at `assignment.ts:194-208`; pre-activation does NOT run there because `assignTab(tabId, 'primary')` does not need it.)
3. Mobile emulator (DevTools, `pointer: coarse`) — move a never-activated tab to secondary — confirm bug present (this is the deferred mobile edge case; record the observation).

**Step 4: Commit**

```bash
git add src/tabs/assignment.ts
git commit -m "chore(tabs): add built-in pre-activation debug breadcrumbs"
```

**Step 5: Manual verification of two open questions**

| Question | How to verify in DevTools |
|----------|---------------------------|
| Q2: Is Lorebook's tab id really `'lorebook'` in Lumiverse? | Inspect any main-sidebar button. Confirm `data-tab-id="lorebook"` (and that `findMainTabButton('lorebook')` resolves a button). If wrong, fix the constant in Task 1. |
| Q4: Does the dropdown data fetch fire on Lorebook component mount, on dropdown open, or on focus? | Open Network panel. Click Lorebook in main once, then close it without opening the dropdown — check whether the dropdown-fetch XHR fired. Compare to the original-bug scenario: move Lorebook to secondary without activating first; check whether the XHR fires. If the fetch fires on dropdown open (not mount), the fix must dispatch a synthetic `mousedown`/`focus` event after the move — escalate to the user. |

If Q2 or Q4 returns a negative (negative meaning the pre-activation fix is the wrong shape), surface back to the user before declaring done.

---

## 4. Files likely to change

| Path | Change |
|------|--------|
| `src/tabs/assignment.ts` | Add `ensureBuiltInTabActiveInMain`, `EnsureActiveHooks` interface; wire into `assignTab` secondary-path top; add three dlog breadcrumbs |
| `src/tabs/__tests__/ensure-builtin-active.test.ts` | New — 4 unit tests for `ensureBuiltInTabActiveInMain` |
| `src/tabs/__tests__/assign-tab-wiring.test.ts` | New — structural test asserting helper is called before `requestTabLocation` |

No backend changes (`src/backend.ts` unaffected). No `package.json` change. No `CHANGELOG.md` update (per Canvas contribution rules — see spec / rule violations in the critic report).

---

## 5. Tests / validation

```
# Unit (TDD)
bun run src/tabs/__tests__/ensure-builtin-active.test.ts        # 4 pass
bun run src/tabs/__tests__/assign-tab-wiring.test.ts              # 1 pass

# Regression: full test suite
bun run test

# Type check
bun run typecheck

# Build
bash build.sh
```

The 4 unit tests + 1 wiring test are **necessary but not sufficient**. The bug is fundamentally a host-integration timing issue — the load-bearing check is the manual verification in Task 3 Step 2. No headless test can perfectly reproduce Lumiverse's React commit + Lorebook's `useEffect` data fetch in isolation.

---

## 6. Risks, tradeoffs, and open questions

### Tradeoffs

- **Small delay on every non-active built-in move** (one rAF, ~16ms). Below human perception for a drawer animation (~250ms). Acceptable vs the alternative of a broken dropdown.
- **Pre-activation clicks the Lorebook button, which fetches data over the network.** If the user moves the tab back to main within ~150ms, the unmount + remount cancels the fetch. Microscopic edge case.
- **`findMainTabButton` returns hidden buttons too** — fine here, but means if a previous Canvas session hid Lorebook's button via `display:none`, the click still fires (which is what we want). The button's `display:none` doesn't prevent JS clicks.

### Risks

- **Race with `armMainDrawerActiveRestore`** — the arm observes main-sidebar class swaps after `requestTabLocation`. Pre-activation runs *before* the arm is set up, so the arm captures the post-Lorebook-active state. When Lumiverse's `pendingActiveTabReset` useEffect swaps Lorebook → non-moved neighbor, the arm's observer catches the swap and re-clicks Lorebook (the "originally active" tab at observer-arm time). The net user-visible end state: Lorebook ends up in secondary, the originally-active tab is no longer shown in main, but the swap-then-restore means the user sees a brief flicker on the second click. This flicker is consistent with the existing "open in main first" path (which already produces the same flicker on `requestTabLocation`); the user's existing mental model accepts it. If the flicker becomes a complaint, follow-up: post-`runHandoff` re-click of `_originallyActiveInMain` (now we'd actually use that return value, which is why Task 1's helper signature in this plan keeps it simpler — the watcher arm already covers the race).
- **`requestTabLocation` accepting pre-activated Lorebook** — Lumiverse may treat a "tab currently active in main" differently from "tab not active in main" when moving. If Lumiverse's internal state-machine resets the active tab before moving, the pre-activation is wasted. Manual verification (Task 3 Step 2) is the only signal.
- **The dropdown data might be fetched on dropdown-open, not on mount** — see Open Question Q4. If so, the fix loads data the user never sees (because they never open the dropdown until after the move, by which point it's already loaded). That's fine. But if the data is *cleared* on close/re-open in a way that requires a fresh fetch, manual verification will catch it.
- **"Clicking destroys the sidebar" risk** — the comment at `secondary-drawer.ts:266-275` warns that clicking a main-sidebar button "triggers a Lumiverse re-render that destroys the main sidebar, which cascades into the 2s checkSideChanged watcher re-creating the secondary on the wrong side." This was true when the 2s polling watcher was the only side-change detection; the watcher has since been replaced by a `MutationObserver` on the wrapper's class attribute (`drawer-sync.ts:427-447`), which only fires on side changes — not on `drawerTab` swaps. In the user's workflow (swap active tab in main, no side change), there's no re-render cascade. If the Lumiverse side does change as a side effect of activation (rare; would only happen on configured `swap-side-on-activate`), the observer will trigger a redraw but the new secondary will be recreated on the right side — Canvas's `applyLayout` will reconcile assignments. Acceptable for the v1.7.x release.

### Spec / rule violations addressed

Per critic review:
- **Mobile retry path (originally Task 3)** — dropped. YAGNI.
- **`CSS.escape` scope claim** — verified: not actually used by the helper (the wiring test doesn't reach the querySelector path either), so the claim was wrong in the original draft and is corrected here (the helper does not reference `CSS.escape`).
- **Line numbers** — corrected to match current state of `src/tabs/assignment.ts:147-182` (built-in block) and `src/sidebar/secondary-drawer.ts:266-275` (BUILT-IN TAB LIMITATION comment).

### Open questions for the user (deferred to manual verification)

1. **Q2: Is Lorebook's tab id really `'lorebook'` in Lumiverse?** — To verify in DevTools during Task 3 Step 5. If wrong (e.g., it's `'lorebook-v2'` or a UUID), fix the constant in Task 1's helper before commit.

2. **Q4: Where does Lorebook's dropdown data fetch actually fire?** — React mount, dropdown-open, or focus? — To verify in Network panel during Task 3 Step 5. If it's "dropdown-open" not "mount," the current fix works (data is fetched post-mount regardless), but a follow-up may need to dispatch a synthetic `mousedown`/`focus` to force the dropdown to populate. If it's "focus," the fix needs an additional `focus()` call on the moved root after the move.

### Decisions locked (per critic's contract-grounding pattern)

| Question | Resolution |
|----------|------------|
| Q1: Does `getBuiltInTabRoot` return stub or undefined? | Roll-with: pre-activation works either way (click → Lumiverse commits → re-call at `assignment.ts:146` returns real root, which gates the built-in branch correctly). |
| Q2: Is Lorebook's tab id `'lorebook'`? | Defer to manual verification (DevTools during Task 3 Step 5). Surface to user if wrong. |
| Q3: Mobile retry YAGNI? | YES, drop Task 3. Add only if mobile user reports. |
| Q4: Where does the Lorebook data fetch fire? | Defer to manual verification (Network panel during Task 3 Step 5). Surface to user if not "mount." |

### Open questions re-surfaced during re-author

A5 (during re-reading the assignment.ts code, this plan ended up addressing):

- **Where in the call chain is the bug?** Originally placed pre-activation inside the built-in branch. Re-reading reveals the bug lives in the FALL-THROUGH to `assignToSecondary` when `getBuiltInTabRoot(tabId)` returns null at line 146 of `assignment.ts`. Fix placement: **at the top of the secondary-path branch**, before the `builtInRoot` check, so the click makes the gate pass on the next line. Done in Task 2.

- **Does the "clicking destroys sidebar" warning apply?** Investigated `drawer-sync.ts:427-447`. The 2s polling watcher is gone, replaced by a MutationObserver on wrapper class. In the user's workflow (no side change), no cascade. Documented as a residual risk in §6.
