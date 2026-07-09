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
}

const _anims = new WeakMap<HTMLElement, AnimState>()

/** Test / cancel-all fallback when a single global cancel is needed. */
let _lastWrapper: HTMLElement | null = null

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

export function animateWrapper(wrapper: HTMLElement, targetPx: number) {
  _lastWrapper = wrapper
  let state = _anims.get(wrapper)
  if (!state) {
    state = { raf: null, start: null, from: 0, to: 0 }
    _anims.set(wrapper, state)
  }
  const current = wrapper
    ? (parseFloat(wrapper.style.transform?.match(/-?[\d.]+/)?.[0] || '0'))
    : 0
  state.from = current
  state.to = targetPx
  state.start = null
  if (state.raf !== null) cancelAnimationFrame(state.raf)
  state.raf = requestAnimationFrame((t) => animFrame(wrapper, state!, t))
}
