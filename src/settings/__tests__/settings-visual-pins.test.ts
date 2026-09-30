// Visual contract pins for the settings panel stylesheet + the unified
// Canvas switch spec (2026-09-23 refinement round). These assert the HOST
// PARITY contract at the source level: host .segmented chassis, trough-on-card
// group surfaces, host type scale, engine-emitted knob tokens, motion token
// use, reduced-motion completeness, and the Chrome-mode header row (the old
// absolutely-positioned help chip collided with the selected tile's dot).
//
// Style follows start-button-location.test.ts source pins: readFileSync +
// toContain / regex over the module sources. No DOM needed.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const panelSrc = readFileSync(join(process.cwd(), 'src/settings/panel.ts'), 'utf8')
const renderSrc = readFileSync(join(process.cwd(), 'src/settings/render.ts'), 'utf8')
const configureSrc = readFileSync(
  join(process.cwd(), 'src/tabs/configure-modal.tsx'),
  'utf8',
)

/** Slice of the injected panel sheet (everything inside injectPanelStyles). */
const sheetStart = panelSrc.indexOf('injectStyles(PANEL_STYLE_ID')
const sheetEnd = panelSrc.indexOf('`)', sheetStart)
const sheet = panelSrc.slice(sheetStart, sheetEnd)

/** The prefers-reduced-motion block (sits just before the coarse media block). */
const rmStart = sheet.indexOf('@media (prefers-reduced-motion: reduce)')
const coarseStart = sheet.indexOf('@media (max-width: 600px)')
const rmBlock = rmStart >= 0 ? sheet.slice(rmStart, coarseStart) : ''

/** The coarse/narrow stacking block. */
const c420Start = sheet.indexOf('@media (max-width: 420px)')
const coarseBlock = coarseStart >= 0 ? sheet.slice(coarseStart, c420Start < 0 ? undefined : c420Start) : ''

/** The phone-width caption block. */
const c420Block = c420Start >= 0 ? sheet.slice(c420Start) : ''

describe('settings visual pins — Canvas segmented skin (reverted by preference)', () => {
  test('flat-cell trough: fill-subtle, clipping, no host pill gap/padding', () => {
    const trough = sheet.match(/\.sidebar-ux-panel-segmented\s*\{[^}]*\}/)?.[0] ?? ''
    expect(trough).toContain('background: var(--lumiverse-fill-subtle,')
    expect(trough).toContain('border: 1px solid var(--lumiverse-border)')
    expect(trough).toContain('border-radius: 8px')
    expect(trough).toContain('overflow: hidden')
    expect(trough).not.toContain('gap: 2px')
    expect(trough).not.toContain('padding: 2px')
  })

  test('buttons: 12px/600, 7px 10px padding, ellipsis fallback', () => {
    const btn = sheet.match(/\.sidebar-ux-panel-segmented-btn\s*\{[^}]*\}/)?.[0] ?? ''
    expect(btn).toContain('font-size: calc(12px *')
    expect(btn).toContain('font-weight: 600')
    expect(btn).toContain('padding: 7px 10px')
    expect(btn).toContain('text-overflow: ellipsis')
    expect(btn).not.toContain('min-height: 36px')
    expect(btn).not.toContain('border-radius: 6px')
  })

  test('active = primary-020; inset focus ring; hairline divider restored', () => {
    const active = sheet.match(/\.sidebar-ux-panel-segmented-btn-active\s*\{[^}]*\}/)?.[0] ?? ''
    expect(active).toContain('background: var(--lumiverse-primary-020,')
    expect(active).toContain('color: var(--lumiverse-primary)')
    expect(
      sheet.match(
        /\.sidebar-ux-panel-segmented-btn:focus-visible\s*\{[^}]*outline-offset: -2px/,
      ),
    ).toBeTruthy()
    expect(sheet).toContain('.sidebar-ux-panel-segmented-btn:not(:last-child)')
    expect(sheet).toContain('border-right: 1px solid var(--lumiverse-border)')
  })
})

describe('settings visual pins — trough-on-card surfaces', () => {
  test('group steps to --lumiverse-fill (shell card is already fill-subtle)', () => {
    const group = sheet.match(/\.sidebar-ux-panel-group\s*\{[^}]*\}/)?.[0] ?? ''
    expect(group).toContain('background: var(--lumiverse-fill,')
    expect(group).toContain('border: 1px solid var(--lumiverse-border)')
    expect(group).toContain('border-radius: var(--lumiverse-radius,')
    // The text-wash inner card is gone.
    expect(sheet).not.toContain('color-mix(in srgb, var(--lumiverse-text) 2.5%')
    expect(sheet).not.toContain('color-mix(in srgb, var(--lumiverse-text) 2%')
  })

  test('rows: fill-hover hover, 0.55 disabled, hairline separators', () => {
    expect(
      sheet.match(/\.sidebar-ux-panel-row:hover\s*\{[^}]*background: var\(--lumiverse-fill-hover/),
    ).toBeTruthy()
    expect(sheet).toContain('.sidebar-ux-panel-row-disabled { opacity: 0.55; }')
    expect(sheet).not.toContain('opacity: 0.45')
    // Modes block separates from the first row like a row would.
    expect(sheet).toContain('.sidebar-ux-panel-modes-wrap + .sidebar-ux-panel-row')
  })
})

describe('settings visual pins — host type scale + motion', () => {
  test('header 16px/650 + 11px text-dim subtitle (host panel h2 / cardMeta)', () => {
    const title = sheet.match(/\.sidebar-ux-panel-header-title\s*\{[^}]*\}/)?.[0] ?? ''
    expect(title).toContain('font-size: calc(16px *')
    expect(title).toContain('font-weight: 650')
    const sub = sheet.match(/\.sidebar-ux-panel-header-sub\s*\{[^}]*\}/)?.[0] ?? ''
    expect(sub).toContain('font-size: calc(11px *')
    expect(sub).toContain('var(--lumiverse-text-dim')
    expect(sub).not.toContain('11.5px')
  })

  test('section titles = host .subsectionTitle (12px/700/.05em/text-dim)', () => {
    const sec = sheet.match(/\.sidebar-ux-panel-section-title\s*\{[^}]*\}/)?.[0] ?? ''
    expect(sec).toContain('font-size: calc(12px *')
    expect(sec).toContain('font-weight: 700')
    expect(sec).toContain('letter-spacing: 0.05em')
    expect(sec).toContain('var(--lumiverse-text-dim')
  })

  test('durations ride --lumiverse-transition-fast (no bare 0.15s/0.18s literals)', () => {
    expect(sheet).not.toContain('0.15s ease')
    expect(sheet).not.toContain('0.18s cubic-bezier')
    expect(sheet).not.toContain('120ms ease')
    // Every transition in the sheet names the token (reduced-motion's
    // `transition: none` is the one legitimate bare value).
    const transitions = (sheet.match(/transition:[^;]+/g) ?? []).filter(
      (t) => !t.includes('transition: none'),
    )
    expect(transitions.length).toBeGreaterThan(0)
    for (const t of transitions) {
      expect(t).toContain('var(--lumiverse-transition-fast')
    }
  })

  test('reduced-motion covers the segmented control too', () => {
    expect(rmBlock).toContain('.sidebar-ux-panel-segmented')
    expect(rmBlock).toContain('.sidebar-ux-panel-segmented-btn')
    expect(rmBlock).toContain('transition: none')
  })
})

describe('settings visual pins — toggle token contract (unified switch)', () => {
  test('panel: no literal whites; knob colors off=text / on=primary-contrast', () => {
    expect(sheet).not.toContain('background: white')
    expect(sheet).not.toContain('background: #fff')
    expect(sheet).toContain('var(--lumiverse-primary-contrast, #fff)')
    const knob = sheet.match(/\.sidebar-ux-panel-toggle-knob\s*\{[^}]*\}/)?.[0] ?? ''
    expect(knob).toContain('background: var(--lumiverse-text)')
    const onKnob = sheet.match(
      /\.sidebar-ux-panel-toggle-on \.sidebar-ux-panel-toggle-knob\s*\{[^}]*\}/,
    )?.[0] ?? ''
    expect(onKnob).toContain('background: var(--lumiverse-primary-contrast, #fff)')
    // Knob keeps its one flourish.
    expect(knob).toContain('cubic-bezier(0.2, 0.8, 0.2, 1)')
  })

  test('panel: deterministic 36x20 border-box geometry', () => {
    const track = sheet.match(/\.sidebar-ux-panel-toggle\s*\{[^}]*\}/)?.[0] ?? ''
    expect(track).toContain('box-sizing: border-box')
    expect(track).toContain('width: 36px')
    expect(track).toContain('height: 20px')
    expect(track).toContain('border-radius: 999px')
  })

  test('Configure Tabs switch matches the unified spec (P2-13)', () => {
    const track = configureSrc.match(/\.canvas-configure-tabs-toggle\s*\{[^}]*\}/)?.[0] ?? ''
    expect(track).toContain('box-sizing: border-box')
    expect(track).toContain('width: 36px')
    expect(track).toContain('height: 20px')
    expect(track).toContain('border-radius: 999px')
    expect(track).toContain('background: var(--lumiverse-fill-strong')
    expect(track).toContain('border: 1px solid var(--lumiverse-border')
    const knob = configureSrc.match(/\.canvas-configure-tabs-toggle::after\s*\{[^}]*\}/)?.[0] ?? ''
    expect(knob).toContain('width: 14px')
    expect(knob).toContain('height: 14px')
    expect(knob).toContain('background: var(--lumiverse-text)')
    expect(knob).toContain('cubic-bezier(0.2, 0.8, 0.2, 1)')
    expect(configureSrc).not.toContain('background: #fff')
    expect(configureSrc).toContain('background: var(--lumiverse-primary-contrast, #fff)')
    expect(configureSrc).toContain('.canvas-configure-tabs-toggle:disabled {\n      opacity: 0.55;')
  })
})

describe('settings visual pins — Chrome mode header (P0-1 collision fix)', () => {
  test('header row + eyebrow exist; the absolute help chip is gone', () => {
    expect(sheet).toContain('.sidebar-ux-panel-modes-header')
    expect(sheet).toContain('.sidebar-ux-panel-modes-eyebrow')
    expect(sheet).not.toContain('.sidebar-ux-panel-modes-help')
    expect(panelSrc).not.toContain('sidebar-ux-panel-modes-help')
    expect(panelSrc).toContain("className = 'sidebar-ux-panel-modes-header'")
    expect(panelSrc).toContain("className = 'sidebar-ux-panel-modes-eyebrow'")
  })

  test('eyebrow uses the host .label style; string unified with the radiogroup', () => {
    const eyebrow = sheet.match(/\.sidebar-ux-panel-modes-eyebrow\s*\{[^}]*\}/)?.[0] ?? ''
    expect(eyebrow).toContain('font-size: calc(11px *')
    expect(eyebrow).toContain('font-weight: 600')
    expect(eyebrow).toContain('letter-spacing: 0.05em')
    expect(eyebrow).toContain('var(--lumiverse-text-dim')
    expect(panelSrc).toContain("modesEyebrow.textContent = 'Chrome mode'")
    expect(panelSrc).toContain("setAttribute('aria-label', 'Chrome mode')")
  })

  test('section titles are h3 (h2 -> h3 heading order)', () => {
    expect(panelSrc).toContain("createElement('h3')")
    expect(panelSrc).not.toContain("createElement('h4')")
  })
})

describe('settings visual pins — responsive + touch (P2-14/16)', () => {
  test('captions hide only at phone width, not for all coarse pointers', () => {
    expect(c420Block).toContain('.sidebar-ux-panel-mode-caption { display: none; }')
    expect(coarseBlock).not.toContain('sidebar-ux-panel-mode-caption')
  })

  test('hit expanders on toggle + help under narrow/coarse (24px minimum)', () => {
    expect(coarseBlock).toContain('.sidebar-ux-panel-toggle::before')
    expect(coarseBlock).toContain('.sidebar-ux-panel-help::before')
    expect(coarseBlock).toContain('inset: -4px')
  })

  test('tile press state on non-selected tiles only', () => {
    expect(
      sheet.match(
        /\.sidebar-ux-panel-mode:not\(\.sidebar-ux-panel-mode-selected\):active:not\(:disabled\)/,
      ),
    ).toBeTruthy()
  })
})

describe('settings visual pins — stacked segmented rows (2026-09-23d)', () => {
  test('row stacks the control under the label (host .field pattern)', () => {
    const row = sheet.match(/\.sidebar-ux-panel-row-stacked\s*\{[^}]*\}/)?.[0] ?? ''
    expect(row).toContain('flex-direction: column')
    expect(row).toContain('align-items: stretch')
    expect(row).toContain('gap: 8px')
  })

  test('stacked label = host .fieldLabel (12px text-muted)', () => {
    const label = sheet.match(
      /\.sidebar-ux-panel-row-stacked \.sidebar-ux-panel-row-label\s*\{[^}]*\}/,
    )?.[0] ?? ''
    expect(label).toContain('font-size: calc(12px *')
    expect(label).toContain('var(--lumiverse-text-muted)')
  })

  test('control spans the full row width', () => {
    const seg = sheet.match(
      /\.sidebar-ux-panel-row-stacked > \.sidebar-ux-panel-segmented\s*\{[^}]*\}/,
    )?.[0] ?? ''
    expect(seg).toContain('width: 100%')
    expect(seg).toContain('min-width: 0')
  })

  test('all five segmented rows opt in; render.ts supports the flag', () => {
    expect((panelSrc.match(/stacked: true/g) ?? []).length).toBe(5)
    expect(renderSrc).toContain("'sidebar-ux-panel-row-stacked'")
    expect(renderSrc).toContain('stacked?: boolean')
  })
})

describe('settings visual pins — narrow-drawer room (2026-09-23 follow-up)', () => {
  test('segmented stretches into the row free space (2026-09-23c)', () => {
    const trough = sheet.match(/\.sidebar-ux-panel-segmented\s*\{[^}]*\}/)?.[0] ?? ''
    expect(trough).toContain('flex: 1 1 auto')
    expect(trough).not.toContain('flex-shrink: 0')
    expect(trough).not.toContain('min-width: 150px')
    // The label column must not grow, or it steals the control's room.
    const label = sheet.match(/\.sidebar-ux-panel-row-text\s*\{[^}]*\}/)?.[0] ?? ''
    expect(label).toContain('flex: 0 1 auto')
  })

  test('segmented keeps the Canvas skin while the container query adds room', () => {
    const btn = sheet.match(/\.sidebar-ux-panel-segmented-btn\s*\{[^}]*\}/)?.[0] ?? ''
    expect(btn).toContain('font-size: calc(12px *')
    expect(btn).toContain('padding: 7px 10px')
    expect(btn).toContain('text-overflow: ellipsis')
  })

  test('panel is a width-true container and stacks controls when narrow', () => {
    const root = sheet.match(/\.sidebar-ux-panel-root\s*\{[^}]*\}/)?.[0] ?? ''
    expect(root).toContain('container-type: inline-size')
    expect(root).toContain('container-name: canvas-settings')
    expect(sheet).toContain('@container canvas-settings (max-width: 420px)')
    expect(
      sheet.match(
        /@container canvas-settings \(max-width: 420px\)[\s\S]*?\.sidebar-ux-panel-row > \.sidebar-ux-panel-segmented\s*\{[^}]*width: 100%/,
      ),
    ).toBeTruthy()
  })

  test('label suffix collapses to the stem below 300px; full name stays accessible', () => {
    expect(sheet).toContain('@container canvas-settings (max-width: 300px)')
    expect(sheet).toContain('.sidebar-ux-panel-seg-label-suffix { display: none; }')
    expect(panelSrc).toContain("suffix: ' drawer'")
    expect(renderSrc).toContain("'sidebar-ux-panel-seg-label-suffix'")
    expect(renderSrc).toContain("btn.setAttribute('aria-label', opt.label)")
  })
})
