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

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
