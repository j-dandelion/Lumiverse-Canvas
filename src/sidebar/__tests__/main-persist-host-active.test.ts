// Tests for isHostPrimaryTabActive (src/sidebar/main-persist.ts)
//
// Restore gates must treat host tabBtnActive as authoritative and ignore
// Canvas mirror chrome (which paints before React commits panel children).

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

// --- Minimal DOM stubs (before importing main-persist) ---

type StubBtn = {
  tagName: string
  className: string
  _attrs: Record<string, string>
  getAttribute(name: string): string | null
  classList: { contains(c: string): boolean }
}

let _sidebar: { querySelector(sel: string): StubBtn | null } | null = null
let _mirrorActive: StubBtn | null = null

function makeBtn(opts: {
  id: string
  title: string
  active?: boolean
  mirror?: boolean
}): StubBtn {
  const className = opts.mirror
    ? (opts.active
      ? 'sidebar-ux-main-tab-mirror-btn sidebar-ux-tab-active'
      : 'sidebar-ux-main-tab-mirror-btn')
    : (opts.active ? 'tabBtn tabBtnActive' : 'tabBtn')
  const attrs: Record<string, string> = {
    'data-tab-id': opts.id,
    title: opts.title,
  }
  return {
    tagName: 'BUTTON',
    className,
    _attrs: attrs,
    getAttribute(name: string) {
      return attrs[name] ?? null
    },
    classList: {
      contains(c: string) {
        return className.split(/\s+/).includes(c)
      },
    },
  }
}

let _hostButtons: StubBtn[] = []

function matchActiveHost(sel: string): StubBtn | null {
  // isHostPrimaryTabActive uses:
  // 'button.tabBtnActive, button[class*="tabBtnActive"]'
  if (!sel.includes('tabBtnActive')) return null
  return _hostButtons.find((b) => b.className.includes('tabBtnActive')) ?? null
}

;(globalThis as any).document = {
  querySelector(sel: string) {
    if (sel === '[data-spindle-mount="sidebar"]') return _sidebar
    // Mirror selectors (not used by isHostPrimaryTabActive but keep harmless)
    if (sel.includes('sidebar-ux-main-tab-mirror-btn')) {
      if (_mirrorActive && sel.includes('sidebar-ux-tab-active')) {
        const wantId = sel.match(/data-tab-id="([^"]+)"/)?.[1]
        const wantTitle = sel.match(/title="([^"]+)"/)?.[1]
        if (wantId && _mirrorActive.getAttribute('data-tab-id') === wantId) return _mirrorActive
        if (wantTitle && _mirrorActive.getAttribute('title') === wantTitle) return _mirrorActive
        // Combined selector with comma — return if any part matches loosely
        if (!wantId && !wantTitle) return _mirrorActive
      }
      return null
    }
    return null
  },
  querySelectorAll() {
    return []
  },
  createElement() {
    return { style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, classList: { add() {}, remove() {} } }
  },
  getElementById() {
    return null
  },
  documentElement: {
    classList: {
      contains() { return false },
      add() {},
      remove() {},
    },
  },
  head: { appendChild() {} },
}

function setupHost(activeId: string | null, buttons = ['profile', 'memory', 'lorebook']) {
  _hostButtons = buttons.map((id) =>
    makeBtn({
      id,
      title: id.charAt(0).toUpperCase() + id.slice(1),
      active: activeId === id,
    }),
  )
  _sidebar = {
    querySelector(sel: string) {
      return matchActiveHost(sel)
    },
  }
}

function setupMirror(activeId: string | null) {
  _mirrorActive = activeId
    ? makeBtn({ id: activeId, title: activeId, active: true, mirror: true })
    : null
}

// Import after stubs (dynamic import so document stub is in place first)
const { isHostPrimaryTabActive } = await import('../main-persist')

export {}

// --- Host active matches exact data-tab-id ---
{
  setupHost('memory')
  setupMirror(null)
  assert(isHostPrimaryTabActive('memory') === true, 'host memory active → true')
  assert(isHostPrimaryTabActive('profile') === false, 'host memory active, query profile → false')
}

// --- Full spindle id matches bare host id ---
{
  setupHost('memory')
  setupMirror(null)
  assert(
    isHostPrimaryTabActive('spindle:uuid:tab:memory:1') === true,
    'spindle full id matches host bare memory',
  )
  assert(
    isHostPrimaryTabActive('spindle:uuid:tab:profile:1') === false,
    'spindle profile id does not match host memory',
  )
}

// --- Mirror-only active must NOT count as host active ---
{
  setupHost('profile')
  setupMirror('memory')
  assert(
    isHostPrimaryTabActive('memory') === false,
    'mirror memory active + host profile → host memory false',
  )
  assert(
    isHostPrimaryTabActive('profile') === true,
    'host profile still true when mirror says memory',
  )
}

// --- No host active button (mirror only) ---
{
  setupHost(null)
  setupMirror('memory')
  assert(
    isHostPrimaryTabActive('memory') === false,
    'mirror-only with no host tabBtnActive → false',
  )
}

// --- Title match ---
{
  setupHost('memory')
  setupMirror(null)
  assert(isHostPrimaryTabActive('Memory') === true, 'title Memory matches host active')
}

console.log(`main-persist-host-active: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
