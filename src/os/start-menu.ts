/**
 * OS-mode Start menu (spec D6/D10/D18/D19, §2.4).
 *
 * Per-drawer launcher chrome while OS mode is on:
 *   - a **Start button** styled after the Options dock chrome, injected per
 *     strip: Sides mode → the main mirror's bottom dock BENEATH the settings
 *     button (D10), the secondary strip's end; Top/Bottom mode → the OUTER
 *     (screen-edge) end of each strip via CSS `order` (the S8 #3 dock-order
 *     trick — single geometry authority stays in tab-position.ts). The
 *     secondary Start button is placed by the `startButtonLocation` setting
 *     (default off): the main drawer's Start menu still lists every window
 *     from both drawers, so the secondary chrome is a convenience, never the
 *     only return path.
 *   - the **menu**: the full tab inventory — BOTH drawers, closed tabs
 *     included — alphabetized by title (case-insensitive) with a state
 *     mark (D18 direction: filled dot = open, hollow circle = minimized, no
 *     mark = closed) and the tab's icon. Clicking LAUNCHES into the invoking
 *     drawer (the menu's own side is authoritative, user direction
 *     2026-09-16): closed → launch fresh, minimized → restore, open → focus;
 *     the window moves to the invoking drawer when needed and, unless its
 *     button was already there, lands at that drawer's launch end (middle-
 *     facing end in Top/Bottom). A Configure-hidden tab is un-hidden first so
 *     its strip button returns (D19 auto-opens a closed target drawer).
 *
 * MENU vs STRIP visibility (LUMI-16b, member decision 2026-09-28): the
 * manage checkbox toggles the model's START-MENU-ONLY set (`menuHidden`) —
 * hiding/unhiding from the menu changes ONLY the menu's listing and never
 * the strips. Strip visibility stays owned by the window lifecycle
 * (`closed`/active) and Configure Tabs' `hidden` set; the launch path clears
 * BOTH sets for the launched window (a launched panel re-enters the menu's
 * normal list, and a Configure-hidden target still needs its button back).
 *
 * Lifecycle: ONE menu open at a time across drawers; Escape or click-outside
 * dismisses; entries derive on every open (never stale). The menu anchors
 * to the invoking button's viewport rect, opening away from the screen edge
 * with viewport clamping (§4.4.3).
 *
 * Motion (§4.4.3): the surface scales about the invoking button's center (an
 * external transform-origin) while fading — grows out of the button on open,
 * collapses back into it on close. Interruptible: a close mid-open continues
 * from the captured visual state instead of popping. Reduced-motion / no-WAAPI
 * environments take the instant path. The menu is a <body> child under the
 * host UI zoom, so every rendered rect is converted to layout px (see
 * start-menu-motion.ts for the coordinate contract).
 */

import type { Side, TabKey } from '../core/model'
import { parseBuiltinKey } from '../core/model'
import { humanTabTitleForKey } from '../tabs/configure-catalog'
import { getLayoutOwnedTabTitle } from '../persist/layout-model'
import { getModel, getHost, dispatchBatch } from '../recon/dispatch'
import { getDrawerTabs, getMainDrawerSide, type DrawerTab } from '../store'
import { getMainWrapper } from '../dom/lumiverse'
import { getSettings, isOsModeEnabled } from '../settings/state'
import { isStartAtStripTopGate } from './start-strip-top-gate'
import { resolveChromeSides } from '../sidebar/chrome-sides'
import { openWindowInDrawerByLiveId } from './actions'
import { getSecondaryTabList, getSecondaryWrapper, isSecondarySidebarOpen } from '../sidebar/secondary'
import { DRAWER_SHELL_CREATED_EVENT } from '../sidebar/drawer-shell'
import { SECONDARY_START_DOCK_CLASS } from '../tabs/secondary-start-dock'
import { START_STRIP_TOP_DIVIDER_CLASS } from '../sidebar/styles'
import { BUILTIN_ICON_SVGS } from '../tabs/builtin-icons'
import { isCoreTabId } from '../tabs/core-tabs'
import { injectStartMenuStyles, START_MENU_STYLE_ID } from './start-menu-styles'
import { dlog } from '../debug/log'
import {
  canAnimateMenu,
  captureMenuVisualState,
  computeGrowthOrigin,
  getUiScale,
  playMenuIn,
  playMenuOut,
  prefersReducedMotion,
} from './start-menu-motion'

const START_ATTR = 'data-canvas-os-start'
/** Which drawer owns a Start button (`primary` | `secondary`). Stamped on
 *  every ensure so a per-side removal sweep can never take the other side's
 *  button (pinned lists live outside the shell wrappers). */
const START_SIDE_ATTR = 'data-canvas-start-side'
const MENU_ID = 'canvas-os-start-menu'
/** Secondary Start dock: carries the main-drawer dock chrome (divider + 8px
 *  gap + bottom anchor) so the separator is owned by the container, not the
 *  button. Must stay the LAST child of the secondary tab list — tab writers
 *  insert before it via the shared leaf helper. */
const TAB_LIST_BOTTOM_CLASS = 'sidebar-ux-tab-list-bottom'

let _menu: HTMLElement | null = null
let _menuOpenFor: Side | null = null
/** Invoking button — the close animation's anchor. Cleared on hide. */
let _menuButton: HTMLElement | null = null
/** Pending position rAF (identity-guarded against a superseded open). */
let _menuRaf = 0
/** Open-animation handle (cancelled when a close starts). */
let _menuAnim: Animation | null = null
/** False until the position rAF reveals the menu (hide-before-reveal → instant). */
let _menuRevealed = false
/** In-flight close: the menu stays in the DOM while it animates out. */
let _closing: { menu: HTMLElement; anim: Animation | null } | null = null
let _buttonRaf = 0
let _unsubDocListeners: (() => void) | null = null
/** Manage (eye) mode: transient per menu-open. The eye button in the header
 *  toggles it; closing the menu resets it so the next open is NORMAL view. */
let _manageMode = false

// ── Entry derivation (pure, exported for tests) ──────────────────────────────

export interface StartMenuEntry {
  /** Live tab id (the window-state actions' keying). */
  liveId: string
  /** The tab's own drawer — inventory metadata. The click LAUNCHES into the
   *  invoking menu's drawer, not this one. */
  side: Side
  title: string
  iconSvg?: string
  iconUrl?: string
  state: 'open' | 'minimized' | 'closed'
  /** MENU-hidden per the model's START-MENU-only `menuHidden` set (LUMI-16b)
   *  — NOT the strip `hidden` set. NORMAL projection emits only
   *  `menuHidden: false` entries; MANAGE projection carries both, driving the
   *  dimmed row + checkbox state. A menu-hidden row's state mark still
   *  reflects the WINDOW lifecycle (an open window shows the open mark even while
   *  menu-hidden — the strips never react to this set). */
  menuHidden: boolean
  /** The model TabKey the entry was resolved from — the setHidden intent's
   *  keying (the toggle path dispatches by key, never by liveId). */
  key: string
  /** Core hide-locked (CORE_HIDE_LOCKED): the manage-mode checkbox is
   *  disabled unless the `coreTabsHidden` setting is on — the Configure
   *  Tabs rule, mirrored here. */
  locked: boolean
}

// ── Icon resolution (fixes the empty-icon bug) ───────────────────────────────

/** Canvas's placeholder for icon-less extension tabs (strip fallback). */
function isPlaceholderIcon(svg: Element): boolean {
  return (
    svg.classList.contains('lucide-puzzle') ||
    svg.classList.contains('canvas-puzzle')
  )
}

/**
 * Clone the live tab button's icon. The observer facade zeroes the store's
 * `iconSvg` (`src/store/index.ts`), so the rendered button is the primary
 * source — and the host-sanitized one. Placeholder puzzle glyphs count as a
 * miss so the monogram fallback stays reachable.
 */
export function extractButtonIcon(
  root?: HTMLElement | null,
): { svg?: string; url?: string } {
  if (!root || typeof root.querySelector !== 'function') return {}
  const svg = root.querySelector('svg')
  if (svg && !isPlaceholderIcon(svg)) return { svg: svg.outerHTML }
  const url = root.querySelector('img')?.getAttribute('src') ?? undefined
  return url ? { url } : {}
}

/** `profile:2` → `profile`; extension addresses (`ext:foo`) pass through. */
export function builtinBaseId(liveId: string): string {
  return liveId.replace(/:\d+$/, '')
}

/** First code point of a title, uppercased — the monogram fallback. */
export function entryMonogram(title: string): string {
  const first = Array.from(title.trim())[0]
  return first ? first.toUpperCase() : '?'
}

/**
 * Per-entry icon resolution order (plan §3.5): live button → store fields →
 * built-in map. An empty result means the render-time monogram is used.
 */
export function resolveEntryIcon(
  tab: { iconSvg?: string; iconUrl?: string; root?: HTMLElement | null } | undefined,
  liveId: string,
): { svg?: string; url?: string } {
  const dom = extractButtonIcon(tab?.root)
  if (dom.svg) return { svg: dom.svg }
  if (dom.url) return { url: dom.url }
  if (tab?.iconSvg) return { svg: tab.iconSvg }
  if (tab?.iconUrl) return { url: tab.iconUrl }
  const builtin = BUILTIN_ICON_SVGS[builtinBaseId(liveId)]
  return builtin ? { svg: builtin } : {}
}

/**
 * Derive the Start menu entries for one projection mode.
 *
 * Visibility here is the START-MENU-ONLY set (`model.menuHidden`, LUMI-16b)
 * — NOT the strip `hidden` set. NORMAL mode (the default launch surface):
 * every menu-visible tab of BOTH drawers — closed included, menu-hidden
 * EXCLUDED — alphabetized by title (case-insensitive, stable tie-break on
 * liveId). Un-hiding is the manage (eye) mode's job, not a launch action, so
 * menu-hidden tabs do not occupy launch rows; the manage projection below is
 * the recovery path.
 *
 * MANAGE mode: the same inventory WITH the menu-hidden tabs re-listed
 * (dimmed, checkbox rows — the Configure Tabs precedent), so menu-hidden
 * tabs stay reachable.
 *
 * The inventory is drawer-agnostic (both Start buttons list every window)
 * but the LAUNCH is not: each entry opens in the invoking menu's drawer, and
 * a window whose button was not already there lands at that drawer's launch
 * end (`openWindowInDrawerByLiveId`). The state mark ALWAYS reflects the
 * WINDOW lifecycle (open/minimized/closed) — even for a menu-hidden row,
 * because the menu-hidden set never touches the strips: an open window keeps
 * its button (and its open mark) while menu-hidden. Unresolvable extension keys
 * are skipped (they cannot open this session).
 *
 * Pure over its inputs: the tab inventory is a PARAMETER (no module-global
 * `getDrawerTabs()` read inside the body — the default argument only wires
 * the production caller), so both projections are testable.
 */
export function deriveStartMenuEntries(
  model: {
    primary: readonly string[]
    secondary: readonly string[]
    hidden: readonly string[]
    menuHidden: readonly string[]
    closed: readonly string[]
    active: { primary: string | null; secondary: string | null }
  },
  resolve: (key: string) => string | null,
  tabs: readonly DrawerTab[] = getDrawerTabs(),
  opts: { manageMode?: boolean } = {},
): StartMenuEntry[] {
  const manageMode = opts.manageMode ?? false
  // One scan for titles/icons (was a per-key find).
  const tabsById = new Map(tabs.map((t) => [t.id, t]))
  const seen = new Set<string>()
  const out: StartMenuEntry[] = []
  for (const side of ['primary', 'secondary'] as const) {
    const keys = side === 'primary' ? model.primary : model.secondary
    const activeKey = model.active[side]
    for (const key of keys) {
      const liveId = resolve(key)
      if (!liveId || seen.has(liveId)) continue
      seen.add(liveId)
      // MENU-hidden (LUMI-16b): the Start-menu-only set. The strip `hidden`
      // set is deliberately NOT consulted here — strip visibility is not a
      // menu concern.
      const isMenuHidden = model.menuHidden.includes(key)
      // NORMAL view drops menu-hidden rows (manage mode is their recovery
      // path).
      if (isMenuHidden && !manageMode) continue
      // The state mark is the WINDOW lifecycle only: a menu-hidden tab can
      // still be open (button on the strip) or minimized — 'closed' comes
      // from model.closed membership alone.
      const state = model.closed.includes(key)
        ? 'closed'
        : key === activeKey ? 'open' : 'minimized'
      const tab = tabsById.get(liveId)
      // LUMI-26 Amendment 2: launchable windows only, in BOTH projections —
      // a listed row's launch must resolve. A resolved live id with no
      // drawer-inventory backing is fabricated (builtin identity
      // passthrough) or stale — the host does not back this tab, so there
      // is no window to launch/focus; closed unbacked rows would be dead
      // controls (`openWindowInDrawerByLiveId` no-ops on the findKey miss).
      // Closed + backed rows keep listing and launching (D6 reopen memory);
      // manage mode recovers MENU-hidden tabs, not unbacked ones — Configure
      // Tabs is the recovered tabs' surface.
      if (!tab) continue
      const icon = resolveEntryIcon(tab, liveId)
      // Core hide-lock: resolved from the MODEL key's bare builtin id (the
      // same resolution the OS close path uses — never isHideLocked(liveId)).
      const coreId = parseBuiltinKey(key)
      out.push({
        liveId,
        side,
        // LUMI-26 rework: never a raw `builtin:`/`ext:` key — layout-blob
        // title first, then the humanized key chain.
        title: tab?.title ?? getLayoutOwnedTabTitle(key as TabKey) ?? humanTabTitleForKey(key) ?? key,
        iconSvg: icon.svg,
        iconUrl: icon.url,
        state,
        menuHidden: isMenuHidden,
        key,
        locked: coreId !== null && isCoreTabId(coreId),
      })
    }
  }
  out.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    || a.liveId.localeCompare(b.liveId),
  )
  return out
}

/** Human-readable state names for the accessible name (single i18n point). */
export const STATE_LABEL: Record<StartMenuEntry['state'], string> = {
  open: 'open',
  minimized: 'minimized',
  closed: 'closed',
}

/** Hover action verb per state — what the click will do. */
export const STATE_VERB: Record<StartMenuEntry['state'], string> = {
  open: 'Focus',
  minimized: 'Restore',
  closed: 'Launch',
}

/**
 * Designed state marks (user direction 2026-09-15): open = filled dot with a
 * soft halo, minimized = hollow circle, closed = NO mark at all (the window is
 * on no strip). `currentColor` keeps the shapes readable in forced-colors.
 */
export const STATE_MARK_SVG: Record<StartMenuEntry['state'], string> = {
  open: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none"><circle cx="9" cy="9" r="4" fill="currentColor"/><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-opacity=".25" stroke-width="1.5"/></svg>',
  minimized: '<svg viewBox="0 0 18 18" width="18" height="18" fill="none"><circle cx="9" cy="9" r="5.25" stroke="currentColor" stroke-width="1.5"/></svg>',
  closed: '',
}

// ── Menu DOM ─────────────────────────────────────────────────────────────────

function createMenuEntry(entry: StartMenuEntry, targetSide: Side): HTMLElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'canvas-os-start-menu__item'
  item.setAttribute('role', 'menuitem')
  item.setAttribute('data-os-state', entry.state)
  item.setAttribute('aria-label', `${entry.title} — ${STATE_LABEL[entry.state]}`)

  const rail = document.createElement('span')
  rail.className = 'canvas-os-start-menu__rail'
  rail.setAttribute('aria-hidden', 'true')

  const tile = document.createElement('span')
  tile.className = 'canvas-os-start-menu__tile'
  tile.setAttribute('aria-hidden', 'true')
  renderEntryIcon(tile, entry)

  const label = document.createElement('span')
  label.className = 'canvas-os-start-menu__label'
  label.textContent = entry.title

  const status = document.createElement('span')
  status.className = 'canvas-os-start-menu__status'
  status.setAttribute('aria-hidden', 'true')
  const markSvg = STATE_MARK_SVG[entry.state]
  if (markSvg) {
    const mark = document.createElement('span')
    mark.className = 'canvas-os-start-menu__mark'
    mark.innerHTML = markSvg
    status.appendChild(mark)
  }
  const verb = document.createElement('span')
  verb.className = 'canvas-os-start-menu__verb'
  verb.textContent = STATE_VERB[entry.state]
  status.appendChild(verb)

  item.append(rail, tile, label, status)
  item.addEventListener('click', () => {
    hideStartMenu()
    // Launch into the INVOKING menu's drawer (per-drawer launcher): the entry
    // inventory is global, but the clicked window opens where the user is.
    // The action places it at that drawer's launch end unless its button is
    // already there.
    void openWindowInDrawerByLiveId(entry.liveId, targetSide)
  })
  return item
}

/**
 * Manage (eye) mode row: the same launch button as a NORMAL row, plus a
 * visibility checkbox on the right — checked = VISIBLE in the START MENU
 * (Configure Tabs semantics, mirrored for the menu's own set).
 * Hidden-in-menu rows render dimmed (`row-hidden` precedent).
 *
 * `onMenuHiddenChange` (LUMI-24) fires after the optimistic entry flip so
 * the caller can refresh the header's "N panels · M hidden" tally live.
 *
 * The checkbox dispatches the START-MENU-ONLY intent
 * `{t:'setMenuHidden', key, hidden}` (LUMI-16b) — NEVER the strip
 * `setHidden` (that bit drives the strips via Configure Tabs) and NOT the
 * Configure draft mutation (`configure-model.setHidden` mutates the modal's
 * draft; this menu has no draft). The set is consumed ONLY by the Start-menu
 * projections: reconcile has no menuHidden diff, so no host write fires and
 * the strips cannot react; the dispatch's reconcileAndPersist saves the
 * layout automatically. The set is menu-projection-only: launching a
 * menu-hidden panel does NOT change its menuHidden membership (the launch
 * path never writes the menu axis — LUMI-23, member decision 2026-09-28);
 * only this checkbox un-hides it.
 *
 * Core hide-locked rows (CORE_HIDE_LOCKED) keep the checkbox disabled
 * unless the `coreTabsHidden` setting is on — the same unlock rule the
 * Configure toggle applies.
 */
function createManageRow(
  entry: StartMenuEntry,
  targetSide: Side,
  onMenuHiddenChange?: (nowMenuHidden: boolean) => void,
): HTMLElement {
  const row = createMenuEntry(entry, targetSide)
  row.classList.add('canvas-os-start-menu__item--manage')
  if (entry.menuHidden) row.classList.add('row-hidden')

  const coreUnlocked = !!getSettings().coreTabsHidden
  const isLocked = entry.locked && !coreUnlocked

  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.className = 'canvas-os-start-menu__check'
  checkbox.checked = !entry.menuHidden
  checkbox.disabled = isLocked
  checkbox.title = isLocked
    ? 'Cannot hide this panel'
    : entry.menuHidden ? 'Show panel' : 'Hide panel'
  checkbox.setAttribute('aria-label', `${entry.title} — ${checkbox.title}`)
  checkbox.addEventListener('click', (ev) => ev.stopPropagation())
  checkbox.addEventListener('change', () => {
    // Toggle the START-MENU-ONLY membership by TabKey (LUMI-16b). The set is
    // menu-projection-only: no strip applicator receives these ids, and the
    // persist rides reconcileAndPersist — nothing else to do here.
    void dispatchBatch([{ t: 'setMenuHidden', key: entry.key, hidden: !checkbox.checked }])
    // Optimistic in-place row update: the intent re-projects on the next
    // open; flipping the dim now keeps the surface live. The state mark is
    // untouched — the window lifecycle did not change.
    const nowMenuHidden = !checkbox.checked
    entry.menuHidden = nowMenuHidden
    row.classList.toggle('row-hidden', nowMenuHidden)
    // Live header tally (LUMI-24): runs AFTER the entry flip above so the
    // refresh re-reads the shared entries array with the new membership.
    onMenuHiddenChange?.(nowMenuHidden)
  })
  row.appendChild(checkbox)
  return row
}

/**
 * Fill a tile with the entry icon: resolved SVG → `<img>` → monogram.
 * The tile is decorative (`aria-hidden`); the label carries the name.
 */
export function renderEntryIcon(
  tile: HTMLElement,
  entry: Pick<StartMenuEntry, 'iconSvg' | 'iconUrl' | 'title'>,
): void {
  if (entry.iconSvg) {
    tile.innerHTML = entry.iconSvg
    return
  }
  if (entry.iconUrl) {
    const img = document.createElement('img')
    img.src = entry.iconUrl
    img.alt = ''
    img.width = 16
    img.height = 16
    tile.appendChild(img)
    return
  }
  tile.textContent = entryMonogram(entry.title)
  tile.classList.add('canvas-os-start-menu__tile--monogram')
}

/** Manage (eye) toggle glyph — an eye, `currentColor` strokes. */
const MANAGE_EYE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>'

/**
 * Count-line text: "N panels", plus manage mode's "· M hidden" tally.
 * Shared by the header build AND the manage checkbox's live refresh
 * (LUMI-24) so the two renderings can never drift.
 */
function countLine(count: number, hiddenCount: number, manageMode: boolean): string {
  const panels = count === 1 ? '1 panel' : `${count} panels`
  return manageMode
    ? `${panels} · ${hiddenCount === 1 ? '1 hidden' : `${hiddenCount} hidden`}`
    : panels
}

/**
 * Header strip: brand glyph + deck label + [manage toggle] + window count.
 *
 * LUMI-16a: the header is NO LONGER wholesale `aria-hidden` — the manage
 * (eye) toggle is a REAL control and must be reachable by assistive tech.
 * The decorative chrome (brand glyph, title, count) is individually
 * aria-hidden inside a chrome wrapper; the eye button is a sibling of that
 * wrapper, left of the count, and carries its own accessible name + pressed
 * state. Visually unchanged: same flex row, same order.
 */
function createHeader(count: number, hiddenCount: number, manageMode: boolean): HTMLElement {
  const header = document.createElement('div')
  header.className = 'canvas-os-start-menu__header'
  header.setAttribute('role', 'presentation')

  const chrome = document.createElement('span')
  chrome.className = 'canvas-os-start-menu__header-chrome'
  chrome.setAttribute('aria-hidden', 'true')
  const brand = document.createElement('span')
  brand.className = 'canvas-os-start-menu__brand'
  brand.innerHTML = START_GLYPH_SVG
  const title = document.createElement('span')
  title.className = 'canvas-os-start-menu__title'
  title.textContent = 'Start'
  chrome.append(brand, title)

  const manageBtn = document.createElement('button')
  manageBtn.type = 'button'
  manageBtn.className = `canvas-os-start-menu__manage${manageMode ? ' manage-on' : ''}`
  manageBtn.innerHTML = MANAGE_EYE_SVG
  manageBtn.setAttribute('aria-pressed', manageMode ? 'true' : 'false')
  const manageLabel = manageMode ? 'Done managing panels' : 'Manage panels'
  manageBtn.setAttribute('aria-label', manageLabel)
  manageBtn.title = manageLabel

  const countEl = document.createElement('span')
  countEl.className = 'canvas-os-start-menu__count'
  countEl.setAttribute('aria-hidden', 'true')
  // Count reads from the FULL inventory (both drawers); the menu-hidden
  // tally is manage mode's second line ("N panels · M hidden", LUMI-16a —
  // the tally reads the START-MENU-only set since LUMI-16b).
  countEl.textContent = countLine(count, hiddenCount, manageMode)

  header.append(chrome, manageBtn, countEl)
  return header
}

/** Empty-state row (spec §4.4.3): "where did my tabs go?" in one glance. */
function createEmptyState(): HTMLElement {
  const empty = document.createElement('div')
  empty.className = 'canvas-os-start-menu__empty'
  empty.setAttribute('role', 'presentation')
  const glyph = document.createElement('span')
  glyph.className = 'canvas-os-start-menu__empty-glyph'
  glyph.setAttribute('aria-hidden', 'true')
  glyph.innerHTML = START_GLYPH_SVG
  const title = document.createElement('span')
  title.className = 'canvas-os-start-menu__empty-title'
  title.textContent = 'No windows'
  const hint = document.createElement('span')
  hint.className = 'canvas-os-start-menu__empty-hint'
  hint.textContent = 'Open a tab to add a window here'
  empty.append(glyph, title, hint)
  return empty
}

/**
 * Build the menu surface for the invoking drawer; the caller positions it.
 * MANAGE (eye) mode projects hidden tabs back into the list as dimmed
 * checkbox rows (the Configure Tabs precedent); NORMAL view lists visible
 * tabs only. The manage toggle lives in the header and flips the mode in
 * place (fresh projection, count line swap) without rebuilding the sheet.
 */
function buildMenu(targetSide: Side): HTMLElement | null {
  const host = getHost()
  const model = getModel()
  if (!host || !model) return null
  const resolve = (key: string) => host.resolve(key)
  const entries = deriveStartMenuEntries(model, resolve, getDrawerTabs(), {
    manageMode: _manageMode,
  })
  injectStartMenuStyles()
  const menu = document.createElement('div')
  menu.id = MENU_ID
  menu.className = 'canvas-os-start-menu'
  if (_manageMode) menu.setAttribute('data-manage-mode', 'true')
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', 'Start menu')
  if (entries.length === 0) {
    // Manage mode's empty-state swap: hidden-only inventories show rows in
    // NORMAL view too (all hidden → empty). Rebuild on toggle covers it.
    menu.appendChild(createEmptyState())
    return menu
  }
  const header = createHeader(
    entries.length,
    entries.filter((e) => e.menuHidden).length,
    _manageMode,
  )
  // Manage toggle: flips the projection in place. Rebuild the list rows +
  // count line; keep the menu open and anchored (transient per open — the
  // close path resets the module flag, see hideStartMenu).
  const manageBtn = header.querySelector('button.canvas-os-start-menu__manage') as HTMLButtonElement | null
  manageBtn?.addEventListener('click', (ev) => {
    ev.stopPropagation()
    toggleManageMode(targetSide)
  })
  // Live tally (LUMI-24): the manage checkbox's optimistic handler calls
  // this to re-render the "N panels · M hidden" line in place — same shape
  // as the row's in-place dim update, no rebuild. Re-reads the shared
  // entries array, which the handler has already flipped.
  const countEl = header.querySelector('span.canvas-os-start-menu__count') as HTMLSpanElement | null
  const refreshCount = (): void => {
    if (!countEl) return
    countEl.textContent = countLine(
      entries.length,
      entries.filter((e) => e.menuHidden).length,
      _manageMode,
    )
  }
  menu.appendChild(header)
  const divider = document.createElement('div')
  divider.className = 'canvas-os-start-menu__divider'
  divider.setAttribute('role', 'separator')
  menu.appendChild(divider)
  const list = document.createElement('div')
  list.className = 'canvas-os-start-menu__list'
  list.setAttribute('role', 'presentation')
  for (const entry of entries) {
    list.appendChild(
      _manageMode
        ? createManageRow(entry, targetSide, refreshCount)
        : createMenuEntry(entry, targetSide),
    )
  }
  menu.appendChild(list)
  return menu
}

/**
 * Flip manage mode and re-render the open menu in place: fresh projection,
 * fresh header (pressed state + count line), fresh rows. Keeps the sheet's
 * geometry (no re-open animation) — the anchored surface stays put.
 */
function toggleManageMode(targetSide: Side): void {
  _manageMode = !_manageMode
  const menu = _menu
  if (!menu || !_menuButton?.isConnected) return
  const next = buildMenu(targetSide)
  if (!next) return
  // Swap in the next surface's children, keeping the SAME positioned node
  // (left/top/zoom attrs already applied by the open rAF).
  menu.className = next.className
  for (const attr of ['data-manage-mode']) {
    const v = next.getAttribute(attr)
    if (v === null) menu.removeAttribute(attr)
    else menu.setAttribute(attr, v)
  }
  for (const child of Array.from(menu.children)) child.remove()
  for (const child of Array.from(next.children)) menu.appendChild(child)
  dlog('[os] start menu manage toggle', { manage: _manageMode })
}

/** Cancel the pending menu-position rAF (if any). */
function cancelMenuRaf(): void {
  if (_menuRaf) {
    cancelAnimationFrame(_menuRaf)
    _menuRaf = 0
  }
}

/** Cancel an in-flight close animation and drop its menu immediately. */
function cancelClosing(): void {
  if (!_closing) return
  const { menu, anim } = _closing
  _closing = null
  if (anim) {
    anim.onfinish = null
    anim.cancel()
  }
  menu.remove()
}

/**
 * True when `button` lives in a vertical (Sides) tab strip. The strip may
 * live in three places: a BODY-LEVEL pin host (`.sidebar-ux-tab-list-pin-host`
 * — the drawer's list is reparented there when pinned, so a pinned button is
 * NOT inside its drawer wrapper), the secondary wrapper, or the main
 * wrapper. Vertical = Sides (not Top/Bottom), stamped on the pin host as
 * `data-strip-axis`; the wrappers are vertical by construction in Sides.
 * Used to unify Sides menu placement across drawers (LUMI-15); a body-
 * anchored menu with no live host falls back to the non-Sides placement.
 */
function isVerticalSidesStrip(button: HTMLElement): boolean {
  // closest is unavailable on test fakes: absence of the method means the
  // stub can't be matched against any host — fall back to the non-Sides
  // placement rather than crashing the open path.
  const anyBtn = button as HTMLElement & { closest?: (sel: string) => HTMLElement | null }
  // 1) Pinned strip: body-level pin host carries the axis stamp directly.
  const pinHost = anyBtn.closest?.('.sidebar-ux-tab-list-pin-host') as HTMLElement | null
  if (pinHost) {
    return pinHost.getAttribute('data-strip-axis') !== 'horizontal'
  }
  // 2) Unpinned secondary drawer: inside its own wrapper (and that wrapper
  // must be the live one — a detached shell's button can't open a menu).
  const wrapper = anyBtn.closest?.('.sidebar-ux-secondary-wrapper') as HTMLElement | null
  if (wrapper) {
    if (wrapper === getSecondaryWrapper()) return true
  }
  // 3) Main drawer: getMainWrapper needs document.querySelector — absent in
  // some test fakes; treat as "not the main strip" and fall back.
  const main = getMainWrapper()
  if (!main) return false
  // Main drawer's wrapper — Start rides the main strip in Sides mode.
  if (main.contains(button)) {
    // Vertical = Sides (not Top/Bottom): distinguishable by the strip's
    // axis stamp; absent (e.g. test stubs) treat as vertical since the main
    // mirror list is a vertical column by construction.
    const axis = main.querySelector('[data-strip-axis]')?.getAttribute('data-strip-axis')
    return axis !== 'horizontal'
  }
  return false
}

/**
 * The SCREEN side of a drawer role ('primary' | 'secondary'). The main
 * drawer's side is user-swappable (`getMainDrawerSide`); the second drawer
 * always sits on the opposite screen side, and only exists when open.
 */
function drawerScreenSide(side: Side): 'left' | 'right' | null {
  if (side === 'secondary') {
    if (!isSecondarySidebarOpen() || !getSecondaryWrapper()) return null
    return getMainDrawerSide() === 'left' ? 'right' : 'left'
  }
  return getMainDrawerSide()
}

/**
 * Dismiss a menu whose invoking button left the DOM (shell remount, side
 * change, second-drawer disable): a body-level menu must not outlive its
 * anchor. Runs from the ensure pass — the same signal that recreates the
 * strip — because those remounts carry no OS-setting diff.
 */
function reconcileStartMenuPresence(): void {
  if (_menu && (!_menuButton || !_menuButton.isConnected)) {
    hideStartMenu({ immediate: true })
  }
}

/** Open the menu for a drawer, anchored to the invoking button. Idempotent:
 *  clicking a drawer's own Start button while its menu is open toggles. */
export function openStartMenu(side: Side, button: HTMLElement): void {
  // Same-side toggle — only while the menu is genuinely open on a live
  // button. A shell remount can leave a stale open flag + dead anchor; then
  // the click must open a fresh menu, not try to close the orphan.
  if (_menuOpenFor === side && _menuButton?.isConnected) {
    hideStartMenu()
    return
  }
  hideStartMenu({ immediate: true })
  // Manage mode is transient per menu-open: every open starts in NORMAL
  // view (the launch surface); the eye toggle re-enters manage mode.
  _manageMode = false
  const menu = buildMenu(side)
  if (!menu) return
  document.body.appendChild(menu)
  _menu = menu
  _menuOpenFor = side
  _menuButton = button
  _menuRevealed = false
  button.setAttribute('aria-expanded', 'true')

  // Position: open AWAY from the screen edge — above bottom-anchored
  // buttons, below top-strip buttons; clamp into the viewport (8px gutters).
  // The menu is a body child under the host's UI zoom: rects and window.inner*
  // are RENDERED px while inline left/top are LAYOUT px — clamp in rendered
  // space, assign divided by the scale (context-menu/index.ts pattern).
  const rect = button.getBoundingClientRect()
  menu.style.visibility = 'hidden'
  cancelMenuRaf()
  _menuRaf = requestAnimationFrame(() => {
    _menuRaf = 0
    if (_menu !== menu) return // stale rAF from a superseded open
    const mRect = menu.getBoundingClientRect()
    const uiScale = getUiScale()
    const openUpward = rect.bottom > window.innerHeight / 2
    // The drop shadow follows the open direction (the sheet owns the values):
    // an upward menu's down-cast shadow paints over the bottom taskbar/tab
    // strip it opens from — stamp the direction so CSS can mirror the Y
    // offset (live report 2026-09-16).
    menu.toggleAttribute('data-open-upward', openUpward)
    // Sides placement (LUMI-15, member-unified for both drawers): a vertical
    // strip's menu flies out BESIDE the strip, away from the screen edge —
    // left drawer → right of the button/tab strip, right drawer → left of it
    // (button-anchored so a docked button keeps its own edge too). Vertical
    // anchor (both variants): strip-top button → as high as possible; dock
    // (bottom) button → as low as possible. Top/Bottom strips keep theirs
    // (open up/downward from the button).
    const screenSide = drawerScreenSide(side)
    const inSides = isStartAtStripTop() || isVerticalSidesStrip(button)
    const preferredLeft = inSides
      ? (screenSide === 'right' ? rect.left - mRect.width - 8 : rect.right + 8)
      : rect.left
    const renderedLeft = Math.max(8, Math.min(preferredLeft, window.innerWidth - mRect.width - 8))
    // Sides, strip-top button → as high as possible; Sides, dock button → as
    // low as possible. Non-Sides keeps the up/down open-direction clamp.
    const renderedTop = inSides
      ? (isStartAtStripTop()
        ? 8
        : Math.max(8, window.innerHeight - mRect.height - 8))
      : Math.max(8, Math.min(
        openUpward ? rect.top - mRect.height - 8 : rect.bottom + 8,
        window.innerHeight - mRect.height - 8,
      ))
    menu.style.left = `${renderedLeft / uiScale}px`
    menu.style.top = `${renderedTop / uiScale}px`
    // Origin from the PLACED box, never the pre-position rect: with auto
    // insets the fixed menu is measured at its static position (after #root),
    // which is nowhere near where it is about to be placed. Using it doubled
    // the origin distance in Bottom mode and the open frame started far too
    // low (live report 2026-09-15).
    const placedRect = menu.getBoundingClientRect()
    menu.style.visibility = ''
    _menuRevealed = true
    // Grow out of the button: origin at its center, external to the box.
    _menuAnim = playMenuIn(menu, computeGrowthOrigin(rect, placedRect, uiScale))
    ;(menu.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus()
  })
  attachMenuDismiss()
  dlog('[os] start menu open', { side })
}

/**
 * Hide the open menu (idempotent). Animated by default: the surface fades
 * while shrinking toward the invoking button; the node is removed when the
 * animation settles. `immediate` skips the motion (teardown, dead anchor,
 * pre-reveal hide, reduced-motion, no WAAPI) — used wherever a visible exit
 * would be wrong.
 */
export function hideStartMenu(opts?: { immediate?: boolean }): void {
  _unsubDocListeners?.()
  _unsubDocListeners = null
  for (const btn of document.querySelectorAll(`button[${START_ATTR}]`)) {
    btn.setAttribute('aria-expanded', 'false')
  }

  const menu = _menu
  const button = _menuButton
  const revealed = _menuRevealed
  const side = _menuOpenFor
  _menu = null
  _menuOpenFor = null
  _menuButton = null
  _menuRevealed = false
  // Manage mode is transient per menu-open — the next open is NORMAL view.
  _manageMode = false
  cancelMenuRaf()

  // Focus must not stay on a surface that is leaving the DOM.
  const active = document.activeElement as HTMLElement | null
  if (menu && active && menu.contains(active)) {
    if (button?.isConnected) button.focus()
    else active.blur()
  }

  const animatable = menu !== null && canAnimateMenu(menu) && !prefersReducedMotion()
  if (!menu || opts?.immediate || !animatable || !revealed || !button || !button.isConnected) {
    _menuAnim?.cancel()
    _menuAnim = null
    menu?.remove()
    cancelClosing()
    if (menu) dlog('[os] start menu close', { side, immediate: true })
    return
  }

  // Capture the current visual state BEFORE cancelling the open animation:
  // getComputedStyle sees the animated values, while getBoundingClientRect
  // would fold its transform into the rects measured below. Cancel first,
  // then measure the settled layout so the shrink target is the true button.
  const from = captureMenuVisualState(menu)
  _menuAnim?.cancel()
  _menuAnim = null
  const origin = computeGrowthOrigin(
    button.getBoundingClientRect(),
    menu.getBoundingClientRect(),
    getUiScale(),
  )
  menu.style.pointerEvents = 'none'
  const anim = playMenuOut(menu, origin, from, () => {
    menu.remove()
    if (_closing?.menu === menu) _closing = null
  })
  if (anim) _closing = { menu, anim }
  dlog('[os] start menu close', { side, immediate: false })
}

/** Outside-click + Escape + viewport-change dismissal while the menu is open. */
function attachMenuDismiss(): void {
  const onDocMousedown = (ev: MouseEvent) => {
    const target = ev.target
    if (!(target instanceof Element)) return
    if (_menu?.contains(target)) return
    if (target.closest(`button[${START_ATTR}]`)) return // the button toggles itself
    hideStartMenu()
  }
  const onKey = (ev: KeyboardEvent) => {
    // APG behavior — Tab closes the menu and moves focus on.
    if (ev.key === 'Tab') { hideStartMenu(); return }
    if (ev.key === 'Escape') {
      ev.preventDefault()
      hideStartMenu()
      return
    }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return
    if (!_menu) return
    const items = Array.from(_menu.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
    if (items.length === 0) return
    const idx = items.indexOf(document.activeElement as HTMLElement)
    ev.preventDefault()
    const dir = ev.key === 'ArrowDown' ? 1 : -1
    const next = idx === -1 ? items[0]! : items[(idx + dir + items.length) % items.length]!
    next.focus()
  }
  // A resize moves the anchored button (viewport-anchored strips) while the
  // fixed body-level menu keeps its old coordinates — dismiss immediately
  // rather than leave a stale anchor / clipped surface behind.
  const onViewportResize = () => {
    hideStartMenu({ immediate: true })
  }
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', onViewportResize)
  window.visualViewport?.addEventListener('resize', onViewportResize)
  // Known residual: no document-level `scroll` dismissal (the strip's own scroll case).
  _unsubDocListeners = () => {
    document.removeEventListener('mousedown', onDocMousedown, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', onViewportResize)
    window.visualViewport?.removeEventListener('resize', onViewportResize)
  }
}

// ── Start buttons ────────────────────────────────────────────────────────────

/** Nine-dot launcher mark — shared by the Start button and the menu header. */
const START_GLYPH_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="5" r="1.8"/><circle cx="12" cy="5" r="1.8"/><circle cx="19" cy="5" r="1.8"/><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/><circle cx="5" cy="19" r="1.8"/><circle cx="12" cy="19" r="1.8"/><circle cx="19" cy="19" r="1.8"/></svg>'

/**
 * Start button markup. Chrome is CSS-owned:
 * `.sidebar-ux-tab-list button[data-canvas-os-start]` in
 * `sidebar/styles.ts` (OS_START_BUTTON_CSS) mirrors the Options/Settings dock
 * button — same 48px row, radius, transition and hover background. NEVER
 * inline geometry here: inline styles beat the sheet AND the mobile /
 * horizontal size overrides. The glyph is the only intended difference
 * (20px icon box, same as the mirror's forced icon size).
 */
function startButtonHtml(): string {
  return `<button type="button" ${START_ATTR}="1" aria-label="Start" title="Start" aria-haspopup="menu" aria-expanded="false">${START_GLYPH_SVG}</button>`
}

/** True when the Start button should ride the TOP of the vertical tab strip
 *  (startButtonAtStripTop). Shared gate: `isStartAtStripTopGate()` in
 *  os/start-strip-top-gate.ts is the single definition (the renderer consumes
 *  the same helper so its structure pass pins the lifted button — LUMI-14);
 *  this wrapper is the in-module name the ensure/clear paths read. */
function isStartAtStripTop(): boolean {
  return isStartAtStripTopGate()
}

/**
 * Ensure the side's Start button exists in the right slot (idempotent):
 *   - Sides, main mirror → the bottom dock, beneath the settings button (D10).
 *   - Sides, secondary → the shared secondary dock (same
 *     `.sidebar-ux-tab-list-bottom` chrome as the main drawer's Settings dock:
 *     divider + 8px gap, anchored to the strip end). The divider is therefore
 *     NOT part of the button. The Options gear lives in the same dock when
 *     its location includes this side — never create a second dock (the
 *     last-child invariant in docs/pitfalls.md).
 *   - Sides + startButtonAtStripTop (desktop) → FIRST child of the vertical
 *     tab list, above the tabs, with a dedicated divider element between the
 *     button and the strip (container-owned line, LUMI-15 — same visual
 *     grammar as normal mode's dock divider). The dock (and the gear inside
 *     it) stays bottom-anchored. Returned to the shared dock when the setting
 *     turns off. The root class `sidebar-ux-start-at-strip-top` is the CSS
 *     carrier; the dock-last-child invariant is untouched (tabs never cross
 *     the dock).
 *   - Top/Bottom → CSS `order` at the OUTER (screen-edge) end of its dock/list
 *     (HORIZONTAL_STRIP_CSS keys on the pin host's sidebar-ux-side-* class and
 *     the `sidebar-ux-start-edge-inner` root class; an in-place side flip
 *     re-orders without
 *     re-running this ensure). No inline order is kept.
 *
 * Placement is location-agnostic: the caller decides WHICH sides get a button
 * (`resolveChromeSides`), this ensure only positions it within the side.
 */
async function ensureStartButtonForSide(side: Side): Promise<void> {
  const list = side === 'primary' ? await getMainMirrorList() : getSecondaryTabList()
  if (!list) return
  let btn = list.querySelector(`button[${START_ATTR}]`) as HTMLButtonElement | null
  if (btn && !btn.isConnected) btn = null
  if (!btn) {
    const template = document.createElement('template')
    template.innerHTML = startButtonHtml().trim()
    btn = template.content.firstElementChild as HTMLButtonElement
  }
  btn.setAttribute(START_SIDE_ATTR, side)
  // Strip-top variant (Sides desktop only — mobile turns the strip into a
  // horizontal row, Top/Bottom placement is HORIZONTAL_STRIP_CSS's): lift
  // Start to the FIRST slot of the vertical tab list instead of its dock.
  // The dock — gear inside — stays bottom-anchored in both variants.
  const atStripTop = isStartAtStripTop()
  if (!atStripTop) {
    // Setting turned off (or Top/Bottom/mobile): the divider's owner moved
    // back to a dock — drop the strip-top divider so it cannot paint an
    // orphan line inside the list (LUMI-15 lifecycle).
    list.querySelector(`:scope > .${START_STRIP_TOP_DIVIDER_CLASS}`)?.remove()
  }
  if (atStripTop) {
    // The divider is its own element (LUMI-15) — a container-owned line, not
    // button chrome — inserted between the button and the strip. The ensure
    // and removeStartChromeForSide own its lifecycle: it must never paint
    // without the lifted button.
    let divider = list.querySelector(`:scope > .${START_STRIP_TOP_DIVIDER_CLASS}`) as HTMLElement | null
    if (!divider) {
      divider = document.createElement('div')
      divider.className = START_STRIP_TOP_DIVIDER_CLASS
    }
    if (btn.parentElement !== list || btn.previousElementSibling !== null) {
      list.insertBefore(btn, list.firstElementChild)
    }
    // Insert the divider AFTER pinning the button (normally its
    // nextElementSibling): the renderer's structure pass
    // (main-renderer.ts ensureMirrorListStructure) pins Start as the first
    // list child and inserts main right behind it, so a divider placed above
    // Start gets displaced to index 2 on every render — the one-frame
    // flicker (pitfalls §26). Below Start, between it and the strip, is the
    // member-asked-for construction (margin on the tab side).
    if (divider.parentElement !== list || divider.previousElementSibling !== btn) {
      list.insertBefore(divider, btn.nextElementSibling)
    }
    if (side === 'secondary') {
      // Lifting out can strand the shared dock empty (gear excluded from this
      // side) — an empty dock still paints its divider. Same removal contract
      // as removeStartChromeForSide: only when nothing is left in it.
      const dock = list.querySelector(`:scope > .${SECONDARY_START_DOCK_CLASS}`) as HTMLElement | null
      if (dock && !dock.firstElementChild) dock.remove()
    }
  } else if (side === 'primary') {
    // Re-dock a button a previous strip-top session lifted to a direct list
    // child (setting turned off): parent === list means lifted, parent ===
    // dock means already placed, no parent means fresh.
    const dock = list.querySelector(`.${TAB_LIST_BOTTOM_CLASS}`) as HTMLElement | null
    if (dock) {
      if (btn.parentElement !== dock) dock.appendChild(btn)
    } else if (!btn.parentElement) {
      list.appendChild(btn)
    }
  } else {
    // Secondary: wrap the Start in the shared dock so the divider matches the
    // main drawer's Settings dock exactly (container border, not button).
    let dock = list.querySelector(`:scope > .${SECONDARY_START_DOCK_CLASS}`) as HTMLElement | null
    if (!dock) {
      dock = document.createElement('div')
      dock.className = `${TAB_LIST_BOTTOM_CLASS} ${SECONDARY_START_DOCK_CLASS}`
      list.appendChild(dock)
    }
    if (btn.parentElement !== dock) dock.appendChild(btn)
    // Self-heal ordering: a late host registration can append a tab button
    // after the dock; tab writers use appendSecondaryTabNode, this is the
    // belt-and-braces for anything that slipped through.
    if (dock.nextElementSibling) list.appendChild(dock)
  }
  // Horizontal end-order is CSS-owned (HORIZONTAL_STRIP_CSS) so a side flip
  // re-orders in place. Clear any inline order an older session left behind —
  // in the vertical dock it would survive and reorder Start above Options.
  btn.style.removeProperty('order')
  if (!btn.dataset.wired) {
    btn.dataset.wired = '1'
    btn.addEventListener('click', () => openStartMenu(side, btn as HTMLElement))
  }
}

/** The main mirror's tab list (lazy import — load-order cycle). */
async function getMainMirrorList(): Promise<HTMLElement | null> {
  const m = await import('../sidebar/main-mirror-drawer')
  return m.getMainMirrorTabList()
}

/**
 * Remove one side's Start chrome. Idempotent.
 *
 * The button is matched by its stamped side attribute so a document-wide
 * sweep cannot remove the other side's button (pinned lists live outside the
 * shell wrappers, and a remount can leave an orphan). For the secondary, the
 * shared dock is removed only when it has no other content left — the Options
 * gear may still live in it (settings-dock.ts).
 */
function removeStartChromeForSide(side: Side): void {
  for (const btn of Array.from(
    document.querySelectorAll(`button[${START_ATTR}][${START_SIDE_ATTR}="${side}"]`),
  )) {
    btn.remove()
  }
  if (side === 'secondary') {
    for (const dock of Array.from(document.querySelectorAll(`.${SECONDARY_START_DOCK_CLASS}`))) {
      if (!dock.firstElementChild) dock.remove()
    }
  }
  // Strip-top divider: removed only when THIS side's button is gone from its
  // list (same per-side discipline as the button itself — a document-wide
  // sweep could remove the OTHER side's divider). The ensure owns
  // repositioning it while the button exists.
  for (const divider of Array.from(
    document.querySelectorAll(`.${START_STRIP_TOP_DIVIDER_CLASS}`),
  )) {
    const list = divider.parentElement
    if (!list) continue
    if (!list.querySelector(`button[${START_ATTR}][${START_SIDE_ATTR}="${side}"]`)) {
      divider.remove()
    }
  }
  if (_menuOpenFor === side) hideStartMenu({ immediate: true })
}

/**
 * Reconcile both sides' Start chrome against the resolved location set
 * (`startButtonLocation` + live main side + second-drawer state). Exported
 * for the unified `reconcileChromeLocations` (os/chrome-locations.ts); the
 * rAF-coalesced `scheduleEnsureButtons` is the feature/shell-event entry.
 */
export function reconcileStartChrome(): void {
  scheduleEnsureButtons()
}

function scheduleEnsureButtons(): void {
  if (_buttonRaf) return
  _buttonRaf = requestAnimationFrame(async () => {
    _buttonRaf = 0
    // A remounted shell can strand an open menu on a dead anchor; the ensure
    // pass is the one place that always runs after a remount.
    reconcileStartMenuPresence()
    if (!isOsModeEnabled()) return
    const resolved = resolveChromeSides(
      getSettings().startButtonLocation,
      getMainDrawerSide(),
      !!getSettings().secondSidebarEnabled,
    )
    if (resolved.main) await ensureStartButtonForSide('primary')
    else removeStartChromeForSide('primary')
    if (resolved.second) await ensureStartButtonForSide('secondary')
    else removeStartChromeForSide('secondary')
    // The Start button may have joined/left a dock that was collapsed while
    // empty — re-evaluate. Dynamic import avoids a settings-dock cycle.
    void import('../sidebar/settings-dock')
      .then((m) => m.refreshMainDockEmptyState())
      .catch(() => { /* module unavailable in some test harnesses */ })
  })
}

// ── Feature hooks ────────────────────────────────────────────────────────────

/** Shell-created re-ensure wiring (idempotent; test-visible). */
let _onShellCreated: (() => void) | null = null

/**
 * Subscribe the Start-button ensure to `canvas:drawer-shell-created`.
 * A shell mount (second-drawer enable, side remount, viewport cross) replaces
 * the strip with no OS-mode setting diff — without this the secondary Start
 * button is missing after `requestSecondDrawerMode(true)` while OS mode is
 * already on (live report 2026-09-15; panel-chrome consumes the same signal).
 * Idempotent: repeated calls keep exactly one listener.
 */
export function installShellCreatedListener(): void {
  if (typeof window === 'undefined' || _onShellCreated !== null) return
  _onShellCreated = () => scheduleEnsureButtons()
  window.addEventListener(DRAWER_SHELL_CREATED_EVENT, _onShellCreated)
}

/** Remove the shell-created listener (teardown; safe when never installed). */
export function removeShellCreatedListener(): void {
  if (_onShellCreated && typeof window !== 'undefined') {
    window.removeEventListener(DRAWER_SHELL_CREATED_EVENT, _onShellCreated)
  }
  _onShellCreated = null
}

/** Mount the Start buttons (feature mount / runtime enable). */
export function mountStartMenu(): void {
  if (!isOsModeEnabled()) return
  installShellCreatedListener()
  scheduleEnsureButtons()
  // Self-cleanup registration (extension disable regardless of toggle): a
  // RUNTIME OS enable mounts this chrome through apply() with no feature
  // teardown, so without this the buttons/listener would survive disable
  // (teardownStartMenu is idempotent — the boot-mount path may also have
  // registered it). LAZY import: start-menu sits in a load cycle
  // (registry → start-menu → … → registry), so a top-level registerCleanup
  // can run while cleanup.ts is still initializing (TDZ). Same pattern as
  // panel-chrome (`os/panel-chrome.ts`).
  void import('../sidebar/cleanup').then((m) => m.registerCleanup(teardownStartMenu))
  dlog('[os] start menu chrome mounted')
}

/**
 * Live-apply the `startButtonLocation` setting (feature apply). OS chrome
 * only exists while OS mode is on; the ensure pass resolves the location set
 * itself (live main side + second-drawer state), so this is a no-op when OS
 * mode is off.
 */
export function applyStartButtonLocationChange(): void {
  if (!isOsModeEnabled()) return
  scheduleEnsureButtons()
}

/** Teardown: remove buttons + docks + any open menu (feature unmount / disable). */
export function teardownStartMenu(): void {
  removeShellCreatedListener()
  if (_buttonRaf) {
    cancelAnimationFrame(_buttonRaf)
    _buttonRaf = 0
  }
  hideStartMenu({ immediate: true })
  for (const btn of Array.from(document.querySelectorAll(`button[${START_ATTR}]`))) {
    btn.remove()
  }
  // Remove the secondary Start docks too — but only when empty: the shared
  // dock may still host the Options gear (settings-dock.ts), which owns its
  // own lifecycle.
  for (const dock of Array.from(document.querySelectorAll(`.${SECONDARY_START_DOCK_CLASS}`))) {
    if (!dock.firstElementChild) dock.remove()
  }
  // The menu stylesheet is only needed while OS-mode Start chrome exists.
  // Never remove it in hideStartMenu — the close animation still needs it.
  document.getElementById(START_MENU_STYLE_ID)?.remove()
  dlog('[os] start menu chrome unmounted')
}
