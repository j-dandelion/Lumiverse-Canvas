// Salvaged from Chronicle v1.1.0, 2026-06-01 (commit 329f13748c2270de41b67be27ebc920c6725fd43).
// Extracted from git history after Chronicle was reverted to v1.0.4 in Phase 1.2
// (commit 93fd172b57859cc31e242c07cc77a2e46694db02, which removed this file from the working tree).
// Original: ~/chronicle_ext/src/select-range-parser.ts
// Original test: ~/chronicle_ext/src/__tests__/select-range-parser.test.ts (35 cases; available in git history at 329f137).
//
// Adaptations for Canvas:
//   - No code changes; the file is pure logic, no DOM, no Chronicle state.
//   - Replaced "Chronicle" with "Canvas" in the docblock header.
//   - No imports / type references to rewrite.

/**
 * Canvas — `/select` command argument parser
 *
 * Pure function. No DOM, no globals. Converts a user-typed range string
 * into a structured form for the orchestrator to act on.
 *
 * Accepted syntax:
 *   25-100          → single range
 *   25 100          → single range (whitespace separator)
 *   1,5,10-12,100   → multi-range (comma-separated)
 *   all             → keyword: select all currently loaded messages
 *   clear           → keyword: clear current selection
 *
 * The parser strips a leading "/select" prefix if present.
 * The result is normalized: indices deduplicated, descending ranges reversed.
 *
 * Out of scope: validating that indices exist in the active chat. The
 * orchestrator handles that with a "out of range" toast.
 */

export type SelectArgs =
  | { kind: 'range'; indices: Set<number> }
  | { kind: 'all' }
  | { kind: 'clear' }
  | { kind: 'error'; reason: string }

const MAX_INDICES = 999_999  // sanity cap to prevent runaway expansion

export function parseSelectArgs(input: string): SelectArgs {
  if (typeof input !== 'string') return { kind: 'error', reason: 'Input is not a string' }

  // Strip leading "/select" prefix. The prefix is "/select" followed by
  // whitespace, end-of-string, or a digit (so "/select25-100" works as
  // well as "/select 25-100"). The "/select" must be a standalone token
  // (preceded by start-of-string or whitespace) so it doesn't match
  // "/select" embedded in larger words like "selecting".
  let trimmed = input.trim()
  const prefixMatch = /(?:^|\s)\/select(?=\s|$|\d)/i.exec(trimmed)
  if (prefixMatch) {
    // Consume the matched text plus any whitespace between "select" and args
    trimmed = trimmed.slice(prefixMatch[0].length).replace(/^\s+/, '')
  }
  if (trimmed === '') return { kind: 'error', reason: 'No range provided' }

  // Keywords
  if (/^all$/i.test(trimmed)) return { kind: 'all' }
  if (/^clear$/i.test(trimmed)) return { kind: 'clear' }

  // Split on commas, then parse each chunk.
  const chunks = trimmed.split(',').map((c) => c.trim()).filter((c) => c !== '')
  if (chunks.length === 0) return { kind: 'error', reason: 'No range provided' }

  const indices = new Set<number>()

  for (const chunk of chunks) {
    // Accept "A-B", "A B", or single "A".
    // Reject malformed: leading dash ("-25"), trailing dash ("25-"),
    // double dash ("25--30"), or any chunk that isn't a clean number-or-dash.
    if (chunk.startsWith('-') || chunk.endsWith('-')) {
      return { kind: 'error', reason: `Malformed range: "${chunk}"` }
    }
    if (chunk.includes('--')) {
      return { kind: 'error', reason: `Malformed range: "${chunk}"` }
    }
    // Collapse whitespace runs to a single dash (so "25 100" → "25-100"
    // and "25 - 100" → "25-100"). Trim again to be safe.
    const normalized = chunk.replace(/\s+/g, '-')
    const parts = normalized.split('-').filter((p) => p !== '')

    let from: number
    let to: number
    if (parts.length === 1) {
      const n = parseIntStrict(parts[0])
      if (n === null) return { kind: 'error', reason: `Invalid number: "${parts[0]}"` }
      from = n
      to = n
    } else if (parts.length === 2) {
      const a = parseIntStrict(parts[0])
      const b = parseIntStrict(parts[1])
      if (a === null) return { kind: 'error', reason: `Invalid number: "${parts[0]}"` }
      if (b === null) return { kind: 'error', reason: `Invalid number: "${parts[1]}"` }
      from = Math.min(a, b)
      to = Math.max(a, b)
    } else {
      return { kind: 'error', reason: `Malformed range: "${chunk}"` }
    }

    if (from < 0) return { kind: 'error', reason: 'Negative indices not allowed' }
    if (to - from + 1 > MAX_INDICES) {
      return { kind: 'error', reason: `Range too large (max ${MAX_INDICES} indices)` }
    }
    for (let i = from; i <= to; i++) indices.add(i)
  }

  if (indices.size === 0) return { kind: 'error', reason: 'No valid indices parsed' }
  return { kind: 'range', indices }
}

function parseIntStrict(s: string): number | null {
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n < 0) return null
  return n
}