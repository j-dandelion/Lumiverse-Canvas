// /help — aggregates registry.list() and shows them.
// Implementation: wired in Task 2.6 (depends on SlashContext.toast).
import type { CommandRegistry } from './registry'
import type { SlashContext, SlashCommandDef } from './types'

export function makeHelpCommand(_registry: CommandRegistry): SlashCommandDef {
  return {
    name: 'help',
    description: 'List all available slash commands',
    usage: '/help',
    owner: 'canvas',
    category: 'meta',
    handler: (_args: Record<string, string>, _ctx: SlashContext) => {
      // TODO: implementation in Task 2.6 (needs ctx.toast)
    },
  }
}
