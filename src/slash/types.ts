// Shared types for the slash-command runtime.
// Shapes documented in references/slash-command-extension-api.md (Task 4.1).

export interface SlashCommandDef {
  name: string                          // 'help', 'select', etc.
  description: string                   // shown in /help
  usage?: string                        // '/select <range>' — shown in /help
  argsSchema?: {                        // for suggestion preview (future)
    name: string
    type: 'string' | 'number' | 'enum'
    values?: string[]
    optional?: boolean
  }[]
  /**
   * Sync preferred. Prefix is current arg text after first space (may be '').
   * Return candidate argument strings (not full command lines). Used for
   * arg-mode suggest rows + ghost-text completion.
   */
  getArgCompletions?: (prefix: string, ctx: { chatId: string }) => string[]
  handler: (args: Record<string, string>, ctx: SlashContext) => Promise<void> | void
  owner: string                         // extension identifier
  category?: 'select' | 'layout' | 'theme' | 'lore' | 'chat' | 'meta'
}

export interface SlashContext {
  chatId: string
  setText: (text: string) => void        // write back to textarea (input event)
  toast: (kind: 'info' | 'error' | 'success', text: string) => void
}
