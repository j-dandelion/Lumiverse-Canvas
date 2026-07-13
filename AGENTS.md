# Canvas — Agent Guide

Canvas is a Spindle extension for Lumiverse (an AI chat frontend) that adds a second sidebar drawer, chat reflow, drag-to-resize, slash commands, and more. It is a pure-frontend TypeScript extension running in the browser.

## WORKFLOW.md (session catch-up)

**Global protocol:** `~/.grok/AGENTS.md` → Session catch-up (WORKFLOW.md). Skill: `/workflow`.

This repo keeps a **product-only** local `WORKFLOW.md` (main-mirror epic, pitfalls, deploy notes). Read it first for Canvas WIP/gotchas; then `docs/README.md` for durable architecture. Prefer WORKFLOW over session memory for open bugs. **Never commit** `WORKFLOW.md` (gitignored).

Meta/process work on the **global WORKFLOW system** (hooks, gates, template) lives in `~/WORKFLOW.md` and `~/.grok/docs/workflow-md.md` — do not dump that into this repo’s WORKFLOW.

## Build / deploy when finalizing

The live app loads from the Spindle runtime path, **not** from repo `dist/` alone. When finishing a change that affects UI or extension behavior (before handoff, live verify, or wrapping a major round):

1. Run **`npm run deploy` only** — it builds and copies into `~/Lumiverse/data/extensions/canvas/repo/`.
2. Do **not** also run `npm run build` first (that builds twice; `deploy` already builds via `build.sh`).
3. Hard-refresh the browser (**Ctrl+F5**) so Lumiverse picks up the new bundle.
4. Use `npm run build` alone only when you need repo `dist/` without updating the runtime (e.g. CI-style check). Unit tests: `bun test …` as needed.

If a “fix didn’t work” after a correct code change, the usual miss is build-only or no hard refresh — redeploy + Ctrl+F5.

## Documentation

For durable architecture and in-depth documentation, start with the /docs/ folder: `/docs/README.md` (reading order and quick reference). For *current* WIP and gotchas, prioritize `WORKFLOW.md` first when it exists.

```
docs/
├── README.md            ← Start here (reading order, quick reference, state flow)
├── architecture.md      ← Build system, entry points, module graph, design patterns
├── features.md          ← Feature registry, settings system, live-apply
├── sidebar.md           ← Secondary sidebar: DOM, state machine, observers, mobile
├── tabs.md              ← Tab assignment, buttons, activation handoff, context menus
├── persistence.md       ← Layout storage, IPC, save/load, main drawer persistence
├── slash-commands.md    ← Runtime, intercept, suggest popup, built-in commands, extension API
├── chat-reflow.md       ← Chat column margin reflow, button tagging
├── dom-layer.md         ← Lumiverse queries, fiber access, Zustand store walk, host bridge
├── resize-and-drag.md   ← Resize handles, drawer tab vertical drag
└── mobile.md            ← Mobile viewport detection, mutual exclusion, viewport crossing
```

## Key Files

- `src/setup.ts` — orchestrator, lifecycle management
- `src/features/registry.ts` — feature registry (add new features here)
- `src/sidebar/secondary.tsx` — secondary sidebar DOM construction
- `src/sidebar/secondary-drawer.ts` — secondary drawer state machine
- `src/tabs/assignment.ts` — tab assignment policy layer
- `src/slash/runtime.ts` — slash command runtime wiring
- `src/layout/persist.ts` — layout persistence + IPC
- `src/types.ts` — `CanvasSettings`, `LayoutState`, `DetachedTab` types

## Architecture at a Glance

1. Spindle loader calls `setup(ctx)` in `src/setup.ts`
2. Settings are hydrated from `layout.json` via backend IPC
3. Features are iterated from `FEATURES` array in `features/registry.ts`
4. Each feature has optional `init()`, `mount()`, `apply()` hooks
5. Settings changes flow: `setSettings` → `applySettings` → `feature.apply()` + `persistSettings` (100ms debounce)
6. Layout persistence uses atomic writes (temp key + `storage.move`)
7. Main drawer is host-owned; Canvas watches it via `MutationObserver`
8. Secondary drawer is fully Canvas-owned (DOM, state, animation)

## Adding a New Feature

1. Add setting field to `CanvasSettings` in `src/types.ts` with default in `DEFAULT_CANVAS_SETTINGS`
2. Add `CanvasFeature` object to `FEATURES` array in `src/features/registry.ts`
3. Add toggle to settings panel in `src/settings/panel.ts`
4. The orchestrator picks up init/mount/apply automatically

## Adding a Slash Command

Register via `CustomEvent` from any extension:
```javascript
window.dispatchEvent(new CustomEvent('canvas:slash-register', {
  detail: { command: { name: 'my-cmd', description: 'Does thing', owner: 'my-ext', handler: async (args, ctx) => { ... } } }
}))
```
Unregister: `window.dispatchEvent(new CustomEvent('canvas:slash-unregister', { detail: { name: 'my-cmd' } }))`
