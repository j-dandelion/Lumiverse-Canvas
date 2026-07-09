// JS-based animation for Canvas drawer wrappers (secondary + main mirror).
// Uses requestAnimationFrame + easeOutCubic (350ms) — no CSS transitions,
// no counter-translate. The wrapper translates, and both the drawerTab
// and drawer (its children) move as one unit.
//
// Per-wrapper state so main and secondary can animate independently.

const ANIM_DURATION_MS = 350

type AnimState = {
  raf: number | null
  start: number | null
  from: number
  to: number
  onComplete: (() => void) | null
}

const _anims = new WeakMap<HTMLElement, AnimState>()

/** Test / cancel-all fallback when a single global cancel is needed. */
let _lastWrapper: HTMLElement | null = null

/** Parse translateX px from an inline transform (0 if absent / none). */
export function parseTranslateX(transform: string | null | undefined): number {
  if (!transform || transform === 'none') return 0
  const m = transform.match(/translateX\(\s*(-?[\d.]+)\s*px\s*\)/)
  if (m) return parseFloat(m[1]) || 0
  // Fallback: first signed number (legacy `translateX(N)` without units in tests).
  const n = transform.match(/-?[\d.]+/)
  return n ? parseFloat(n[0]) || 0 : 0
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function animFrame(wrapper: HTMLElement, state: AnimState, now: number) {
  if (state.start === null) state.start = now
  const elapsed = now - state.start
  const progress = Math.min(elapsed / ANIM_DURATION_MS, 1)
  const eased = easeOutCubic(progress)

  const val = state.from + (state.to - state.from) * eased
  wrapper.style.transform = `translateX(${val}px)`

  if (progress < 1) {
    state.raf = requestAnimationFrame((t) => animFrame(wrapper, state, t))
  } else {
    state.raf = null
    state.start = null
    const done = state.onComplete
    state.onComplete = null
    if (done) {
      try {
        done()
      } catch {
        /* caller errors must not break animation bookkeeping */
      }
    }
  }
}

/** Cancel in-flight rAF for a specific wrapper (or the last animated one). */
export function cancelWrapperAnimation(wrapper?: HTMLElement | null): void {
  const target = wrapper ?? _lastWrapper
  if (!target) return
  const state = _anims.get(target)
  if (state?.raf != null) {
    cancelAnimationFrame(state.raf)
    state.raf = null
    state.start = null
    state.onComplete = null
  }
}

/** Test helper: inspect last wrapper's anim state (or a specific wrapper). */
export function __getAnimState(wrapper?: HTMLElement | null) {
  const target = wrapper ?? _lastWrapper
  if (!target) return { animRaf: null as number | null, animStart: null as number | null }
  const state = _anims.get(target)
  return {
    animRaf: state?.raf ?? null,
    animStart: state?.start ?? null,
  }
}

/**
 * Animate wrapper translateX to targetPx over ANIM_DURATION_MS.
 * Optional onComplete fires once when the animation settles (not on cancel).
 */
export function animateWrapper(
  wrapper: HTMLElement,
  targetPx: number,
  onComplete?: () => void,
): void {
  _lastWrapper = wrapper
  let state = _anims.get(wrapper)
  if (!state) {
    state = { raf: null, start: null, from: 0, to: 0, onComplete: null }
    _anims.set(wrapper, state)
  }
  const current = parseTranslateX(wrapper.style.transform)
  state.from = current
  state.to = targetPx
  state.start = null
  state.onComplete = onComplete ?? null
  if (state.raf !== null) cancelAnimationFrame(state.raf)
  // Already at target — settle immediately so onComplete still runs.
  if (current === targetPx) {
    wrapper.style.transform = `translateX(${targetPx}px)`
    state.raf = null
    const done = state.onComplete
    state.onComplete = null
    if (done) {
      try {
        done()
      } catch {
        /* ignore */
      }
    }
    return
  }
  state.raf = requestAnimationFrame((t) => animFrame(wrapper, state!, t))
}
