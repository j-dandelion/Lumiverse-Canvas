import { beforeEach, afterEach, describe, expect, jest, mock, test } from 'bun:test'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}
const classes = new Set<string>()
let css = ''
let placement = deferred()
let entered = deferred()
let chromeCalls = 0
let drawerCalls = 0
let failSettle = false
let applyWork: Promise<void> | null = null
let guardedDuringApply = false

;(globalThis as any).document = {
  head: { appendChild: (el: { textContent: string }) => { css = el.textContent } },
  documentElement: { classList: {
    add: (...names: string[]) => names.forEach((n) => classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
    contains: (name: string) => classes.has(name),
  } },
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '', remove() {} }),
}
;(globalThis as any).requestAnimationFrame = (cb: (time: number) => void) => { cb(1); return 1 }

mock.module('../../recon/dispatch', () => ({
  bootPlacementDone: () => { entered.resolve(); return placement.promise },
  flush: async () => { if (failSettle) throw new Error('restore failed') },
}))
mock.module('../../sidebar/main-persist', () => ({ waitForMainContentSettled: async () => {} }))
mock.module('../../os/chrome-locations', () => ({ reconcileChromeLocations: () => { chromeCalls++ } }))
mock.module('../../sidebar/drawer-location', () => ({ reconcileDrawerLocation: (opts: { force?: boolean }) => {
  expect(held()).toBe(true)
  expect(opts.force).toBe(true)
  drawerCalls++
} }))
mock.module('../../sidebar/drawer-sync', () => ({ syncDrawerTabSettings: () => {} }))
mock.module('../panel', () => ({ applySettings: () => {
  guardedDuringApply = classes.has('sidebar-ux-mode-switch-pending')
  if (applyWork) trackModeRevealWork(applyWork)
} }))
mock.module('../../layout/snapshot', () => ({ buildPersistedLayout: () => ({}) }))

const { beginModeReveal, finishModeReveal, trackModeRevealWork, deferModeRevealReflow, cancelModeReveal } =
  await import('../mode-reveal')
const { hydrateSettings, setSettings, cancelSettingsSave } = await import('../state')

const os = { osMode: true, taskbarMode: true, moveControlsToOuterEdge: true, drawerLocation: 'sides' as const }
const taskbar = { ...os, osMode: false }
const vanilla = { ...taskbar, taskbarMode: false, moveControlsToOuterEdge: false }
const held = () => classes.has('sidebar-ux-mode-switch-pending')

beforeEach(() => {
  cancelModeReveal()
  classes.clear()
  placement = deferred()
  entered = deferred()
  chromeCalls = 0
  drawerCalls = 0
  failSettle = false
  applyWork = null
  guardedDuringApply = false
})
afterEach(() => { cancelModeReveal(); cancelSettingsSave() })

describe('mode reveal', () => {
  test('OS exit is guarded before synchronous feature apply; waits for restore and placement', async () => {
    hydrateSettings(os)
    const restore = deferred()
    applyWork = restore.promise
    setSettings({ osMode: false, taskbarMode: true, moveControlsToOuterEdge: true })
    expect(guardedDuringApply).toBe(true)
    expect(held()).toBe(true)
    const done = finishModeReveal()
    restore.resolve()
    await entered.promise
    expect(held()).toBe(true)
    expect(chromeCalls).toBe(0)
    placement.resolve()
    await done
    expect(held()).toBe(false)
    expect(chromeCalls).toBe(1)
    expect(drawerCalls).toBe(1)
    expect(classes.has('sidebar-ux-mode-switch-reveal')).toBe(true)
    expect(classes.has('sidebar-ux-mode-switch-strip-change')).toBe(false)
  })

  test('Vanilla exit guards the replacing main strip and host wrapper too', async () => {
    beginModeReveal(os, vanilla)
    expect(classes.has('sidebar-ux-mode-switch-strip-change')).toBe(true)
    expect(css).toContain(':has([data-spindle-mount="sidebar"])')
    expect(css).toContain('prefers-reduced-motion: reduce')
    placement.resolve()
    await finishModeReveal()
    expect(held()).toBe(false)
  })

  test('new work during the settle tail keeps the same guard and applies reflow once', async () => {
    beginModeReveal(os, taskbar)
    let reflows = 0
    const reflow = () => { reflows++; expect(deferModeRevealReflow(reflow)).toBe(false) }
    expect(deferModeRevealReflow(reflow)).toBe(true)
    expect(deferModeRevealReflow(reflow)).toBe(true)
    const done = finishModeReveal()
    await entered.promise
    const next = deferred()
    beginModeReveal(taskbar, os)
    trackModeRevealWork(next.promise)
    placement.resolve()
    await Promise.resolve()
    expect(held()).toBe(true)
    expect(reflows).toBe(0)
    next.resolve()
    await done
    expect(held()).toBe(false)
    expect(chromeCalls).toBe(1)
    expect(reflows).toBe(1)
  })

  test('rejected restore and settle error release the visual guard', async () => {
    beginModeReveal(os, taskbar)
    trackModeRevealWork(Promise.reject(new Error('partial restore')))
    failSettle = true
    placement.resolve()
    await finishModeReveal()
    expect(held()).toBe(false)
    expect(classes.has('sidebar-ux-mode-switch-reveal')).toBe(false)
  })

  test('teardown cancels waiters without reflow; an old tail cannot reveal a newer switch', async () => {
    beginModeReveal(os, vanilla)
    let reflows = 0
    deferModeRevealReflow(() => { reflows++ })
    const old = finishModeReveal()
    await entered.promise
    cancelModeReveal()
    const oldPlacement = placement
    placement = deferred()
    entered = deferred()
    beginModeReveal(vanilla, os)
    const current = finishModeReveal()
    await entered.promise
    oldPlacement.resolve()
    await old
    expect(held()).toBe(true)
    expect(chromeCalls).toBe(0)
    expect(reflows).toBe(0)
    placement.resolve()
    await current
    expect(held()).toBe(false)
    expect(chromeCalls).toBe(1)
  })

  test('unchanged chrome does not acquire a guard', () => {
    beginModeReveal(taskbar, { ...taskbar })
    expect(held()).toBe(false)
    expect(deferModeRevealReflow(() => {})).toBe(false)
  })

  test('a wedged restore is released by the recovery deadline', async () => {
    jest.useFakeTimers()
    try {
      beginModeReveal(os, vanilla)
      trackModeRevealWork(new Promise(() => {}))
      let reflows = 0
      deferModeRevealReflow(() => { reflows++ })
      const done = finishModeReveal()
      jest.advanceTimersByTime(15001)
      await done
      expect(held()).toBe(false)
      expect(reflows).toBe(1)
      expect(classes.has('sidebar-ux-mode-switch-strip-change')).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })
})
