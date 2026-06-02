// Single entry. Wires intercept → parse → dispatch → handler.
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { CommandRegistry } from './registry'
import { installIntercept } from './intercept'
import { makeHelpCommand } from './builtin-help'
import { showSuggest, hideSuggest } from './suggest'

export function attachSlashRuntime(ctx: SpindleFrontendContext): () => void {
  const registry = new CommandRegistry()
  registry.register(makeHelpCommand(registry))

  const detachIntercept = installIntercept(ctx, {
    onParsed: (_parsed, _ta) => { /* implementation: Task 2.6 */ },
    onTextChange: (text) => {
      if (text.startsWith('/')) {
        const prefix = text.split(/\s/)[0].slice(1).toLowerCase()  // "/select 25" → "select"
        const matches = registry.list()
          .filter((c) => c.name.toLowerCase().startsWith(prefix))
          .map((c) => c.usage ?? '/' + c.name)
        // Find the textarea — it's the chat-message textarea
        const ta = document.querySelector<HTMLTextAreaElement>('textarea[name="chat-message"]')
        if (ta) showSuggest(ta, matches)
      } else {
        hideSuggest()
      }
    },
  })

  return () => {
    detachIntercept()
  }
}
