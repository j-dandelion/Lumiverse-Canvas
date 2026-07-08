import type { SlashCommandDef } from '../../types'

export function makeNewChatCommand(): SlashCommandDef {
  return {
    name: 'newchat',
    description: 'Start a new chat with the currently selected character',
    usage: '/newchat',
    owner: 'canvas',
    category: 'chat',
    handler: async (_args, ctx) => {
      ctx.toast('info', 'New chat command registered (not yet implemented)')
    },
  }
}
