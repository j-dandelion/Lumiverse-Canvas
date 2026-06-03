// Salvaged from Chronicle v1.1.0, 2026-06-01 (commit ff585f1).
// Extracted from git history after Chronicle was reverted to v1.0.4 in Phase 1.2
// (commit 93fd172, which removed this file from the working tree).
// Original: ~/chronicle_ext/src/select-range-extract.ts
// Original test: ~/chronicle_ext/src/__tests__/select-range-extract.test.ts (22 cases; available in git history at ff585f1).
//
// Adaptations for Canvas:
//   - No code changes; the file is pure logic, no DOM, no Chronicle state.
//   - Stripped "Chronicle" prefix in header comment (becomes Canvas).
//
// --- original source follows ---

/**
 * Canvas — `index_in_chat` extractor
 *
 * Extract the visual `index_in_chat` from a Lumiverse message row.
 *
 * Lumiverse does not expose `index_in_chat` as a data-attribute on the row.
 * The number is rendered as text inside `class="metaPill"` (format `#{N}`).
 * This module scrapes that text. If the metaPill is missing or the format
 * has changed, the function falls back to walking the React/Preact fiber
 * tree to read `message.index_in_chat` directly from props.
 *
 * The pure parsing logic (`parseIndexFromText`) is split out so it can be
 * unit-tested without a DOM. `readIndexInChat` wires it up to the DOM.
 *
 * See ~/.hermes/skills/chronicle-extension/references/lumiverse-dom-quirks.md
 * for the DOM contract this code relies on.
 */

const INDEX_RE = /^#(\d+)/

/**
 * Pure: extract an index number from a metaPill segment's textContent.
 * Returns null if the text doesn't start with `#{N}`.
 */
export function parseIndexFromText(text: string | null | undefined): number | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  const m = INDEX_RE.exec(trimmed)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isSafeInteger(n) || n < 0) return null
  return n
}

/**
 * Read the visual `index_in_chat` from a Lumiverse message row.
 *
 * Primary: scrape the first [class*="metaSegment"] inside [class*="metaPill"].
 * Fallback: walk React/Preact fiber to read `message.index_in_chat` from props.
 */
export function readIndexInChat(row: HTMLElement): number | null {
  if (!row) return null

  // Primary: text-scrape the first [class*="metaSegment"] inside [class*="metaPill"]
  // CSS-module class names are hashed (e.g. "metaPill_x7y2z"); the prefix is stable.
  const pill = row.querySelector('[class*="metaPill"]')
  if (pill) {
    const seg = pill.querySelector('[class*="metaSegment"]')
    if (seg) {
      const n = parseIndexFromText(seg.textContent)
      if (n !== null) return n
    }
  }

  // Fallback: walk React/Preact fiber to read `message.index_in_chat` prop.
  // Covers future metaPill format changes.
  return readIndexInChatFromFiber(row)
}

declare global {
  interface Element {
    // React 16/17 fiber key. Preact 10 attaches the same key.
    __reactFiber$?: unknown
    // React 16/17 props key.
    __reactProps$?: unknown
  }
}

function readIndexInChatFromFiber(row: HTMLElement): number | null {
  // Find any fiber-related key on the element. React 16/17 uses
  // `__reactFiber$<random>`; Preact 10 uses `__preactattr_<random>` or
  // attaches props directly to the DOM node. Be permissive.
  const fiberKey = Object.keys(row).find(
    (k) => k.startsWith('__reactFiber') || k.startsWith('__preact')
  )
  if (!fiberKey) return null

  // Walk up the fiber tree looking for a `message` prop with `index_in_chat`.
  // The fiber object has a `.return` pointer to its parent fiber.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = (row as any)[fiberKey]
  let depth = 0
  const MAX_DEPTH = 20
  while (fiber && depth < MAX_DEPTH) {
    const props = fiber.memoizedProps || fiber.pendingProps
    if (props && typeof props === 'object' && 'message' in props) {
      const message = (props as { message: unknown }).message
      if (message && typeof message === 'object' && 'index_in_chat' in message) {
        const n = (message as { index_in_chat: unknown }).index_in_chat
        if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) {
          return n
        }
      }
    }
    fiber = fiber.return
    depth++
  }
  return null
}
