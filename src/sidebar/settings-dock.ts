// Options (Settings gear) location — mirrors the host Settings button into
// the drawer(s) selected by `optionsButtonLocation`.
//
// The main drawer's gear is rendered by main-renderer.ts (model-keyed mirror
// strip, bottom dock). This module only SHOWS/HIDES it and owns the secondary
// clone. The clone lives in the SAME shared secondary dock as the OS Start
// button (SECONDARY_START_DOCK_CLASS) — never a second dock: the one-dock
// last-child invariant is load-bearing for tab ordering and the divider
// (docs/pitfalls.md).
//
// The clone must classify as SETTINGS chrome, never as a tab:
//   - literal `tabBtnSettings` class → isSettingsButton() true (buttons.ts)
//   - NEVER a `data-tab-id`
// so live-tab-order/DnD/count writers skip it.
//
// Leaf-ish by design: imports main-renderer (twin lookup + mirror key) and
// the two shell accessors. No settings/registry imports.

import { injectStyles } from '../debug/styles'
import { dwarn } from '../debug/log'
import { SECONDARY_START_DOCK_CLASS } from '../tabs/secondary-start-dock'
import { getMainMirrorWrapper } from './main-mirror-drawer'
import { getSecondaryTabList } from './secondary'
import { findSettingsTwin, SETTINGS_MIRROR_KEY } from './main-renderer'
import type { ResolvedChromeSides } from './chrome-sides'
import { callHostStoreAction } from '../store'

const STYLE_ID = 'sidebar-ux-settings-dock-styles'
const TAB_LIST_BOTTOM_CLASS = 'sidebar-ux-tab-list-bottom'
/** Present on each settings gear (main mirror + secondary clone). */
const GEAR_ATTR = 'data-canvas-settings-gear'
/** Hides one gear (literal-side exclusion). */
const GEAR_HIDDEN_CLASS = 'sidebar-ux-options-hidden'
/** Collapses a bottom dock whose every child is hidden. */
const DOCK_EMPTY_CLASS = 'sidebar-ux-dock-empty'
const START_ATTR = 'data-canvas-os-start'

/** Built-in fallback glyph when the host twin is unavailable (lucide gear). */
const FALLBACK_GEAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>'

const SETTINGS_DOCK_CSS = `
  .sidebar-ux-tab-list button[data-canvas-settings-gear] {
    width: 100%;
    height: 48px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 0;
    box-sizing: border-box;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--lumiverse-text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .sidebar-ux-tab-list button[data-canvas-settings-gear]:hover {
    background: var(--lumiverse-primary-015);
    color: var(--lumiverse-text);
  }
  .sidebar-ux-tab-list button[data-canvas-settings-gear]:focus-visible {
    outline: 2px solid var(--lumiverse-primary);
    outline-offset: -2px;
    border-radius: 8px;
  }
  .sidebar-ux-tab-list button[data-canvas-settings-gear] > svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
  /* Horizontal strips: square, same size as tab buttons (the base width:100%
     would stretch the flex row). */
  [data-strip-axis="horizontal"] .sidebar-ux-tab-list button[data-canvas-settings-gear] {
    width: 48px !important;
    height: 48px !important;
    min-width: 48px !important;
  }
  /* Literal-side exclusion (main drawer gear is renderer-owned). */
  button[${GEAR_ATTR}].sidebar-ux-options-hidden,
  button[data-mirror-key="${SETTINGS_MIRROR_KEY}"].sidebar-ux-options-hidden {
    display: none !important;
  }
  /* A bottom dock whose only children are hidden must not paint its divider. */
  .sidebar-ux-tab-list-bottom.sidebar-ux-dock-empty {
    display: none !important;
  }
`

// ── Main drawer gear ─────────────────────────────────────────────────────────

/** All settings-gear buttons in the main mirror (strip + pinned hosts). */
function getMainGears(): HTMLElement[] {
  try {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return []
    return Array.from(
      document.querySelectorAll(
        `button[data-mirror-key="${SETTINGS_MIRROR_KEY}"], button[${GEAR_ATTR}="main"]`,
      ),
    ) as HTMLElement[]
  } catch {
    return []
  }
}

/**
 * Show/hide the main drawer's gear + collapse its bottom dock when nothing
 * visible remains in it (the Start button may keep the dock alive in OS mode).
 */
export function refreshMainDockEmptyState(): void {
  try {
    const wrapper = getMainMirrorWrapper()
    if (!wrapper || typeof wrapper.querySelectorAll !== 'function') return
    const gearHidden = getMainGears().some((g) => g.classList.contains(GEAR_HIDDEN_CLASS))
    const list = wrapper.querySelector('.sidebar-ux-tab-list')
    const dock =
      (list?.querySelector(`.${TAB_LIST_BOTTOM_CLASS}`) as HTMLElement | null)
      ?? (wrapper.querySelector(`.${TAB_LIST_BOTTOM_CLASS}`) as HTMLElement | null)
    if (!dock) return
    const hasStart =
      typeof dock.querySelector === 'function' && !!dock.querySelector(`button[${START_ATTR}]`)
    dock.classList.toggle(DOCK_EMPTY_CLASS, gearHidden && !hasStart)
  } catch {
    /* shell may be mid-remount */
  }
}

function applyMainGear(include: boolean): void {
  for (const gear of getMainGears()) {
    // Main-mirror gear identity: give it the shared attr so CSS and tests have
    // one hook regardless of which surface rendered it.
    if (!gear.hasAttribute(GEAR_ATTR)) gear.setAttribute(GEAR_ATTR, 'main')
    gear.classList.toggle(GEAR_HIDDEN_CLASS, !include)
  }
  refreshMainDockEmptyState()
}

// ── Secondary drawer gear ────────────────────────────────────────────────────

function buildSecondaryGear(): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'tabBtnSettings'
  btn.setAttribute(GEAR_ATTR, 'secondary')
  btn.setAttribute('title', 'Settings')
  btn.setAttribute('aria-label', 'Settings')
  const svg = findSettingsTwin()?.querySelector('svg')?.outerHTML
  btn.innerHTML = svg || FALLBACK_GEAR_SVG
  btn.addEventListener('click', () => {
    const twin = findSettingsTwin()
    if (twin && typeof twin.click === 'function') {
      twin.click()
      return
    }
    // Fiber bridge may be mid-remount — try the host store action. The host
    // signature is openSettings(view?, target?) and both params are optional.
    try {
      callHostStoreAction('openSettings')
    } catch (err) {
      dwarn('[settings-dock] openSettings fallback failed:', err)
    }
  })
  return btn
}

/**
 * Ensure/remove the secondary gear in the shared dock. Idempotent.
 * The dock is created on demand and left last (same self-heal as the Start
 * ensure); it is removed only when nothing (gear or Start) remains.
 */
function applySecondaryGear(include: boolean): void {
  const list = getSecondaryTabList()
  if (!list) {
    // No live list (second drawer disabled/remounting): clean any pinned
    // orphans document-wide so a hidden gear cannot float on a dead host.
    if (!include) {
      for (const gear of Array.from(document.querySelectorAll(`button[${GEAR_ATTR}="secondary"]`))) {
        gear.remove()
      }
      removeEmptySecondaryDocks()
    }
    return
  }
  let dock = list.querySelector(`:scope > .${SECONDARY_START_DOCK_CLASS}`) as HTMLElement | null
  if (include && !dock) {
    dock = document.createElement('div')
    dock.className = `${TAB_LIST_BOTTOM_CLASS} ${SECONDARY_START_DOCK_CLASS}`
    list.appendChild(dock)
  }
  if (dock) {
    let gear = dock.querySelector(`button[${GEAR_ATTR}="secondary"]`) as HTMLButtonElement | null
    if (include && !gear) {
      gear = buildSecondaryGear()
      dock.appendChild(gear)
    } else if (!include && gear) {
      gear.remove()
    }
    // Self-heal: keep the shared dock last (tab writers insert before it).
    if (dock.nextElementSibling) list.appendChild(dock)
  }
  if (!include) removeEmptySecondaryDocks()
}

function removeEmptySecondaryDocks(): void {
  for (const dock of Array.from(document.querySelectorAll(`.${SECONDARY_START_DOCK_CLASS}`))) {
    if (!dock.firstElementChild) dock.remove()
  }
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * Apply the resolved Options-gear location. Called from
 * `reconcileChromeLocations` (os/chrome-locations.ts) on setting diffs and on
 * every chrome lifecycle event (mount, shell-created, side flip, second-drawer
 * disable, location change).
 */
export function applyOptionsButtonLocation(resolved: ResolvedChromeSides): void {
  try {
    injectStyles(STYLE_ID, SETTINGS_DOCK_CSS)
  } catch (err) {
    dwarn('[settings-dock] style injection failed:', err)
  }
  try {
    applyMainGear(resolved.main)
    applySecondaryGear(resolved.second)
  } catch (err) {
    dwarn('[settings-dock] apply failed:', err)
  }
}

/** Teardown: remove the secondary clone (+ empty docks) and un-hide the main
 *  gear so the renderer-owned state is clean for the next mount. */
export function teardownSettingsDock(): void {
  for (const gear of Array.from(document.querySelectorAll(`button[${GEAR_ATTR}="secondary"]`))) {
    gear.remove()
  }
  removeEmptySecondaryDocks()
  for (const gear of getMainGears()) {
    gear.classList.remove(GEAR_HIDDEN_CLASS)
  }
  refreshMainDockEmptyState()
  try {
    document.getElementById(STYLE_ID)?.remove()
  } catch {
    /* ignore */
  }
}
