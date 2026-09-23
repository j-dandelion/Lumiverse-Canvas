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
