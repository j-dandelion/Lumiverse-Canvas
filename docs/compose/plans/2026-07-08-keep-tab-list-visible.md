# keepTabListVisible Setting Implementation Plan

> **Historical.** Setting/API renamed **2026-07-12** to `taskbarMode` / “Taskbar mode” (UI). Legacy key still migrates in `mergeCanvasSettings`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `keepTabListVisible` setting to Canvas that pins the secondary drawer's tab-button-list to the screen edge so the user can switch tabs even when the drawer is closed. Works regardless of the `moveControlsToOuterEdge` setting and regardless of which side the main/secondary drawer is on.

**Architecture:** When the new setting is on, the secondary's `.sidebar-ux-tab-list` element is taken out of the drawer's flex layout via `position: fixed` and pinned to the viewport edge (matching the secondary's side). The wrapper continues to translate on open/close; the panel (which is now the drawer's only flex child) slides in from behind the pinned tabList. The drawer's `flex-direction` is reset, the panel's chat-facing border is cleared, and the tabList's own border is set to the inner (panel-facing) side. The wrapper's `.sidebar-ux-drawer-tab` toggle remains a child of the wrapper and slides with it; it is visually behind the pinned tabList when the drawer is closed and visible to the left of the drawer when open.

**Tech Stack:** TypeScript, DOM inline styles, feature registry pattern (`CanvasFeature`), Zustand-free settings state (in-memory `FullCanvasSettings`).

## Global Constraints

- Canvas-only changes (no Lumiverse modifications)
- Follow existing `applyTabListPosition` patterns in `src/sidebar/tab-position.ts`
- New function lives in `src/sidebar/tab-position.ts` (no new file)
- New feature registered in `src/features/registry.ts` FEATURES array (appended last)
- New setting added to `CanvasSettings` in `src/types.ts` with default `false`
- New UI toggle in the "Sidebars" section of `src/settings/panel.ts`
- No-op on mobile (viewport ≤ 600px), matching `applyTabListPosition` behavior
- Idempotent (using `setIfDifferent` style guard or class check)
- Test framework: existing test pattern in `src/sidebar/__tests__/tab-position.test.ts` (plain `bun run` with `assert`/`assertEqual` helpers)

## File Structure

```
src/types.ts                                      # Add keepTabListVisible to CanvasSettings + DEFAULT_CANVAS_SETTINGS
src/sidebar/tab-position.ts                       # Add applyTabListPin() + TAB_LIST_PINNED_CLASS export
src/sidebar/styles.ts                             # Add .sidebar-ux-tab-list--pinned rules
src/features/registry.ts                          # Add keepTabListVisible feature
src/settings/panel.ts                             # Add UI toggle in "Sidebars" section
src/sidebar/__tests__/tab-pin.test.ts             # New unit test for applyTabListPin
```

---

### Task 1: Add the `keepTabListVisible` setting to `CanvasSettings`

**Covers:** Setting type, default, and merge logic.

**Files:**
- Modify: `src/types.ts:32-128`

**Interfaces:**
- Consumes: nothing new
- Produces: `keepTabListVisible?: boolean` on `CanvasSettings`; `keepTabListVisible: false` on `DEFAULT_CANVAS_SETTINGS`

- [ ] **Step 1: Add the setting field to the `CanvasSettings` interface**

In `src/types.ts`, after the `moveControlsToOuterEdge` field (line 56), add a new field with a doc comment:

```typescript
  /** When the secondary drawer is closed, keep the tab-button-list visible
   *  at the screen edge so the user can switch tabs without opening the
   *  drawer. Works regardless of `moveControlsToOuterEdge`. The panel still
   *  slides in/out from behind the pinned tab list. No-op on mobile. */
  keepTabListVisible?: boolean
```

- [ ] **Step 2: Add the default value to `DEFAULT_CANVAS_SETTINGS`**

In `src/types.ts`, in the `DEFAULT_CANVAS_SETTINGS` object (line 107-128), add the default after `moveControlsToOuterEdge: false`:

```typescript
  // Sidebars
  moveControlsToOuterEdge: false,
  keepTabListVisible: false,
```

- [ ] **Step 3: Run typecheck to confirm no type errors**

Run: `bun run typecheck` from the package directory.
Expected: No errors. `mergeCanvasSettings` will pick up the new field automatically (it iterates `Object.keys(out)`).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add keepTabListVisible setting"
```

---

### Task 2: Implement `applyTabListPin()` in `tab-position.ts`

**Covers:** The core DOM-mutation function for pinning the tab list to the viewport edge.

**Files:**
- Modify: `src/sidebar/tab-position.ts` (append a new exported function at the end of the file)
- Test: `src/sidebar/__tests__/tab-pin.test.ts` (created in Task 5)

**Interfaces:**
- Consumes: `getMainDrawerSide()` from `../store`; `getSecondaryTabList()`, `getSecondaryPanel()` from `./secondary`; `getSettings()` from `../settings/state`; `isMobileViewport()` from `./mobile-exclusion`
- Produces: `export const TAB_LIST_PINNED_CLASS = 'sidebar-ux-tab-list--pinned'`; `export function applyTabListPin(enabled: boolean): void`

- [ ] **Step 1: Add the pinned-class constant at the top of `tab-position.ts` (after the imports, before `ElementOpts`)**

```typescript
/** Class added to .sidebar-ux-tab-list when keepTabListVisible pins it to
 *  the viewport edge. Used both as a runtime flag (idempotency check) and
 *  as a CSS hook for any pinned-specific rules in sidebar/styles.ts. */
export const TAB_LIST_PINNED_CLASS = 'sidebar-ux-tab-list--pinned'
```

- [ ] **Step 2: Add the `applyTabListPin()` function at the end of `tab-position.ts`**

The function:
- No-ops on mobile.
- No-ops if the secondary wrapper doesn't exist.
- Is idempotent (checks for the pinned class before mutating).
- When `enabled`:
  - Adds the pinned class.
  - Sets `position: fixed; top: 0; bottom: 0; [side]: 0; z-index: 10000; width: 56px; pointer-events: auto;` on the tab list (where `[side]` is `right` if the secondary is on the right of the screen, `left` otherwise).
  - Resets the secondary drawer's `flex-direction` to default (the tab list is no longer a flex child).
  - Clears the secondary panel's `borderRight` and `borderLeft`.
  - Sets the tab list's border on the inner (panel-facing) side: `borderLeft` if the secondary is on the right of the screen, `borderRight` if on the left.
- When `!enabled`:
  - Removes the pinned class.
  - Clears the inline `position`, `top`, `bottom`, `left`, `right`, `z-index`, `pointer-events` on the tab list.
  - Re-calls `applyTabListPosition(getSettings().moveControlsToOuterEdge)` to restore the drawer's `flex-direction`, the tab list's original border, and the panel's chat-facing border.

```typescript
/** Pin the secondary drawer's tab-button-list to the viewport edge so it
 *  remains visible even when the drawer is closed. The panel (the drawer's
 *  only remaining flex child) slides in/out from behind the pinned tab
 *  list. The drawer toggle (`.sidebar-ux-drawer-tab`) is unchanged — it
 *  still slides with the wrapper, hidden behind the tab list when closed
 *  and visible to the left of the drawer when open.
 *
 *  Idempotent. No-op on mobile (the drawer's mobile layout already handles
 *  the tab list differently via media queries). No-op if the secondary
 *  wrapper doesn't exist (master toggle off or before mount). */
export function applyTabListPin(enabled: boolean): void {
  if (isMobileViewport()) return

  const tabList = getSecondaryTabList()
  if (!tabList) return
  const drawer = getSecondaryDrawer()
  const panel = getSecondaryPanel()

  const isPinned = tabList.classList.contains(TAB_LIST_PINNED_CLASS)
  if (enabled === isPinned) return  // already in target state

  // Secondary is on the opposite side of the main.
  const side: 'left' | 'right' = getMainDrawerSide() === 'left' ? 'right' : 'left'
  const innerBorderSide: 'left' | 'right' = side === 'right' ? 'left' : 'right'
  const borderVal = '1px solid var(--lumiverse-primary-020)'

  if (enabled) {
    tabList.classList.add(TAB_LIST_PINNED_CLASS)
    // Position the tab list at the viewport edge.
    ;(tabList as any).style.position = 'fixed'
    ;(tabList as any).style.top = '0'
    ;(tabList as any).style.bottom = '0'
    ;(tabList as any).style[side] = '0'
    ;(tabList as any).style.zIndex = '10000'
    ;(tabList as any).style.width = '56px'
    ;(tabList as any).style.pointerEvents = 'auto'
    // Border on the inner (panel-facing) side.
    if (innerBorderSide === 'right') {
      ;(tabList as any).style.borderRight = borderVal
      ;(tabList as any).style.borderLeft = 'none'
    } else {
      ;(tabList as any).style.borderLeft = borderVal
      ;(tabList as any).style.borderRight = 'none'
    }
    // Reset the drawer's flex direction — the tab list is no longer a
    // flex child, so the direction has no effect.
    if (drawer) {
      ;(drawer as any).style.flexDirection = ''
    }
    // Clear the panel's chat-facing border — the tab list no longer
    // sits next to the panel inside the drawer.
    if (panel) {
      ;(panel as any).style.borderRight = 'none'
      ;(panel as any).style.borderLeft = 'none'
    }
  } else {
    tabList.classList.remove(TAB_LIST_PINNED_CLASS)
    // Clear the pinning styles on the tab list.
    ;(tabList as any).style.position = ''
    ;(tabList as any).style.top = ''
    ;(tabList as any).style.bottom = ''
    ;(tabList as any).style.left = ''
    ;(tabList as any).style.right = ''
    ;(tabList as any).style.zIndex = ''
    ;(tabList as any).style.width = ''
    ;(tabList as any).style.pointerEvents = ''
    // Clear the borders we set — applyTabListPosition will set them
    // based on moveControlsToOuterEdge.
    ;(tabList as any).style.borderLeft = ''
    ;(tabList as any).style.borderRight = ''
    // Restore the drawer's flex direction and the panel's border.
    applyTabListPosition(getSettings().moveControlsToOuterEdge)
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors. The function uses inline `as any` casts on `style` because the tab list / drawer / panel elements are typed as `HTMLElement` but we only set CSS properties the test stubs already support (the existing `applyTabListPosition` uses a `StyledElement` type alias for the same reason — see lines 26-36 of `tab-position.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/sidebar/tab-position.ts
git commit -m "feat: add applyTabListPin function"
```

---

### Task 3: Add CSS rules for the pinned tab list

**Covers:** Ensuring the pinned tab list's tab buttons render with the correct visual state (color, hover, active indicator, side-specific box-shadow) regardless of whether the tab list is inside the drawer or pinned to the viewport edge.

**Files:**
- Modify: `src/sidebar/styles.ts:159-204` (the wrapper-scoped tab-button rules in `injectDrawerTabStyles`)

**Interfaces:**
- Consumes: `TAB_LIST_PINNED_CLASS` (exported from `tab-position.ts` in Task 2)
- Produces: CSS rules that target `.sidebar-ux-tab-list--pinned` in addition to the existing wrapper-scoped rules

- [ ] **Step 1: Add pinned-class selectors to the tab-button CSS rules**

In `src/sidebar/styles.ts`, the rules at lines 159-204 use `.sidebar-ux-secondary-wrapper .sidebar-ux-tab-list button[data-tab-id]` (wrapper-scoped). When the tab list is pinned to the viewport edge, the wrapper-scoped rules still match (the tab list is still a descendant of the wrapper, just `position: fixed`). So **no rule changes are strictly required for the pinned state**.

However, the side-specific active-indicator rule at line 198 uses `.sidebar-ux-secondary-wrapper.sidebar-ux-side-left .sidebar-ux-tab-list button[data-tab-id].sidebar-ux-tab-active`. The `.sidebar-ux-side-left` class is on the wrapper. When the tab list is pinned, the tab list is still a descendant of the wrapper, so this rule still matches. **No changes needed.**

The only cosmetic concern: when pinned, the tab list's `flex-direction: column` (set inline at `secondary.tsx:217`) is still in effect, but the tab list is no longer a flex child of the drawer. With `position: fixed`, the `flex-direction` is irrelevant — the tab list is laid out as a block with its children stacked vertically by their own display values. The tab buttons have `display: flex` (via the `injectDrawerTabStyles` rule at styles.ts:99-100), so they stack naturally.

**Conclusion: no CSS changes are needed for the pinned state.** Skip this task.

If visual testing later reveals a styling issue (e.g., the active indicator direction is wrong when pinned), the fix would be a new CSS rule keyed on `.sidebar-ux-tab-list--pinned` that overrides the side-specific box-shadow. Add the override only if a real bug is observed.

- [ ] **Step 2: Commit (empty — nothing changed)**

```bash
git commit --allow-empty -m "chore: no CSS changes needed for pinned tab list"
```

---

### Task 4: Register the `keepTabListVisible` feature

**Covers:** Feature lifecycle wiring — init, mount, apply, teardown.

**Files:**
- Modify: `src/features/registry.ts:38, 367-380` (import and FEATURES array)
- Modify: `src/features/registry.ts` (add the new feature object)

**Interfaces:**
- Consumes: `applyTabListPin` from `../sidebar/tab-position`
- Produces: A `CanvasFeature` object with `id: 'keepTabListVisible'`, `mount(ctx, layout)`, `apply(prev, next)`, and a returned teardown from `mount`

- [ ] **Step 1: Add the import**

In `src/features/registry.ts`, update the existing import (line 38):

```typescript
import { applyTabListPosition, applyTabListPin } from '../sidebar/tab-position'
```

- [ ] **Step 2: Add the new feature object, placed AFTER `tabPositionFeature` and BEFORE `drawerTabDragFeature`**

Insert after line 363 (the closing `}` of `tabPositionFeature`):

```typescript
/** Keep tab controls visible: pins the secondary drawer's tab-button-list to
 *  the screen edge so the user can switch tabs even when the drawer is
 *  closed. The panel still slides in/out from behind the pinned list.
 *  No-op on mobile (mobile CSS handles the tab list separately).
 *
 *  init() is a no-op (the secondary wrapper doesn't exist at init time —
 *  it's created later in secondSidebarFeature.mount()). mount() reads
 *  the current setting and applies it. apply() re-applies on diff. The
 *  returned teardown un-pins the tab list so the secondary wrapper can
 *  be torn down cleanly without leaving a body-level orphan. */
const keepTabListVisibleFeature: CanvasFeature = {
  id: 'keepTabListVisible',
  mount(_ctx, _layout) {
    applyTabListPin(getSettings().keepTabListVisible)
    return () => applyTabListPin(false)
  },
  apply(prev, next) {
    if (prev.keepTabListVisible === next.keepTabListVisible) return
    applyTabListPin(next.keepTabListVisible)
  },
}
```

- [ ] **Step 3: Register the feature in the FEATURES array**

In `src/features/registry.ts`, update the FEATURES array (lines 367-380) to include the new feature AFTER `tabPositionFeature` and BEFORE `drawerTabDragFeature`:

```typescript
export const FEATURES: readonly CanvasFeature[] = [
  debugFeature,
  chatReflowFeature,
  secondSidebarFeature,
  resizeSidebarsFeature,
  drawerSyncFeature,
  consistentIconSizeFeature,
  shadowsDesktopFeature,
  shadowsMobileFeature,
  layoutPersistenceFeature,
  slashFeature,
  tabPositionFeature,
  keepTabListVisibleFeature,  // <-- new
  drawerTabDragFeature,
]
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/registry.ts
git commit -m "feat: register keepTabListVisible feature"
```

---

### Task 5: Add the UI toggle to the settings panel

**Covers:** The user-facing toggle in the "Sidebars" section of the Canvas settings panel.

**Files:**
- Modify: `src/settings/panel.ts:247-289` (the "Sidebars" section)

**Interfaces:**
- Consumes: `getSettings()`, `setSettings()` from `../settings/state`; `buildSettingRow()` from `./render`
- Produces: A new toggle row in the "Sidebars" section, registered in the `refresh` closure

- [ ] **Step 1: Add the toggle to the "Sidebars" section**

In `src/settings/panel.ts`, after the `moveControlsToOuterEdge` toggle (line 257) and before the `resizeSidebars` toggle (line 259), add:

```typescript
  const keepTabListVisible = makeToggle(
    () => getSettings().keepTabListVisible,
    (v) => setSettings({ keepTabListVisible: v })
  )
  secSidebars.appendChild(buildSettingRow({
    label: 'Keep tab controls visible',
    hint: 'Pins the tab buttons to the screen edge so you can switch tabs even when the second drawer is closed. The panel still slides in and out from behind the list.',
    control: keepTabListVisible.btn,
  }))
```

- [ ] **Step 2: Register the toggle in the `refresh` closure**

In the `refresh` closure (around line 372-397), add the refresh call. Place it next to `moveControlsToOuter.refresh()`:

```typescript
  const refresh = () => {
    master.refresh()
    moveControlsToOuter.refresh()
    keepTabListVisible.refresh()  // <-- new
    resizeSidebars.refresh()
    compact.refresh()
    iconSize.refresh()
    chat.refresh()
    persist.refresh()
    slash.refresh()
    debugMode.refresh()
    shadowsDesktop.refresh()
    shadowsMobile.refresh()
    // ... (rest unchanged)
  }
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/settings/panel.ts
git commit -m "feat: add Keep tab controls visible toggle to settings panel"
```

---

### Task 6: Write unit tests for `applyTabListPin()`

**Covers:** Verifying the pinning/unpinning behavior, side awareness, idempotency, and mobile no-op.

**Files:**
- Create: `src/sidebar/__tests__/tab-pin.test.ts`
- Reference: `src/sidebar/__tests__/tab-position.test.ts` (for test pattern)

**Interfaces:**
- Consumes: `applyTabListPin`, `TAB_LIST_PINNED_CLASS` from `../tab-position`; `__setSecondaryWrapperForTest` from `../secondary`
- Produces: A test file that runs via `bun run src/sidebar/__tests__/tab-pin.test.ts` and prints `PASS: N / FAILED: M`

- [ ] **Step 1: Create the test file with stubs and import setup**

The test follows the same pattern as `tab-position.test.ts`: a hand-rolled `StubElement` / `StubStyle` with the inline-style properties the function touches, a stubbed `document.querySelector` that returns the right element per selector, a stubbed `window.matchMedia` (default desktop). The test maintains two separate wrapper stubs: `mainWrapperStub` (whose className encodes the main drawer's side, used by `getMainDrawerSide()`) and `secondaryWrapperStub` (set via `__setSecondaryWrapperForTest`, used by `getSecondaryTabList()` and friends).

```typescript
// Test for applyTabListPin in src/sidebar/tab-position.ts
//
// Verifies the pinning behavior:
// - When enabled, the tab list gets position: fixed, top/bottom/[side]: 0,
//   z-index, width, and pointer-events; the drawer's flex-direction is
//   reset; the panel's borders are cleared; the tab list's border is set
//   on the inner (panel-facing) side.
// - When disabled, all of the above are reverted and applyTabListPosition
//   is called to restore the drawer's flex-direction and the panel's
//   chat-facing border.
// - Side awareness: secondary on the right → tab list pinned at right: 0,
//   border on left. Secondary on the left → tab list pinned at left: 0,
//   border on right.
// - Idempotency: calling pin twice does not re-write the inline styles.
// - Mobile no-op: stub matchMedia to return mobile → no styles written.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// --- Minimal DOM stubs ---

class StubStyle {
  private _props: Record<string, string> = {}
  get position() { return this._props['position'] ?? '' }
  set position(v: string) { this._props['position'] = v }
  get top() { return this._props['top'] ?? '' }
  set top(v: string) { this._props['top'] = v }
  get bottom() { return this._props['bottom'] ?? '' }
  set bottom(v: string) { this._props['bottom'] = v }
  get left() { return this._props['left'] ?? '' }
  set left(v: string) { this._props['left'] = v }
  get right() { return this._props['right'] ?? '' }
  set right(v: string) { this._props['right'] = v }
  get zIndex() { return this._props['zIndex'] ?? '' }
  set zIndex(v: string) { this._props['zIndex'] = v }
  get width() { return this._props['width'] ?? '' }
  set width(v: string) { this._props['width'] = v }
  get pointerEvents() { return this._props['pointerEvents'] ?? '' }
  set pointerEvents(v: string) { this._props['pointerEvents'] = v }
  get borderLeft() { return this._props['borderLeft'] ?? '' }
  set borderLeft(v: string) { this._props['borderLeft'] = v }
  get borderRight() { return this._props['borderRight'] ?? '' }
  set borderRight(v: string) { this._props['borderRight'] = v }
  get flexDirection() { return this._props['flexDirection'] ?? '' }
  set flexDirection(v: string) { this._props['flexDirection'] = v }
}

class StubElement {
  style = new StubStyle()
  private _className = ''
  get className() { return this._className }
  set className(v: string) { this._className = v }
  private _classSet = new Set<string>()
  classList = {
    add: (c: string) => { this._classSet.add(c); this._className = Array.from(this._classSet).join(' ') },
    remove: (c: string) => { this._classSet.delete(c); this._className = Array.from(this._classSet).join(' ') },
    contains: (c: string) => this._classSet.has(c),
    toString: () => this._className,
  }
  closest(_sel: string): StubElement | null { return null }
  querySelector(_sel: string): StubElement | null { return null }
}

// --- Secondary drawer stubs ---

const stubDrawer = new StubElement()
stubDrawer.className = 'sidebar-ux-drawer'
const stubTabList = new StubElement()
stubTabList.className = 'sidebar-ux-tab-list'
const stubPanel = new StubElement()
stubPanel.className = 'sidebar-ux-panel'

const secondaryWrapper = new StubElement()
secondaryWrapper.querySelector = (sel: string): StubElement | null => {
  if (sel === '.sidebar-ux-drawer') return stubDrawer
  if (sel === '.sidebar-ux-tab-list') return stubTabList
  if (sel === '.sidebar-ux-panel') return stubPanel
  return null
}

// --- Main drawer stubs (for getMainDrawerSide via getMainWrapper) ---

const mainWrapperStub = new StubElement()
const mainSidebarStub = new StubElement()
mainSidebarStub.className = '_sidebar_abc123'
mainSidebarStub.closest = (_sel: string): StubElement | null => mainWrapperStub
// getMainDrawerSide reads wrapper.classList.toString().includes('wrapperLeft')
// so the className must be a string (not the Set serialization). We use a
// className that doesn't go through the classList helper.
;(mainWrapperStub as any).classList = {
  toString: () => mainWrapperStub.className,
}

;(globalThis as any).document = {
  querySelector(sel: string): StubElement | null {
    if (sel === '[data-spindle-mount="sidebar"]') return mainSidebarStub
    if (sel === '.sidebar-ux-drawer') return stubDrawer
    if (sel === '.sidebar-ux-tab-list') return stubTabList
    if (sel === '.sidebar-ux-panel') return stubPanel
    return null
  },
}

;(globalThis as any).window = {
  matchMedia: (_q: string) => ({
    matches: false, // desktop by default
    addEventListener() {},
    removeEventListener() {},
  }),
}

// --- Import after stubs are in place ---

import { applyTabListPin, TAB_LIST_PINNED_CLASS } from '../tab-position'
import { __setSecondaryWrapperForTest } from '../secondary'

// --- Helper: reset stubs between cases ---
// 'side' here is the SECONDARY drawer's side (not the main's).
// The main wrapper's className is set to match (opposite of secondary).

function resetStubs(secondarySide: 'left' | 'right' = 'right') {
  stubDrawer.style = new StubStyle()
  stubTabList.style = new StubStyle()
  stubPanel.style = new StubStyle()
  ;(stubTabList as any).classList = {
    _set: new Set<string>(),
    add(c: string) { this._set.add(c); stubTabList.className = Array.from(this._set).join(' ') },
    remove(c: string) { this._set.delete(c); stubTabList.className = Array.from(this._set).join(' ') },
    contains(c: string) { return this._set.has(c) },
    toString() { return stubTabList.className },
  }
  // Main wrapper's className encodes the MAIN drawer's side.
  // The secondary is on the opposite side.
  mainWrapperStub.className = secondarySide === 'right' ? 'wrapperLeft_wrapper' : 'wrapperRight'
  __setSecondaryWrapperForTest(secondaryWrapper as any)
}

// ============================================================
// Case 1: pin on, secondary on right → tab list pinned at right: 0,
// border on left
// ============================================================
{
  resetStubs('right')  // secondary on right (main on left)

  applyTabListPin(true)

  assertEqual(stubTabList.style.position, 'fixed', 'C1: tab list position = fixed')
  assertEqual(stubTabList.style.top, '0', 'C1: tab list top = 0')
  assertEqual(stubTabList.style.bottom, '0', 'C1: tab list bottom = 0')
  assertEqual(stubTabList.style.right, '0', 'C1: tab list right = 0 (secondary on right)')
  assertEqual(stubTabList.style.zIndex, '10000', 'C1: tab list z-index = 10000')
  assertEqual(stubTabList.style.width, '56px', 'C1: tab list width = 56px')
  assertEqual(stubTabList.style.pointerEvents, 'auto', 'C1: tab list pointer-events = auto')
  assertEqual(stubTabList.style.borderLeft, '1px solid var(--lumiverse-primary-020)', 'C1: tab list borderLeft set (inner side)')
  assertEqual(stubTabList.style.borderRight, 'none', 'C1: tab list borderRight = none')
  assertEqual(stubDrawer.style.flexDirection, '', 'C1: drawer flex-direction reset')
  assertEqual(stubPanel.style.borderRight, 'none', 'C1: panel borderRight cleared')
  assertEqual(stubPanel.style.borderLeft, 'none', 'C1: panel borderLeft cleared')
  assert(stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C1: pinned class added')
}

// ============================================================
// Case 2: pin on, secondary on left → tab list pinned at left: 0,
// border on right
// ============================================================
{
  resetStubs('left')  // secondary on left (main on right)

  applyTabListPin(true)

  assertEqual(stubTabList.style.position, 'fixed', 'C2: tab list position = fixed')
  assertEqual(stubTabList.style.left, '0', 'C2: tab list left = 0 (secondary on left)')
  assertEqual(stubTabList.style.right, '', 'C2: tab list right = empty (secondary on left)')
  assertEqual(stubTabList.style.borderRight, '1px solid var(--lumiverse-primary-020)', 'C2: tab list borderRight set (inner side)')
  assertEqual(stubTabList.style.borderLeft, 'none', 'C2: tab list borderLeft = none')
  assertEqual(stubDrawer.style.flexDirection, '', 'C2: drawer flex-direction reset')
  assert(stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C2: pinned class added')
}

// ============================================================
// Case 3: pin off after pin on — clears all styles, re-applies position
// ============================================================
{
  resetStubs('right')
  applyTabListPin(true)
  // After pin, tab list has position: fixed etc.
  assertEqual(stubTabList.style.position, 'fixed', 'C3: pre-condition — pinned')

  applyTabListPin(false)

  assertEqual(stubTabList.style.position, '', 'C3: position cleared')
  assertEqual(stubTabList.style.top, '', 'C3: top cleared')
  assertEqual(stubTabList.style.bottom, '', 'C3: bottom cleared')
  assertEqual(stubTabList.style.right, '', 'C3: right cleared')
  assertEqual(stubTabList.style.zIndex, '', 'C3: zIndex cleared')
  assertEqual(stubTabList.style.width, '', 'C3: width cleared')
  assertEqual(stubTabList.style.pointerEvents, '', 'C3: pointerEvents cleared')
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C3: pinned class removed')
  // After unpin, applyTabListPosition(moveControlsToOuterEdge) runs.
  // With moveControlsToOuterEdge default (false) and secondary on right
  // (main on left → secondary on right), the drawer's flex-direction is
  // 'row' (tab list on left of drawer, panel on right).
  assertEqual(stubDrawer.style.flexDirection, 'row', 'C3: drawer flex-direction restored via applyTabListPosition')
}

// ============================================================
// Case 4: idempotency — pin twice does not re-write
// ============================================================
{
  resetStubs('right')
  applyTabListPin(true)
  // Snapshot
  const posAfter1 = stubTabList.style.position
  const rightAfter1 = stubTabList.style.right

  applyTabListPin(true)  // second call — no-op

  assertEqual(stubTabList.style.position, posAfter1, 'C4: position unchanged on second pin')
  assertEqual(stubTabList.style.right, rightAfter1, 'C4: right unchanged on second pin')
}

// ============================================================
// Case 5: unpin on already-unpinned tab list — no-op
// ============================================================
{
  resetStubs('right')
  // No pin first — tab list is in default state
  applyTabListPin(false)  // should be a no-op (idempotent)
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C5: no class added')
  assertEqual(stubTabList.style.position, '', 'C5: position unchanged')
}

// ============================================================
// Case 6: mobile no-op — matchMedia returns mobile
// ============================================================
{
  resetStubs('right')
  const origMatchMedia = (globalThis as any).window.matchMedia
  ;(globalThis as any).window.matchMedia = (_q: string) => ({
    matches: true, // mobile
    addEventListener() {},
    removeEventListener() {},
  })

  applyTabListPin(true)

  assertEqual(stubTabList.style.position, '', 'C6: mobile → no position written')
  assertEqual(stubTabList.style.right, '', 'C6: mobile → no right written')
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C6: mobile → no class added')

  ;(globalThis as any).window.matchMedia = origMatchMedia
}

// ============================================================
// Case 7: no secondary wrapper — no-op
// ============================================================
{
  resetStubs('right')
  __setSecondaryWrapperForTest(null)

  applyTabListPin(true)

  assertEqual(stubTabList.style.position, '', 'C7: no wrapper → no position written')
  assert(!stubTabList.classList.contains(TAB_LIST_PINNED_CLASS), 'C7: no wrapper → no class added')

  __setSecondaryWrapperForTest(secondaryWrapper as any)
}

console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
```

- [ ] **Step 2: Run the test**

Run: `bun run src/sidebar/__tests__/tab-pin.test.ts`
Expected: `PASS: 32` (or similar) and `FAILED: 0`. If any assertion fails, the test prints the failure message and the FAILED count is non-zero. Fix the implementation (Task 2) if the test reveals a bug.

- [ ] **Step 3: Commit**

```bash
git add src/sidebar/__tests__/tab-pin.test.ts
git commit -m "test: add applyTabListPin unit tests"
```

---

### Task 7: Run the full test suite to confirm no regressions

**Covers:** Verifying that the new code doesn't break any existing test.

**Files:**
- No file changes; this is a verification step.

- [ ] **Step 1: Run the full test suite**

Run: `bun run test` (from the package directory, NOT from the repo root — the AGENTS.md and project rules require package-directory execution).
Expected: All tests pass. Existing tests in `tab-position.test.ts`, `secondary-drawer.test.ts`, `secondary-drawer-lumiscript.test.ts`, `buttons.test.ts`, `secondary-drawer-wiring.test.ts`, `apply.test.ts` (drawerTabPosition), `apply-restore.test.ts` should all still pass. The new test in `tab-pin.test.ts` should also pass.

- [ ] **Step 2: Run the typecheck one final time**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit (if any test fixtures needed adjustment)**

If any existing test had to be updated to accommodate the new behavior, commit the fixture update:

```bash
git add <modified test files>
git commit -m "test: update fixtures for keepTabListVisible"
```

If no test needed adjustment, skip this step.

---

## Self-Review Checklist

Before reporting completion, verify:

1. **Spec coverage:** All 6 spec sections are covered:
   - Setting type & default → Task 1
   - Core DOM-mutation function → Task 2
   - CSS rules → Task 3 (no changes needed)
   - Feature lifecycle wiring → Task 4
   - UI toggle → Task 5
   - Unit tests → Task 6
   - Regression check → Task 7

2. **No placeholders:** Every step has actual code. No "TBD", "TODO", "implement later".

3. **Type consistency:** `applyTabListPin(enabled: boolean)` and `TAB_LIST_PINNED_CLASS: 'sidebar-ux-tab-list--pinned'` are used consistently across all tasks.

4. **No dead code:** The teardown returned by the feature's `mount()` is registered with the orchestrator's cleanup chain via the existing `registerCleanup` mechanism (handled by `setup.ts:151`).

5. **No drive-by changes:** Only the files listed in the file structure are touched.
