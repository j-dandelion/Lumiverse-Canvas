# Plan: Tab-list DnD bugfixes (post-review)

> Last updated: 2026-07-13  
> Source: bug hunt on commits `f1f7ed4`…`b00742e`  
> Status: committed (2026-07-13) — code + unit tests + deploy; live-verify pending

## Goal

Fix regressions from the last DnD/mobile rounds so cross-drawer live drag is safe, Settings stays chrome-only, and teardown/mid-drag cancel cannot leave the DOM half-moved. Keep same-list primary reorder “sticky” (the reason success-path restore was removed in `371a5cb`).

## Non-goals

- Redesign DnD UX or drop the taskbar gate
- Change intentional cascade (taskbar off → clear DnD preference)
- Broad mobile full-bleed redesign (optional follow-up)
- Concurrent-commit queue redesign (defer unless live-verify hits races)

---

## Implementation order

### 1. Critical — cross-list mid-drag vs commit

**Problem:** Success path keeps mid-drag DOM so same-list primary doesn’t flash. Cross-list mid-drag parks a **mirror** node in the secondary list; `addSecondaryTabButton` sees `data-tab-id` and skips creating a real secondary button.

**Fix A — DnD restore policy** (`src/tabs/tab-list-dnd.ts`):

| Case | Behavior |
|------|----------|
| Same-list reorder | **Do not** restore on success; commit reorders host + mirror + secondary |
| Cross-list move (`fromSecondary !== target.secondary`) | **`restoreSourceButtonDOM()` before `commitConfigureDraft`** |
| Commit fail / cancel / no target | Restore as today |

**Fix B — defense in depth** (`src/tabs/buttons.ts` `addSecondaryTabButton`):

Treat “already has button” as true only for a **real secondary** control. Exclude:

- `.sidebar-ux-main-tab-mirror-btn`
- nodes under `.sidebar-ux-main-tab-list-mirror`

If a foreign node with the same id is found, remove it (or ignore it) then create the secondary button.

**Tests:** stub DOM — secondary list contains mirror-class `button[data-tab-id=X]` → `addSecondaryTabButton({ id: X })` still creates a secondary button.

### 2. High — block Settings from live DnD

**Fix** in `installLongPressOnButton` / `startDrag` (`tab-list-dnd.ts`):

- Import `isSettingsButton` from `./buttons`
- If `isSettingsButton(btn)` → do not install (or no-op pointerdown)

### 3. Medium — teardown mid-drag restores DOM

**Fix** in `tearDownTabListDnd`: call `restoreSourceButtonDOM()` **before** `cleanupDragVisuals()` / clearing parent refs when `_isDragging`.

### 4. Medium — concurrent commit (defer)

Light retry optional; skip for v1 unless live-verify shows races.

### 5. Low — `collectHostTabButtons` dead filter

Simplify to `display !== 'none'` only (`src/sidebar/main-tab-pin.ts`). Ride along if cheap.

### 6. Optional follow-ups (not blocking)

- Panel hint: taskbar off clears DnD preference
- Coarse-pointer full-bleed hybrids
- `innerWidth` vs `matchMedia` in restore
- Single teardown registration for DnD feature (cleanup accumulation)

---

## File touch map

| File | Changes |
|------|---------|
| `src/tabs/tab-list-dnd.ts` | Cross-list restore-before-commit; Settings skip; teardown restore |
| `src/tabs/buttons.ts` | Harden `alreadyHasButton` |
| `src/tabs/__tests__/…` | Buttons already-has + optional DnD tests |
| `src/sidebar/main-tab-pin.ts` | Optional dead-filter cleanup |
| Docs | Short note in `docs/tabs.md` or `docs/features.md` if behavior is user-facing |

Do **not** hand-edit `dist/`; use `npm run deploy` when finishing for live app.

---

## Suggested commits

1. `fix(tabs): restore source DOM before cross-drawer live DnD commit` (+ alreadyHasButton harden + tests)
2. `fix(tabs): skip Settings and restore on DnD teardown`
3. Optional: `chore(sidebar): simplify collectHostTabButtons filter`

---

## Live-verify matrix

| # | Scenario | Pass criteria |
|---|----------|----------------|
| A | Primary → secondary live DnD | Real secondary btn; activate works; no mirror class in secondary |
| B | Secondary → primary live DnD | Mirror + host show tab; secondary list clean |
| C | Primary same-list + hidden tab | Order sticks; no snap-back |
| D | Secondary same-list reorder | Order sticks |
| E | Long-press Settings | No overlay / no drag |
| F | Toggle DnD off mid cross-drag | DOM restored; no orphans |
| G | Cancel drag outside lists | Original order |
| H | Configure modal primary→secondary | Still works (alreadyHasButton regression) |

---

## Risk notes

- Restore-before-commit **only for cross-list** avoids reintroducing same-list primary flash.
- Hardening `alreadyHasButton` must not remove a legitimate secondary button (only foreign/mirror nodes).
- Settings skip aligns with main-mirror host-chrome policy.
