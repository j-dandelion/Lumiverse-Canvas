---
name: canvas
description: Canvas Spindle extension for Lumiverse (secondary sidebar drawer, chat reflow, tabs, OS mode). Use for any work in this repo — build/deploy, tests, tab moves, main-mirror, boot restore, drawer motion, or any src/ change.
---

# Canvas

Canvas is a Spindle extension for Lumiverse — pure-frontend TypeScript running in the browser. Skill directory: `.agents/skills/canvas/`.

## Before you touch code

1. Read `docs/README.md` (reading order + quick reference), then `docs/pitfalls.md` — **mandatory before** tab moves, the main-mirror, boot restore, or drawer motion.
2. Catch up on session state: `git log --oneline -20`, plus `references/open-items.md` (pending live-verifies, OS-mode spec §7, low-severity review items). Durable knowledge lives in `docs/` (committed); session work-state lives in the LUMI issue threads — there is no WORKFLOW.md.

## Deploy gate

- Finish a UI/behavior change with **`npm run deploy` only** — it builds and copies into `~/Lumiverse/data/extensions/canvas/repo/`. Never run `npm run build` first (that builds twice; `deploy` already builds via `build.sh`).
- The user must hard-refresh (**Ctrl+F5**) — the live app loads from the Spindle runtime path, not repo `dist/`.
- If a fix "didn't work" after a correct code change, suspect no-deploy / no-Ctrl+F5 first.
- `npm run build` alone only when you need repo `dist/` without updating the runtime (CI-style check).

## Test conventions

- Gate: `bunx tsc --noEmit` → 0 non-test errors; `npm test` → full suite green. The runner (`scripts/test-runner.sh`) is honest — it captures exit codes and routes `bun:test` files through `bun test`. Never reintroduce `OUTPUT=$(...) || true`.
- **Source-text convention tests exist** (e.g. `host-programmatic-open.test.ts` asserts on source text in `buttons.ts` / `main-renderer.ts`): when restructuring a matched block, update the convention to the new structure — keep the guarantee, don't delete the test.

## Commit discipline

Commit only when the user asks or approves. Never commit work-state journals (`WORKFLOW.md`, `REFACTOR-PLAN.md`, `.release-notes-*.md`) — gitignored on purpose.

## Key invariants (one-liners; detail in docs/pitfalls.md)

- The assignment facade is read by **TabKey only**; liveId ↔ TabKey conversion goes through `tabs/identity.ts`. Never invent keys or layer fallbacks outside it.
- `getTabAssignments()` is a read-only snapshot of the owned model — placement changes go through `dispatch({ t: 'move' | 'activate' | ... })`, never facade writes.
- `sidebar/tab-position.ts` is the **single strip-geometry writer**; `drawer-location.ts` is presentation/orchestration only.
- The Canvas exclusive active key (`_state.activeKey`) is truth for the main mirror; the host's `tabBtnActive` is stale-prone — never adopt it over a user selection.
- The owned model is the single source of truth for placement, widths, and hidden state; DOM/CSS-only writes do not survive reload.
- Boot restore is merge convergence: never undo user actions inside the boot window; a completed restore reconciles secondary assignment in BOTH directions.
- Extension teardown is generation-gated (`SPINDLE_FRONTEND_INACTIVE`): teardown must be pure-DOM or use the raw store.

## Open work

`references/open-items.md` lists pending live-verifies, the OS-mode spec §7 pointer, and low-severity review items. Check it before claiming a feature fully verified.
