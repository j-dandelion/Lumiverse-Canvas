// Single entry. Wires intercept → parse → dispatch → handler.
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { CommandRegistry } from './registry'
import { installIntercept } from './intercept'
import { makeHelpCommand } from './builtin-help'

export function attachSlashRuntime(ctx: SpindleFrontendContext): () => void {
  const registry = new CommandRegistry()
  registry.register(makeHelpCommand(registry))

  // Detach placeholder — full intercept wired in Task 2.4
  const detachIntercept = installIntercept(ctx, {
    onParsed: (_parsed, _ta) => { /* implementation: Task 2.6 */ },
    onTextChange: (_text) => { /* implementation: Task 2.5 */ },
  })

  return () => {
    detachIntercept()
  }
}
