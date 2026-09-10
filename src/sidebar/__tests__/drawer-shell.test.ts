// createDrawerShell — stable public class hooks for theming.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error('FAIL:', msg)
  }
}

class StubStyle {
  private _props: Record<string, string> = {}
  setProperty(k: string, v: string) {
    this._props[k] = v
  }
  getPropertyValue(k: string) {
    return this._props[k] ?? ''
  }
  removeProperty(k: string) {
    delete this._props[k]
  }
  set cssText(_v: string) {}
}

class StubElement {
  style = new StubStyle()
  className = ''
  tagName = 'DIV'
  innerHTML = ''
  textContent: string | null = null
  children: StubElement[] = []
  dataset: Record<string, string> = {}
  private _attrs: Record<string, string> = {}

  classList = {
    contains: (c: string) => this.className.split(/\s+/).includes(c),
    toggle: (c: string, force?: boolean) => {
      const has = this.className.split(/\s+/).includes(c)
      const want = force === undefined ? !has : force
      if (want && !has) this.className = `${this.className} ${c}`.trim()
      if (!want && has) {
        this.className = this.className.split(/\s+/).filter((t) => t !== c).join(' ')
      }
      return want
    },
  }

  querySelector(_sel: string): StubElement | null {
    return null
  }

  setAttribute(k: string, v: string) {
    this._attrs[k] = v
  }
  getAttribute(k: string) {
    return this._attrs[k] ?? null
  }
  appendChild(child: StubElement) {
    this.children.push(child)
    return child
  }
  addEventListener() {}
}

;(globalThis as any).window = {
  innerWidth: 1200,
  addEventListener() {},
  removeEventListener() {},
}

;(globalThis as any).document = {
  documentElement: { style: new StubStyle() },
  head: { appendChild() {} },
  getElementById() {
    return null
  },
  createElement(_tag: string) {
    return new StubElement()
  },
}

const { createDrawerShell, restyleShellSide } = await import('../drawer-shell')

{
  const secondary = createDrawerShell({
    owner: 'secondary',
    side: 'right',
    widthCssVar: '--sidebar-ux-secondary-w',
  })
  assert(
    secondary.wrapper.classList.contains('sidebar-ux-shell'),
    'secondary: has sidebar-ux-shell',
  )
  assert(
    secondary.wrapper.classList.contains('sidebar-ux-secondary-wrapper'),
    'secondary: has owner wrapper class',
  )
  assert(
    secondary.wrapper.classList.contains('sidebar-ux-side-right'),
    'secondary: has side class',
  )
  assert(
    secondary.wrapper.getAttribute('data-drawer-owner') === 'secondary',
    'secondary: data-drawer-owner',
  )
  // Live-verify #10: the two shells must NOT share one glyph. Secondary keeps
  // Canvas's panel icon.
  assert(
    secondary.drawerTab.children[0]?.innerHTML.includes('line x1="9"') === true,
    'secondary: keeps Canvas panel glyph',
  )
}

{
  const main = createDrawerShell({
    owner: 'main',
    side: 'left',
    widthCssVar: '--sidebar-ux-main-mirror-w',
  })
  assert(main.wrapper.classList.contains('sidebar-ux-shell'), 'main: has sidebar-ux-shell')
  assert(
    main.wrapper.classList.contains('sidebar-ux-main-mirror-wrapper'),
    'main: has owner wrapper class',
  )
  assert(main.wrapper.classList.contains('sidebar-ux-side-left'), 'main: has side class')
  assert(main.wrapper.getAttribute('data-drawer-owner') === 'main', 'main: data-drawer-owner')
  // Live-verify #10: main keeps the vanilla Lumiverse drawerTab glyph
  // (lucide `Sparkles`, ViewportDrawer.tsx), not Canvas's panel icon.
  assert(
    main.drawerTab.children[0]?.innerHTML.includes('M9.937 15.5') === true,
    'main: keeps vanilla Sparkles glyph',
  )
  assert(
    main.drawerTab.children[0]?.innerHTML.includes('line x1="9"') === false,
    'main: does NOT use the Canvas panel glyph',
  )
}

// ── restyleShellSide: drawer flex is pin-aware ──
// Pinned = the tab list was reparented to the body-level pin host, so it is
// absent from the wrapper and the 56px spacer takes its place in the
// drawer's [spacer, panel] order. The spacer must sit on the screen edge →
// flex is the OPPOSITE of the in-flow default. Regression: the restyle used
// to write the in-flow default unconditionally, parking the panel under the
// pinned strip after a side swap.
{
  const makeWrapper = (pinned: boolean) => {
    const wrapper = new StubElement()
    wrapper.className = 'sidebar-ux-secondary-wrapper'
    const drawer = new StubElement()
    drawer.className = 'sidebar-ux-drawer'
    const tabList = new StubElement()
    tabList.className = 'sidebar-ux-tab-list'
    const drawerTab = new StubElement()
    drawerTab.className = 'sidebar-ux-drawer-tab'
    wrapper.querySelector = (sel: string): StubElement | null => {
      if (sel === '.sidebar-ux-drawer') return drawer
      if (sel === '.sidebar-ux-drawer-tab') return drawerTab
      if (sel === '.sidebar-ux-tab-list') return pinned ? null : tabList
      return null
    }
    return { wrapper, drawer }
  }

  const unpinned = makeWrapper(false)
  restyleShellSide(unpinned.wrapper as any, 'right')
  assert(
    unpinned.drawer.style.getPropertyValue('flex-direction') === 'row',
    'restyleShellSide unpinned right → in-flow row',
  )
  restyleShellSide(unpinned.wrapper as any, 'left')
  assert(
    unpinned.drawer.style.getPropertyValue('flex-direction') === 'row-reverse',
    'restyleShellSide unpinned left → in-flow row-reverse',
  )

  const pinned = makeWrapper(true)
  restyleShellSide(pinned.wrapper as any, 'right')
  assert(
    pinned.drawer.style.getPropertyValue('flex-direction') === 'row-reverse',
    'restyleShellSide pinned right → outer-edge row-reverse',
  )
  restyleShellSide(pinned.wrapper as any, 'left')
  assert(
    pinned.drawer.style.getPropertyValue('flex-direction') === 'row',
    'restyleShellSide pinned left → outer-edge row',
  )
}

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}`)

// Make this file a module: the stubs (`StubStyle`, `StubElement`, counters)
// are file-local, and top-level await needs module semantics anyway. Without
// this the project-wide tsc run merges them into the script global scope and
// reports duplicate identifiers against sibling test files.
export {}
