// Pure command parser. No DOM, no async, no side effects.
// Exported: parseCommand(input: string): ParsedCommand | null

export interface ParsedCommand {
  name: string
  args: string
}

// /^\/(\S+)(?:\s+(.*))?$/
// 1. Must start with /
// 2. Followed by non-whitespace characters (command name)
// 3. Optionally followed by whitespace and the rest (args)
//
// Prefix-matching pitfall (from Chronicle skill pitfall #6):
//   /select25-30 should NOT be parsed as name="select25" with args="30".
//   Per the plan, the parser returns the name as-is; the /select handler
//   decides whether /select25 means /select with arg 25 or a different
//   command. So the parser is simple: split on first whitespace, validate.

export function parseCommand(input: string): ParsedCommand | null {
  // Leading whitespace is NOT tolerated — the slash must be at column 0.
  // The /help/etc. handlers may be invoked with arbitrary chat input, and
  // a leading space means the user is mid-edit; do not consume it.
  if (!input.startsWith('/')) return null
  if (input.length === 1) return null  // just "/"

  const match = /^\/(\S+)(?:\s+(.*))?$/.exec(input)
  if (!match) return null

  const name = match[1]
  if (!/^[a-z][a-z0-9_-]*$/i.test(name)) return null  // valid identifier

  return { name, args: match[2] ?? '' }
}
