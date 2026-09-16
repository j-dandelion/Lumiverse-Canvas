// Start-menu visual pins (2026-09-15 "Command Deck" overhaul).
//
// Source-text pins for the visual contract the leaf DOM tests cannot reach:
//   - chassis parity with the tab right-click context menu
//     (`src/tabs/tab-context-menu.ts`): border, 10px radius, shadow stack,
//     divider, glass recipe,
//   - the deliberate deviations recorded in the plan
//     (`~/Documents/plans/2026-09-15-canvas-start-menu-visual-overhaul.md`):
//     `--lumiverse-bg` surface at 90% opacity (not the base's bg-deep),
//     visible hover token (the base `--lumiverse-fill` is black-15), zoom-safe
//     viewport sizing, state marks ● open / ○ minimized / none closed,
//   - DOM wiring: class hooks, `data-os-state`, the icon fallback chain and
//     the stylesheet lifecycle.
//
// Custom assertion harness — run by scripts/test-runner.sh via `bun run`
// (footer convention copied from start-menu-lifecycle-pins.test.ts; a harness
// that only printed FAIL lines and exited 0 would be reported as PASS).
//
// Leaf imports only: `../start-menu-styles` (no store/dispatch graph).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.error('FAIL:', msg)
  }
}
function assertIncludes(haystack: string, needle: string, msg: string) {
  if (haystack.includes(needle)) passed++
  else {
    console.error(`FAIL: ${msg} — expected to find "${needle}"`)
    failed++
  }
}

import { readFileSync } from 'fs'
import { join } from 'path'
import { START_MENU_CSS, START_MENU_STYLE_ID } from '../start-menu-styles'

const src = readFileSync(join(process.cwd(), 'src/os/start-menu.ts'), 'utf8')

/** Extract the declaration block starting at `needle` up to its closing brace. */
function blockOf(css: string, needle: string): string {
  const start = css.indexOf(needle)
  if (start === -1) return ''
  return css.substring(start, css.indexOf('}', start))
}

// ── 1. Chassis parity with the tab context menu ──────────────────────────────
{
  const root = blockOf(START_MENU_CSS, '.canvas-os-start-menu {')
  assert(root !== '', 'menu root rule exists')
  assertIncludes(root, 'background: color-mix(in srgb, var(--lumiverse-bg', 'surface uses --lumiverse-bg')
  assertIncludes(root, '90%, transparent', 'requested 90% opacity (color-mix fallback)')
  assertIncludes(root, 'rgb(from var(--lumiverse-bg', 'alpha pinned to 90% where relative color is supported')
  assert(!root.includes('--lumiverse-bg-deep'), 'deep surface token replaced')
  assert(!START_MENU_CSS.includes('--lumiverse-bg-deep'), 'bg-deep gone from the whole sheet')
  assertIncludes(root, 'border: 1px solid var(--lumiverse-border)', 'border parity')
  assertIncludes(root, 'border-radius: 10px', '10px radius parity')
  assertIncludes(
    root,
    'box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04)',
    'shadow stack parity',
  )
  assertIncludes(root, 'padding: 4px', 'surface padding parity')
}
{
  const divider = blockOf(START_MENU_CSS, '.canvas-os-start-menu__divider {')
  assertIncludes(divider, 'margin: 4px 8px', 'divider margin parity')
  assertIncludes(divider, 'background: var(--lumiverse-border)', 'divider token parity')
}
{
  const item = blockOf(START_MENU_CSS, 'button.canvas-os-start-menu__item {')
  assertIncludes(item, 'gap: 8px', 'item gap parity')
  assertIncludes(item, 'border-radius: 6px', 'item radius parity')
  assertIncludes(item, 'padding: 6px 12px', 'item horizontal padding parity (vertical 6px declared)')
}

// ── 2. Deliberate deviations ─────────────────────────────────────────────────
{
  // Hover must be visibly lighter: `--lumiverse-fill` is rgba(0,0,0,.15).
  const hover = blockOf(START_MENU_CSS, 'button.canvas-os-start-menu__item:hover {')
  assertIncludes(hover, 'background: var(--lumiverse-bg-hover', 'hover uses the visible surface-hover token')
  assert(!hover.includes('var(--lumiverse-fill'), 'hover must not use the invisible base fill token')
  const active = blockOf(START_MENU_CSS, 'button.canvas-os-start-menu__item:active {')
  assertIncludes(active, 'var(--lumiverse-primary-020)', 'pressed feedback is a visible token')
}
{
  // Zoom-safe sizing: raw 100vw/60vh overflow inside the host zoom layer.
  assertIncludes(
    START_MENU_CSS,
    'width: min(320px, calc((100vw - 16px) / var(--lumiverse-ui-scale, 1)))',
    'width divides by ui-scale',
  )
  assertIncludes(
    START_MENU_CSS,
    'max-height: calc(min(60vh, 420px) / var(--lumiverse-ui-scale, 1))',
    'max-height divides by ui-scale (spec constant preserved)',
  )
  assert(
    !START_MENU_CSS.includes('min-width: 236px'),
    'min-width must not defeat the viewport clamp',
  )
}
{
  // State marks: ● open / ○ minimized / none closed (user direction).
  assertIncludes(
    START_MENU_CSS,
    ".canvas-os-start-menu__item[data-os-state='open'] .canvas-os-start-menu__mark {",
    'open mark rule',
  )
  assertIncludes(
    START_MENU_CSS,
    ".canvas-os-start-menu__item[data-os-state='minimized'] .canvas-os-start-menu__mark {",
    'minimized mark rule',
  )
  assert(
    !START_MENU_CSS.includes(
      ".canvas-os-start-menu__item[data-os-state='closed'] .canvas-os-start-menu__mark",
    ),
    'closed has no mark rule — it must never render one',
  )
}
{
  // Glass — the context-menu recipe, coarse-pointer gated, same surface token.
  assertIncludes(START_MENU_CSS, 'body[data-glass] .canvas-os-start-menu {', 'glass hook')
  assertIncludes(START_MENU_CSS, '@media not (pointer: coarse)', 'glass coarse-pointer gate')
  assertIncludes(START_MENU_CSS, 'backdrop-filter: blur(var(--lcs-glass-blur, 8px))', 'glass blur token')
  const glass = blockOf(START_MENU_CSS, 'body[data-glass] .canvas-os-start-menu {')
  assertIncludes(glass, 'var(--lumiverse-bg', 'glass derives from the same surface token')
}

// ── 3. Anatomy hooks + interaction states ───────────────────────────────────
{
  for (const cls of [
    '__header',
    '__brand',
    '__title',
    '__count',
    '__divider',
    '__list',
    '__item',
    '__rail',
    '__tile',
    '__tile--monogram',
    '__label',
    '__status',
    '__mark',
    '__verb',
    '__empty',
    '__empty-glyph',
    '__empty-title',
    '__empty-hint',
  ]) {
    assert(START_MENU_CSS.includes(`.canvas-os-start-menu${cls}`), `CSS owns ${cls}`)
  }
  assertIncludes(START_MENU_CSS, ':focus-visible', 'keyboard focus hook')
  assertIncludes(START_MENU_CSS, 'outline: 2px solid var(--lumiverse-primary)', 'focus uses an outline (survives forced colors)')
  assertIncludes(START_MENU_CSS, '@media (prefers-reduced-motion: reduce)', 'reduced-motion hook')
  assertIncludes(START_MENU_CSS, '@media (forced-colors: active)', 'forced-colors hook')
  assertIncludes(START_MENU_CSS, '@media (pointer: coarse)', 'touch hook')
  assertIncludes(START_MENU_CSS, 'font-size: calc(10.5px * var(--lumiverse-font-scale, 1))', 'verb type scale')
  assertIncludes(START_MENU_CSS, '--csm-status-w: calc(58px * var(--lumiverse-font-scale, 1))', 'status slot scales with font scale')
}

// ── 4. DOM wiring in start-menu.ts ───────────────────────────────────────────
{
  assertIncludes(src, 'injectStartMenuStyles()', 'buildMenu injects the sheet once')
  assertIncludes(src, "item.className = 'canvas-os-start-menu__item'", 'item class hook')
  assertIncludes(src, "item.setAttribute('data-os-state', entry.state)", 'state hook')
  assertIncludes(src, "item.setAttribute('aria-label',", 'accessible name per item')
  assertIncludes(src, "header.setAttribute('aria-hidden', 'true')", 'header is chrome for AT')
  assertIncludes(src, "mark.innerHTML = markSvg", 'mark markup is data-driven')
  assertIncludes(src, "tile.setAttribute('aria-hidden', 'true')", 'icon tile is decorative')
  assertIncludes(src, 'document.getElementById(START_MENU_STYLE_ID)?.remove()', 'teardown removes the sheet')
  assert(!src.includes('glyphFor'), 'the text-glyph helper is gone')
  assert(!src.includes('●') && !src.includes('○'), 'no text glyphs remain in the module')
  assertIncludes(src, "closed: '',", 'closed state mark is explicitly empty')
}

// ── 5. Icon fallback chain + monogram ───────────────────────────────────────
{
  const fnStart = src.indexOf('export function resolveEntryIcon(')
  assert(fnStart >= 0, 'resolveEntryIcon present')
  const body = src.substring(fnStart, src.indexOf('\n}', fnStart))
  const domIdx = body.indexOf('extractButtonIcon(')
  const storeIdx = body.indexOf('tab?.iconSvg')
  const builtinIdx = body.indexOf('BUILTIN_ICON_SVGS[')
  assert(domIdx >= 0, 'live button icon first')
  assert(storeIdx > domIdx, 'store fields after the live button')
  assert(builtinIdx > storeIdx, 'built-in map last')
  assertIncludes(src, 'lucide-puzzle', 'host puzzle placeholder detected')
  assertIncludes(src, 'PUZZLE_ICON_SVG', 'canvas puzzle placeholder detected')
  assertIncludes(src, 'entryMonogram(entry.title)', 'monogram render fallback')
  assertIncludes(src, "tile.classList.add('canvas-os-start-menu__tile--monogram')", 'monogram class hook')
  assertIncludes(src, 'BUILTIN_ICON_SVGS', 'built-in icon map consumed')
}

// ── 6. Style id contract ─────────────────────────────────────────────────────
assert(START_MENU_STYLE_ID === 'canvas-os-start-menu-styles', 'stable style element id')
assertIncludes(START_MENU_CSS, '.canvas-os-start-menu', 'sheet targets the menu class')

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}`)
