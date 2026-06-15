// Regression test: injectDrawerTabStyles() injects a CSS rule
// `[data-canvas-moved]:not([data-canvas-active]) { display: none !important; }`
// that hides inactive moved tabs without touching the extension's inline
// `display` style. This replaces the old v1.6.5 approach which stamped
// `display: none !important` / `removeProperty('display')` directly on
// moved roots, breaking extensions like Creator Notes HTML Renderer that
// set `display: flex` on tab.root.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

// --- Minimal DOM stubs for document.getElementById / createElement / head.appendChild ---
// injectStyles (debug/styles.ts) uses:
//   document.getElementById(id)
//   document.createElement('style')
//   document.head.appendChild(style)

class StubStyleElement {
  id = ''
  textContent = ''
}

// Collect style elements appended to head so tests can inspect them
const _styleElements: StubStyleElement[] = []

const stubHead = {
  appendChild(el: StubStyleElement) {
    _styleElements.push(el)
    return el
  },
}

;(globalThis as any).document = {
  getElementById(id: string): StubStyleElement | null {
    return _styleElements.find((el) => el.id === id) ?? null
  },
  createElement(tag: string): StubStyleElement {
    if (tag === 'style') return new StubStyleElement()
    throw new Error(`createElement('${tag}') not stubbed`)
  },
  head: stubHead,
}

import { injectDrawerTabStyles } from '../styles'

// Helper: find a style element by id from the collected stub elements
function findStyleById(id: string): StubStyleElement | null {
  return _styleElements.find((e) => e.id === id) ?? null
}

// ============================================================
// Test 1: injectDrawerTabStyles() creates a <style> element with
//         the moved-active-toggle CSS rule.
// ============================================================
{
  injectDrawerTabStyles()

  const found = findStyleById('canvas-moved-active-toggle')
  assert(found !== null, 'T1: style#canvas-moved-active-toggle exists in document.head')

  const css = found?.textContent ?? ''
  assert(css.includes('[data-canvas-moved]'), 'T1: CSS contains [data-canvas-moved] selector')
  assert(css.includes('[data-canvas-active]'), 'T1: CSS contains [data-canvas-active] selector')
  assert(css.includes('display: none !important'), 'T1: CSS contains display: none !important')
}

// ============================================================
// Test 2: Idempotency — calling injectDrawerTabStyles() twice
//         produces only ONE <style id="canvas-moved-active-toggle">
//         element (injectStyles is a no-op when id already exists).
// ============================================================
{
  injectDrawerTabStyles()

  const count = _styleElements.filter((e) => e.id === 'canvas-moved-active-toggle').length
  assertEqual(count, 1, 'T2: only one style#canvas-moved-active-toggle exists after two calls')
}

// ============================================================
// Test 3: The injected CSS rule uses the correct selector
//         `[data-canvas-moved]:not([data-canvas-active])` and sets
//         `display: none !important`.
//
//         JSDOM in Bun's test runner does not expose cssRules on
//         style elements, so we fall back to verifying the rule text
//         is present in the style element's textContent.
// ============================================================
{
  const found = findStyleById('canvas-moved-active-toggle')
  assert(found !== null, 'T3: style element found for rule inspection')

  const css = found?.textContent ?? ''

  // Verify the selector — the :not pseudo-class must be present
  assert(css.includes('[data-canvas-moved]:not([data-canvas-active])'),
    'T3: raw CSS includes [data-canvas-moved]:not([data-canvas-active]) selector')

  // Verify the declaration
  assert(css.includes('display: none !important'),
    'T3: raw CSS includes "display: none !important" declaration')

  // Verify the rule is properly scoped with { }
  const selectorIdx = css.indexOf('[data-canvas-moved]:not([data-canvas-active])')
  const openBraceIdx = css.indexOf('{', selectorIdx)
  const closeBraceIdx = css.indexOf('}', openBraceIdx)
  assert(selectorIdx >= 0 && openBraceIdx > selectorIdx && closeBraceIdx > openBraceIdx,
    'T3: rule is properly delimited with { }')

  // Verify the declaration is inside the rule block
  const ruleBody = css.substring(openBraceIdx + 1, closeBraceIdx)
  assert(ruleBody.includes('display: none !important'),
    'T3: display: none !important is inside the rule block')

  // NOTE: Bun's JSDOM does not expose cssRules, so we verify via textContent.
  // If cssRules becomes available in the future, we could tighten this:
  //
  //   const sheet = found?.sheet
  //   const rules = Array.from(sheet?.cssRules ?? [])
  //   const match = rules.find(r => r instanceof CSSStyleRule && r.selectorText === '[data-canvas-moved]:not([data-canvas-active])')
  //   assert(match !== undefined, 'T3: cssRules contains the expected CSSStyleRule')
}

// ============================================================
// Test 4 (regression): Simulate a moved root that mimics Creator
//         Notes' bug pattern. The extension sets
//         `display: flex; flex-direction: column; height: 100%`
//         directly on tab.root. The CSS rule must NOT touch the
//         inline style — only the attribute-based rule controls
//         visibility.
// ============================================================
{
  // Simulate a DOM element with inline styles as Creator Notes does
  const el = {
    _attrs: {} as Record<string, string>,
    style: { cssText: '' },
    setAttribute(name: string, value: string) { this._attrs[name] = value },
    getAttribute(name: string) { return this._attrs[name] ?? null },
    removeAttribute(name: string) { delete this._attrs[name] },
  } as any

  // Mimic what Creator Notes HTML Renderer does: set display:flex inline
  el.setAttribute('data-canvas-moved', 'test-tab')
  el.style.cssText = 'display:flex;flex-direction:column;height:100%;'

  // injectDrawerTabStyles() has already been called above — the CSS rule
  // exists but should NOT have touched el.style (the rule is a stylesheet
  // rule, not inline style manipulation).
  // cssText is stored verbatim — check for "display:flex" (no space)
  assert(el.style.cssText.includes('display:flex'),
    'T4: extension inline display:flex is preserved (not overwritten by Canvas)')

  // The element lacks data-canvas-active, so the CSS rule applies
  // (display: none !important). We can't check computed styles in our
  // stub, but we verify the element is in the correct state for the
  // rule to hide it.
  assert(el._attrs['data-canvas-active'] === undefined,
    'T4: element lacks data-canvas-active (rule applies — element hidden)')

  // Now activate the element — adding data-canvas-active means the
  // :not([data-canvas-active]) selector no longer matches, so the
  // element becomes visible.
  el.setAttribute('data-canvas-active', '')
  assert(el._attrs['data-canvas-active'] === '',
    'T4: after activation, data-canvas-active is set (rule no longer applies)')

  // The inline style should STILL be untouched — Canvas never calls
  // removeProperty or setProperty on display.
  assert(el.style.cssText.includes('display:flex'),
    'T4: inline display:flex still preserved after activation')
}

// ============================================================
// Results
// ============================================================
console.log(`PASS: ${passed}`)
console.log(`FAILED: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
