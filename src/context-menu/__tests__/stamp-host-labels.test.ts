// stampHostTabLabelsMenuItem — host ContextMenu wording follows Canvas
// isShowTabLabels (optimistic cache), not lagging host React.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.error('FAIL:', msg)
  }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) passed++
  else {
    failed++
    console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`)
  }
}

let _mockShow = true

// Minimal DOM for stamp (no full browser)
class StubStyle {
  color = ''
}
class StubEl {
  tagName = 'DIV'
  textContent = ''
  style = new StubStyle()
  dataset: Record<string, string> = {}
  children: StubEl[] = []
  querySelector(sel: string): StubEl | null {
    if (sel === 'button') return this.children.find((c) => c.tagName === 'BUTTON') ?? null
    return null
  }
}

;(globalThis as any).document = {
  body: new StubEl(),
  createElement: () => new StubEl(),
}

const { mock } = await import('bun:test')

mock.module('../../sidebar/drawer-sync', () => ({
  isShowTabLabels: () => _mockShow,
  syncSecondaryTabLabels: () => {},
  syncDrawerTabSettings: () => {},
}))

// Other imports pulled by context-menu/index — stub minimally
mock.module('../../dom/lumiverse', () => ({ getMainSidebar: () => null }))
mock.module('../../store', () => ({
  findStoreData: () => {},
  getDrawerTabs: () => [],
}))
mock.module('../../tabs/assignment', () => ({
  getTabSidebar: () => 'primary',
  assignTab: () => {},
}))
mock.module('../../settings/state', () => ({
  getSettings: () => ({ secondSidebarEnabled: true }),
}))
mock.module('../../tabs/tab-context-menu', () => ({
  hideAssignmentMenu: () => {},
}))
mock.module('../../tabs/buttons', () => ({
  isSettingsButton: () => false,
}))
mock.module('../../debug/log', () => ({
  dlog: () => {},
  dwarn: () => {},
}))

const { stampHostTabLabelsMenuItem } = await import('../index')

// S1: labels on → Hide + danger color
{
  _mockShow = true
  const menu = new StubEl()
  const btn = new StubEl()
  btn.tagName = 'BUTTON'
  btn.textContent = 'Show tab labels' // stale host wording
  menu.children.push(btn)

  stampHostTabLabelsMenuItem(menu as unknown as HTMLElement)
  assertEqual(btn.textContent, 'Hide tab labels', 'S1: wording Hide when show=true')
  assertEqual(
    btn.style.color,
    'var(--lumiverse-error, #e54545)',
    'S1: danger color when labels visible',
  )
}

// S2: labels off → Show + normal text color (main-mirror bug after hide)
{
  _mockShow = false
  const menu = new StubEl()
  const btn = new StubEl()
  btn.tagName = 'BUTTON'
  btn.textContent = 'Hide tab labels' // host React still thinks showing
  menu.children.push(btn)

  stampHostTabLabelsMenuItem(menu as unknown as HTMLElement)
  assertEqual(btn.textContent, 'Show tab labels', 'S2: wording Show when show=false')
  assertEqual(btn.style.color, 'var(--lumiverse-text)', 'S2: non-danger color when hidden')
}

// S3: empty menu no throw
{
  const menu = new StubEl()
  stampHostTabLabelsMenuItem(menu as unknown as HTMLElement)
  assert(true, 'S3: no button is a no-op')
}

console.log(`stamp-host-labels tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
