import type { SlashCommandDef } from '../../types'

export function makePersonaCommand(): SlashCommandDef {
  return {
    name: 'persona',
    description: 'Switch the active persona in the current chat',
    usage: '/persona <name>',
    owner: 'canvas',
    category: 'chat',
    handler: async (args, ctx) => {
      const personaName = args._raw?.trim()

      if (!personaName) {
        ctx.toast('error', 'Usage: /persona <name>')
        return
      }

      // Implementation will go here
      ctx.toast('info', `Persona command registered for: ${personaName} (not yet implemented)`)
    },
  }
}
