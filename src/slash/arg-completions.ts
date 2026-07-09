// Pure helpers for slash-command argument completion + ghost suffix.
// No DOM. Unit-tested in __tests__/arg-completions.test.ts.

export interface ArgMode {
  /** Command token without leading `/`. */
  cmdName: string
  /** Typed arg text used for prefix matching (from first non-space after command). */
  argPrefix: string
  /** Inclusive start index of the arg segment in the full textarea value. */
  argStart: number
  /** Exclusive end index of the arg segment (typically value.length in v1). */
  argEnd: number
}

export interface CommandNameToken {
  /** Inclusive start of the name token (always 1 — after `/`). */
  start: number
  /** Exclusive end of the name token (first space, or text.length). */
  end: number
  /** Typed chars after `/` within the token (user casing preserved). */
  typedPrefix: string
}

/**
 * Slice of the textarea value for the command name (after `/`, before the
 * first space). Used for command-name ghost range so accept never wipes
 * trailing args when the user has typed past the command token.
 *
 * Returns null when the value is not a leading-slash command.
 */
export function commandNameToken(text: string): CommandNameToken | null {
  if (!text.startsWith('/')) return null
  const spaceIdx = text.indexOf(' ')
  const end = spaceIdx >= 0 ? spaceIdx : text.length
  const start = 1
  return {
    start,
    end,
    typedPrefix: text.slice(start, end),
  }
}

/**
 * Detect first-arg completion mode: text starts with `/`, has whitespace
 * after the command token. v1 treats the entire remainder (from first
 * non-space after the command) as a single arg token (no multi-arg yet).
 *
 * Returns null when still typing the command name (no space) or the
 * value is not a slash command.
 */
export function parseArgMode(text: string): ArgMode | null {
  if (!text.startsWith('/')) return null
  const spaceIdx = text.indexOf(' ')
  if (spaceIdx < 0) return null

  const cmdName = text.slice(1, spaceIdx)
  if (!cmdName) return null

  // Range starts at the first non-whitespace after the command token.
  let argStart = spaceIdx + 1
  while (argStart < text.length && /\s/.test(text[argStart]!)) {
    argStart++
  }

  const argEnd = text.length
  const argPrefix = text.slice(argStart, argEnd)

  return { cmdName, argPrefix, argStart, argEnd }
}

/**
 * Case-insensitive prefix filter. Empty prefix returns all candidates
 * (preserving order).
 */
export function filterPrefix(candidates: string[], prefix: string): string[] {
  if (prefix === '') return candidates.slice()
  const lower = prefix.toLowerCase()
  return candidates.filter((c) => c.toLowerCase().startsWith(lower))
}

/**
 * Remainder of `full` after a case-insensitive match of `typedPrefix`.
 * Returns null when full does not start with typedPrefix (ci) or when
 * there is nothing left to ghost (exact match / shorter full).
 *
 * The returned suffix preserves `full`'s casing from typedPrefix.length
 * onward (matched length = typedPrefix.length on a successful ci match).
 */
export function ghostSuffix(full: string, typedPrefix: string): string | null {
  if (!full.toLowerCase().startsWith(typedPrefix.toLowerCase())) return null
  if (full.length <= typedPrefix.length) return null
  return full.slice(typedPrefix.length)
}

/**
 * Safe index into candidates. Returns null when empty or out of range.
 */
export function pickActive(candidates: string[], activeIndex: number): string | null {
  if (candidates.length === 0) return null
  if (activeIndex < 0 || activeIndex >= candidates.length) return null
  return candidates[activeIndex] ?? null
}
