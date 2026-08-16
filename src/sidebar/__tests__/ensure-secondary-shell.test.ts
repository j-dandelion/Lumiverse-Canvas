// ensureSecondaryShellMounted + mount heal for detached secondary wrappers.
// Regression: setting secondSidebarEnabled=true while module ref points at a
// removed node made open/addButton/moves look like no-ops under taskbar mode.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(a: unknown, b: unknown, msg: string) {
  assert(a === b, `${msg} (got ${JSON.stringify(a)} expected ${JSON.stringify(b)})`)
}

// Minimal document + connected-element fakes for bun (no jsdom).
type FakeEl = {
  isConnected: boolean
  className: string
  style: { cssText: string; transform?: string }
  dataset: Record<string, string>
  children: FakeEl[]
  parentElement: FakeEl | null
  querySelector: (sel: string) => FakeEl | null
  querySelectorAll: (sel: string) => FakeEl[]
  appendChild: (c: FakeEl) => FakeEl
  remove: () => void
  setAttribute: (n: string, v: string) => void
  getAttribute: (n: string) => string | null
}

const bodyChildren: FakeEl[] = []

function makeEl(className = ''): FakeEl {
  const el: FakeEl = {
    isConnected: false,
    className,
    style: { cssText: '' },
    dataset: {},
    children: [],
    parentElement: null,
    querySelector(sel: string) {
      if (sel.includes('sidebar-ux-drawer') && !sel.includes('tab')) {
        return this.children.find((c) => c.className.includes('sidebar-ux-drawer')) ?? null
      }
      if (sel.includes('sidebar-ux-tab-list')) {
        return this.children.flatMap((c) => c.children).find((c) => c.className.includes('sidebar-ux-tab-list'))
          ?? this.children.find((c) => c.className.includes('sidebar-ux-tab-list'))
          ?? null
      }
      if (sel.includes('sidebar-ux-panel-content') || sel.includes('sidebar-ux-panel')) {
        const drawer = this.children.find((c) => c.className.includes('sidebar-ux-drawer'))
        return drawer?.children.find((c) => c.className.includes('sidebar-ux-panel')) ?? null
      }
      if (sel.includes('sidebar-ux-resize-handle')) return null
      if (sel.includes('sidebar-ux-drawer-tab')) {
        return this.children.find((c) => c.className.includes('sidebar-ux-drawer-tab')) ?? null
      }
      return null
    },
    querySelectorAll() { return [] },
    appendChild(c: FakeEl) {
      c.parentElement = this
      c.isConnected = this.isConnected
      this.children.push(c)
      return c
    },
    remove() {
      this.isConnected = false
      this.parentElement = null
      const i = bodyChildren.indexOf(this)
      if (i >= 0) bodyChildren.splice(i, 1)
    },
    setAttribute() {},
    getAttribute() { return null },
  }
  return el
}

// Mock document/body before importing secondary module.
const body = {
  appendChild(el: FakeEl) {
    el.isConnected = true
    el.parentElement = body as unknown as FakeEl
    bodyChildren.push(el)
    return el
  },
  querySelectorAll(sel: string) {
    if (sel.includes('sidebar-ux-secondary-wrapper')) {
      return bodyChildren.filter((c) => c.className.includes('sidebar-ux-secondary-wrapper'))
    }
    return []
  },
}

// @ts-expect-error minimal document for unit test
globalThis.document = {
  body,
  documentElement: {
    style: { getPropertyValue: () => '', setProperty: () => {}, removeProperty: () => {} },
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
  },
  createElement(tag: string) {
    const el = makeEl()
    ;(el as FakeEl & { tagName: string }).tagName = tag.toUpperCase()
    return el
  },
  querySelector() { return null },
  querySelectorAll(sel: string) {
    return body.querySelectorAll(sel)
  },
  getElementById() { return null },
  head: { appendChild() {} },
}

// @ts-expect-error matchMedia for isMobileViewport
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  innerWidth: 1200,
  requestAnimationFrame: (cb: FrameRequestCallback) => { cb(0); return 0 },
}

// Stub heavy deps used by secondary mount path.
import { mock } from 'bun:test'

mock.module('../../settings/state', () => ({
  getSettings: () => ({
    secondSidebarEnabled: true,
    taskbarMode: true,
    moveControlsToOuterEdge: true,
    mirrorCompactPosition: false,
  }),
}))

mock.module('../../dom/host-bridge', () => ({
  getHostBridge: () => ({
    ui: {},
    containers: {
      registerContainer: () => {},
      unregisterContainer: () => {},
    },
  }),
}))

mock.module('../../store', () => ({
  getDrawerTabs: () => [],
  getStoreSnapshot: () => null,
  getMainDrawerSide: () => 'left',
  isMainDrawerOpen: () => false,
  findStoreData: () => {},
}))

mock.module('../../dom/lumiverse', () => ({
  getMainSidebar: () => null,
  getMainPanelContent: () => null,
  getMainPanel: () => null,
  getMainWrapper: () => null,
  getMainDrawer: () => null,
  getMainPanelHeader: () => null,
  getChatColumn: () => null,
  getMainDrawerWidth: () => 300,
}))

mock.module('../../chat/reflow', () => ({
  updateChatReflow: () => {},
}))

mock.module('../../resize/handles', () => ({
  mountResizeHandles: () => {},
}))

mock.module('../drawer-sync', () => ({
  syncDrawerTabSettings: () => {},
}))

mock.module('../tab-position', () => ({
  applyTabListPin: () => {},
  applyTabListPosition: () => {},
  getPinnedTabList: () => null,
  reconcileTabListPin: () => {},
}))

mock.module('../panel-header-sync', () => ({
  syncPanelHeaderFromMain: () => {},
  stopPanelHeaderObservers: () => {},
  resetPanelHeaderSyncCache: () => {},
}))

mock.module('../animation', () => ({
  animateWrapper: () => {},
}))

mock.module('../styles', () => ({
  SECONDARY_WIDTH_VAR: '--sidebar-ux-secondary-w',
  injectDrawerTabStyles: () => {},
}))

mock.module('../drawer-shell', () => ({
  closedTransformPx: (_side: string, w: number) => w,
  readWidthCssVar: () => 420,
  createDrawerShell: () => {
    const wrapper = makeEl('sidebar-ux-secondary-wrapper sidebar-ux-shell')
    const drawerTab = makeEl('sidebar-ux-drawer-tab')
    const drawer = makeEl('sidebar-ux-drawer')
    const tabList = makeEl('sidebar-ux-tab-list')
    const panel = makeEl('sidebar-ux-panel')
    const content = makeEl('sidebar-ux-panel-content')
    const header = makeEl('sidebar-ux-panel-header')
    const title = makeEl('sidebar-ux-panel-title')
    const closeBtn = makeEl('sidebar-ux-panel-close')
    panel.appendChild(header)
    panel.appendChild(content)
    drawer.appendChild(tabList)
    drawer.appendChild(panel)
    wrapper.appendChild(drawerTab)
    wrapper.appendChild(drawer)
    return {
      wrapper,
      drawerTab,
      drawer,
      tabList,
      panel,
      header,
      title,
      closeBtn,
      content,
      side: 'right' as const,
      widthCssVar: '--sidebar-ux-secondary-w',
      owner: 'secondary' as const,
    }
  },
}))

mock.module('../../tabs/assignment', () => ({
  getTabAssignments: () => new Map(),
  clearTabAssignments: () => {},
  isTabActiveInMainDrawer: () => false,
  hasSecondaryAssignedTabs: () => false,
}))

mock.module('../../tabs/buttons', () => ({
  showMainTabButton: () => {},
  findSafeFallbackButton: () => null,
  updateDrawerTabVisibility: () => {},
}))

mock.module('../mobile-exclusion', () => ({
  isMobileViewport: () => false,
  enforceExclusionOnOpen: () => {},
  setMobileOpenClass: () => {},
}))

mock.module('../secondary-drawer', () => ({
  setSuppressAutoActivation: () => {},
}))

mock.module('../strip-gutter', () => ({
  updateStripGutters: () => {},
  clearStripGutters: () => {},
}))

mock.module('../../layout/persist', () => ({
  persistOpenState: () => {},
}))

mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
}))

const {
  mountSecondarySidebar,
  unmountSecondarySidebar,
  getSecondaryWrapper,
  ensureSecondaryShellMounted,
  isSecondaryShellLive,
  __setSecondaryWrapperForTest,
} = await import('../secondary')

// --- fresh mount ---
{
  unmountSecondarySidebar()
  assert(!isSecondaryShellLive(), 'E1: not live before mount')
  assert(ensureSecondaryShellMounted() === true, 'E1: ensure mounts when enabled')
  assert(isSecondaryShellLive() === true, 'E1: live after ensure')
  assert(getSecondaryWrapper()?.isConnected === true, 'E1: wrapper connected')
}

// --- ensure is idempotent when live ---
{
  const before = getSecondaryWrapper()
  assert(ensureSecondaryShellMounted() === true, 'E2: ensure still true')
  assert(getSecondaryWrapper() === before, 'E2: same wrapper when already live')
}

// --- detached ref: ensure remounts ---
{
  const stale = getSecondaryWrapper()
  assert(stale != null, 'E3: have wrapper to detach')
  // Simulate DOM purge without tearDown (isConnected → false, still in module).
  stale!.isConnected = false
  assert(isSecondaryShellLive() === false, 'E3: detached is not live')
  assert(ensureSecondaryShellMounted() === true, 'E3: ensure remounts after detach')
  assert(isSecondaryShellLive() === true, 'E3: live after remount')
  assert(getSecondaryWrapper() !== stale, 'E3: new wrapper instance')
  assert(getSecondaryWrapper()?.isConnected === true, 'E3: new wrapper connected')
}

// --- mountSecondarySidebar heals detached without leaving ghost ---
{
  const w = getSecondaryWrapper()
  w!.isConnected = false
  mountSecondarySidebar()
  assert(isSecondaryShellLive() === true, 'E4: mount heals detached')
  assert(getSecondaryWrapper()?.isConnected === true, 'E4: connected after mount heal')
}

// --- unmount clears live ---
{
  unmountSecondarySidebar()
  assert(getSecondaryWrapper() === null, 'E5: wrapper null after unmount')
  assert(isSecondaryShellLive() === false, 'E5: not live after unmount')
  // Test seam: force a fake detached wrapper as if mid-corruption
  const ghost = makeEl('sidebar-ux-secondary-wrapper')
  ghost.isConnected = false
  __setSecondaryWrapperForTest(ghost as unknown as HTMLElement)
  assert(isSecondaryShellLive() === false, 'E5: test ghost not live')
  assert(ensureSecondaryShellMounted() === true, 'E5: ensure replaces ghost')
  assert(isSecondaryShellLive() === true, 'E5: live after ghost replace')
  unmountSecondarySidebar()
}

console.log(`ensure-secondary-shell: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
