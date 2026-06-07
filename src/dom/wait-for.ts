import { dwarn } from '../debug/log'

// Maximum rAF iterations before giving up (~5 seconds at 60fps).
const MAX_WAIT_FRAMES = 300

/**
 * Poll via requestAnimationFrame until `getElement()` returns a truthy value
 * or `maxFrames` iterations (~5s) elapse. Returns the element or null on
 * timeout. Used by waitForWrapper (reflow) and waitForSidebar (tagger).
 */
export function waitForElement<T>(
  getElement: () => T | null,
  label: string,
  maxFrames = MAX_WAIT_FRAMES,
): Promise<T | null> {
  let attempts = 0
  return new Promise<T | null>((resolve) => {
    const check = () => {
      const el = getElement()
      if (el) {
        resolve(el)
        return
      }
      if (++attempts > maxFrames) {
        dwarn(`waitForElement: ${label} not found after ${maxFrames} frames (~5s), giving up`)
        resolve(null)
        return
      }
      requestAnimationFrame(check)
    }
    check()
  })
}
