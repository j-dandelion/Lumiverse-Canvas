# Canvas Documentation

Documentation for the Canvas extension codebase, optimized for coding agents. Start here to understand the architecture, then dive into specific subsystems.

## Reading Order

1. **[architecture.md](architecture.md)** — High-level overview: what Canvas is, build system, entry points, module graph, key design patterns
2. **[features.md](features.md)** — Feature registry, settings system, settings panel, live-apply dispatch
3. **[sidebar.md](sidebar.md)** — Secondary sidebar: DOM construction, state machine, DrawerObserver, cross-drawer sync, side-change detection, mobile support, animation
4. **[custom-css.md](custom-css.md)** — Theming: stable Canvas selectors (`.sidebar-ux-shell`), Lumiverse tokens, dual-mode host+Canvas recipes, pin-host pitfalls
5. **[tabs.md](tabs.md)** — Tab management: assignment system, button management, active-tab tracking, activation handoff, context menus, button tagging
6. **[persistence.md](persistence.md)** — Layout persistence: storage format, IPC, backend, frontend save/load, main drawer persistence, layout restore
7. **[slash-commands.md](slash-commands.md)** — Slash command system: runtime, registry, intercept, suggest popup, dispatch, intent, DOM utilities, built-in commands, extension API, toast surface
8. **[chat-reflow.md](chat-reflow.md)** — Chat column reflow: margin calculation, observer architecture, button tagging
9. **[dom-layer.md](dom-layer.md)** — DOM helpers: Lumiverse element queries, React fiber access, Zustand store walk, host bridge, selectors, width clamp
10. **[resize-and-drag.md](resize-and-drag.md)** — Resize handles and drawer tab drag: handle structure, drag behavior, drawer tab vertical positioning
11. **[mobile.md](mobile.md)** — Mobile support: viewport detection, mutual exclusion, CSS variable sync, viewport crossing, mobile-specific behaviors

**[pitfalls.md](pitfalls.md)** — Cross-cutting traps: TabKey vs liveId dual-keying, mirror active-key rules, placement-first flow, boot restore placement, drawer-location/motion traps, host NO-GOs. **Read this before touching tab moves, the main-mirror, restore, or drawer motion.**

## Quick Reference

### Entry Points
- `src/frontend.ts` → `src/setup.ts` — Spindle loader calls `setup(ctx: SpindleFrontendContext)`
- `src/backend.ts` — Bun backend for `layout.json` persistence

### Key Types
- `LayoutState` — persisted drawer state (`types.ts`)
- `CanvasSettings` — all user-togglable settings (`types.ts`)
- `DrawerLocation` — `'sides' | 'top' | 'bottom'`; Top/Bottom pins one horizontal tab strip per zone to the viewport edge (`types.ts`)
- `horizontalSplit` — Top/Bottom dual-drawer boundary fraction (0.5 default, normalized 0.1–0.9); dragged via the strip handle, drives `--sidebar-ux-hsplit` (`types.ts` → `sidebar/tab-position.ts`)
- `FullCanvasSettings` — `Required<CanvasSettings>` with all fields non-optional (`settings/state.ts`)
- `CanvasFeature` — feature lifecycle hooks (`features/registry.ts`)
- `DrawerTab` — store's tab entry with `id`, `title`, `root`, `iconSvg` (`store/index.ts`)
- `ObservedTab` — DrawerObserver's tab entry (`sidebar/drawer-observer.ts`)
- `SlashCommandDef` — slash command definition (`slash/types.ts`)

### Key Files
- `src/setup.ts` — orchestrator, lifecycle management
- `src/core/model.ts` + `src/core/reduce.ts` — owned layout model: single source of truth for tab placement, order, active, drawers
- `src/recon/dispatch.ts` — dispatch queue, `placementFirstMoveByLiveId` (the move path), `bootstrapFromLayout` (restore + boot placement)
- `src/host/lumiverse/implementation.ts` — `LumiverseHost` (HostPort): observe/place/setOrder/activate against live Lumiverse
- `src/features/registry.ts` — feature registry (add new features here)
- `src/os/` — OS mode: `actions.ts` (window-state actions), `os-mode.ts` (enable/disable + slot routing), `drawer-command.ts` (shell-command seam), `panel-chrome.ts` (header minimize/X + D17 parking), `start-menu.ts` + `start-menu-motion.ts` (Start button/menu), spec `~/Documents/plans/os-mode-spec.md`
- `src/sidebar/secondary.tsx` — secondary sidebar DOM construction + `reassignSecondaryTabsFromModel`
- `src/sidebar/secondary-drawer.ts` — secondary drawer state machine
- `src/sidebar/drawer-shell.ts` — shared shell builder for both drawers (wrapper / drawer / panel / header / tab list)
- `src/sidebar/animation.ts` + `src/sidebar/panel-motion.ts` — mode-routed open/close motion: Sides `translateX` slide (350 ms) vs Top/Bottom rail bloom (`animatePanelToggle`, anchored to the displayed window's strip button)
- `src/sidebar/drawer-location.ts` — Drawer location presentation/orchestration: html classes + `--sidebar-ux-strip-h`, shell edge offsets, handle visibility, consumer knobs, presence subscription, `reconcileDrawerLocation()` fan-out, `clearDrawerLocation()` (never writes strip geometry)
- `src/sidebar/tab-position.ts` — the single strip-geometry writer: pin host chrome (`data-strip-axis`/`data-strip-edge`, zone split), list chrome + clear, spacer sync
- `src/sidebar/main-tab-pin.ts` — main-mirror pin: exclusive active key, `userPicked` guard, neighbor handoff
- `src/tabs/assignment.ts` — owned-model facade (TabKey-keyed)
- `src/slash/runtime.ts` — slash command runtime wiring
- `src/persist/layout-repo.ts` + `src/persist/layout-load.ts` — layout persistence + IPC
- `src/persist/settings-repo.ts` — settings persistence + IPC

### State Flow
```
User toggles setting in panel
  → setSettings(patch)                    [settings/state.ts]
    → applySettings(prev, next)           [settings/panel.ts]
      → feature.apply(prev, next, ctx)    [features/registry.ts]
    → refreshSettingsPanel()              [settings/state.ts]
    → persistSettings()                   [settings/state.ts] (100ms debounce)
      → sendToBackend({ type: 'SAVE_LAYOUT', layout })  [persist/layout-repo.ts]
```

### Extension Points
- **Slash commands**: register via `canvas:slash-register` CustomEvent
- **Features**: add `CanvasFeature` to `FEATURES` array in `features/registry.ts`
- **Settings**: add field to `CanvasSettings` interface in `types.ts`, add default in `DEFAULT_CANVAS_SETTINGS`, add toggle in `settings/panel.ts`
- **Custom CSS / themes**: prefer Lumiverse tokens + `.sidebar-ux-shell` / pin hosts — see [custom-css.md](custom-css.md)
