// Tab identity resolution — the SINGLE home for TabKey ↔ live-id mapping.
//
// REFACTOR-PLAN v2 §4.2: every representation of a tab resolves through the
// two pure functions below, over the observer inventory (DrawerObserver is
// the identity store — REFACTOR-PLAN v2 §4.1). The precedence tables here
// are the ONLY fallback logic in the codebase; callers delegate instead of
// layering their own.
//
// Direction asymmetry (by design):
//   - `liveIdForKey` (model key → DOM address) is TOTAL for builtins — a
//     builtin's address IS its bare id by construction, so a DOM-placed
//     builtin with no live button still resolves — and null only for
//     unresolvable extension keys.
//   - `keyForLiveId` (DOM address → model key) NEVER invents keys: it
//     returns the frozen registry key or null.
//
// Legacy inputs are handled INSIDE these functions (self-migrating): keys in
// 'builtin:{title}' masquerade form, stale extensionIds, title-valued live
// ids, ':N' suffix drift, and renamed titles (via the registry's `titles`
// set) all resolve and re-serialize canonically on the first save.

import {
  isBuiltinKey,
  parseBuiltinKey,
  parseExtensionKey,
  type TabKey,
} from '../core/model'

export interface TabShape {
  id: string
  extensionId: string
  title: string
  /** Frozen registry key (absent only for legacy-injected test doubles). */
  key?: TabKey
  /** Every title this button has ever carried (first-seen + current). */
  titles?: ReadonlySet<string>
  root?: HTMLElement | null
}

// ── key → live id ──────────────────────────────────────────────────────────

/**
 * Resolve a model TabKey to the tab's CURRENT live address.
 *
 * Precedence:
 *   1. Frozen-key match (canonical; also the only path that resolves '@N'
 *      disambiguated keys — their title part carries the suffix).
 *   2. Builtin: exact id → suffix-stripped id → title match (the legacy
 *      'builtin:{title}' untagged-extension masquerade) → the bare id
 *      itself (a builtin's address IS its id; DOM-placed builtins may have
 *      no live button).
 *   3. Extension: extensionId (+ 'unknown'/'' normalization) AND title →
 *      title-only (stale extensionId — never drop a tab the user placed).
 */
export function liveIdForKey(key: TabKey, tabs: readonly TabShape[]): string | null {
  const frozen = tabs.find((t) => t.key === key)
  if (frozen) return frozen.id

  if (isBuiltinKey(key)) {
    const builtinId = parseBuiltinKey(key) ?? ''
    const base = builtinId.includes(':') ? builtinId.slice(0, builtinId.lastIndexOf(':')) : builtinId
    const idMatch = tabs.find((t) => {
      if (t.id === builtinId) return true
      const tBase = t.id.includes(':') ? t.id.slice(0, t.id.lastIndexOf(':')) : t.id
      return tBase === base
    })
    if (idMatch) return idMatch.id
    const titleMatch = builtinId ? tabs.find((t) => t.title === builtinId) : undefined
    if (titleMatch) return titleMatch.id
    return builtinId
  }

  const parsed = parseExtensionKey(key)
  if (!parsed) return null
  const extMatch = tabs.find(
    (t) =>
      (t.extensionId === parsed.extensionId ||
        (!t.extensionId && parsed.extensionId === 'unknown')) &&
      t.title === parsed.tabName,
  )
  if (extMatch) return extMatch.id
  const titleMatch = tabs.find((t) => t.title === parsed.tabName)
  return titleMatch ? titleMatch.id : null
}

// ── live id → key ──────────────────────────────────────────────────────────

/**
 * Resolve a live address (or a legacy title/key-shaped input) to the tab's
 * FROZEN TabKey.
 *
 * Precedence:
 *   1. Exact address match → the frozen key.
 *   2. Suffix-stripped address match (':N' drift in either direction).
 *   3. Title match (current title, then every title the button has ever
 *      carried — a renamed extension keeps resolving legacy layouts).
 *   4. Button-attribute bridge: the button's current data-tab-id (legacy
 *      input path — Phase 1's attribute watch closes the live stale window,
 *      old bundles and test doubles may still carry a newer id than the
 *      entry).
 *
 * NEVER invents keys: the old assignment-map fallback (which turned a
 * TabKey into a garbage 'ext:…' key) is gone.
 */
export function keyForLiveId(id: string, tabs: readonly TabShape[]): TabKey | null {
  let match = tabs.find((t) => t.id === id)
  if (match) return match.key ?? null

  const idBase = id.includes(':') ? id.slice(0, id.lastIndexOf(':')) : id
  match = tabs.find((t) => {
    const tBase = t.id.includes(':') ? t.id.slice(0, t.id.lastIndexOf(':')) : t.id
    return tBase === id || tBase === idBase
  })
  if (match) return match.key ?? null

  match = tabs.find((t) => t.title === id || t.titles?.has(id))
  if (match) return match.key ?? null

  match = tabs.find((t) => {
    const btn = t.root
    return !!btn && btn.getAttribute('data-tab-id') === id
  })
  if (match) return match.key ?? null

  return null
}

// ── title → live id ────────────────────────────────────────────────────────

/**
 * Resolve a tab TITLE to its current live address. Used to normalize stale
 * title ids (pre-tag era) into the one id namespace the draft, the catalog,
 * and the commit all share.
 */
export function liveIdForTitle(title: string, tabs: readonly TabShape[]): string | null {
  const t = tabs.find((x) => x.title === title || x.titles?.has(title))
  return t ? t.id : null
}
