// Tests for configure-commit.ts
//
// commitConfigureDraft calls into DOM and host-bridge heavy modules.
// We test the guard mechanism, error handling, and the happy path with
// empty deltas (no tab moves needed).

import {
  commitConfigureDraft,
  isConfigureBatchActive,
  waitForConfigureCommitIdle,
  __setApplyMainDrawerSideChangeForTest,
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
      const classSet = new Set<string>()
      const el: any = {
        tag,
        tagName: tag.toUpperCase(),
        get className() { return [...classSet].join(' ') },
        set className(v: string) {
          classSet.clear()
          for (const c of String(v || '').split(/\s+/).filter(Boolean)) classSet.add(c)
        },
        classList: {
          add(...cs: string[]) { for (const c of cs) classSet.add(c) },
          remove(...cs: string[]) { for (const c of cs) classSet.delete(c) },
          contains(c: string) { return classSet.has(c) },
          toggle(c: string, force?: boolean) {
            if (force === true) { classSet.add(c); return true }
            if (force === false) { classSet.delete(c); return false }
            if (classSet.has(c)) { classSet.delete(c); return false }
            classSet.add(c)
            return true
          },
        },
        children, attributes: attrs, style,
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
        isConnected: true,
      }
      return el
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

// Bun bare runtime has no MutationObserver / rAF — configure-commit preserve
// and builtin-move need them. Minimal shims (observe no-ops; rAF → macrotask).
if (typeof (globalThis as any).MutationObserver === 'undefined') {
  ;(globalThis as any).MutationObserver = class {
    constructor(_cb: MutationCallback) {}
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  }
}
if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
  ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number
}
if (typeof (globalThis as any).cancelAnimationFrame !== 'function') {
  ;(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id)
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
  __setApplyMainDrawerSideChangeForTest(null)
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
// C3: concurrent commitConfigureDraft calls are serialized (both succeed)
// =====================================================================
{
  setup()
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { /* no-op */ },
    { side: 'right', tabOrder: [], hiddenTabIds: [] },
  )

  // First call starts the batch; second waits on the queue.
  const p1 = commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)
  const result: CommitResult = await commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)
  assert(result.ok === true, 'C3: queued second concurrent call succeeds')
  const r1 = await p1
  assert(r1.ok === true, 'C3: first concurrent call succeeds')
  assert(!isConfigureBatchActive(), 'C3: batch guard reset after both complete')
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
// C8: concurrent commits both succeed when serialized on the queue
// =====================================================================
{
  setup()
  __setHostSetSettingForTest(
    (key: string, value: unknown) => { /* no-op */ },
    { side: 'right', tabOrder: [], hiddenTabIds: [] },
  )

  // Fire two commits concurrently (simulates Configure auto-commit + live DnD).
  const p1 = commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)
  const p2 = commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)

  const r1 = await p1
  const r2 = await p2

  assert(r1.ok === true, 'C8: first concurrent commit succeeds')
  assert(r2.ok === true, 'C8: second concurrent commit succeeds (queued)')
  assert(!isConfigureBatchActive(), 'C8: batch guard reset after both complete')
  await waitForConfigureCommitIdle()
  assert(!isConfigureBatchActive(), 'C8: waitForConfigureCommitIdle leaves idle')
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
// C13: secondary → primary activates *neighbor* (above), not first remaining
//     Order [a,b,c], active=c, move c → primary. Remaining a,b — first would
//     be a; handoff Part B picks above → b (matches rClick Move).
// =====================================================================
{
  setup()
  const { getActiveSecondaryTabId, setActiveSecondaryTabId } = await import('../assignment')

  const roots: Record<string, any> = {}
  for (const id of ['tab-a', 'tab-b', 'tab-c']) {
    const root: any = document.createElement('div')
    root.setAttribute('data-canvas-moved', id)
    if (id === 'tab-c') root.setAttribute('data-canvas-active', '')
    roots[id] = root
  }

  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  for (const id of ['tab-a', 'tab-b', 'tab-c']) panelContent.appendChild(roots[id])

  const tabList: any = makeStubTabList()
  for (const id of ['tab-a', 'tab-b', 'tab-c']) {
    const btn: any = document.createElement('button')
    btn.setAttribute('data-tab-id', id)
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
  wireSecondaryShell(wrapper, tabList, panelContent, Object.values(roots))
  tabList.querySelectorAll = (sel: string) => {
    if (sel.includes('data-tab-id') || sel.includes('button')) {
      return [...(tabList.children as any[])]
    }
    return []
  }
  __setSecondaryWrapperForTest(wrapper)

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

  __setDrawerTabsForTest([
    { id: 'tab-a', title: 'A', root: roots['tab-a'], extensionId: 'ext' },
    { id: 'tab-b', title: 'B', root: roots['tab-b'], extensionId: 'ext' },
    { id: 'tab-c', title: 'C', root: roots['tab-c'], extensionId: 'ext' },
  ] as any)

  setTabAssignment('tab-a', 'secondary')
  setTabAssignment('tab-b', 'secondary')
  setTabAssignment('tab-c', 'secondary')
  setActiveSecondaryTabId('tab-c')

  __setHostSetSettingForTest(
    () => {},
    { side: 'right', tabOrder: ['tab-a', 'tab-b', 'tab-c'], hiddenTabIds: [] },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['tab-c'],
    secondaryIds: ['tab-a', 'tab-b'],
    builtinOrder: [],
    extensionOrder: ['tab-a', 'tab-b', 'tab-c'],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['tab-a', 'tab-b', 'tab-c'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['tab-a', 'secondary'],
      ['tab-b', 'secondary'],
      ['tab-c', 'secondary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C13: commit ok')
  assertEqual(getTabAssignments().get('tab-c'), undefined, 'C13: tab-c left secondary')
  assertEqual(getActiveSecondaryTabId(), 'tab-b', 'C13: neighbor above (tab-b), not first remaining (tab-a)')
  assertEqual(
    roots['tab-b'].getAttribute('data-canvas-active'),
    '',
    'C13: tab-b root active',
  )
  __setSecondaryWrapperForTest(null)
}

// =====================================================================
// C12: primary → secondary quiet move preserves tab icon (not puzzle)
//     Regression: live DnD / Configure quiet path only passed store
//     iconSvg/iconUrl; host strip tabs often have no store icons —
//     fell through to PUZZLE_ICON_SVG. Prefer main-button SVG like assignTab.
//     Uses extension quiet path (no rAF/builtin-move) with store icons empty.
// =====================================================================
{
  setup()
  const ICON_SVG = '<svg data-test-icon="profile-gear"></svg>'

  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  panelContent.children = panelContent.children || []
  const origPanelAppend = panelContent.appendChild.bind(panelContent)
  panelContent.appendChild = (c: unknown) => {
    origPanelAppend(c)
    if (Array.isArray(panelContent.children) && !panelContent.children.includes(c)) {
      panelContent.children.push(c)
    }
    return c
  }

  const tabList: any = makeStubTabList()
  // Ensure children is a real array the stub can grow (document stub
  // appendChild already pushes; re-bind for clarity).
  if (!Array.isArray(tabList.children)) tabList.children = []
  // addSecondaryTabButton scans querySelectorAll for data-tab-id.
  tabList.querySelectorAll = (sel: string) => {
    if (!sel.includes('data-tab-id')) return []
    const m = sel.match(/data-tab-id="([^"]+)"/)
    if (!m) return []
    return (tabList.children as any[]).filter(
      (c) => c.getAttribute?.('data-tab-id') === m[1],
    )
  }
  tabList.querySelector = (sel: string) => tabList.querySelectorAll(sel)[0] ?? null

  const wrapper: any = makeStubWrapper(tabList)
  wrapper.appendChild(panelContent)
  wireSecondaryShell(wrapper, tabList, panelContent, [])
  __setSecondaryWrapperForTest(wrapper)

  // Main strip button carries the real host SVG (store has none).
  const mainBtn: any = document.createElement('button')
  mainBtn.setAttribute('data-tab-id', 'ext-a')
  mainBtn.setAttribute('title', 'Ext A')
  mainBtn.querySelector = (sel: string) => {
    if (sel === 'svg' || (typeof sel === 'string' && sel.includes('svg'))) {
      return { outerHTML: ICON_SVG }
    }
    return null
  }

  const mainSidebar: any = document.createElement('div')
  mainSidebar.setAttribute('data-spindle-mount', 'sidebar')
  mainSidebar.querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-tab-id') && sel.includes('ext-a')) {
      return mainBtn
    }
    if (typeof sel === 'string' && sel.includes('title') && sel.includes('Ext A')) {
      return mainBtn
    }
    return null
  }
  mainSidebar.querySelectorAll = () => [mainBtn]
  ;(document as any).querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-spindle-mount')) return mainSidebar
    return null
  }

  const extRoot: any = document.createElement('div')
  extRoot.querySelector = () => null
  // parentElement needed so reparent check runs cleanly
  Object.defineProperty(extRoot, 'parentElement', {
    get() { return null },
    configurable: true,
  })

  // Extension path: no built-in roots (avoids rAF in builtin-move).
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

  // Store deliberately has no iconSvg/iconUrl (same as built-in host tabs).
  __setDrawerTabsForTest([
    { id: 'ext-a', title: 'Ext A', root: extRoot, extensionId: 'ext' },
  ] as any)

  __setHostSetSettingForTest(
    () => {},
    { side: 'right', tabOrder: ['ext-a'], hiddenTabIds: [], showTabLabels: false },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: [],
    secondaryIds: ['ext-a'],
    builtinOrder: [],
    extensionOrder: ['ext-a'],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['ext-a'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([['ext-a', 'primary']]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C12: primary→secondary commit ok')
  assertEqual(getTabAssignments().get('ext-a'), 'secondary', 'C12: assignment is secondary')

  const created = (tabList.children as any[]).find(
    (c) => c.getAttribute?.('data-tab-id') === 'ext-a',
  )
  assert(!!created, 'C12: secondary tab button created')
  const iconChild = created?.children?.[0] as any
  const iconHtml = iconChild?.innerHTML ?? ''
  assert(
    iconHtml.includes('data-test-icon="profile-gear"'),
    'C12: secondary button uses main-button SVG, not puzzle fallback',
  )
  assert(
    !iconHtml.includes('M15.39 4.39'),
    'C12: secondary button does not use puzzle path',
  )

  __setSecondaryWrapperForTest(null)
}

// =====================================================================
// C14: primary → secondary of *inactive* tab preserves primary active
//     Regression (main-mirror live DnD): 3rd tab active, drag 6th to
//     second drawer → host pendingActiveTabReset jumps drawerTab to the
//     top-most remaining primary tab; panel content must stay on the
//     pre-move active tab (rClick assignTab parity).
// =====================================================================
{
  setup()
  // Desktop: armPreservePrimaryActiveOnQuietToSecondary skips mobile.
  // Default stubHostBridge matchMedia treats ≤600 as true — override.
  if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
    ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(0), 0) as unknown as number
  }

  const clicks: string[] = []
  const makeMainBtn = (id: string, active: boolean) => {
    const btn: any = document.createElement('button')
    btn.setAttribute('data-tab-id', id)
    btn.setAttribute('title', id)
    btn.className = active ? 'tabBtn tabBtnActive' : 'tabBtn'
    btn.click = () => {
      clicks.push(id)
      // Simulate host accepting the click: exclusive tabBtnActive.
      for (const b of mainButtons) {
        b.className = b === btn ? 'tabBtn tabBtnActive' : 'tabBtn'
      }
    }
    btn.querySelector = () => null
    return btn
  }

  const btnA = makeMainBtn('tab-a', false) // top-most
  const btnB = makeMainBtn('tab-b', true)  // pre-move active (3rd-like)
  const btnC = makeMainBtn('tab-c', false) // dragged inactive
  const mainButtons = [btnA, btnB, btnC]

  const mainSidebar: any = document.createElement('div')
  mainSidebar.setAttribute('data-spindle-mount', 'sidebar')
  mainSidebar.querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('tabBtnActive')) {
      return mainButtons.find((b) => String(b.className).includes('tabBtnActive')) ?? null
    }
    const idM = typeof sel === 'string' ? sel.match(/data-tab-id="([^"]+)"/) : null
    if (idM) return mainButtons.find((b) => b.getAttribute('data-tab-id') === idM[1]) ?? null
    const titleM = typeof sel === 'string' ? sel.match(/title="([^"]+)"/) : null
    if (titleM) return mainButtons.find((b) => b.getAttribute('title') === titleM[1]) ?? null
    return null
  }
  mainSidebar.querySelectorAll = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-tab-id')) return mainButtons.slice()
    if (typeof sel === 'string' && sel.includes('button')) return mainButtons.slice()
    return []
  }

  ;(document as any).querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-spindle-mount')) return mainSidebar
    return null
  }

  const rootC: any = document.createElement('div')
  rootC.querySelector = () => null

  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  panelContent.children = panelContent.children || []
  const origAppend = panelContent.appendChild.bind(panelContent)
  panelContent.appendChild = (c: unknown) => {
    origAppend(c)
    if (Array.isArray(panelContent.children) && !panelContent.children.includes(c)) {
      panelContent.children.push(c)
    }
    return c
  }

  const tabList: any = makeStubTabList()
  if (!Array.isArray(tabList.children)) tabList.children = []
  tabList.querySelectorAll = (sel: string) => {
    if (!sel.includes('data-tab-id')) return []
    const m = sel.match(/data-tab-id="([^"]+)"/)
    if (!m) return []
    return (tabList.children as any[]).filter(
      (c) => c.getAttribute?.('data-tab-id') === m[1],
    )
  }
  tabList.querySelector = (sel: string) => tabList.querySelectorAll(sel)[0] ?? null

  const wrapper: any = makeStubWrapper(tabList)
  wrapper.appendChild(panelContent)
  wireSecondaryShell(wrapper, tabList, panelContent, [])
  __setSecondaryWrapperForTest(wrapper)

  ;(globalThis as any).window = {
    ...(globalThis as any).window,
    spindle: {
      ui: {
        getBuiltInTabRoot: (id: string) => (id === 'tab-c' ? rootC : undefined),
        getBuiltInTabTitle: (id: string) => id,
        requestTabLocation: () => {
          // Host pendingActiveTabReset → first non-moved primary (tab-a).
          btnA.className = 'tabBtn tabBtnActive'
          btnB.className = 'tabBtn'
          btnC.className = 'tabBtn'
        },
        getTabLocation: () => ({ kind: 'container', containerId: 'canvas-secondary-drawer' }),
      },
      containers: {},
    },
    // Desktop viewport so preserve + handoff dest activation run.
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }

  __setHostSetSettingForTest(
    () => {},
    {
      side: 'right',
      tabOrder: ['tab-a', 'tab-b', 'tab-c'],
      hiddenTabIds: [],
      showTabLabels: false,
    },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['tab-a', 'tab-b'],
    secondaryIds: ['tab-c'],
    builtinOrder: ['tab-a', 'tab-b', 'tab-c'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['tab-a', 'tab-b', 'tab-c'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['tab-a', 'primary'],
      ['tab-b', 'primary'],
      ['tab-c', 'primary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C14: commit ok')
  assertEqual(getTabAssignments().get('tab-c'), 'secondary', 'C14: tab-c moved to secondary')
  assert(
    clicks.includes('tab-b'),
    'C14: re-clicked pre-move active tab-b after host reset to top tab',
  )
  assert(
    String(btnB.className).includes('tabBtnActive'),
    'C14: tab-b still host-active after quiet move of inactive tab-c',
  )
  assert(
    !String(btnA.className).includes('tabBtnActive'),
    'C14: top-most tab-a is not left active',
  )

  __setSecondaryWrapperForTest(null)
}

// =====================================================================
// C14b: main-mirror exclusive key ≠ host tabBtnActive — inactive drag
//     Host parked on top tab-a; Canvas key is tab-b (user selection).
//     Drag inactive tab-c → secondary must re-click/adopt tab-b, not a.
// =====================================================================
{
  setup()
  if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
    ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(0), 0) as unknown as number
  }

  const { setSettings, getSettings } = await import('../../settings/state')
  const savedTaskbar = getSettings().taskbarMode
  const savedOuter = getSettings().moveControlsToOuterEdge
  setSettings({ taskbarMode: true, moveControlsToOuterEdge: true })

  const {
    __setActiveMainMirrorKeyForTest,
    __setMainTabPinEnabledForTest,
    __resetMainTabPinForTest,
    getActiveMainMirrorKey,
  } = await import('../../sidebar/main-tab-pin')

  __resetMainTabPinForTest()
  __setMainTabPinEnabledForTest(true)
  __setActiveMainMirrorKeyForTest('id__tab-b')

  const clicks: string[] = []
  const makeMainBtn = (id: string, active: boolean) => {
    const btn: any = document.createElement('button')
    btn.setAttribute('data-tab-id', id)
    btn.setAttribute('title', id)
    btn.className = active ? 'tabBtn tabBtnActive' : 'tabBtn'
    btn.click = () => {
      clicks.push(id)
      for (const b of mainButtons) {
        b.className = b === btn ? 'tabBtn tabBtnActive' : 'tabBtn'
      }
    }
    btn.querySelector = () => null
    return btn
  }

  // Host still thinks top tab-a is active (parked); Canvas key is tab-b.
  const btnA = makeMainBtn('tab-a', true)
  const btnB = makeMainBtn('tab-b', false)
  const btnC = makeMainBtn('tab-c', false)
  const mainButtons = [btnA, btnB, btnC]

  const mainSidebar: any = document.createElement('div')
  mainSidebar.setAttribute('data-spindle-mount', 'sidebar')
  for (const b of mainButtons) mainSidebar.appendChild(b)
  mainSidebar.querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('tabBtnActive')) {
      return mainButtons.find((b) => String(b.className).includes('tabBtnActive')) ?? null
    }
    const idM = typeof sel === 'string' ? sel.match(/data-tab-id="([^"]+)"/) : null
    if (idM) return mainButtons.find((b) => b.getAttribute('data-tab-id') === idM[1]) ?? null
    const titleM = typeof sel === 'string' ? sel.match(/title="([^"]+)"/) : null
    if (titleM) return mainButtons.find((b) => b.getAttribute('title') === titleM[1]) ?? null
    return null
  }
  mainSidebar.querySelectorAll = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-tab-id')) return mainButtons.slice()
    if (typeof sel === 'string' && sel.includes('button')) return mainButtons.slice()
    return []
  }

  ;(document as any).querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-spindle-mount')) return mainSidebar
    return null
  }

  const rootC: any = document.createElement('div')
  rootC.querySelector = () => null

  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  panelContent.children = panelContent.children || []
  const origAppend = panelContent.appendChild.bind(panelContent)
  panelContent.appendChild = (c: unknown) => {
    origAppend(c)
    if (Array.isArray(panelContent.children) && !panelContent.children.includes(c)) {
      panelContent.children.push(c)
    }
    return c
  }

  const tabList: any = makeStubTabList()
  if (!Array.isArray(tabList.children)) tabList.children = []
  tabList.querySelectorAll = (sel: string) => {
    if (!sel.includes('data-tab-id')) return []
    const m = sel.match(/data-tab-id="([^"]+)"/)
    if (!m) return []
    return (tabList.children as any[]).filter(
      (c) => c.getAttribute?.('data-tab-id') === m[1],
    )
  }
  tabList.querySelector = (sel: string) => tabList.querySelectorAll(sel)[0] ?? null

  const wrapper: any = makeStubWrapper(tabList)
  wrapper.appendChild(panelContent)
  wireSecondaryShell(wrapper, tabList, panelContent, [])
  __setSecondaryWrapperForTest(wrapper)

  ;(globalThis as any).window = {
    ...(globalThis as any).window,
    spindle: {
      ui: {
        getBuiltInTabRoot: (id: string) => (id === 'tab-c' ? rootC : undefined),
        getBuiltInTabTitle: (id: string) => id,
        requestTabLocation: () => {
          // Host reset always lands on first non-moved (tab-a).
          btnA.className = 'tabBtn tabBtnActive'
          btnB.className = 'tabBtn'
          btnC.className = 'tabBtn'
        },
        getTabLocation: () => ({ kind: 'container', containerId: 'canvas-secondary-drawer' }),
      },
      containers: {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }

  __setHostSetSettingForTest(
    () => {},
    {
      side: 'right',
      tabOrder: ['tab-a', 'tab-b', 'tab-c'],
      hiddenTabIds: [],
      showTabLabels: false,
    },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['tab-a', 'tab-b'],
    secondaryIds: ['tab-c'],
    builtinOrder: ['tab-a', 'tab-b', 'tab-c'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['tab-a', 'tab-b', 'tab-c'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['tab-a', 'primary'],
      ['tab-b', 'primary'],
      ['tab-c', 'primary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C14b: commit ok')
  assert(
    clicks.includes('tab-b'),
    'C14b: re-clicked Canvas-active tab-b (not host-parked tab-a)',
  )
  assert(
    String(btnB.className).includes('tabBtnActive'),
    'C14b: tab-b host-active after quiet move of inactive tab-c',
  )
  assert(
    !String(btnA.className).includes('tabBtnActive'),
    'C14b: top-most tab-a is not left active',
  )
  const mirrorKeyB = getActiveMainMirrorKey()
  assert(
    mirrorKeyB === 'id__tab-b' || mirrorKeyB === 'title__tab-b',
    `C14b: main-mirror key stays tab-b (got ${mirrorKeyB})`,
  )

  __setSecondaryWrapperForTest(null)
  __resetMainTabPinForTest()
  setSettings({ taskbarMode: savedTaskbar, moveControlsToOuterEdge: savedOuter })
}

// =====================================================================
// C15: active primary → secondary handoff uses neighbor (above), not top
//     Mirror key + host both on tab-c; move tab-c → secondary must activate
//     tab-b (above), not tab-a (top-most).
// =====================================================================
{
  setup()
  if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
    ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(0), 0) as unknown as number
  }

  const { setSettings, getSettings } = await import('../../settings/state')
  const savedTaskbar = getSettings().taskbarMode
  const savedOuter = getSettings().moveControlsToOuterEdge
  setSettings({ taskbarMode: true, moveControlsToOuterEdge: true })

  const {
    __setActiveMainMirrorKeyForTest,
    __setMainTabPinEnabledForTest,
    __resetMainTabPinForTest,
    getActiveMainMirrorKey,
  } = await import('../../sidebar/main-tab-pin')

  __resetMainTabPinForTest()
  __setMainTabPinEnabledForTest(true)
  __setActiveMainMirrorKeyForTest('id__tab-c')

  const clicks: string[] = []
  const makeMainBtn = (id: string, active: boolean) => {
    const btn: any = document.createElement('button')
    btn.setAttribute('data-tab-id', id)
    btn.setAttribute('title', id)
    btn.className = active ? 'tabBtn tabBtnActive' : 'tabBtn'
    btn.click = () => {
      clicks.push(id)
      for (const b of mainButtons) {
        b.className = b === btn ? 'tabBtn tabBtnActive' : 'tabBtn'
      }
    }
    btn.querySelector = () => null
    return btn
  }

  const btnA = makeMainBtn('tab-a', false)
  const btnB = makeMainBtn('tab-b', false)
  const btnC = makeMainBtn('tab-c', true) // pre-move active, dragged away
  const mainButtons = [btnA, btnB, btnC]

  const mainSidebar: any = document.createElement('div')
  mainSidebar.setAttribute('data-spindle-mount', 'sidebar')
  for (const b of mainButtons) mainSidebar.appendChild(b)
  mainSidebar.querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('tabBtnActive')) {
      return mainButtons.find((b) => String(b.className).includes('tabBtnActive')) ?? null
    }
    const idM = typeof sel === 'string' ? sel.match(/data-tab-id="([^"]+)"/) : null
    if (idM) return mainButtons.find((b) => b.getAttribute('data-tab-id') === idM[1]) ?? null
    const titleM = typeof sel === 'string' ? sel.match(/title="([^"]+)"/) : null
    if (titleM) return mainButtons.find((b) => b.getAttribute('title') === titleM[1]) ?? null
    return null
  }
  mainSidebar.querySelectorAll = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-tab-id')) return mainButtons.slice()
    if (typeof sel === 'string' && sel.includes('button')) return mainButtons.slice()
    return []
  }

  ;(document as any).querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-spindle-mount')) return mainSidebar
    return null
  }

  const rootC: any = document.createElement('div')
  rootC.querySelector = () => null

  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  panelContent.children = panelContent.children || []
  const origAppend = panelContent.appendChild.bind(panelContent)
  panelContent.appendChild = (c: unknown) => {
    origAppend(c)
    if (Array.isArray(panelContent.children) && !panelContent.children.includes(c)) {
      panelContent.children.push(c)
    }
    return c
  }

  const tabList: any = makeStubTabList()
  if (!Array.isArray(tabList.children)) tabList.children = []
  tabList.querySelectorAll = (sel: string) => {
    if (!sel.includes('data-tab-id')) return []
    const m = sel.match(/data-tab-id="([^"]+)"/)
    if (!m) return []
    return (tabList.children as any[]).filter(
      (c) => c.getAttribute?.('data-tab-id') === m[1],
    )
  }
  tabList.querySelector = (sel: string) => tabList.querySelectorAll(sel)[0] ?? null

  const wrapper: any = makeStubWrapper(tabList)
  wrapper.appendChild(panelContent)
  wireSecondaryShell(wrapper, tabList, panelContent, [])
  __setSecondaryWrapperForTest(wrapper)

  ;(globalThis as any).window = {
    ...(globalThis as any).window,
    spindle: {
      ui: {
        getBuiltInTabRoot: (id: string) => (id === 'tab-c' ? rootC : undefined),
        getBuiltInTabTitle: (id: string) => id,
        requestTabLocation: () => {
          // Host pendingActiveTabReset → first non-moved primary (tab-a).
          // Hide moved button so captureSourceList filter matches live.
          btnC.style.display = 'none'
          btnA.className = 'tabBtn tabBtnActive'
          btnB.className = 'tabBtn'
          btnC.className = 'tabBtn'
        },
        getTabLocation: () => ({ kind: 'container', containerId: 'canvas-secondary-drawer' }),
      },
      containers: {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }

  __setHostSetSettingForTest(
    () => {},
    {
      side: 'right',
      tabOrder: ['tab-a', 'tab-b', 'tab-c'],
      hiddenTabIds: [],
      showTabLabels: false,
    },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['tab-a', 'tab-b'],
    secondaryIds: ['tab-c'],
    builtinOrder: ['tab-a', 'tab-b', 'tab-c'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['tab-a', 'tab-b', 'tab-c'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['tab-a', 'primary'],
      ['tab-b', 'primary'],
      ['tab-c', 'primary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C15: commit ok')
  assertEqual(getTabAssignments().get('tab-c'), 'secondary', 'C15: tab-c moved to secondary')
  // pickSourceReplacement(tab-c, [a,b,c]) → tab-b (above)
  assert(
    clicks.includes('tab-b'),
    'C15: handoff activated neighbor tab-b (above), not only top-most',
  )
  assert(
    String(btnB.className).includes('tabBtnActive'),
    'C15: tab-b is host-active after active tab moved away',
  )
  assert(
    !String(btnA.className).includes('tabBtnActive'),
    'C15: top-most tab-a is not left active',
  )
  const mirrorKeyNeighbor = getActiveMainMirrorKey()
  assert(
    mirrorKeyNeighbor === 'id__tab-b' || mirrorKeyNeighbor === 'title__tab-b',
    `C15: main-mirror key adopted neighbor tab-b (got ${mirrorKeyNeighbor})`,
  )
  const { getActiveSecondaryTabId: getSecAfterC15 } = await import('../assignment')
  assert(
    getSecAfterC15() !== 'tab-c',
    'C15: quiet drag does not activate moved tab in secondary',
  )

  __setSecondaryWrapperForTest(null)
  __resetMainTabPinForTest()
  setSettings({ taskbarMode: savedTaskbar, moveControlsToOuterEdge: savedOuter })
}

// =====================================================================
// C15b: active primary→secondary after *early host hide* (live DnD path)
//      Primary→secondary drop hides the host button before commit so pin
//      reconcile does not rematerialize a mirror clone. Capture must still
//      include the tab (location still main-drawer) and wasActive via mirror
//      key must fire neighbor handoff — not leave empty panel / no strip switch.
// =====================================================================
{
  setup()
  if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
    ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(0), 0) as unknown as number
  }

  const { setSettings, getSettings } = await import('../../settings/state')
  const savedTaskbar = getSettings().taskbarMode
  const savedOuter = getSettings().moveControlsToOuterEdge
  setSettings({ taskbarMode: true, moveControlsToOuterEdge: true })

  const {
    __setActiveMainMirrorKeyForTest,
    __setMainTabPinEnabledForTest,
    __resetMainTabPinForTest,
    getActiveMainMirrorKey,
  } = await import('../../sidebar/main-tab-pin')

  __resetMainTabPinForTest()
  __setMainTabPinEnabledForTest(true)
  __setActiveMainMirrorKeyForTest('id__tab-c')

  const clicks: string[] = []
  const makeMainBtn = (id: string, active: boolean) => {
    const btn: any = document.createElement('button')
    btn.setAttribute('data-tab-id', id)
    btn.setAttribute('title', id)
    btn.className = active ? 'tabBtn tabBtnActive' : 'tabBtn'
    btn.click = () => {
      clicks.push(id)
      for (const b of mainButtons) {
        b.className = b === btn ? 'tabBtn tabBtnActive' : 'tabBtn'
      }
    }
    btn.querySelector = () => null
    return btn
  }

  const btnA = makeMainBtn('tab-a', false)
  const btnB = makeMainBtn('tab-b', false)
  const btnC = makeMainBtn('tab-c', true)
  const mainButtons = [btnA, btnB, btnC]
  // Live DnD early hide *before* commit (host location still main-drawer).
  btnC.style.display = 'none'

  const mainSidebar: any = document.createElement('div')
  mainSidebar.setAttribute('data-spindle-mount', 'sidebar')
  for (const b of mainButtons) mainSidebar.appendChild(b)
  mainSidebar.querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('tabBtnActive')) {
      return mainButtons.find((b) => String(b.className).includes('tabBtnActive')) ?? null
    }
    const idM = typeof sel === 'string' ? sel.match(/data-tab-id="([^"]+)"/) : null
    if (idM) return mainButtons.find((b) => b.getAttribute('data-tab-id') === idM[1]) ?? null
    return null
  }
  mainSidebar.querySelectorAll = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-tab-id')) return mainButtons.slice()
    if (typeof sel === 'string' && sel.includes('button')) return mainButtons.slice()
    return []
  }

  ;(document as any).querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-spindle-mount')) return mainSidebar
    return null
  }

  const rootC: any = document.createElement('div')
  rootC.querySelector = () => null
  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  panelContent.appendChild = (c: unknown) => c

  const tabList: any = makeStubTabList()
  if (!Array.isArray(tabList.children)) tabList.children = []
  tabList.querySelectorAll = (sel: string) => {
    if (!sel.includes('data-tab-id')) return []
    const m = sel.match(/data-tab-id="([^"]+)"/)
    if (!m) return []
    return (tabList.children as any[]).filter(
      (c) => c.getAttribute?.('data-tab-id') === m[1],
    )
  }
  tabList.querySelector = (sel: string) => tabList.querySelectorAll(sel)[0] ?? null

  const wrapper: any = makeStubWrapper(tabList)
  wrapper.appendChild(panelContent)
  wireSecondaryShell(wrapper, tabList, panelContent, [])
  __setSecondaryWrapperForTest(wrapper)

  const locations: Record<string, { kind: string; containerId?: string }> = {
    'tab-a': { kind: 'main-drawer' },
    'tab-b': { kind: 'main-drawer' },
    'tab-c': { kind: 'main-drawer' },
  }

  ;(globalThis as any).window = {
    ...(globalThis as any).window,
    spindle: {
      ui: {
        getBuiltInTabRoot: (id: string) => (id === 'tab-c' ? rootC : undefined),
        getBuiltInTabTitle: (id: string) => id,
        requestTabLocation: (id: string) => {
          if (id === 'tab-c') {
            locations['tab-c'] = {
              kind: 'container',
              containerId: 'canvas-secondary-drawer',
            }
            btnA.className = 'tabBtn tabBtnActive'
            btnB.className = 'tabBtn'
            btnC.className = 'tabBtn'
          }
        },
        getTabLocation: (id: string) => locations[id] ?? { kind: 'main-drawer' },
      },
      containers: {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }

  __setHostSetSettingForTest(
    () => {},
    {
      side: 'right',
      tabOrder: ['tab-a', 'tab-b', 'tab-c'],
      hiddenTabIds: [],
      showTabLabels: false,
    },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['tab-a', 'tab-b'],
    secondaryIds: ['tab-c'],
    builtinOrder: ['tab-a', 'tab-b', 'tab-c'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['tab-a', 'tab-b', 'tab-c'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['tab-a', 'primary'],
      ['tab-b', 'primary'],
      ['tab-c', 'primary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C15b: commit ok after early hide')
  assertEqual(getTabAssignments().get('tab-c'), 'secondary', 'C15b: tab-c secondary')
  assert(
    clicks.includes('tab-b'),
    'C15b: neighbor tab-b activated (not skipped wasActive=false)',
  )
  assert(
    String(btnB.className).includes('tabBtnActive'),
    'C15b: tab-b host-active after early-hide active move',
  )
  const mirrorKey = getActiveMainMirrorKey()
  assert(
    mirrorKey === 'id__tab-b' || mirrorKey === 'title__tab-b',
    `C15b: mirror key switched to neighbor (got ${mirrorKey})`,
  )

  __setSecondaryWrapperForTest(null)
  __resetMainTabPinForTest()
  setSettings({ taskbarMode: savedTaskbar, moveControlsToOuterEdge: savedOuter })
}

// =====================================================================
// C16: quiet primary→secondary of inactive tab must not auto-activate it
//      in secondary (drag release must not select the moved tab).
// =====================================================================
{
  setup()
  if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
    ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(0), 0) as unknown as number
  }

  const { getActiveSecondaryTabId, setActiveSecondaryTabId } = await import('../assignment')
  setActiveSecondaryTabId('existing-sec')

  const makeMainBtn = (id: string, active: boolean) => {
    const btn: any = document.createElement('button')
    btn.setAttribute('data-tab-id', id)
    btn.setAttribute('title', id)
    btn.className = active ? 'tabBtn tabBtnActive' : 'tabBtn'
    btn.click = () => {
      for (const b of mainButtons) {
        b.className = b === btn ? 'tabBtn tabBtnActive' : 'tabBtn'
      }
    }
    btn.querySelector = () => null
    return btn
  }

  const btnA = makeMainBtn('tab-a', true)
  const btnB = makeMainBtn('tab-b', false) // inactive, dragged to secondary
  const mainButtons = [btnA, btnB]

  const mainSidebar: any = document.createElement('div')
  mainSidebar.setAttribute('data-spindle-mount', 'sidebar')
  for (const b of mainButtons) mainSidebar.appendChild(b)
  mainSidebar.querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('tabBtnActive')) {
      return mainButtons.find((b) => String(b.className).includes('tabBtnActive')) ?? null
    }
    const idM = typeof sel === 'string' ? sel.match(/data-tab-id="([^"]+)"/) : null
    if (idM) return mainButtons.find((b) => b.getAttribute('data-tab-id') === idM[1]) ?? null
    return null
  }
  mainSidebar.querySelectorAll = () => mainButtons.slice()

  ;(document as any).querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-spindle-mount')) return mainSidebar
    return null
  }

  const rootB: any = document.createElement('div')
  rootB.querySelector = () => null

  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  panelContent.children = panelContent.children || []
  const origAppend = panelContent.appendChild.bind(panelContent)
  panelContent.appendChild = (c: unknown) => {
    origAppend(c)
    if (Array.isArray(panelContent.children) && !panelContent.children.includes(c)) {
      panelContent.children.push(c)
    }
    return c
  }

  const tabList: any = makeStubTabList()
  if (!Array.isArray(tabList.children)) tabList.children = []
  tabList.querySelectorAll = (sel: string) => {
    if (!sel.includes('data-tab-id')) return []
    const m = sel.match(/data-tab-id="([^"]+)"/)
    if (!m) return []
    return (tabList.children as any[]).filter(
      (c) => c.getAttribute?.('data-tab-id') === m[1],
    )
  }
  tabList.querySelector = (sel: string) => tabList.querySelectorAll(sel)[0] ?? null

  const wrapper: any = makeStubWrapper(tabList)
  wrapper.appendChild(panelContent)
  wireSecondaryShell(wrapper, tabList, panelContent, [])
  __setSecondaryWrapperForTest(wrapper)

  ;(globalThis as any).window = {
    ...(globalThis as any).window,
    spindle: {
      ui: {
        getBuiltInTabRoot: (id: string) => (id === 'tab-b' ? rootB : undefined),
        getBuiltInTabTitle: (id: string) => id,
        requestTabLocation: () => {
          btnB.style.display = 'none'
        },
        getTabLocation: () => ({ kind: 'container', containerId: 'canvas-secondary-drawer' }),
      },
      containers: {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }

  __setHostSetSettingForTest(
    () => {},
    {
      side: 'right',
      tabOrder: ['tab-a', 'tab-b'],
      hiddenTabIds: [],
      showTabLabels: false,
    },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['tab-a'],
    secondaryIds: ['tab-b'],
    builtinOrder: ['tab-a', 'tab-b'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['tab-a', 'tab-b'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['tab-a', 'primary'],
      ['tab-b', 'primary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C16: commit ok')
  assertEqual(getTabAssignments().get('tab-b'), 'secondary', 'C16: tab-b moved to secondary')
  assertEqual(
    getActiveSecondaryTabId(),
    'existing-sec',
    'C16: pre-existing secondary active unchanged (moved tab not auto-activated)',
  )
  assert(
    rootB.getAttribute('data-canvas-active') == null,
    'C16: moved root has no data-canvas-active',
  )

  __setSecondaryWrapperForTest(null)
}

// =====================================================================
// C17: closed main-mirror, no Canvas exclusive selection — drag primary
//      → secondary must NOT treat host parked tabBtnActive as user-active.
//      Regression: strip closed / key null + host Profile parked → quiet
//      preserve re-clicked park target and force-opened/activated a tab.
// =====================================================================
{
  setup()
  if (typeof (globalThis as any).requestAnimationFrame !== 'function') {
    ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
      setTimeout(() => cb(0), 0) as unknown as number
  }

  const { setSettings, getSettings } = await import('../../settings/state')
  const savedTaskbar = getSettings().taskbarMode
  const savedOuter = getSettings().moveControlsToOuterEdge
  setSettings({ taskbarMode: true, moveControlsToOuterEdge: true })

  const {
    __setActiveMainMirrorKeyForTest,
    __setMainTabPinEnabledForTest,
    __resetMainTabPinForTest,
    getActiveMainMirrorKey,
  } = await import('../../sidebar/main-tab-pin')

  __resetMainTabPinForTest()
  __setMainTabPinEnabledForTest(true)
  // Closed strip: no exclusive selection (user never activated / cleared).
  __setActiveMainMirrorKeyForTest(null)

  const clicks: string[] = []
  const makeMainBtn = (id: string, active: boolean) => {
    const btn: any = document.createElement('button')
    btn.setAttribute('data-tab-id', id)
    btn.setAttribute('title', id)
    btn.className = active ? 'tabBtn tabBtnActive' : 'tabBtn'
    btn.click = () => {
      clicks.push(id)
      for (const b of mainButtons) {
        b.className = b === btn ? 'tabBtn tabBtnActive' : 'tabBtn'
      }
    }
    btn.querySelector = () => null
    return btn
  }

  // Host parks top tab-a; user has no Canvas selection. Drag inactive tab-c.
  const btnA = makeMainBtn('tab-a', true)
  const btnB = makeMainBtn('tab-b', false)
  const btnC = makeMainBtn('tab-c', false)
  const mainButtons = [btnA, btnB, btnC]

  const mainSidebar: any = document.createElement('div')
  mainSidebar.setAttribute('data-spindle-mount', 'sidebar')
  for (const b of mainButtons) mainSidebar.appendChild(b)
  mainSidebar.querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('tabBtnActive')) {
      return mainButtons.find((b) => String(b.className).includes('tabBtnActive')) ?? null
    }
    const idM = typeof sel === 'string' ? sel.match(/data-tab-id="([^"]+)"/) : null
    if (idM) return mainButtons.find((b) => b.getAttribute('data-tab-id') === idM[1]) ?? null
    const titleM = typeof sel === 'string' ? sel.match(/title="([^"]+)"/) : null
    if (titleM) return mainButtons.find((b) => b.getAttribute('title') === titleM[1]) ?? null
    return null
  }
  mainSidebar.querySelectorAll = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-tab-id')) return mainButtons.slice()
    if (typeof sel === 'string' && sel.includes('button')) return mainButtons.slice()
    return []
  }

  ;(document as any).querySelector = (sel: string) => {
    if (typeof sel === 'string' && sel.includes('data-spindle-mount')) return mainSidebar
    return null
  }

  const rootC: any = document.createElement('div')
  rootC.querySelector = () => null

  const panelContent: any = document.createElement('div')
  panelContent.className = 'sidebar-ux-panel-content'
  panelContent.children = panelContent.children || []
  const origAppend = panelContent.appendChild.bind(panelContent)
  panelContent.appendChild = (c: unknown) => {
    origAppend(c)
    if (Array.isArray(panelContent.children) && !panelContent.children.includes(c)) {
      panelContent.children.push(c)
    }
    return c
  }

  const tabList: any = makeStubTabList()
  if (!Array.isArray(tabList.children)) tabList.children = []
  tabList.querySelectorAll = (sel: string) => {
    if (!sel.includes('data-tab-id')) return []
    const m = sel.match(/data-tab-id="([^"]+)"/)
    if (!m) return []
    return (tabList.children as any[]).filter(
      (c) => c.getAttribute?.('data-tab-id') === m[1],
    )
  }
  tabList.querySelector = (sel: string) => tabList.querySelectorAll(sel)[0] ?? null

  const wrapper: any = makeStubWrapper(tabList)
  wrapper.appendChild(panelContent)
  wireSecondaryShell(wrapper, tabList, panelContent, [])
  __setSecondaryWrapperForTest(wrapper)

  ;(globalThis as any).window = {
    ...(globalThis as any).window,
    spindle: {
      ui: {
        getBuiltInTabRoot: (id: string) => (id === 'tab-c' ? rootC : undefined),
        getBuiltInTabTitle: (id: string) => id,
        requestTabLocation: () => {
          btnA.className = 'tabBtn tabBtnActive'
          btnB.className = 'tabBtn'
          btnC.className = 'tabBtn'
        },
        getTabLocation: () => ({ kind: 'container', containerId: 'canvas-secondary-drawer' }),
      },
      containers: {},
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }

  __setHostSetSettingForTest(
    () => {},
    {
      side: 'right',
      tabOrder: ['tab-a', 'tab-b', 'tab-c'],
      hiddenTabIds: [],
      showTabLabels: false,
    },
  )

  const draft: ConfigureDraft = {
    drawerSide: 'right',
    primaryIds: ['tab-a', 'tab-b'],
    secondaryIds: ['tab-c'],
    builtinOrder: ['tab-a', 'tab-b', 'tab-c'],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: ['tab-a', 'tab-b', 'tab-c'],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map([
      ['tab-a', 'primary'],
      ['tab-b', 'primary'],
      ['tab-c', 'primary'],
    ]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C17: commit ok')
  assertEqual(getTabAssignments().get('tab-c'), 'secondary', 'C17: tab-c moved to secondary')
  assert(
    clicks.length === 0,
    `C17: no host tab re-click when Canvas key was null (got clicks=${JSON.stringify(clicks)})`,
  )
  assert(
    getActiveMainMirrorKey() == null,
    `C17: main-mirror key stays null (got ${getActiveMainMirrorKey()})`,
  )
  const { getActiveSecondaryTabId: getSecC17 } = await import('../assignment')
  assert(
    getSecC17() !== 'tab-c',
    'C17: moved tab not activated in secondary',
  )
  assert(
    rootC.getAttribute('data-canvas-active') == null,
    'C17: moved root has no data-canvas-active',
  )

  __setSecondaryWrapperForTest(null)
  __resetMainTabPinForTest()
  setSettings({ taskbarMode: savedTaskbar, moveControlsToOuterEdge: savedOuter })
}

// =====================================================================
// C18: commit with only drawerSide flipped invokes side-change remount path
// =====================================================================
{
  setup()
  const sideCalls: Array<'left' | 'right'> = []
  __setApplyMainDrawerSideChangeForTest((desired) => {
    sideCalls.push(desired)
  })
  __setHostSetSettingForTest(
    (_key: string, _value: unknown) => { /* no-op */ },
    { side: 'right', tabOrder: ['profile'], hiddenTabIds: [] },
  )
  setTabAssignment('profile', 'primary')

  const draft: ConfigureDraft = {
    drawerSide: 'left',
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
    assignments: new Map([['profile', 'primary']]),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C18: side-only commit returns ok')
  assertEqual(sideCalls.length, 1, 'C18: forceMainDrawerSideChange called once')
  assertEqual(sideCalls[0], 'left', 'C18: remount path receives desired side left')
  __setApplyMainDrawerSideChangeForTest(null)
}

// =====================================================================
// C19: commit without drawerSide change does not invoke side remount
// =====================================================================
{
  setup()
  const sideCalls: Array<'left' | 'right'> = []
  __setApplyMainDrawerSideChangeForTest((desired) => {
    sideCalls.push(desired)
  })
  __setHostSetSettingForTest(
    (_key: string, _value: unknown) => { /* no-op */ },
    { side: 'right', tabOrder: [], hiddenTabIds: [] },
  )

  const result: CommitResult = await commitConfigureDraft(NO_TABS_DRAFT, NO_TABS_BASE)
  assert(result.ok === true, 'C19: matching-side commit returns ok')
  assertEqual(sideCalls.length, 0, 'C19: no side remount when drawerSide unchanged')
  __setApplyMainDrawerSideChangeForTest(null)
}

// =====================================================================
// C20: side remount still runs when host patch fails (swap must not no-op)
// =====================================================================
{
  setup()
  const sideCalls: Array<'left' | 'right'> = []
  __setApplyMainDrawerSideChangeForTest((desired) => {
    sideCalls.push(desired)
  })
  // No host-settings seam → patchHostDrawerSettings returns false.
  clearHostSettingsCache()

  const draft: ConfigureDraft = {
    drawerSide: 'left',
    primaryIds: [],
    secondaryIds: [],
    builtinOrder: [],
    extensionOrder: [],
    hiddenIds: new Set(),
  }
  const base: BaseSnapshot = {
    tabOrder: [],
    hiddenTabIds: [],
    drawerSide: 'right',
    assignments: new Map(),
  }

  const result: CommitResult = await commitConfigureDraft(draft, base)
  assert(result.ok === true, 'C20: commit ok even when host patch fails')
  assertEqual(sideCalls.length, 1, 'C20: side remount still attempted after host write fail')
  assertEqual(sideCalls[0], 'left', 'C20: desired side left')
  __setApplyMainDrawerSideChangeForTest(null)
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
