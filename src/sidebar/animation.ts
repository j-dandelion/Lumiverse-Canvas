// JS-based animation for the secondary sidebar wrapper.
// Uses requestAnimationFrame + easeOutCubic (350ms) — no CSS transitions,
// no counter-translate. The wrapper translates, and both the drawerTab
// and drawer (its children) move as one unit.
//
// Extracted from sidebar/secondary.tsx.

const ANIM_DURATION_MS = 350
let _animRaf: number | null = null
let _animStart: number | null = null
let _animFrom = 0
let _animTo = 0

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function animFrame(wrapper: HTMLElement, now: number) {
  if (_animStart === null) _animStart = now
  const elapsed = now - _animStart
  const progress = Math.min(elapsed / ANIM_DURATION_MS, 1)
  const eased = easeOutCubic(progress)

  const val = _animFrom + (_animTo - _animFrom) * eased
  wrapper.style.transform = `translateX(${val}px)`

  if (progress < 1) {
    _animRaf = requestAnimationFrame((t) => animFrame(wrapper, t))
  } else {
    _animRaf = null
    _animStart = null
  }
}

export function animateWrapper(wrapper: HTMLElement, targetPx: number) {
  const current = wrapper
    ? (parseFloat(wrapper.style.transform?.match(/-?[\d.]+/)?.[0] || '0'))
    : 0
  _animFrom = current
  _animTo = targetPx
  _animStart = null
  if (_animRaf !== null) cancelAnimationFrame(_animRaf)
  _animRaf = requestAnimationFrame((t) => animFrame(wrapper, t))
}
