// Pure command parser. No DOM, no async, no side effects.
// Exported: parseCommand(input: string): ParsedCommand | null

export interface ParsedCommand {
  name: string
  args: string                    // raw args string; per-command parsing
}

export function parseCommand(input: string): ParsedCommand | null {
  // Implementation: Task 2.2
  return null
}
