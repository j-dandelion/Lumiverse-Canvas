// OS-mode Start button (src/os/start-menu.ts) — visual parity with the
// Options/Settings dock button in the tab strip.
//
// Chrome is CSS-owned via the `data-canvas-os-start` attribute:
//   - OS_START_BUTTON_CSS (base + hover + icon) mirrors the host `.tabBtn`
//     chrome as reproduced by the Canvas mirror button group.
//   - HORIZONTAL_STRIP_CSS + the two *_MOBILE_CSS sheets re-pin the row
//     geometry with !important (the base width:100% would stretch a flex row).
//
// Regression guards:
//   - the markup must NOT carry inline styles (inline beats the sheet AND the
//     mobile / horizontal overrides — the original bug),
//   - must NOT reuse `.sidebar-ux-main-tab-mirror-btn` (renderer stale-drop
//     deletes it, DnD installs drag on it, live-order phantom-counts it).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertIncludes(haystack: string, needle: string, msg: string) {
  if (haystack.includes(needle)) {
    passed++
  } else {
    console.error(`FAIL: ${msg} — expected to find "${needle}"`)
    failed++
  }
}

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  OS_START_BUTTON_CSS,
  HORIZONTAL_STRIP_CSS,
  SECONDARY_MOBILE_CSS,
  MAIN_MIRROR_MOBILE_CSS,
} from '../styles'

const START_SEL = 'button[data-canvas-os-start]'

// ── 1. Base chrome — same box as the Options row ──
{
  const ruleStart = OS_START_BUTTON_CSS.indexOf(`.sidebar-ux-tab-list ${START_SEL} {`)
  assert(ruleStart !== -1, 'base rule must target the start attribute')
  const block = OS_START_BUTTON_CSS.substring(
    ruleStart,
    OS_START_BUTTON_CSS.indexOf('}', ruleStart),
  )
  assertIncludes(block, 'width: 100%', 'base must fill the dock width like Options')
  assertIncludes(block, 'height: 48px', 'base must use the host tabBtn height')
  assertIncludes(block, 'border-radius: 8px', 'base radius must match Options')
  assertIncludes(block, 'background: transparent', 'base stays transparent until hover')
  assertIncludes(block, 'transition: all 0.2s ease', 'base transition must match Options')
  assertIncludes(block, 'color: var(--lumiverse-text-muted)', 'base color must match Options')
}

// ── 2. Hover — exact token parity with the Options button ──
{
  const hoverStart = OS_START_BUTTON_CSS.indexOf(':hover {')
  assert(hoverStart !== -1, 'hover rule present')
  const block = OS_START_BUTTON_CSS.substring(
    hoverStart,
    OS_START_BUTTON_CSS.indexOf('}', hoverStart),
  )
  assertIncludes(block, 'background: var(--lumiverse-primary-015)',
    'hover background must be the Options token')
  assertIncludes(block, 'color: var(--lumiverse-text)',
    'hover text color must match Options')
}

// ── 3. Icon box — 20px, same as the mirror's forced icon size ──
{
  assertIncludes(OS_START_BUTTON_CSS, `${START_SEL} > svg {`, 'icon rule present')
  const iconStart = OS_START_BUTTON_CSS.indexOf(`${START_SEL} > svg {`)
  const block = OS_START_BUTTON_CSS.substring(
    iconStart,
    OS_START_BUTTON_CSS.indexOf('}', iconStart),
  )
  assertIncludes(block, 'width: 20px', 'glyph box must match the 20px mirror icon')
  assertIncludes(block, 'height: 20px', 'glyph box height')
}

// ── 3b. Start divider is DOCK-owned, never button chrome (live report 2026-09-15) ──
// The main drawer's separator is the settings dock container's border-top.
// The second drawer's Start therefore lives in its own
// `.sidebar-ux-tab-list-bottom` dock (class `sidebar-ux-secondary-start-dock`),
// so the divider matches the main drawer exactly. It must NOT be a border on
// the Start button.
{
  assert(!OS_START_BUTTON_CSS.includes(
    `.sidebar-ux-tab-list > ${START_SEL}`,
  ), 'the divider must not be drawn as Start button chrome')
  const src = readFileSync(join(process.cwd(), 'src/os/start-menu.ts'), 'utf8')
  const dockSrc = readFileSync(
    join(process.cwd(), 'src/tabs/secondary-start-dock.ts'),
    'utf8',
  )
  assertIncludes(
    dockSrc,
    "export const SECONDARY_START_DOCK_CLASS = 'sidebar-ux-secondary-start-dock'",
    'secondary Start dock class is the structural hook',
  )
  assertIncludes(src, '`${TAB_LIST_BOTTOM_CLASS} ${SECONDARY_START_DOCK_CLASS}`',
    'the dock reuses the main drawer dock class (identical chrome)')
  assertIncludes(dockSrc, 'export function getSecondaryStartDock',
    'tab writers resolve the dock so it stays last')
  assertIncludes(dockSrc, 'export function appendSecondaryTabNode',
    'tab appends must insert BEFORE the dock, never past the divider')
}

// ── 4. Horizontal strip: 48×48, never the base width:100% ──
{
  const idx = HORIZONTAL_STRIP_CSS.indexOf(`[data-canvas-os-start]`)
  assert(idx !== -1, 'horizontal CSS must size the Start button')
  const block = HORIZONTAL_STRIP_CSS.substring(
    idx,
    HORIZONTAL_STRIP_CSS.indexOf('}', idx),
  )
  assertIncludes(block, 'width: 48px !important', 'horizontal Start must be 48px square')
  assertIncludes(block, 'height: 48px !important', 'horizontal Start height')
  assertIncludes(block, 'min-width: 48px !important', 'horizontal Start min-width')
  assertIncludes(block, 'padding: 0 !important', 'horizontal Start padding')
}

// ── 4b. Horizontal end-order is CSS-owned (side-flip re-orders in place) ──
// The old inline `btn.style.order` was written from getMainDrawerSide() at
// ensure time only; an S4 in-place side flip (no remount, no ensure) kept the
// stale value and left the Options dock on the screen edge until a refresh.
{
  assertIncludes(
    HORIZONTAL_STRIP_CSS,
    '.sidebar-ux-side-left .sidebar-ux-tab-list button[data-canvas-os-start] {',
    'left-attached strip orders Start first (outer edge)',
  )
  assertIncludes(
    HORIZONTAL_STRIP_CSS,
    '.sidebar-ux-side-right .sidebar-ux-tab-list button[data-canvas-os-start] {',
    'right-attached strip orders Start last (outer edge)',
  )
  assertIncludes(HORIZONTAL_STRIP_CSS, 'order: -1 !important', 'left side uses order:-1')
  assertIncludes(HORIZONTAL_STRIP_CSS, 'order: 1 !important', 'right side uses order:1')
  assert(
    !HORIZONTAL_STRIP_CSS.includes('order: -2 !important'),
    'the old inline-era -2 value must not be reintroduced',
  )
}

// ── 5. Mobile rows (both drawers): 52×48 ──
{
  assertIncludes(SECONDARY_MOBILE_CSS, START_SEL, 'secondary mobile must size Start')
  assertIncludes(SECONDARY_MOBILE_CSS, 'width: 52px !important', 'secondary mobile width')
  assertIncludes(SECONDARY_MOBILE_CSS, 'height: 48px !important', 'secondary mobile height')
  assertIncludes(MAIN_MIRROR_MOBILE_CSS, START_SEL, 'main mobile must size Start')
  assertIncludes(MAIN_MIRROR_MOBILE_CSS, 'width: 52px !important', 'main mobile width')
  // The mobile Sides list is a ROW — the Start dock must fall inline after
  // the tabs with its divider on the tab-facing left edge (same treatment as
  // the main mirror's dock), never a button border.
  assertIncludes(
    SECONDARY_MOBILE_CSS,
    '.sidebar-ux-secondary-wrapper .sidebar-ux-tab-list > .sidebar-ux-tab-list-bottom',
    'secondary mobile must dock the Start inline (row layout)',
  )
  assertIncludes(
    SECONDARY_MOBILE_CSS,
    'border-left: 1px solid var(--lumiverse-primary-020) !important',
    'mobile Start dock divider uses the dock separator token',
  )
}

// ── 6. Source pin: no bespoke inline geometry, no mirror class ──
{
  const src = readFileSync(join(process.cwd(), 'src/os/start-menu.ts'), 'utf8')
  const fnStart = src.indexOf('function startButtonHtml()')
  assert(fnStart >= 0, 'startButtonHtml present')
  const fnBody = src.substring(fnStart, src.indexOf('\n}', fnStart))
  assertIncludes(src, "const START_ATTR = 'data-canvas-os-start'",
    'hook attribute name is the CSS selector contract')
  assertIncludes(fnBody, '${START_ATTR}', 'markup keeps the CSS hook attribute')
  assert(!fnBody.includes('style="'),
    'markup must not carry inline styles (they beat the sheet + overrides)')
  assert(!fnBody.includes('width:32px'),
    'bespoke 32px geometry must not return')
  assert(!fnBody.includes('sidebar-ux-main-tab-mirror-btn'),
    'must not reuse the mirror tab class (renderer/DnD/live-order treat it as a tab)')
  // End-order must stay CSS-owned: no stale inline order writes (the ensure
  // clears legacy inline values instead — see section 4b).
  assert(!src.includes('startIsOuter'),
    'inline Start-order logic must not return (CSS owns the horizontal end-order)')
  assert(!src.includes('btn.style.order ='),
    'no inline order assignment; use removeProperty to clear legacy values')
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
