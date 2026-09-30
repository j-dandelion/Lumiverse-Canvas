// Chrome-side resolution for the drawer-location settings
// (`optionsButtonLocation`, `startButtonLocation`).
//
// Both settings store literal screen sides ('left' | 'right' | 'both') with
// `null` meaning "main drawer only" (the pre-setting behavior). The main
// drawer's side is user-swappable, so resolution needs the live main side and
// whether the second drawer exists.
//
// Leaf module (no imports) so os/start-menu.ts, sidebar/settings-dock.ts and
// the settings panel can share one definition without cycles.

// Leaf module: the only import is TYPE-ONLY (erased at runtime), so this
// stays runtime-dependency-free for cycle safety.

import type { ChromeSideValue } from '../types'

export type { ChromeSideValue }

export interface ResolvedChromeSides {
  /** Drawer sides that host the chrome, in left→right order. */
  sides: Array<'left' | 'right'>
  /** Main drawer included. */
  main: boolean
  /** Second drawer included (never true when the second drawer is disabled). */
  second: boolean
}

/**
 * Resolve a stored location value into the drawer roles that should host the
 * chrome.
 *
 * - `null` → main only (default; preserves behavior for blobs without the key)
 * - `'both'` → main + second (second only when enabled)
 * - `'left' | 'right'` → whichever of the two drawers sits on that screen
 *   side; when that side has no drawer (single-drawer mode), fall back to the
 *   main drawer so the chrome never becomes unreachable.
 *
 * The result is never empty.
 */
export function resolveChromeSides(
  value: ChromeSideValue,
  mainSide: 'left' | 'right',
  secondEnabled: boolean,
): ResolvedChromeSides {
  const secondSide = mainSide === 'left' ? 'right' : 'left'

  if (value === 'both') {
    return {
      sides: secondEnabled ? [mainSide, secondSide] : [mainSide],
      main: true,
      second: secondEnabled,
    }
  }

  if (value === 'left' || value === 'right') {
    if (value === mainSide) return { sides: [mainSide], main: true, second: false }
    if (secondEnabled) return { sides: [secondSide], main: false, second: true }
    // Requested side has no drawer open (single-drawer mode) — keep the
    // chrome on the main drawer instead of stranding it.
    return { sides: [mainSide], main: true, second: false }
  }

  return { sides: [mainSide], main: true, second: false }
}

/** True when `side` is in the resolved set. */
export function isChromeSideIncluded(
  value: ChromeSideValue,
  side: 'left' | 'right',
  mainSide: 'left' | 'right',
  secondEnabled: boolean,
): boolean {
  return resolveChromeSides(value, mainSide, secondEnabled).sides.includes(side)
}

/**
 * The value to display as "selected" in the panel. `null` renders as the main
 * drawer's current side (role-based behavior shown with literal-side labels).
 * `'both'` stays `'both'`.
 */
export function displayChromeSide(
  value: ChromeSideValue,
  mainSide: 'left' | 'right',
): 'left' | 'right' | 'both' {
  if (value === 'both') return 'both'
  if (value === 'left' || value === 'right') return value
  return mainSide
}
