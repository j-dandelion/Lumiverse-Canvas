/**
 * Typed helper for accessing React/Preact fiber internals from DOM elements.
 *
 * React 16+ attaches fiber objects to DOM nodes via keys like
 * `__reactFiber$<random>`. Preact uses `__preactattr_<random>` or
 * attaches props directly. This module centralises the access pattern
 * so callers never need `as any` casts for fiber reads.
 */

/** Known fiber key prefixes (React 16+ and Preact). */
const FIBER_PREFIXES = ['__reactFiber$', '__preact'] as const

/**
 * Find the fiber key on a DOM element (React 16/17/18 or Preact pattern).
 * Returns the full key string (e.g. `"__reactFiber$abc123"`) or null.
 */
export function findFiberKey(el: Element): string | null {
  const key = Object.keys(el).find(k =>
    FIBER_PREFIXES.some(prefix => k.startsWith(prefix))
  )
  return key ?? null
}

/**
 * Retrieve the React/Preact fiber object from a DOM element.
 * Returns a loosely-typed record (fiber tree shape varies across React
 * versions) or null when the element has no attached fiber.
 */
export function getFiberFromElement(el: Element): Record<string, unknown> | null {
  const key = findFiberKey(el)
  if (!key) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fiber = (el as any)[key]
  return fiber != null ? fiber as Record<string, unknown> : null
}
