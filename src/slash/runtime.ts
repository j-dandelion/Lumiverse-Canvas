import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { CommandRegistry } from './registry'
import { installIntercept } from './intercept'
import { makeHelpCommand } from './builtin-help'
import { showSuggest, hideSuggest } from './suggest'
import { dispatchCommand } from './dispatch'
import type { SlashContext } from './types'

export function attachSlashRuntime(ctx: SpindleFrontendContext): () => void {
  const registry = new CommandRegistry()
  registry.register(makeHelpCommand(registry))

  // Construct SlashContext. chatId source: ctx.getActiveChat()?.chatId
  // (verified in Phase 0 recon; high confidence). Fall back to '' if no
  // active chat. v1.1.0 has no userId; v1.2.0 may add it.
  const slashCtx: SlashContext = {
    chatId: ctx.getActiveChat()?.chatId ?? '',
    setText: (text) => {
      const ta = document.querySelector<HTMLTextAreaElement>('textarea[name="chat-message"]')
      if (!ta) return
      ta.value = text
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    },
    toast: (kind, text) => {
      // CustomEvent — Task 2.7 wires the real toast surface. For now, log.
      window.dispatchEvent(new CustomEvent('canvas:slash-toast', { detail: { kind, text } }))
    },
  }

  const detachIntercept = installIntercept(ctx, {
    onParsed: (parsed) => {
      dispatchCommand(parsed, slashCtx, registry)
    },
    onTextChange: (text) => {
      if (text.startsWith('/')) {
        const prefix = text.split(/\s/)[0].slice(1).toLowerCase()  // "/select 25" → "select"
        const matches = registry.list()
          .filter((c) => c.name.toLowerCase().startsWith(prefix))
          .map((c) => c.usage ?? '/' + c.name)
        const ta = document.querySelector<HTMLTextAreaElement>('textarea[name="chat-message"]')
        if (ta) showSuggest(ta, matches)
      } else {
        hideSuggest()
      }
    },
  })

  // Listen for toast events — Task 2.7 wires the real surface. For now, log.
  const toastListener = (e: Event) => {
    const detail = (e as CustomEvent).detail
    console.log(`[canvas-slash toast ${detail.kind}]`, detail.text)
  }
  window.addEventListener('canvas:slash-toast', toastListener)

  // And in teardown:
  return () => {
    detachIntercept()
    window.removeEventListener('canvas:slash-toast', toastListener)
    registry.clear()
  }
}
