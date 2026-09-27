# Canvas — still-open work items

Migrated from WORKFLOW.md (dropped 2026-09-27; full archive: `~/Documents/plans/canvas-WORKFLOW-archive-2026-09-27.md`). This list is hand-maintained: strike items as they complete, add new ones at round end. Detailed checklists live in the plan documents under `~/Documents/plans/`.

## Pending live-verifies (deployed, awaiting user Ctrl+F5 + walk)

- 2026-09-23g settings panel (row order + tooltip copy, `024e7ca`/`e974f17`) — Ctrl+F5 + visual confirm.
- 2026-09-23 settings-menu visual refinement (`2026-09-23-canvas-settings-menu-visual-refinement.md`) — §8 walk checklist; watch nesting/fill inversion (U15).
- 2026-09-23 layout-mode switching deep-review Batch 3 (L1–L14 commits) — H1/M1 live-verify walks; dist commits were pending approval at the time.
- Six-concern round (`08eee74`): shadow fade in Top/Bottom (Chrome + Firefox), strip edge, core close→hidden→unhide, minimize gate, OS+mobile single-drawer force.
- Start-menu visual overhaul; four-concern round (#1/#3/#4).
- `6fa7d9b` round: main-drawer OS context items, warm second-drawer enable (recover dual layout first: set `secondSidebarEnabled: false` in `settings.json`, Ctrl+F5, then enable in-app — do NOT toggle off, the disable path snapshots the single model into `osDualLayout`); dual-zone seam item RETIRED 2026-09-16 (single-surface split).
- OS issue #2 re-verify: cross-drawer DnD settle in Bottom.
- 2026-09-16 bug-fix round (21 fixes): live-verify H1–H4 first (closed-window reuse, OS-disable core-tab strand, dual-slot clobber).

## Checklists not yet walked

- OS Mode spec §7 checklist — `~/Documents/plans/os-mode-spec.md` (spec + header-chrome spike `os-mode-header-spike.js`; the `src/os/` module comments are the durable docs).
- S8 drawer location: #1 re-verify items 1+8, then items 2–5, 7, 9–12.
- S6 mobile checklist: ~6 items open. S7 host features + DnD: 0/9 walked (implementation live-verified). S2: ~10 items open. S5: 1 item open.
- Stage source of truth: `~/Documents/plans/2026-09-canvas-live-verify-S1-S7.md`.

## Low-severity review items (report §L, 2026-09-12 adversarial round)

- `readJsonFile` maps any storage read error to "missing".
- `hydrateModeLayoutSlots` keeps absent slots across hot reloads.
- Header title ignores the never-hide-all rescue tab.
- `applySyncFromHost` duplicate-key active (boundary case).
- Mobile cold-boot `_desktopCssVarValue` seeding (reported, unverified).

Report with full context: `~/Documents/plans/2026-09-12-canvas-adversarial-review-round.md` (§G–§L).
