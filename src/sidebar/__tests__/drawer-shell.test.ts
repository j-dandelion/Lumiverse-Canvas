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

const { createDrawerShell } = await import('../drawer-shell')

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
}

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}`)
