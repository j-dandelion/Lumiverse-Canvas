// Microtask dispatch. Implementation lands in Task 2.6 (microtask.ts holds
// the canonical `defer` helper). This file re-exports the type signature
// only at this stage.
import type { ParsedCommand } from './parse'
import type { CommandRegistry } from './registry'
import type { SlashContext } from './types'

// Implementation: Task 2.6
export async function dispatchCommand(
  _parsed: ParsedCommand,
  _ctx: SlashContext,
  _registry: CommandRegistry,
): Promise<void> {
  // TODO: implementation in Task 2.6
}
