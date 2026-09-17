/**
 * OS-mode Start menu styles ("Command Deck") — visual overhaul, 2026-09-15.
 *
 * Chassis parity with the tab right-click context menu
 * (`src/tabs/tab-context-menu.ts`): same border, 10px radius, 6px item radius,
 * divider margins and `body[data-glass]` recipe.
 * Deliberate deviations (documented in the plan
 * `~/Documents/plans/2026-09-15-canvas-start-menu-visual-overhaul.md`):
 *   - surface is the tab strip itself (`TAB_STRIP_BACKGROUND` from
 *     `sidebar/styles.ts` — the drawer shell's `color-mix(primary 6%,
 *     bg-deep)` tab-list formula), not the context menu's surface (user
 *     request 2026-09-16),
 *   - the shadow stack is softened + contained (negative spread, alpha 0.45)
 *     vs the context menu's raw 12px/32px cast — user report 2026-09-16:
 *     "too intense, elongated at one vertical end",
 *   - row hover uses `--lumiverse-bg-hover` (the base `--lumiverse-fill` is
 *     rgba(0,0,0,.15) → ~invisible on a dark surface),
 *   - viewport-relative sizing divides by `--lumiverse-ui-scale` (the menu is a
 *     `body > *` child, so raw vw/vh overflow inside the host zoom layer),
 *   - state marks are `●` open / `○` minimized / none closed (or eye-hidden —
 *     no strip button, so the closed presentation applies).
 *
 * Leaf module: imports only the style injector so the source-pin tests can
 * import `START_MENU_CSS` without dragging the store/dispatch graph.
 * Dynamic positioning (left/top/visibility/transform-origin) stays inline —
 * the ui-scale coordinate contract lives in `start-menu-motion.ts`.
 */

import { injectStyles } from '../debug/styles'
import { TAB_STRIP_BACKGROUND } from '../sidebar/styles'

export const START_MENU_STYLE_ID = 'canvas-os-start-menu-styles'

export const START_MENU_CSS = `
  .canvas-os-start-menu {
    --csm-row-h: 40px;
    --csm-tile: 28px;
    --csm-status-w: calc(58px * var(--lumiverse-font-scale, 1));

    position: fixed; /* left/top/visibility inline (layout px, /uiScale contract) */
    z-index: 2147483600;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: min(320px, calc((100vw - 16px) / var(--lumiverse-ui-scale, 1)));
    max-height: calc(min(60vh, 420px) / var(--lumiverse-ui-scale, 1));
    overflow: hidden;
    padding: 4px;
    background: ${TAB_STRIP_BACKGROUND};
    border: 1px solid var(--lumiverse-border);
    border-radius: 10px;
    /* Softened, contained cast (user report 2026-09-16: "too intense,
       elongated at one vertical end"). The negative spread keeps the blur
       from smearing along the anchored edge; the direction mirror below is
       preserved. Deliberate deviation from the context-menu chassis stack
       (which has no spread). */
    box-shadow: 0 8px 24px -6px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04);
    color: var(--lumiverse-text);
    font-family: inherit;
    font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
  }

  /* Upward menus (bottom taskbar / Start dock): mirror the shadow's Y offset.
     The base down-cast shadow paints over the strip the menu opens from; the
     upward variant throws it away from the anchor instead (live report
     2026-09-16). Direction is stamped in JS (data-open-upward); the values
     mirror the base rule (same softened/contained stack). */
  .canvas-os-start-menu[data-open-upward] {
    box-shadow: 0 -8px 24px -6px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04);
  }

  /* Glass — the context-menu recipe, coarse-pointer gated; derives from the
     same surface token as the base. */
  @media not (pointer: coarse) {
    body[data-glass] .canvas-os-start-menu {
      background: color-mix(in srgb, ${TAB_STRIP_BACKGROUND} 80%, transparent);
      backdrop-filter: blur(var(--lcs-glass-blur, 8px));
    }
  }

  /* ── Header ──────────────────────────────────────────────────────────── */
  .canvas-os-start-menu__header {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    height: 30px;
    padding: 0 9px;
  }
  .canvas-os-start-menu__brand {
    display: flex;
    width: 14px;
    height: 14px;
    color: var(--lumiverse-text-muted);
  }
  .canvas-os-start-menu__brand svg { width: 14px; height: 14px; display: block; }
  .canvas-os-start-menu__title {
    flex: 1;
    min-width: 0;
    font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
    font-weight: 600;
    color: var(--lumiverse-text-muted);
  }
  .canvas-os-start-menu__count {
    flex-shrink: 0;
    font-size: calc(11px * var(--lumiverse-font-scale, 1));
    color: var(--lumiverse-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* ── Divider — context-menu token parity ─────────────────────────────── */
  .canvas-os-start-menu__divider {
    flex-shrink: 0;
    height: 1px;
    margin: 4px 8px;
    background: var(--lumiverse-border);
  }

  /* ── List ────────────────────────────────────────────────────────────── */
  .canvas-os-start-menu__list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* ── Item — context-menu geometry (vertical padding 6px fits the tile) ── */
  button.canvas-os-start-menu__item {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: var(--csm-row-h);
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--lumiverse-text);
    font-family: inherit;
    font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
    text-align: left;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  button.canvas-os-start-menu__item:hover {
    background: var(--lumiverse-bg-hover, rgba(255, 255, 255, 0.06));
  }
  button.canvas-os-start-menu__item:active {
    background: var(--lumiverse-primary-020);
  }
  button.canvas-os-start-menu__item:focus-visible {
    outline: 2px solid var(--lumiverse-primary);
    outline-offset: -2px;
    background: var(--lumiverse-bg-hover, rgba(255, 255, 255, 0.06));
  }

  /* State rail — running windows pin to the rail. */
  .canvas-os-start-menu__rail {
    flex-shrink: 0;
    width: 3px;
    height: 16px;
    border-radius: 999px;
    background: transparent;
    transition: background 120ms ease;
  }
  .canvas-os-start-menu__item[data-os-state='open'] .canvas-os-start-menu__rail {
    background: var(--lumiverse-primary);
  }
  .canvas-os-start-menu__item[data-os-state='minimized'] .canvas-os-start-menu__rail {
    background: var(--lumiverse-text-muted);
  }

  /* Icon tile — a container, never a state channel at rest. */
  .canvas-os-start-menu__tile {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--csm-tile);
    height: var(--csm-tile);
    overflow: hidden;
    border-radius: 6px;
    background: transparent;
    color: var(--lumiverse-text-muted);
    transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
  }
  .canvas-os-start-menu__tile > svg,
  .canvas-os-start-menu__tile > img {
    width: 16px;
    height: 16px;
    display: block;
  }
  .canvas-os-start-menu__tile > img { border-radius: 3px; object-fit: contain; }
  .canvas-os-start-menu__item[data-os-state='open'] .canvas-os-start-menu__tile {
    background: var(--lumiverse-primary-010, var(--lumiverse-primary-015));
    color: var(--lumiverse-primary);
  }
  .canvas-os-start-menu__item[data-os-state='closed'] .canvas-os-start-menu__tile {
    box-shadow: inset 0 0 0 1px var(--lumiverse-border-hover);
    color: var(--lumiverse-text-dim, var(--lumiverse-text-muted));
  }
  .canvas-os-start-menu__item:hover .canvas-os-start-menu__tile {
    background: var(--lumiverse-bg-hover, rgba(255, 255, 255, 0.06));
    color: var(--lumiverse-text);
  }
  .canvas-os-start-menu__tile--monogram {
    font-size: calc(12px * var(--lumiverse-font-scale, 1));
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  /* Label */
  .canvas-os-start-menu__label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Status slot — mark at rest, action verb on hover/focus (opacity only).
     Closed entries have no mark node at all; the slot is just the verb's home. */
  .canvas-os-start-menu__status {
    position: relative;
    flex-shrink: 0;
    width: var(--csm-status-w);
    height: 18px;
    overflow: hidden;
  }
  .canvas-os-start-menu__mark,
  .canvas-os-start-menu__verb {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    transition: opacity 150ms ease;
  }
  .canvas-os-start-menu__mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    color: var(--lumiverse-text-muted);
  }
  .canvas-os-start-menu__mark > svg { width: 18px; height: 18px; display: block; }
  .canvas-os-start-menu__item[data-os-state='open'] .canvas-os-start-menu__mark {
    color: var(--lumiverse-primary);
  }
  .canvas-os-start-menu__item[data-os-state='minimized'] .canvas-os-start-menu__mark {
    color: var(--lumiverse-text-muted);
  }
  .canvas-os-start-menu__verb {
    opacity: 0;
    color: var(--lumiverse-text-muted);
    font-size: calc(10.5px * var(--lumiverse-font-scale, 1));
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .canvas-os-start-menu__item[data-os-state='open'] .canvas-os-start-menu__verb {
    color: var(--lumiverse-primary-text, var(--lumiverse-primary));
  }
  .canvas-os-start-menu__item:hover .canvas-os-start-menu__mark,
  .canvas-os-start-menu__item:focus-visible .canvas-os-start-menu__mark {
    opacity: 0;
  }
  .canvas-os-start-menu__item:hover .canvas-os-start-menu__verb,
  .canvas-os-start-menu__item:focus-visible .canvas-os-start-menu__verb {
    opacity: 1;
  }

  /* ── Empty state ─────────────────────────────────────────────────────── */
  .canvas-os-start-menu__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 20px 12px 22px;
    text-align: center;
  }
  .canvas-os-start-menu__empty-glyph {
    display: flex;
    width: 24px;
    height: 24px;
    color: var(--lumiverse-text-dim, var(--lumiverse-text-muted));
  }
  .canvas-os-start-menu__empty-glyph svg { width: 24px; height: 24px; }
  .canvas-os-start-menu__empty-title {
    font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
    font-weight: 600;
    color: var(--lumiverse-text);
  }
  .canvas-os-start-menu__empty-hint {
    font-size: calc(11px * var(--lumiverse-font-scale, 1));
    color: var(--lumiverse-text-muted);
  }

  /* ── Touch ───────────────────────────────────────────────────────────── */
  @media (pointer: coarse) {
    .canvas-os-start-menu { --csm-row-h: 46px; --csm-status-w: 18px; }
    .canvas-os-start-menu__verb { display: none; }
  }

  /* Reduced motion — WAAPI handles open/close in JS. */
  @media (prefers-reduced-motion: reduce) {
    .canvas-os-start-menu__item,
    .canvas-os-start-menu__rail,
    .canvas-os-start-menu__tile,
    .canvas-os-start-menu__mark,
    .canvas-os-start-menu__verb { transition: none; }
  }

  /* Forced colors — outline focus survives; the closed tile's inset shadow does not. */
  @media (forced-colors: active) {
    button.canvas-os-start-menu__item:focus-visible {
      outline: 2px solid ButtonBorder;
      outline-offset: -2px;
    }
    .canvas-os-start-menu__item[data-os-state='closed'] .canvas-os-start-menu__tile {
      box-shadow: none;
      border: 1px solid ButtonBorder;
    }
  }
`

/** Inject the menu stylesheet once (idempotent refresh via `injectStyles`). */
export function injectStartMenuStyles(): void {
  injectStyles(START_MENU_STYLE_ID, START_MENU_CSS)
}
