// /help — aggregates registry.list() and shows them.
import type { CommandRegistry } from './registry'
import type { SlashContext, SlashCommandDef } from './types'

export function makeHelpCommand(registry: CommandRegistry): SlashCommandDef {
  return {
    name: 'help',
    description: 'List all available slash commands',
    usage: '/help',
    owner: 'canvas',
    category: 'meta',
    handler: (_args: Record<string, string>, ctx: SlashContext) => {
      const cmds = registry.list()
      const lines = cmds.map((c) => `${c.usage ?? '/' + c.name}  —  ${c.description}`)
      ctx.toast('info', lines.join('\n'))
    },
  }
}
