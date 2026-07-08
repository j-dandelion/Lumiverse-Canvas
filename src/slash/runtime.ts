import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { CommandRegistry } from './registry'
import { installIntercept } from './intercept'
import { makeHelpCommand } from './builtin-help'
import { makeSelectCommands } from './commands/select'
import { makeNewChatCommand } from './commands/newchat'
import { makePersonaCommand } from './commands/persona'
import { showSuggest, hideSuggest } from './suggest'
import { dispatchCommand } from './dispatch'
import { mountToastSurface } from './toast'
import { SELECTOR_TEXTAREA } from '../dom/selectors'
import {
  findCompletionCandidateIndex,
  resolveActiveIndex,
  shouldHideForNonMatchingArgs,
  setControlledValue,
} from './dom-utils'
import type { SlashCommandDef, SlashContext } from './types'

// Runtime type guard for the `canvas:slash-register` CustomEvent detail.
// Validates the four required fields (name/description/owner/handler) before
// we hand a value off to CommandRegistry. Optional fields (usage, argsSchema,
// category) are not checked — they're handled by the registry/handler as needed.
function isSlashCommandDef(x: unknown): x is SlashCommandDef {
  return (
    typeof x === 'object' &&
    x !== null &&
    'name' in x &&
    typeof (x as { name: unknown }).name === 'string' &&
    'description' in x &&
    typeof (x as { description: unknown }).description === 'string' &&
    'owner' in x &&
    typeof (x as { owner: unknown }).owner === 'string' &&
    'handler' in x &&
    typeof (x as { handler: unknown }).handler === 'function'
  )
}

export function attachSlashRuntime(ctx: SpindleFrontendContext): () => void {
  const registry = new CommandRegistry()
  registry.register(makeHelpCommand(registry))
  for (const cmd of makeSelectCommands()) {
    registry.register(cmd)
  }
  registry.register(makeNewChatCommand())
  registry.register(makePersonaCommand())

  // Track cleanup functions returned by registry.register so we can invoke
  // them on `canvas:slash-unregister` (mid-session command removal). Map
  // keyed by command name; a re-registration replaces the prior entry by
  // calling its cleanup first, mirroring the safe-unregister pattern in
  // registry.ts.
  const unregisterByName = new Map<string, () => void>()

  // Construct SlashContext. chatId source: ctx.getActiveChat()?.chatId
  // (verified in Phase 0 recon; high confidence). Fall back to '' if no
  // active chat. v1.1.0 has no userId; v1.2.0 may add it.
  // Sticky last-active-row index. Preserved across keystrokes when the
  // user has typed a non-whitespace arg char, so backspacing/typing
  // within a partial arg doesn't snap the highlight back to the default.
  // Reset to null when the user is back to a whitespace-only (or no) arg.
  let lastActiveIndex: number | null = null

  const slashCtx: SlashContext = {
    get chatId() { return ctx.getActiveChat()?.chatId ?? '' },
    setText: (text) => {
      const ta = document.querySelector<HTMLTextAreaElement>(SELECTOR_TEXTAREA)
      if (!ta) return
      // Use the React-aware setter so any slash command handler that calls
      // setText doesn't fall into the same DOM/React clobber race.
      setControlledValue(ta, text)
    },
    toast: (kind, text) => {
      // Dispatch CustomEvent; the toast surface (toast.tsx) listens and renders.
      window.dispatchEvent(new CustomEvent('canvas:slash-toast', { detail: { kind, text } }))
    },
  }

  const detachIntercept = installIntercept(ctx, {
    onParsed: (parsed) => {
      dispatchCommand(parsed, slashCtx, registry)
    },
    onTextChange: (text) => {
      if (text.startsWith('/')) {
        const prefix = text.split(/\s/)[0].slice(1).toLowerCase()
        const matches = registry.list()
          .filter((c) => c.name.toLowerCase().startsWith(prefix))
        if (matches.length === 0) {
          hideSuggest()
          lastActiveIndex = null
          return
        }
        const ta = document.querySelector<HTMLTextAreaElement>(SELECTOR_TEXTAREA)
        if (!ta) return
        const completionIdx = findCompletionCandidateIndex(matches, text)
        if (shouldHideForNonMatchingArgs(text, completionIdx >= 0)) {
          hideSuggest()
          lastActiveIndex = null
          return
        }
        const { activeIndex, nextSticky } = resolveActiveIndex(matches, text, lastActiveIndex)
        lastActiveIndex = nextSticky
        showSuggest(ta, matches, activeIndex)
      } else {
        hideSuggest()
        lastActiveIndex = null
      }
    },
  })

  // Mount the toast surface. The toast.tsx module registers a CustomEvent
  // listener for 'canvas:slash-toast' on import; mountToastSurface mounts
  // the Preact render.
  const unmountToast = mountToastSurface()

  // Listen for runtime command registration. Other extensions (or DevTools
  // scripts) can dispatch:
  //   window.dispatchEvent(new CustomEvent('canvas:slash-register', {
  //     detail: { command: { name, description, owner, handler, ... } }
  //   }))
  const registerListener = (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (isSlashCommandDef(detail?.command)) {
      // Re-registration replaces the prior entry: call its cleanup first so
      // we don't leak the old cleanup function in the Map.
      const prior = unregisterByName.get(detail.command.name)
      if (prior) prior()
      const cleanup = registry.register(detail.command)
      unregisterByName.set(detail.command.name, cleanup)
    }
  }
  window.addEventListener('canvas:slash-register', registerListener)

  // Listen for runtime command unregistration.
  //   window.dispatchEvent(new CustomEvent('canvas:slash-unregister', {
  //     detail: { name: 'test' }
  //   }))
  const unregisterListener = (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (detail && typeof detail.name === 'string') {
      const cleanup = unregisterByName.get(detail.name)
      if (cleanup) {
        cleanup()
        unregisterByName.delete(detail.name)
      }
    }
  }
  window.addEventListener('canvas:slash-unregister', unregisterListener)

  // And in teardown:
  return () => {
    unmountToast()
    detachIntercept()
    window.removeEventListener('canvas:slash-register', registerListener)
    window.removeEventListener('canvas:slash-unregister', unregisterListener)
    unregisterByName.clear()
    registry.clear()
  }
}