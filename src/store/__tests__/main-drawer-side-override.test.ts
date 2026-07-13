// Tests for main-drawer-side override used by Configure "Swap drawer locations".
// When host DOM still reports the old side, getMainDrawerSide must return the
// intentional desired side until settle clears the override.

import {
  getMainDrawerSide,
  setMainDrawerSideOverride,
  getMainDrawerSideOverride,
  __setStoreSnapshotForTest,
} from '../index'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

/** Ensure a minimal document exists (bun unit tests may lack a DOM). */
function ensureDocument() {
  if (typeof (globalThis as any).document !== 'undefined') return
  ;(globalThis as any).document = {
    querySelector: () => null,
    createElement: () => ({}),
    documentElement: {
      classList: { add() {}, remove() {}, contains() { return false } },
      style: { setProperty() {}, removeProperty() {} },
    },
    body: { appendChild() {}, removeChild() {} },
  }
}

/**
 * getMainWrapper = getMainSidebar()?.closest('[class*="_wrapper_"]').
 * Install a sidebar element whose closest() returns our fake wrapper.
 */
function installMainWrapper(side: 'left' | 'right') {
  ensureDocument()
  const classSet = new Set<string>([
    side === 'left' ? 'wrapperLeft' : 'wrapperRight',
    'wrapperOpen',
    '_wrapper_abc',
  ])
  const wrapper: any = {
    classList: {
      toString() { return [...classSet].join(' ') },
      add(...cs: string[]) { for (const c of cs) classSet.add(c) },
      remove(...cs: string[]) { for (const c of cs) classSet.delete(c) },
      contains(c: string) { return classSet.has(c) },
    },
  }
  const sidebar: any = {
    closest(sel: string) {
      if (typeof sel === 'string' && sel.includes('_wrapper_')) return wrapper
      return null
    },
  }
  const prevQS = document.querySelector ? document.querySelector.bind(document) : null
  ;(document as any).querySelector = (sel: string) => {
    if (sel === '[data-spindle-mount="sidebar"]') return sidebar
    if (prevQS) {
      try { return prevQS(sel) } catch { return null }
    }
    return null
  }
  return {
    setSide(next: 'left' | 'right') {
      classSet.delete('wrapperLeft')
      classSet.delete('wrapperRight')
      classSet.add(next === 'left' ? 'wrapperLeft' : 'wrapperRight')
    },
    clearQuery() {
      ;(document as any).querySelector = prevQS || (() => null)
    },
  }
}

// ── S1: override wins over DOM ──
{
  setMainDrawerSideOverride(null)
  __setStoreSnapshotForTest(null)
  const { setSide, clearQuery } = installMainWrapper('right')
  setSide('right')

  assertEqual(getMainDrawerSide(), 'right', 'S1: DOM reports right without override')

  setMainDrawerSideOverride('left')
  assertEqual(getMainDrawerSideOverride(), 'left', 'S1: override stored as left')
  assertEqual(
    getMainDrawerSide(),
    'left',
    'S1: getMainDrawerSide returns desired left while DOM still right',
  )

  setSide('right')
  assertEqual(getMainDrawerSide(), 'left', 'S1: override still wins after DOM re-read')

  setMainDrawerSideOverride(null)
  assertEqual(getMainDrawerSide(), 'right', 'S1: after clear, DOM right again')
  clearQuery()
}

// ── S2: override null does not affect store fallback ──
{
  ensureDocument()
  setMainDrawerSideOverride(null)
  const prevQS = document.querySelector.bind(document)
  ;(document as any).querySelector = () => null
  __setStoreSnapshotForTest({
    drawerSettings: { side: 'left' },
  })
  assertEqual(getMainDrawerSide(), 'left', 'S2: store fallback left with no override')

  setMainDrawerSideOverride('right')
  assertEqual(getMainDrawerSide(), 'right', 'S2: override right beats store left')
  setMainDrawerSideOverride(null)
  __setStoreSnapshotForTest(null)
  ;(document as any).querySelector = prevQS
}

// ── S3: settle-style: when DOM catches up, clear override → DOM side ──
{
  setMainDrawerSideOverride(null)
  __setStoreSnapshotForTest(null)
  const { setSide, clearQuery } = installMainWrapper('right')

  setMainDrawerSideOverride('left')
  assertEqual(getMainDrawerSide(), 'left', 'S3: before DOM flip, override left')

  setSide('left')
  setMainDrawerSideOverride(null)
  assertEqual(getMainDrawerSide(), 'left', 'S3: after settle clear, DOM left')
  clearQuery()
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
