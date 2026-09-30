// Hierarchical two-chain arbiter for layout mode transitions (plan A-new).
//
// Two promise chains, NO shared lock: a naive single shared lock deadlocks
// the mobile force — `runOsEnable` → `syncOsMobileDrawerMode` →
// `requestSecondDrawerMode` would queue on the very lock the OS run holds and
// the OS run would await that queue forever. The hierarchy fixes it:
//
//   lock order:  OS chain  ⊃  drawer chain
//   runOsTransition(fn)          — runs fn after prior OS transitions AND
//                                  holds the DRAWER chain for fn's whole
//                                  duration, so an external drawer request
//                                  queues behind the OS run.
//   runDrawerTransition(fn)      — runs fn after prior drawer transitions.
//                                  Drawer runs never wait on the OS chain.
//   runNestedDrawerTransition(fn)— runs fn INLINE: the caller is inside
//                                  runOsTransition's fn and already holds the
//                                  drawer chain; queueing would self-deadlock.
//
// Chain updates swallow rejections (`_chain = run.then(noop, noop)` style) so
// one failing transition can never wedge the chain for later work; the
// original promise returned to the caller still reflects the outcome.
//
// Leaf module: deliberately imports NOTHING from sidebar/panel/registry (or
// anywhere else) — both os-mode and second-drawer-mode import it, so any
// dependency there would risk an import cycle.

const noop = (): void => {}

let _osChain: Promise<unknown> = Promise.resolve()
let _drawerChain: Promise<unknown> = Promise.resolve()

// ── Mode-switch commit barrier (deep-review H1) ──────────────────────────
// While a drawer/OS mode switch owns the model (snapshot → restore window),
// Configure/DnD commits must NOT land: a stale pre-switch draft re-applied
// onto the just-restored model re-imposes the old arrangement (and the next
// persist makes it durable). `commitDraftToOwnedModel` refuses while the
// barrier is up and reports `superseded`; the switch's terminal
// `refreshConfigureDraftFromLive` then installs a fresh draft/base.
// Nested switches (the OS run's mobile-force drawer switch) stack one depth
// counter — the outermost `withModeSwitchBarrier` owns the drain.
//
// Barrier-only state: configure-modal is imported LAZILY inside
// `withModeSwitchBarrier` so this module stays import-cycle-free.

let _modeSwitchBarrierDepth = 0

export function beginModeSwitchBarrier(): void {
  _modeSwitchBarrierDepth++
}

export function endModeSwitchBarrier(): void {
  if (_modeSwitchBarrierDepth > 0) _modeSwitchBarrierDepth--
}

export function isModeSwitchBarrierActive(): boolean {
  return _modeSwitchBarrierDepth > 0
}

/**
 * Run `fn` as one mode-switch unit: drain Configure commits onto the
 * PRE-switch model first (skipped when an outer barrier already owns the
 * model — the outermost switch's drain covers the whole run), freeze commit
 * application across `fn`, unfreeze after `fn` (whose tail must end with
 * `refreshConfigureDraftFromLive`, which rebuilds draft+base from live).
 */
export async function withModeSwitchBarrier<T>(fn: () => Promise<T>): Promise<T> {
  const nested = isModeSwitchBarrierActive()
  if (!nested) {
    try {
      const m = await import('../tabs/configure-modal')
      if (m.isConfigureTabsModalOpen()) {
        await m.flushConfigureCommits()
      }
    } catch {
      // Best-effort drain — never block the switch on a modal failure (A4).
    }
  }
  beginModeSwitchBarrier()
  try {
    return await fn()
  } finally {
    endModeSwitchBarrier()
  }
}

/**
 * Serialize an OS slot transition: runs after prior OS transitions and holds
 * the drawer chain for its whole duration (external drawer requests queue
 * behind it). See the lock-hierarchy note in the file header.
 */
export function runOsTransition<T>(fn: () => Promise<T>): Promise<T> {
  const result: Promise<T> = _osChain.then(() => runDrawerTransition(fn))
  _osChain = result.then(noop, noop)
  return result
}

/**
 * Serialize a drawer (second-sidebar mode) transition: runs after prior
 * drawer transitions. Never waits on the OS chain (no deadlock).
 */
export function runDrawerTransition<T>(fn: () => Promise<T>): Promise<T> {
  const result: Promise<T> = _drawerChain.then(fn)
  _drawerChain = result.then(noop, noop)
  return result
}

/**
 * Re-entrant drawer entry for code ALREADY inside `runOsTransition`'s fn
 * (which holds the drawer chain): executes `fn` inline instead of queueing —
 * queueing here would deadlock against the held chain (mobile force path:
 * runOsEnable → syncOsMobileDrawerMode → requestSecondDrawerMode).
 * Do NOT call from outside an OS transition.
 */
export function runNestedDrawerTransition<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(fn())
  } catch (err) {
    return Promise.reject(err)
  }
}
