# keepTabListVisible Fix Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not start Task N+1 until Task N’s acceptance criteria pass (except where noted “can parallel”).

**Context:** The initial implementation (`docs/compose/plans/2026-07-08-keep-tab-list-visible.md`, commits `c793996`…`dc2cf4d`) wired types, settings UI, registry, `applyTabListPin`, and unit tests. Code review found the **core pin mechanism cannot work** under the secondary drawer architecture, plus lifecycle / composition / reflow gaps. This plan fixes those defects; it does not re-litigate the product goal.

**Goal:** When `keepTabListVisible` is true on desktop, the secondary tab-button strip stays on the screen edge and remains clickable while the secondary drawer is closed; when open, the panel content is not hidden under the strip; chat reflow reserves space for the strip when closed; pin survives remount/side-change and composes cleanly with `moveControlsToOuterEdge` and mobile viewport crossing.

**Non-goals:** Changing main-drawer tab layout; pinning on mobile (still no-op, but must **clear** desktop pin styles); redesigning drawer open animation.

---

## Root cause (must fix first)

`applyTabListPin` sets `position: fixed` on `.sidebar-ux-tab-list` while it remains a descendant of `.sidebar-ux-secondary-wrapper`. That wrapper **always** has a non-`none` `transform: translateX(...)` (open and closed). Per CSS, a transformed ancestor is the containing block for `position: fixed` descendants, so the tab list is positioned relative to the wrapper and **slides off-screen with the closed drawer**.

Inline style tests pass because they never model a transformed ancestor. Style writes alone cannot fix this.

---

## Architecture decision

### Chosen approach: **reparent while pinned**

When pin is **enabled** (desktop, secondary exists):

1. Reparent `.sidebar-ux-tab-list` out of the transforming subtree onto a dedicated **pin host** under `document.body` (or a non-transformed Canvas root already used for overlays).
2. Style the tab list (or host) as viewport-fixed on the secondary side, with safe-area insets matching the secondary wrapper.
3. Insert a **56px in-flow spacer** inside `.sidebar-ux-drawer` so the panel does not draw under the strip while open.
4. On **unpin / teardown / mobile cross-down**, restore the tab list to its original parent (before the panel, same order as construction), remove the spacer, and re-run `applyTabListPosition` for borders/flex.

When pin is **disabled**, DOM structure stays as today (tab list inside drawer). No permanent secondary DOM rewrite required for the default path.

### Rejected alternatives

| Option | Why not |
|--------|---------|
| Counter-`transform` on the tab list | Must track every open/close animation frame and side flip; fragile with resize width changes |
| Permanent DOM split (tab list always outside transform) | Larger rewrite of `createSecondarySidebar`, resize handles, flex/`moveControlsToOuterEdge`; correct long-term but oversized for a fix |
| Keep `position: fixed` inside wrapper | **Impossible** given continuous wrapper transform |

### Constants / ownership

- `TAB_LIST_WIDTH_PX = 56` (shared with construction cssText / pin / reflow / spacer)
- Pin-owned properties only: reparent, `position`, `top`/`bottom` (safe-area), side edge, `z-index`, pin borders, class, spacer. Do **not** blank construction `width` on unpin — restore `56px` or never clear it.
- Prefer `setIfDifferent` + `StyledElement` like `applyTabListPosition`.
- Stacking: pin host/list above wrapper (`9990`) so closed drawer doesn’t cover buttons; document vs drawer-tab.

### Reconcile entry point

Introduce a single public reconcile used by mount and settings:

```ts
/** Apply pin from current settings + live DOM. Safe to call anytime. */
export function reconcileTabListPin(): void
```

Semantics:

- Desktop + secondary tab list exists → `applyTabListPin(!!getSettings().keepTabListVisible)` (force re-evaluate after remount; see idempotency note below).
- Mobile → force unpin (clear styles, restore parent if reparented) even if setting is true.
- No secondary → no-op (nothing to pin).

**Idempotency change:** After remount, a fresh tab list has no `TAB_LIST_PINNED_CLASS`, so class-based `enabled === isPinned` still works. After reparent, also track “is this node under the pin host?” so a remount that left an orphan host is cleaned up. Prefer: on unpin always destroy pin host if empty; on pin always ensure host exists.

---

## Task order (dependency graph)

```
Task 1  Reparent pin core + spacer + style hygiene
   │
   ├─► Task 2  Remount / feature lifecycle re-apply
   │
   ├─► Task 3  Pin-aware applyTabListPosition
   │
   ├─► Task 4  Chat reflow when pinned + closed
   │
   ├─► Task 5  Mobile viewport cross clear/restore
   │
   └─► Task 6  Tests + settings UX + docs
              (tests can start stubs in Task 1; full matrix in Task 6)
```

Tasks 2–5 all depend on Task 1’s API. Tasks 2–5 can be sequenced as listed; 3 and 4 are independent of each other after 1.

---

### Task 1: Fix pin mechanism (reparent + spacer + unpin cleanup)

**Covers:** Review Issues 1, 3, 8, 9, 12 (core), 13 (comment accuracy).

**Files:**
- Modify: `src/sidebar/tab-position.ts`
- Possibly touch: `src/sidebar/styles.ts` (only if reparented list loses wrapper-scoped button rules — verify active-indicator / tab button CSS; add pinned-scope rules if needed)
- Possibly touch: `src/sidebar/secondary.tsx` only if a stable pin-host id/class is owned by secondary (prefer pin host owned entirely by `tab-position.ts`)

**Design details:**

1. **Pin host** (create on first pin, reuse while pinned):
   - `className`: e.g. `sidebar-ux-tab-list-pin-host`
   - `position: fixed; top/bottom: env(safe-area-inset-*); {left|right}: 0; width: 56px; z-index: 10000; pointer-events: none` (children `auto`) **or** put those styles on the tab list itself and use host as a plain body child — pick one and keep tests deterministic.
2. **Before reparent:** record `originalParent` + `nextSibling` (should be the panel) on a module-level weak map or data attributes; insert spacer `div.sidebar-ux-tab-list-spacer` with `width: 56px; flex-shrink: 0` in the tab list’s old place.
3. **Reparent:** `pinHost.appendChild(tabList)` (or `body.appendChild(tabList)` if no host).
4. **Borders:** inner (panel-facing) side only, as today; clear panel chat-facing borders while pinned.
5. **Unpin:** reinsert tab list at original slot (or before panel if original parent gone), remove spacer, remove pin host if empty, clear **only** pin-owned styles, restore `width: 56px`, call `applyTabListPosition(getSettings().moveControlsToOuterEdge)`.
6. **Mobile early path:** if `isMobileViewport()`, run full unpin path when currently pinned; do not leave fixed styles.
7. Refactor raw `(el as any).style` to `setIfDifferent`.

- [ ] **Step 1:** Add `TAB_LIST_WIDTH_PX`, pin host class, spacer class; document containing-block rationale in a short comment above `applyTabListPin`.
- [ ] **Step 2:** Implement reparent + spacer on enable; restore on disable.
- [ ] **Step 3:** Safe-area `top`/`bottom` matching secondary wrapper.
- [ ] **Step 4:** Soften `TAB_LIST_PINNED_CLASS` comment; if CSS under `.sidebar-ux-secondary-wrapper .sidebar-ux-tab-list` stops matching after reparent, add equivalent rules under pin host / pinned class in `styles.ts`.
- [ ] **Step 5:** Manual verify checklist (desktop):
  - [ ] Pin on, drawer closed → strip visible on secondary edge, tab clicks work
  - [ ] Pin on, drawer open → full panel content visible (no 56px underlap)
  - [ ] Pin off → DOM order restored, no orphan host/spacer
  - [ ] Both secondary sides (main left and main right)
- [ ] **Step 6:** Commit: `fix(pin): reparent tab list out of transformed secondary wrapper`

**Acceptance:** Closed secondary + pin on ⇒ tab list visible and interactive; open secondary + pin on ⇒ panel not under strip; unpin leaves no orphans.

---

### Task 2: Remount and feature lifecycle

**Covers:** Review Issues 2, 7, 14.

**Files:**
- Modify: `src/sidebar/secondary.tsx` (`mountSecondarySidebar`)
- Modify: `src/features/registry.ts` (`keepTabListVisibleFeature`, possibly `secondSidebarFeature` enable path)
- Optional: `src/sidebar/drawer-sync.ts` only if side-change path bypasses `mountSecondarySidebar` (it should not)

**Changes:**

1. After `applyTabListPosition(...)` in `mountSecondarySidebar`, call `reconcileTabListPin()` (or `applyTabListPin(getSettings().keepTabListVisible)` with force semantics after remount).
2. Align feature comments with reality: no “body-level orphan” unless reparent is documented; teardown still calls unpin.
3. Prefer feature `mount` to always register teardown when secondary can exist — or rely on secondary mount reconcile + feature `apply` only. Minimal fix: remount reconcile is enough for side-change; feature `apply` still handles live toggle.
4. Drop redundant `prev.keepTabListVisible === next.keepTabListVisible` if orchestrator already gates (nit).
5. On `unmountSecondarySidebar` / tearDown: call unpin **before** removing wrapper so reparented list is not orphaned when secondary is destroyed while pin was on.

- [ ] **Step 1:** `reconcileTabListPin()` after position apply in `mountSecondarySidebar`.
- [ ] **Step 2:** Unpin before secondary DOM destroy in unmount/teardown paths.
- [ ] **Step 3:** Update registry comments; optional cleanup of duplicate equality check.
- [ ] **Step 4:** Manual: enable pin → flip main drawer side (side remount) → pin still applied; disable second sidebar → no orphan tab list on body; re-enable second sidebar with pin still true → pin reapplies.
- [ ] **Step 5:** Commit: `fix(pin): re-apply pin on secondary remount and teardown`

**Acceptance:** Side-change and master-toggle off→on preserve correct pin behavior when setting remains true; no body orphans after unmount.

---

### Task 3: Compose with `applyTabListPosition`

**Covers:** Review Issue 5.

**Files:**
- Modify: `src/sidebar/tab-position.ts` (`applyTabListPosition` secondary branch)

**Changes:**

In the secondary branch of `applyTabListPosition`, if the secondary tab list is currently pinned (`TAB_LIST_PINNED_CLASS` or under pin host):

- Still apply **main** drawer half as today.
- For secondary: **do not** run `applyFlexAndBorder` / panel chat border writes that fight pin (or only update main). Pin owns secondary chrome while active.
- Optionally call `reconcileTabListPin()` at end if pin setting true (belt-and-suspenders after position toggles).

- [ ] **Step 1:** Gate secondary writes when pinned.
- [ ] **Step 2:** Manual: pin on → toggle “Move controls to outer edge” → pin borders/layout stable; unpin → position styles correct for both toggle values.
- [ ] **Step 3:** Commit: `fix(pin): skip secondary tab-position writes while pinned`

**Acceptance:** Sequential pin + move-controls toggles never leave mixed border/flex state.

---

### Task 4: Chat reflow for pinned strip when closed

**Covers:** Review Issue 6.

**Files:**
- Modify: `src/chat/reflow.ts` (`updateChatReflow`)
- Modify: `src/sidebar/tab-position.ts` (call `updateChatReflow` after pin/unpin)
- Tests: `src/chat/__tests__/…` or extend reflow tests

**Changes:**

When desktop and `getSettings().keepTabListVisible` and secondary tab list / pin host present:

- Secondary contribution to margin is at least `TAB_LIST_WIDTH_PX` even if `!isSecondarySidebarOpen()`.
- When open, keep full secondary width as today (do not double-add 56 unless closed-only reservation is needed — when open, full drawer width already includes the strip visually at the edge; margin is full drawer width, which is correct).
- After pin enable/disable, call `updateChatReflow()`.

Edge case: pin true but secondary not mounted → width 0 (no strip). Pin true + secondary mounted + closed → 56px on secondary side.

- [ ] **Step 1:** Extend `updateChatReflow` secondary width logic.
- [ ] **Step 2:** Trigger reflow from pin apply/unpin.
- [ ] **Step 3:** Unit/integration test for closed+pinned margin.
- [ ] **Step 4:** Commit: `fix(reflow): reserve tab-list width when pinned and closed`

**Acceptance:** Closed secondary + pin → chat column clears the 56px strip; open secondary unchanged; pin off + closed → 0 secondary margin.

---

### Task 5: Mobile viewport cross

**Covers:** Review Issue 4 (remaining after Task 1 mobile force-unpin).

**Files:**
- Modify: `src/sidebar/mobile-exclusion.ts` and/or reflow’s matchMedia listener path
- Prefer a single desktop↔mobile hook that also calls `reconcileTabListPin()` so pin and reflow stay aligned

**Changes:**

- Cross-down (≤600px): `applyTabListPin(false)` / force unpin (restore parent).
- Cross-up: `reconcileTabListPin()` so setting true reapplies without a settings flip.

If Task 1 already force-unpins on any mobile call to `applyTabListPin`, Task 5 is mainly **hooking the breakpoint** so cross-down runs without a settings change.

- [ ] **Step 1:** Wire viewport listener (reuse existing media query infrastructure if present).
- [ ] **Step 2:** Manual: pin on desktop → narrow below 600 → no fixed tab list; widen → pin returns if setting true.
- [ ] **Step 3:** Commit: `fix(pin): clear and restore pin across mobile viewport cross`

**Acceptance:** No sticky desktop pin styles on mobile layout; return to desktop restores pin when setting enabled.

---

### Task 6: Tests, settings UX, docs

**Covers:** Review Issues 10, 11, 15, remaining nits.

**Files:**
- Modify: `src/sidebar/__tests__/tab-pin.test.ts` (and add integration-style cases)
- Modify: `src/settings/panel.ts` (disable toggle when `!secondSidebarEnabled`)
- Modify: `docs/features.md` (and brief note in `docs/sidebar.md` if pin host is part of secondary surface)

**Test matrix (minimum):**

| Case | Assert |
|------|--------|
| Pin with transformed ancestor stub | Tab list not left as descendant of transformed node (parent is pin host/body) |
| Unpin | Restored under drawer; width `56px`; spacer gone |
| Remount reconcile | Setting true → pin applied after simulated mount |
| `applyTabListPosition` while pinned | Secondary borders not clobbered (or restored by reconcile) |
| Width/spacer | Open pin leaves spacer; unpin removes it |
| Mobile | Force unpin clears class + fixed styles |
| Reflow | Closed+pinned → secondary-side margin ≥ 56 (Task 4) |

**Settings UX:**

- Gate “Keep tab list visible” like resize: `{ disabled: () => !getSettings().secondSidebarEnabled }` and disable the row control when master toggle is off.
- Optional: move row under “Second drawer” section if that improves discoverability (product call; default = gate in place under Sidebars).

**Docs:**

- Registry row for `keepTabListVisible` in `docs/features.md`.
- One paragraph in sidebar docs: pin reparents out of transform; do not rely on `position: fixed` inside the wrapper.

- [ ] **Step 1:** Expand `tab-pin.test.ts` for reparent/spacer/width.
- [ ] **Step 2:** Reflow test if not done in Task 4.
- [ ] **Step 3:** Settings disabled state.
- [ ] **Step 4:** Docs update.
- [ ] **Step 5:** Run full relevant test suite (`tab-pin`, `tab-position`, reflow, any secondary lifecycle).
- [ ] **Step 6:** Commit: `test(pin): cover reparent pin; docs and settings gate`

**Acceptance:** Tests fail if pin leaves tab list under a `transform` parent; docs mention the feature; toggle disabled when second sidebar off.

---

## Manual QA script (end-to-end)

Run after Tasks 1–5, before calling the feature done:

1. Second sidebar on, desktop wide viewport.
2. Assign ≥2 tabs to secondary; leave drawer closed.
3. Enable **Keep tab list visible** → strip visible; click tabs → content switches (panel may open per existing policy).
4. Open drawer → panel fully readable; resize handle still usable.
5. Toggle **Move controls to outer edge** → pin still correct.
6. Flip main drawer side → remount → pin still correct.
7. Close secondary drawer → chat not under strip.
8. Disable pin → strip slides with drawer again; chat margin 0 when closed.
9. Re-enable pin; disable second sidebar → no orphan strip; re-enable second sidebar → pin returns.
10. Narrow to mobile → pin gone; widen → pin returns if still enabled.

---

## Risk notes

- **Event listeners / MutationObservers** on tab list or parent: reparent should keep the same element node so listeners stay attached; verify tab button click handlers and any secondary observers that assume parent is `.sidebar-ux-drawer`.
- **Lumiscript / fiber:** tab buttons are Canvas-managed DOM; reparent should not break React host trees if buttons are plain DOM (confirm — secondary tab list is Canvas-created).
- **z-index wars:** pin at 10000 may sit above modals; if a known modal layer is lower, document or adjust.
- **Performance:** reparent is rare (setting toggle, remount, viewport cross); no per-frame cost.

---

## Out of scope / follow-ups

- Permanent structural split of secondary DOM (tab list never under transform) as a later cleanup if pin becomes always-on default.
- Visual design polish (shadows, blur) on the pinned strip.
- Keyboard focus order when pinned + closed.

---

## Mapping: review issue → task

| Issue | Severity | Task |
|-------|----------|------|
| 1 Containing block / fixed inside transform | bug | 1 |
| 2 Remount loses pin | bug | 2 |
| 3 Unpin clears width | bug | 1 |
| 4 Mobile cross leaves styles | bug | 1 + 5 |
| 5 applyTabListPosition fights pin | bug | 3 |
| 6 Reflow underlap when closed | bug | 4 |
| 7 Lifecycle / comments | suggestion | 2 |
| 8 Open drawer underlap (no spacer) | suggestion | 1 |
| 9 Safe-area | suggestion | 1 |
| 10 Tests miss real failure | suggestion | 6 |
| 11 Settings always enabled | suggestion | 6 |
| 12 setIfDifferent / constants | suggestion | 1 |
| 13 CSS hook comment | nit | 1 / 6 |
| 14 Redundant equality | nit | 2 |
| 15 docs/features.md | nit | 6 |
| 16 Flex-child wording | nit | 1 |

---

## Success criteria (definition of done)

- [ ] Pin works with secondary **closed** (visible + clickable strip).
- [ ] Pin works with secondary **open** (no content underlap).
- [ ] Side remount and second-sidebar remount re-apply pin.
- [ ] Unpin and secondary destroy leave no orphans / no lost 56px width.
- [ ] Mobile cross clears pin; desktop restore respects setting.
- [ ] Chat reflow reserves 56px when pinned+closed.
- [ ] `moveControlsToOuterEdge` composes without fighting pin.
- [ ] Tests encode transformed-ancestor / reparent contract.
- [ ] Docs and settings UX updated.
