// S8 WS3 — single-writer strip geometry (horizontal axis).
//
// Covers applyPinHostChrome via ensureMainPinHost (host attrs, zone width,
// edge anchors, opposite-anchor clearing) and the list chrome writer
// (absolute position, vertical set cleared, Sides re-assertion, dock-offset
// gating). Pin modules' neighbors are mocked so this suite is pure geometry.

import { describe, test, expect, mock, beforeEach } from 'bun:test'

let loc: 'sides' | 'top' | 'bottom' = 'sides'
let presence = false
let secondEnabled = true
let shellLive = true
let secondaryList: FakeEl | null = null
let side: 'left' | 'right' = 'left'
let mobile = false
let dockCalls = 0

class FakeClassList {
  private _set = new Set<string>()
  add(...cs: string[]) { for (const c of cs) this._set.add(c) }
  remove(...cs: string[]) { for (const c of cs) this._set.delete(c) }
  contains(c: string) { return this._set.has(c) }
  toggle(c: string, force?: boolean) {
    const on = force === undefined ? !this._set.has(c) : force
    if (on) this._set.add(c)
    else this._set.delete(c)
    return on
  }
}

class FakeStyle {
  private _p: Record<string, string> = {}
  getPropertyValue(k: string) { return this._p[k] ?? '' }
  setProperty(k: string, v: string) { this._p[k] = v }
  removeProperty(k: string) { delete this._p[k] }
  get top() { return this._p['top'] ?? '' }
  set top(v: string) { this._p['top'] = v }
  get bottom() { return this._p['bottom'] ?? '' }
  set bottom(v: string) { this._p['bottom'] = v }
  get left() { return this._p['left'] ?? '' }
  set left(v: string) { this._p['left'] = v }
  get right() { return this._p['right'] ?? '' }
  set right(v: string) { this._p['right'] = v }
  get width() { return this._p['width'] ?? '' }
  set width(v: string) { this._p['width'] = v }
  get height() { return this._p['height'] ?? '' }
  set height(v: string) { this._p['height'] = v }
  get position() { return this._p['position'] ?? '' }
  set position(v: string) { this._p['position'] = v }
  get flexDirection() { return this._p['flexDirection'] ?? '' }
  set flexDirection(v: string) { this._p['flexDirection'] = v }
  get borderLeft() { return this._p['borderLeft'] ?? '' }
  set borderLeft(v: string) { this._p['borderLeft'] = v }
  get borderRight() { return this._p['borderRight'] ?? '' }
  set borderRight(v: string) { this._p['borderRight'] = v }
}

class FakeEl {
  style = new FakeStyle()
  classList = new FakeClassList()
  className = ''
  children: FakeEl[] = []
  attrs = new Map<string, string>()
  parentElement: FakeEl | null = null
  firstChild: FakeEl | null = null
  childNodes: FakeEl[] = []
  setAttribute(k: string, v: string) { this.attrs.set(k, v) }
  getAttribute(k: string) { return this.attrs.get(k) ?? null }
  appendChild(c: FakeEl) { c.parentElement = this; this.children.push(c); this.childNodes.push(c); this.firstChild = this.children[0] ?? null; return c }
  insertBefore(c: FakeEl, _ref: FakeEl | null) { return this.appendChild(c) }
  removeChild(c: FakeEl) {
    this.children = this.children.filter((x) => x !== c)
    this.childNodes = this.childNodes.filter((x) => x !== c)
    this.firstChild = this.children[0] ?? null
    return c
  }
  remove() { this.parentElement = null }
  querySelector(_s: string): FakeEl | null { return null }
  querySelectorAll(_s: string): FakeEl[] { return [] }
}

// ── Module mocks (registered before the module under test is imported) ──

mock.module('../../settings/state', () => ({
  getSettings: () => ({
    moveControlsToOuterEdge: true,
    taskbarMode: true,
    secondSidebarEnabled: secondEnabled,
  }),
  getDrawerLocation: () => loc,
  getStripEdge: () => (loc === 'top' ? 'top' : loc === 'bottom' ? 'bottom' : null),
  isHorizontalStrip: () => loc !== 'sides',
  isTaskbarModeEnabled: () => true,
}))

mock.module('../../tabs/assignment', () => ({
  hasSecondaryAssignedTabs: () => presence,
}))

mock.module('../../store', () => ({
  getMainDrawerSide: () => side,
}))

mock.module('../../dom/lumiverse', () => ({
  getMainDrawer: () => null,
  getMainSidebar: () => null,
  getMainPanel: () => null,
}))

mock.module('../mobile-exclusion', () => ({
  isMobileViewport: () => mobile,
}))

mock.module('../secondary', () => ({
  getSecondaryDrawer: () => null,
  getSecondaryTabList: () => secondaryList,
  getSecondaryPanel: () => null,
  isSecondaryShellLive: () => shellLive,
}))

mock.module('../dock-offset', () => ({
  updateDockOffsets: () => { dockCalls++ },
}))

// ── DOM stub ──

const body = new FakeEl()
;(globalThis as any).document = {
  body,
  documentElement: { style: new FakeStyle(), classList: new FakeClassList() },
  createElement: () => new FakeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
}

const {
  ensureMainPinHost,
  destroyMainPinHost,
  applyPinnedTabListChrome,
  clearPinnedTabListChrome,
  applyTabListPin,
} = await import('../tab-position')

const { HORIZONTAL_STRIP_CSS } = await import('../styles')

const SAFE_TOP = 'env(safe-area-inset-top, 0px)'
const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)'
const SAFE_LEFT = 'env(safe-area-inset-left, 0px)'
const SAFE_RIGHT = 'env(safe-area-inset-right, 0px)'

function freshList(): FakeEl {
  const el = new FakeEl()
  el.className = 'sidebar-ux-tab-list'
  return el
}

describe('applyPinHostChrome via ensureMainPinHost (WS3)', () => {
  beforeEach(() => {
    loc = 'sides'
    presence = false
    secondEnabled = true
    shellLive = true
    secondaryList = null
    side = 'left'
    mobile = false
    dockCalls = 0
    destroyMainPinHost()
  })

  test('vertical host: side attrs + 56px edge column', () => {
    const host = ensureMainPinHost('left')!
    expect(host.getAttribute('data-strip-axis')).toBe('vertical')
    expect(host.getAttribute('data-strip-edge')).toBe('left')
    expect(host.className).toContain('sidebar-ux-side-left')
    expect(host.style.width).toBe('56px')
    expect(host.style.left).toBe('0')
    expect(host.style.right).toBe('')
    expect(host.style.top).toBe(SAFE_TOP)
    expect(host.style.bottom).toBe(SAFE_BOTTOM)
    expect(host.style.height).toBe('')
  })

  test('horizontal top solo: full width, safe-area anchor, no stale bottom', () => {
    loc = 'top'
    presence = false
    const host = ensureMainPinHost('left')!
    expect(host.getAttribute('data-strip-axis')).toBe('horizontal')
    expect(host.getAttribute('data-strip-edge')).toBe('top')
    expect(host.style.height).toBe('var(--sidebar-ux-strip-h, 56px)')
    expect(host.style.top).toBe(SAFE_TOP)
    expect(host.style.bottom).toBe('')
    expect(host.style.width).toBe('100%')
    expect(host.style.left).toBe(SAFE_LEFT)
    expect(host.style.right).toBe('')
  })

  test('horizontal bottom dual (right side): 50%+1px anchored right', () => {
    loc = 'bottom'
    presence = true
    shellLive = true
    secondaryList = freshList()
    const host = ensureMainPinHost('right')!
    expect(host.getAttribute('data-strip-edge')).toBe('bottom')
    expect(host.style.bottom).toBe(SAFE_BOTTOM)
    expect(host.style.top).toBe('')
    expect(host.style.width).toBe('calc(50% + 1px)')
    expect(host.style.right).toBe(SAFE_RIGHT)
    expect(host.style.left).toBe('')
  })

  test('dual zone halves overlap by 1px (device-pixel seam guard)', () => {
    // Live bug 2026-09-14: at 90% Firefox zoom each 50% fixed half rounded to
    // a fractional device pixel and a 1-device-px column of page background
    // showed through at the seam as a divider. Both halves must grow 1px
    // inward so the union can never leave that column uncovered.
    loc = 'top'
    presence = true
    secondaryList = freshList()
    const host = ensureMainPinHost('left')!
    expect(host.style.width).toBe('calc(50% + 1px)')
  })

  test('dual collapses to solo when the secondary zone disappears', () => {
    loc = 'top'
    presence = true
    secondaryList = freshList()
    let host = ensureMainPinHost('left')!
    expect(host.style.width).toBe('calc(50% + 1px)')

    // Presence lost (mode switch / last tab removed) → full width again.
    presence = false
    host = ensureMainPinHost('left')!
    expect(host.style.width).toBe('100%')
  })

  test('flip horizontal → sides clears height and restores edge column', () => {
    loc = 'top'
    let host = ensureMainPinHost('left')!
    expect(host.style.height).toBe('var(--sidebar-ux-strip-h, 56px)')
    loc = 'sides'
    host = ensureMainPinHost('left')!
    expect(host.getAttribute('data-strip-axis')).toBe('vertical')
    expect(host.style.height).toBe('')
    expect(host.style.width).toBe('56px')
    expect(host.style.left).toBe('0')
  })
})

describe('list chrome writer (WS3)', () => {
  beforeEach(() => {
    loc = 'sides'
    presence = false
    mobile = false
    dockCalls = 0
  })

  test('horizontal: absolute + vertical set cleared; no dock offset', () => {
    loc = 'top'
    const list = freshList()
    applyPinnedTabListChrome(list as any, 'right')
    expect(list.classList.contains('sidebar-ux-tab-list--pinned')).toBe(true)
    expect(list.style.position).toBe('absolute')
    expect(list.style.top).toBe('')
    expect(list.style.bottom).toBe('')
    expect(list.style.left).toBe('')
    expect(list.style.right).toBe('')
    expect(list.style.width).toBe('')
    expect(list.style.height).toBe('')
    expect(list.style.flexDirection).toBe('')
    expect(list.style.borderLeft).toBe('')
    expect(list.style.borderRight).toBe('')
    expect(dockCalls).toBe(0)
  })

  test('sides: re-asserts column/56px/borders and re-applies dock offsets', () => {
    loc = 'sides'
    const list = freshList()
    applyPinnedTabListChrome(list as any, 'left')
    expect(list.style.position).toBe('fixed')
    expect(list.style.width).toBe('56px')
    expect(list.style.flexDirection).toBe('column')
    // Side left → panel-facing (inner) edge is the right side.
    expect(list.style.borderRight).toBe('1px solid var(--lumiverse-primary-020)')
    expect(list.style.borderLeft).toBe('none')
    expect(dockCalls).toBe(1)
  })

  test('horizontal mobile pins; Sides-mobile force-unpins (S6 preserved)', () => {
    // Horizontal mobile: the gate no longer force-unpins.
    mobile = true
    loc = 'top'
    presence = true
    const list = freshList()
    secondaryList = list
    applyTabListPin(true, { force: true })
    expect(list.classList.contains('sidebar-ux-tab-list--pinned')).toBe(true)
    expect(list.style.position).toBe('absolute')

    // Back to Sides on mobile: force-unpin clears the pin state.
    loc = 'sides'
    applyTabListPin(true, { force: true })
    expect(list.classList.contains('sidebar-ux-tab-list--pinned')).toBe(false)
    expect(list.style.position).toBe('')
  })

  test('clear: full property reset + construction restore', () => {
    loc = 'top'
    const list = freshList()
    applyPinnedTabListChrome(list as any, 'left')
    clearPinnedTabListChrome(list as any)
    expect(list.classList.contains('sidebar-ux-tab-list--pinned')).toBe(false)
    expect(list.style.position).toBe('')
    expect(list.style.top).toBe('')
    expect(list.style.bottom).toBe('')
    expect(list.style.left).toBe('')
    expect(list.style.right).toBe('')
    expect(list.style.width).toBe('56px')
    expect(list.style.flexDirection).toBe('column')
    expect(list.style.borderLeft).toBe('')
    expect(list.style.borderRight).toBe('')
  })
})

// S8 regression (live bug 2026-09-13): the right-side horizontal strip was
// scroll-locked. `justify-content: flex-end` on a scroll container pushes the
// overflow past the inline-start edge, which is not part of the scrollable
// region — scrollWidth collapses to clientWidth, max scrollLeft is 0, and the
// earliest tabs get clipped and are unreachable. Right-anchoring must instead
// come from `margin-left: auto` (+ flex-start), which absorbs only positive
// free space: anchored while the tabs fit, fully scrollable once they
// overflow. 2026-09-15: the auto margin lives on an always-present `::before`
// pseudo spacer, not on a button (button-identity stamping broke repeatedly —
// hidden button, removed button, DnD placeholder exclusion).
describe('HORIZONTAL_STRIP_CSS right-anchor scrollability (S8 regression)', () => {
  // Rule blocks only — strip comments so the explanatory text cannot satisfy
  // or fail the assertions.
  const blocks = HORIZONTAL_STRIP_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .filter((b) => b.trim().length > 0)

  test('right-side scroller rules use flex-start, never flex-end', () => {
    const rightAnchorRules = blocks.filter(
      (b) => b.includes('sidebar-ux-side-right') && b.includes('justify-content'),
    )
    // Both horizontal scrollers (main section + secondary outer list).
    expect(rightAnchorRules.length).toBeGreaterThanOrEqual(2)
    for (const rule of rightAnchorRules) {
      expect(rule).not.toContain('flex-end')
      expect(rule).toContain('flex-start')
    }
  })

  test('right-side clusters anchor via the always-present pseudo spacer', () => {
    const pseudoRules = blocks.filter(
      (b) => b.includes('sidebar-ux-side-right') && b.includes('::before'),
    )
    // One per scroller variant (inner main section + leaf list).
    expect(pseudoRules.length).toBeGreaterThanOrEqual(2)
    for (const rule of pseudoRules) {
      expect(rule).toContain("content: ''")
      expect(rule).toContain('margin: 0 0 0 auto')
    }
  })

  // 2026-09-15 (final form): the anchor is CSS-only. The button-identity
  // lifecycle (STRIP_ANCHOR_CLASS / restampStripAnchor) is retired — it broke
  // three times in three days (hidden first button, removed button, DnD
  // placeholder exclusion) and the last one settled the drop overlay on the
  // un-anchored slot.
  test('the button-identity anchor lifecycle is retired', () => {
    expect(HORIZONTAL_STRIP_CSS).not.toContain('sidebar-ux-strip-anchor')
  })
})

// Live feedback 2026-09-14: in Top/Bottom mode the Settings dock sat at the
// cluster's INNER end — with both zones present that is the middle of the
// bar. It must instead sit flush against the drawer-side screen edge with
// the tabs growing inward and the divider facing them. The dock is visually
// BEFORE the tabs on a left-side host (order:-1; DOM order is [main,
// bottom]) and AFTER them on a right-side host (plain order).
describe('HORIZONTAL_STRIP_CSS settings dock placement (live feedback 2026-09-14)', () => {
  const blocks = HORIZONTAL_STRIP_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .filter((b) => b.trim().length > 0)

  const dockBlock = (side: 'left' | 'right') =>
    blocks.find(
      (b) =>
        b.includes(`sidebar-ux-side-${side}`) && b.includes('sidebar-ux-tab-list-bottom'),
    ) ?? ''

  test('left-side dock is ordered before the tabs, divider facing them', () => {
    const rule = dockBlock('left')
    expect(rule).toContain('order: -1')
    expect(rule).toContain('border-right: 1px solid')
    // Inner-side values cleared so the S6 mobile sheet cannot re-add them.
    expect(rule).toContain('border-left: none')
    expect(rule).toContain('margin-left: 0')
    expect(rule).toContain('padding-left: 0')
  })

  test('right-side dock stays at the edge, divider facing the tabs', () => {
    const rule = dockBlock('right')
    expect(rule).toContain('order: 0')
    expect(rule).toContain('border-left: 1px solid')
    expect(rule).toContain('border-right: none')
    expect(rule).toContain('margin-right: 0')
    expect(rule).toContain('padding-right: 0')
  })
})

// Live bug 2026-09-15: the Top/Bottom strip reserve put margin-top/bottom
// on `_chatColumn_` ALONE. The host `.body` is a flex ROW, so a cross-axis
// margin does not reduce the column's height — the column became
// 100% + 56px and the host's `overflow: clip` cut off the composer (TOP) or
// the composer sat under the strip (BOTTOM). The reserve must also land on
// `_chatColumnInner_` (a column-flex child with default flex-shrink), which
// shrinks to 100% - 56 and keeps the composer inside the visible lane.
describe('HORIZONTAL_STRIP_CSS chat top/bottom reserve (live bug 2026-09-15)', () => {
  const blocks = HORIZONTAL_STRIP_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .filter((b) => b.trim().length > 0)

  test('inner reserve exists for BOTH edges (the composer fix)', () => {
    const innerRule = blocks.find((b) => b.includes('_chatColumnInner_')) ?? ''
    expect(innerRule).toContain('sidebar-ux-location-top')
    expect(innerRule).toContain('sidebar-ux-location-bottom')
    expect(innerRule).toContain('margin-bottom: var(--sidebar-ux-strip-h, 56px) !important')
  })

  // Theme Studio "strong" overrides compile to :where(base) + 2 :not(#id)
  // guards with !important — an unguarded Canvas rule loses on specificity
  // and the reserve silently disappears (verified against a live TS project
  // that sets a strong margin-bottom on _chatColumnInner_). The guards are
  // inert for matching; they exist purely as the 2-ID authority tier.
  test('reserve rules carry the authority specificity tier', () => {
    const owned = blocks.filter(
      (b) => b.includes('_chatColumn_') || b.includes('_chatColumnInner_'),
    )
    expect(owned.length).toBeGreaterThanOrEqual(3)
    for (const rule of owned) {
      expect(rule).toContain(':not(#__theme_studio_authority_a__)')
      expect(rule).toContain(':not(#__theme_studio_authority_b__)')
    }
  })

  test('outer chat rules are retained (top margin pushes past the strip)', () => {
    const outerRules = blocks.filter(
      (b) => b.includes('_chatColumn_') && !b.includes('_chatColumnInner_'),
    )
    const topRule = outerRules.find((b) => b.includes('sidebar-ux-location-top')) ?? ''
    const bottomRule = outerRules.find((b) => b.includes('sidebar-ux-location-bottom')) ?? ''
    expect(topRule).toContain('margin-top: var(--sidebar-ux-strip-h, 56px) !important')
    expect(bottomRule).toContain('margin-bottom: var(--sidebar-ux-strip-h, 56px) !important')
  })
})

// 2026-09-15: the OS Start in the second drawer lives in a
// `.sidebar-ux-tab-list-bottom` dock (exactly like the main drawer's Settings
// dock), so the generic dock rules above own its divider in Top/Bottom — no
// Start-specific border rules exist any more. This guards against
// reintroducing button chrome for the divider.
describe('HORIZONTAL_STRIP_CSS Start divider is dock-owned (2026-09-15)', () => {
  test('no Start-specific divider rules remain', () => {
    const blocks = HORIZONTAL_STRIP_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .filter((b) => b.trim().length > 0)
    const startRules = blocks.filter((b) => b.includes('data-canvas-os-start'))
    expect(startRules.length).toBe(1) // the 48x48 sizing rule only
    for (const rule of startRules) {
      expect(rule).not.toContain('border-top')
      expect(rule).not.toContain('border-right')
      expect(rule).not.toContain('border-left')
    }
  })
})
