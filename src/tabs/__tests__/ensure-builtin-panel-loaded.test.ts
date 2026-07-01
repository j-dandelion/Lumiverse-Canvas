// src/tabs/__tests__/ensure-builtin-panel-loaded.test.ts
//
// Tests for the warm-boot panel-load helper used by the built-in
// branch of assignToSecondary. The helper exists because the Lorebook
// panel's books-list fetch (worldBooksApi.list) is gated on
// `drawerOpen && drawerTab === 'lorebook'` (see WorldBookPanel.tsx:165-178),
// and on warm-boot restore those flags are at their initial false/null
// values — so the panel's useEffect mounts with isVisible=false and
// loadBooks() never fires. The helper triggers loadBooks() by flipping
// drawerOpen=true via the fiber-extracted store snapshot, then restores
// the prior visual state by calling closeDrawer + setDrawerTab(null).
;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(performance.now()), 0)
  return 0
}

import {
  ensureBuiltInTabPanelLoaded,
  type EnsureLoadedHooks,
} from '../assignment'

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

async function main() {
  // T1: Calls openDrawer(tabId) on the snapshot, then closeDrawer + setDrawerTab(null).
  {
    const calls: string[] = []
    const fakeSnap = {
      openDrawer: (tab: string) => { calls.push(`openDrawer(${tab})`) },
      closeDrawer: () => { calls.push('closeDrawer') },
      setDrawerTab: (tab: string | null) => { calls.push(`setDrawerTab(${tab})`) },
    }
    await ensureBuiltInTabPanelLoaded('lorebook', {
      getStoreSnapshot: () => fakeSnap,
    })
    ok(
      calls[0] === 'openDrawer(lorebook)',
      `T1: openDrawer called first, got ${JSON.stringify(calls)}`,
    )
    ok(
      calls.includes('closeDrawer'),
      `T1: closeDrawer called, got ${JSON.stringify(calls)}`,
    )
    ok(
      calls.includes('setDrawerTab(null)'),
      `T1: setDrawerTab(null) called, got ${JSON.stringify(calls)}`,
    )
    ok(
      calls.indexOf('openDrawer(lorebook)') < calls.indexOf('closeDrawer'),
      `T1: openDrawer runs before closeDrawer, got ${JSON.stringify(calls)}`,
    )
  }

  // T2: Calls openDrawer before the first rAF, then closeDrawer + setDrawerTab
  //     between the two rAFs. We track rAF boundaries via a counter to verify
  //     the ordering: store mutations are split across two commits so React
  //     sees two distinct state transitions (one opening, one closing).
  {
    let rafCount = 0
    const rAF = (cb: FrameRequestCallback) => {
      rafCount++
      setTimeout(() => cb(performance.now()), 0)
      return rafCount
    }
    ;(globalThis as any).requestAnimationFrame = rAF

    const calls: string[] = []
    const fakeSnap = {
      openDrawer: (tab: string) => { calls.push(`openDrawer(${tab})`) },
      closeDrawer: () => { calls.push('closeDrawer') },
      setDrawerTab: (tab: string | null) => { calls.push(`setDrawerTab(${tab})`) },
    }
    await ensureBuiltInTabPanelLoaded('lorebook', {
      getStoreSnapshot: () => fakeSnap,
    })
    ok(
      calls.indexOf('openDrawer(lorebook)') < calls.indexOf('closeDrawer'),
      `T2: openDrawer is called before closeDrawer (split across rAFs), got ${JSON.stringify(calls)}`,
    )
    ok(
      calls.indexOf('closeDrawer') - calls.indexOf('openDrawer(lorebook)') === 1,
      `T2: only openDrawer is called before the first rAF, got ${JSON.stringify(calls)}`,
    )
    ok(
      calls.indexOf('setDrawerTab(null)') > calls.indexOf('closeDrawer') ||
        calls.indexOf('setDrawerTab(null)') === calls.indexOf('closeDrawer'),
      `T2: setDrawerTab(null) is called in the second half (after first rAF), got ${JSON.stringify(calls)}`,
    )

    // Restore the simple rAF stub for the next test.
    ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0)
      return 0
    }
  }

  // T3: No-op when the snapshot is null (fiber walker hasn't found the store yet).
  {
    const calls: string[] = []
    await ensureBuiltInTabPanelLoaded('lorebook', {
      getStoreSnapshot: () => null,
    })
    ok(
      calls.length === 0,
      `T3: no store mutations when snapshot is null, got ${JSON.stringify(calls)}`,
    )
  }

  // T4: No-op when openDrawer is missing from the snapshot (unexpected shape).
  {
    const calls: string[] = []
    const fakeSnap = {
      // openDrawer deliberately missing
      closeDrawer: () => { calls.push('closeDrawer') },
      setDrawerTab: (_tab: string | null) => { calls.push('setDrawerTab') },
    } as unknown as { openDrawer: (tab: string) => void }
    await ensureBuiltInTabPanelLoaded('lorebook', {
      getStoreSnapshot: () => fakeSnap,
    })
    ok(
      calls.length === 0,
      `T4: no store mutations when openDrawer is missing, got ${JSON.stringify(calls)}`,
    )
  }

  // T5: dlog breadcrumbs are emitted so the warm-boot path is debuggable.
  {
    const logged: string[] = []
    const fakeSnap = {
      openDrawer: () => {},
      closeDrawer: () => {},
      setDrawerTab: () => {},
    }
    await ensureBuiltInTabPanelLoaded('lorebook', {
      getStoreSnapshot: () => fakeSnap,
      dlog: (...a) => logged.push(a.join(' ')),
    })
    ok(
      logged.some(l => l.includes('ENSURE_LOADED_BEGIN')),
      `T5: emits ENSURE_LOADED_BEGIN breadcrumb, got ${JSON.stringify(logged)}`,
    )
    ok(
      logged.some(l => l.includes('ENSURE_LOADED_DONE')),
      `T5: emits ENSURE_LOADED_DONE breadcrumb, got ${JSON.stringify(logged)}`,
    )
  }

  console.log(`ensure-builtin-panel-loaded: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
