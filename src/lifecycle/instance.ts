// Extension instance lifecycle (LUMI-21).
//
// The host tears Canvas down by running the setup() teardown chain. Async
// continuations armed while the instance was live — lazy `import()` thens,
// debounced syncs, post-await host writes — can still fire AFTER teardown
// completed and re-apply Canvas state onto the restored vanilla UI
// (LUMI-21: a post-teardown hidden-sync re-hid the host tab strip after
// disable, and a stale Canvas hidden set fed the re-enabled session).
//
// Pattern: capture `const gen = currentLifecycleGeneration()` when arming a
// continuation; at fire time no-op unless `isLifecycleCurrent(gen)` — the
// arming instance is still the current one AND has not been torn down.
// Boot continuations share the boot generation and see the instance active,
// so boot restore is unaffected.
//
// Generation 0 (no setup() has ever run — unit-test harnesses and bare
// module-eval contexts) keeps the legacy always-current behavior: those
// environments have no lifecycle, and production never fires continuations
// before setup().

let _generation = 0
let _active = false

/**
 * Begin a new setup() instance: bumps the generation and marks it active.
 * Returns the new generation (setup() uses it as its instance identity).
 */
export function beginLifecycle(): number {
  _generation++
  _active = true
  return _generation
}

/**
 * Mark the given generation torn down (setup teardown ran). No-ops for a
 * stale generation that a newer setup() already superseded — mirrors
 * setup()'s stale-teardown guard so a superseding instance's active state
 * is never cleared by the old teardown.
 */
export function endLifecycle(generation: number): void {
  if (generation !== _generation) return
  _active = false
}

/** Generation of the current (or most recent) setup() instance. */
export function currentLifecycleGeneration(): number {
  return _generation
}

/** True while the current setup() instance is live (boot or steady state). */
export function isInstanceActive(): boolean {
  return _generation === 0 || _active
}

/**
 * True when the instance that armed an async continuation is still the
 * live, un-torn-down one. The single guard for post-teardown continuations.
 */
export function isLifecycleCurrent(generation: number): boolean {
  return generation === _generation && (_generation === 0 || _active)
}
