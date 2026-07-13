// Tests for configure-commit.ts
//
// commitConfigureDraft calls into DOM and host-bridge heavy modules.
// We test the guard mechanism, error handling, and the happy path with
// empty deltas (no tab moves needed).

import {
  commitConfigureDraft,
  isConfigureBatchActive,
  type CommitResult,
} from '../configure-commit'
import {
  type ConfigureDraft,
  type BaseSnapshot,
  encodeHostTabOrder,
} from '../configure-model'
import {
  __setHostSetSettingForTest,
  clearHostSettingsCache,
} from '../../dom/host-settings'
import {
  getTabAssignments,
  setTabAssignment,
  deleteTabAssignment,
  clearTabAssignments,
} from '../assignment'
import {
  setSuppressAutoActivation,
  isSuppressAutoActivation,
} from '../../sidebar/secondary-drawer'
import { __setSecondaryWrapperForTest } from '../../sidebar/secondary'
import { persistLayout } from '../../layout/persist'
import { __setStoreSnapshotForTest, __setDrawerTabsForTest } from '../../store'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

// ── Test infrastructure ──

// Ensure document is available as a minimal stub for modules that check it.
// Include classList and style.removeProperty so transitive imports (strip-gutter,
// main-mirror-drawer, tab-position) don't crash even when fire-and-forget.
if (typeof document === 'undefined') {
  // Track lastElementChild for findLumiverseContextMenu-like queries.
  let bodyLastChild: any = null

  // Shared style with removeProperty for documentElement.
  const docStyle: Record<string, any> = {}
  docStyle.removeProperty = () => {}
  docStyle.setProperty = () => {}

  const doc = {
    createElement: (tag: string) => {
      const attrs: Record<string, string> = {}
      const children: unknown[] = []
      const style: Record<string, string> = {}
      return {
        tag,
        tagName: tag.toUpperCase(),
        className: '', children, attributes: attrs, style,
        textContent: '',
        setAttribute(name: string, value: string) { attrs[name] = value },
        getAttribute(name: string) { return attrs[name] ?? null },
        removeAttribute(name: string) { delete attrs[name] },
        appendChild(c: unknown) { children.push(c) },
        remove() {},
        querySelector(_sel: string) { return null },
        querySelectorAll(_sel: string) { return [] as unknown[] },
        contains(other: unknown) { return children.includes(other) || this === other },
        dispatchEvent() { return true },
        addEventListener() {},
        removeEventListener() {},
        closest() { return null },
        parentNode: null,
      }
    },
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
    body: {
      children: [] as unknown[],
      appendChild(c: unknown) { (this as any).children.push(c); bodyLastChild = c },
      removeChild(c: unknown) {
        const idx = (this as any).children.indexOf(c)
        if (idx >= 0) (this as any).children.splice(idx, 1)
        bodyLastChild = (this as any).children[(this as any).children.length - 1] ?? null
      },
      querySelectorAll(_sel: string) { return [] as unknown[] },
      lastElementChild: null as any,
      get lastElementChild() { return bodyLastChild },
      set lastElementChild(v: any) { bodyLastChild = v },
    } as any,
    documentElement: {
      style: docStyle,
      classList: {
        add() {},
        remove() {},
        contains() { return false },
      },
    },
    head: { appendChild() {}, removeChild() {} },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true },
    createEvent() { return { initEvent() {} } },
  } as any
  ;(globalThis as any).document = doc
}

// Stub CSS.escape since bun doesn't have CSS global.
if (typeof CSS === 'undefined') {
  ;(globalThis as any).CSS = { escape: (s: string) => s }
}

// Stub getComputedStyle.
if (typeof getComputedStyle === 'undefined') {
  ;(globalThis as any).getComputedStyle = (el: any) => el?.style ?? {}
}

const NO_TABS_DRAFT: ConfigureDraft = {
  drawerSide: 'right',
  primaryIds: [],
  secondaryIds: [],
  builtinOrder: [],
  extensionOrder: [],
  hiddenIds: new Set(),
}

const NO_TABS_BASE: BaseSnapshot = {
  tabOrder: [],
  hiddenTabIds: [],
  drawerSide: 'right',
  assignments: new Map(),
}

/** Minimal stub for the secondary wrapper's tab list query. */
function makeStubTabList(): HTMLElement {
  const list = document.createElement('div')
  list.className = 'sidebar-ux-tab-list'
  return list
}

/** Minimal stub for the secondary wrapper. */
function makeStubWrapper(list: HTMLElement | null): HTMLElement {
  const wrapper = document.createElement('div')
  if (list) wrapper.appendChild(list)
  return wrapper
}

/** Ensure document.querySelector returns null (for getMainSidebar). */
function stubDocument(): void {
  // Only mutate; don't spread-and-replace (that would lose documentElement
  // classList/removeProperty from a previous test file's stub).
  if (typeof document !== 'undefined') {
    ;(document as any).querySelector = () => null
  }
}

/** Stub window.spindle so getHostBridge returns a usable shell. */
function stubHostBridge() {
  ;(globalThis as any).window = {
    ...(globalThis as any).window,
    spindle: {
      ui: {
        getBuiltInTabRoot: () => undefined,
        getBuiltInTabTitle: () => undefined,
        requestTabLocation: () => {},
        getTabLocation: () => null,
      },
      containers: {},
    },
    matchMedia: (q: string) => ({ matches: q === '(max-width: 600px)' }),
  }
}

function setup() {
  clearTabAssignments()
  clearHostSettingsCache()
  setSuppressAutoActivation(false)
  __setSecondaryWrapperForTest(null)
  __setStoreSnapshotForTest(null)
  __setDrawerTabsForTest(null)
  stubDocument()
  stubHostBridge()
}

// ── Tests ──

// =====================================================================
// C1: isConfigureBatchActive returns false initially
// =====================================================================
{
  setup()
  assert(!isConfigureBatchActive(), 'C1: not active initially')
}

// =====================================================================
// C2: commitConfigureDraft with empty deltas returns ok
// =====================================================================
{
  setup()
  // Inject a working host-settings seam so patchHostDrawerSettings succeeds.
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { /* no-op write */ },
    { side: 'right', tabOrder: [], hiddenTabIds: [] },
  )

  const result: CommitResult = await commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)
  assert(result.ok === true, 'C2: commit with empty draft returns ok')
}

// =====================================================================
// C3: commitConfigureDraft returns error when already active (guard)
// =====================================================================
{
  setup()
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { /* no-op */ },
    { side: 'right', tabOrder: [], hiddenTabIds: [] },
  )

  // First call starts the batch.
  const p1 = commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)
  // Second call while first is still in-flight.
  const result: CommitResult = await commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)
  assert(result.ok === false, 'C3: second concurrent call returns error')
  assert(typeof (result as any).error === 'string', 'C3: error message present')

  // Wait for first to complete.
  await p1
}

// =====================================================================
// C4: commit with matching assignments (empty deltas) and non-empty draft
// =====================================================================
{
  setup()
  // Populate assignments matching the draft.
  setTabAssignment('profile', 'primary')
  setTabAssignment('presets', 'primary')
  setTabAssignment('ext-a', 'primary')

  __setHostSetSettingForTest(
    (key: string, value: unknown) => { /* no-op */ },
    { side: 'right', tabOrder: ['profile', 'presets', 'ext-a'], hiddenTabIds: [] },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'ext-a'],
    secondaryIds: [],
    builtinOrder: ['profile', 'presets'],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['profile', 'presets', 'ext-a'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['profile', 'primary'],
      ['presets', 'primary'],
      ['ext-a', 'primary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C4: commit with matching assignments returns ok')
}

// =====================================================================
// C5: suppressAutoActivation is reset after commit (even on failure)
// =====================================================================
{
  setup()

  // Don't set up host-settings seam — patchHostDrawerSettings will produce
  // a warning but the function should still complete (moves catch errors).
  // The key assertion is that suppressAutoActivation is false afterward.

  // First make it non-matching so it tries moves that will fail quietly.
  setTabAssignment('profile', 'secondary')
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile'],
    secondaryIds: [],
    builtinOrder: ['profile'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['profile'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([['profile', 'secondary']]),
  }

  // Expect the commit to still complete (moves fail silently via .catch).
  setSuppressAutoActivation(false)
  const result: CommitResult = await commitConfigureDraft(draft, base)
  // The key test is the guard state.
  assert(!isSuppressAutoActivation(), 'C5: suppressAutoActivation reset after commit')
  assert(!isConfigureBatchActive(), 'C5: batch guard reset after commit')
}

// =====================================================================
// C6: Secondary wrapper stub allows reorder/hidden functions to run
// =====================================================================
{
  setup()

  // Create a realistic stub with a tab list.
  const tabList = makeStubTabList()
  for (const id of ['tab1', 'tab2', 'tab3']) {
    const btn = document.createElement('button')
    btn.setAttribute('data-tab-id', id)
    btn.style.display = ''
    tabList.appendChild(btn)
  }
  const wrapper = makeStubWrapper(tabList)
  __setSecondaryWrapperForTest(wrapper)

  __setHostSetSettingForTest(
    (key: string, value: unknown) => { /* no-op */ },
    { side: 'right', tabOrder: [], hiddenTabIds: [] },
  )

  // Use a draft with hidden ids to exercise applyHiddenTabIdsToSecondary.
  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['tab1', 'tab2', 'tab3'],
    secondaryIds: [],
    builtinOrder: ['tab1', 'tab2', 'tab3'],
    extensionOrder: [],
    hiddenIds: new Set(['tab2']),
  }
  const base: BaseSnapshot = {
    tabOrder: ['tab1', 'tab2', 'tab3'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['tab1', 'primary'],
      ['tab2', 'primary'],
      ['tab3', 'primary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C6: commit with wrapper stub returns ok')

  // Verify batch guard + suppress are reset after commit.
  assert(!isConfigureBatchActive(), 'C6: batch guard reset')
  assert(!isSuppressAutoActivation(), 'C6: suppressAutoActivation reset')
}


// =====================================================================
// C7: commit + rebase — isDraftDirty is clean after successful commit
//
// Tests the auto-commit invariant: after commitConfigureDraft succeeds
// and the host state reflects the committed draft, building a fresh
// base from the committed state yields a clean dirty check.
// =====================================================================
{
  setup()
  // Use a live test seam that actually updates cached settings on write.
  let cachedSettings: any = { side: 'right', tabOrder: ['profile', 'presets', 'loom'], hiddenTabIds: [] }
  __setHostSetSettingForTest(
    (_key: string, value: unknown) => {
      cachedSettings = value as any
      // Re-inject so getHostDrawerSettings reads the updated cache.
      __setHostSetSettingForTest(
        (_k: string, _v: unknown) => { cachedSettings = _v as any },
        cachedSettings,
      )
    },
    cachedSettings,
  )
  setTabAssignment('profile', 'primary')
  setTabAssignment('presets', 'primary')
  setTabAssignment('loom', 'primary')

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile', 'presets', 'loom'],
    secondaryIds: [],
    builtinOrder: ['profile', 'presets', 'loom'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['profile', 'presets', 'loom'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['profile', 'primary'],
      ['presets', 'primary'],
      ['loom', 'primary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C7: commit returns ok')

  // Simulate autoCommit's rebase: build fresh draft+base from committed
  // host state. Since we used a live seam, getHostDrawerSettings now
  // reflects the committed tabOrder.
  const { isDraftDirty } = await import('../configure-model')
  const { getHostDrawerSettings } = await import('../../dom/host-settings')
  const { getTabAssignments } = await import('../assignment')

  const hostSettings = getHostDrawerSettings()
  const currentAssignments = new Map(getTabAssignments())

  // Build fresh draft+base from the known committed layout (not relying
  // on getFullCatalog, which returns all 25 builtins). The relevant
  // invariant is that a draft built from the committed state paired with
  // a base snapshot of that same state reports clean.
  const freshDraft: ConfigureDraft = {
    drawerSide: (hostSettings?.side as 'left' | 'right') || 'right',
    primaryIds: ['profile', 'presets', 'loom'],
    secondaryIds: [],
    builtinOrder: ['profile', 'presets', 'loom'],
    extensionOrder: [],
    hiddenIds: new Set(hostSettings?.hiddenTabIds || []),
  }
  const freshBase: BaseSnapshot = {
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: hostSettings?.hiddenTabIds || [],
    drawerSide: (hostSettings?.side as 'left' | 'right') || 'right',
    assignments: new Map(currentAssignments),
  }

  assert(!isDraftDirty(freshDraft, freshBase), 'C7: isDraftDirty is false after commit + rebase')
}

// =====================================================================
// C8: concurrent commits are rejected (guard) — same as C3 but explicit
//     about the auto-commit serialization pattern
// =====================================================================
{
  setup()
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { /* no-op */ },
    { side: 'right', tabOrder: [], hiddenTabIds: [] },
  )

  // Fire two commits concurrently (simulates rapid auto-commit calls).
  const p1 = commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)
  const p2 = commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)

  const r1 = await p1
  const r2 = await p2

  // Exactly one of the two should succeed; the other returns busy error.
  const okCount = [r1, r2].filter(r => r.ok === true).length
  const errCount = [r1, r2].filter(r => r.ok === false).length
  assert(okCount === 1, 'C8: exactly one concurrent commit succeeds')
  assert(errCount === 1, 'C8: exactly one concurrent commit returns busy')
  assert(!isConfigureBatchActive(), 'C8: batch guard reset after both complete')
}

// =====================================================================
// C9: commit returns ok with empty deltas (no-op happy path for auto-commit)
// =====================================================================
{
  setup()
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { /* no-op */ },
    { side: 'right', tabOrder: [], hiddenTabIds: [] },
  )

  // autoCommit calls commitConfigureDraft only when dirty. This test
  // confirms that even if called when clean (draft matches base),
  // the function handles it gracefully.
  const result: CommitResult = await commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)
  assert(result.ok === true, 'C9: commit with clean (matching) state returns ok')
}

/** Wire querySelector on secondary shell stubs so quiet-move cleanup can find content. */
function wireSecondaryShell(
  wrapper: any,
  tabList: any,
  panelContent: any,
  movedRoots: any[],
): void {
  const matchMoved = (sel: string, roots: any[]) => {
    const m = sel.match(/data-canvas-moved="([^"]+)"/)
    if (!m) return null
    return roots.find((r) => r.getAttribute?.('data-canvas-moved') === m[1]) ?? null
  }
  panelContent.querySelector = (sel: string) => matchMoved(sel, movedRoots)
  panelContent.querySelectorAll = (sel: string) => {
    if (sel.includes('data-canvas-moved')) return movedRoots.slice()
    return []
  }
  tabList.querySelector = (sel: string) => {
    const m = sel.match(/data-tab-id="([^"]+)"/)
    if (!m) return null
    return (tabList.children as any[]).find(
      (c) => c.getAttribute?.('data-tab-id') === m[1],
    ) ?? null
  }
  tabList.querySelectorAll = (sel: string) => {
    if (sel.includes('sidebar-ux-tab-active') || sel.includes('button')) {
      return (tabList.children as any[]).filter((c) => {
        if (sel.includes('sidebar-ux-tab-active')) {
          return String(c.className || '').includes('sidebar-ux-tab-active')
        }
        return true
      })
    }
    return []
  }
  wrapper.querySelector = (sel: string) => {
    if (sel === '.sidebar-ux-panel-content' || sel.includes('panel-content')) return panelContent
    if (sel === '.sidebar-ux-tab-list' || sel.includes('tab-list')) return tabList
    if (sel.includes('data-tab-id')) return tabList.querySelector(sel)
    return null
  }
}

// =====================================================================
// C10: secondary → primary (last tab) clears active + assignment
//     Regression: quiet move left secondary open with empty panel after
//     live DnD / Configure drag to main-mirror.
// =====================================================================
{
  setup()
  const { getActiveSecondaryTabId, setActiveSecondaryTabId } = await import('../assignment')
  const { setSecondarySidebarOpen } = await import('../../sidebar/secondary')

  const movedRoot: any = document.createElement('div')
  movedRoot.setAttribute('data-canvas-moved', 'profile')
  movedRoot.setAttribute('data-canvas-active', '')

  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  panelContent.appendChild(movedRoot)

  const tabList: any = makeStubTabList()
  const secBtn = document.createElement('button')
  secBtn.setAttribute('data-tab-id', 'profile')
  tabList.appendChild(secBtn)

  const wrapper: any = makeStubWrapper(tabList)
  wrapper.appendChild(panelContent)
  wireSecondaryShell(wrapper, tabList, panelContent, [movedRoot])
  __setSecondaryWrapperForTest(wrapper)
  setSecondarySidebarOpen(true)

  // Built-in path: getBuiltInTabRoot returns the moved root.
  ;(globalThis as any).window = {
    ...(globalThis as any).window,
    spindle: {
      ui: {
        getBuiltInTabRoot: (id: string) => (id === 'profile' ? movedRoot : undefined),
        getBuiltInTabTitle: () => 'Profile',
        requestTabLocation: () => {
          // Host reparents root out of secondary; quiet path must clear attrs.
          const idx = (panelContent.children as unknown[]).indexOf(movedRoot)
          if (idx >= 0) (panelContent.children as unknown[]).splice(idx, 1)
        },
        getTabLocation: () => null,
      },
      containers: {},
    },
    matchMedia: (q: string) => ({ matches: q === '(max-width: 600px)' }),
  }

  setTabAssignment('profile', 'secondary')
  setActiveSecondaryTabId('profile')

  __setHostSetSettingForTest(
    () => {},
    { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['profile'],
    secondaryIds: [],
    builtinOrder: ['profile'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['profile'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([['profile', 'secondary']]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C10: last secondary→primary commit ok')
  assertEqual(getTabAssignments().get('profile'), undefined, 'C10: assignment deleted')
  assertEqual(getActiveSecondaryTabId(), null, 'C10: active secondary cleared')
  assertEqual(
    movedRoot.getAttribute('data-canvas-moved'),
    null,
    'C10: data-canvas-moved cleared on built-in root',
  )
  assertEqual(
    movedRoot.getAttribute('data-canvas-active'),
    null,
    'C10: data-canvas-active cleared on built-in root',
  )
  // closeSecondarySidebar no-ops without full shell drawer; active+attrs
  // are the critical empty-panel fix.
  setSecondarySidebarOpen(false)
  __setSecondaryWrapperForTest(null)
}

// =====================================================================
// C11: secondary → primary with sibling remaining activates neighbor
// =====================================================================
{
  setup()
  const { getActiveSecondaryTabId, setActiveSecondaryTabId } = await import('../assignment')

  const rootA: any = document.createElement('div')
  rootA.setAttribute('data-canvas-moved', 'tab-a')
  rootA.setAttribute('data-canvas-active', '')
  const rootB: any = document.createElement('div')
  rootB.setAttribute('data-canvas-moved', 'tab-b')

  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  panelContent.appendChild(rootA)
  panelContent.appendChild(rootB)

  const tabList: any = makeStubTabList()
  for (const id of ['tab-a', 'tab-b']) {
    const btn: any = document.createElement('button')
    btn.setAttribute('data-tab-id', id)
    // showSecondaryTab toggles classList on secondary buttons.
    const classes = new Set<string>()
    btn.classList = {
      add: (c: string) => { classes.add(c); btn.className = [...classes].join(' ') },
      remove: (c: string) => { classes.delete(c); btn.className = [...classes].join(' ') },
      toggle: (c: string, force?: boolean) => {
        const on = force === undefined ? !classes.has(c) : !!force
        if (on) classes.add(c); else classes.delete(c)
        btn.className = [...classes].join(' ')
        return on
      },
      contains: (c: string) => classes.has(c),
    }
    btn.querySelector = () => null
    tabList.appendChild(btn)
  }
  const wrapper: any = makeStubWrapper(tabList)
  wrapper.appendChild(panelContent)
  // After tab-a move, only rootB remains moved in secondary for showSecondaryTab.
  wireSecondaryShell(wrapper, tabList, panelContent, [rootA, rootB])
  // getSecondaryTabList → querySelector('.sidebar-ux-tab-list') then button[data-tab-id]
  tabList.querySelectorAll = (sel: string) => {
    if (sel.includes('data-tab-id') || sel.includes('button')) {
      return [...(tabList.children as any[])]
    }
    return []
  }
  __setSecondaryWrapperForTest(wrapper)

  // Extension path (no built-in roots) so reparent + showSecondaryTab run.
  ;(globalThis as any).window = {
    ...(globalThis as any).window,
    spindle: {
      ui: {
        getBuiltInTabRoot: () => undefined,
        getBuiltInTabTitle: () => undefined,
        requestTabLocation: () => {},
        getTabLocation: () => null,
      },
      containers: {},
    },
    matchMedia: (q: string) => ({ matches: q === '(max-width: 600px)' }),
  }

  // Store roots for extension reparent.
  __setDrawerTabsForTest([
    { id: 'tab-a', title: 'A', root: rootA, extensionId: 'ext' },
    { id: 'tab-b', title: 'B', root: rootB, extensionId: 'ext' },
  ] as any)

  setTabAssignment('tab-a', 'secondary')
  setTabAssignment('tab-b', 'secondary')
  setActiveSecondaryTabId('tab-a')

  __setHostSetSettingForTest(
    () => {},
    { side: 'right', tabOrder: ['tab-a', 'tab-b'], hiddenTabIds: [] },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['tab-a'],
    secondaryIds: ['tab-b'],
    builtinOrder: [],
    extensionOrder: ['tab-a', 'tab-b'],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['tab-a', 'tab-b'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['tab-a', 'secondary'],
      ['tab-b', 'secondary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C11: sibling secondary→primary commit ok')
  assertEqual(getTabAssignments().get('tab-a'), undefined, 'C11: tab-a assignment deleted')
  assertEqual(getTabAssignments().get('tab-b'), 'secondary', 'C11: tab-b still secondary')
  assertEqual(getActiveSecondaryTabId(), 'tab-b', 'C11: neighbor tab-b activated')
  assertEqual(
    rootB.getAttribute('data-canvas-active'),
    '',
    'C11: tab-b root has data-canvas-active',
  )
  assertEqual(
    rootA.getAttribute('data-canvas-moved'),
    null,
    'C11: moved tab attrs cleared',
  )
  __setSecondaryWrapperForTest(null)
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
