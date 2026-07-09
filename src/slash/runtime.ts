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
import { parseArgMode, pickActive } from './arg-completions'
import { hideGhost, setGhost } from './ghost-text'
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

/** Build synthetic suggest rows for arg completions. */
function argCompletionRows(
  cmd: SlashCommandDef,
  candidates: string[],
): SlashCommandDef[] {
  return candidates.map((c) => ({
    name: c,
    description: 'Complete argument',
    owner: cmd.owner,
    usage: `/${cmd.name} ${c}`,
    handler: cmd.handler,
    category: cmd.category,
  }))
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

  const syncGhostForArg = (
    ta: HTMLTextAreaElement,
    fullArg: string | null,
    argStart: number,
    argEnd: number,
    typedPrefix: string,
  ): void => {
    if (!fullArg) {
      hideGhost()
      return
    }
    setGhost(ta, {
      fullArg,
      range: { start: argStart, end: argEnd },
      typedPrefix,
    })
  }

  const onTextChange = (text: string): void => {
    if (!text.startsWith('/')) {
      hideSuggest()
      lastActiveIndex = null
      return
    }

    // ── Arg mode: space after command token + command has getArgCompletions
    const argMode = parseArgMode(text)
    if (argMode) {
      const cmd =
        registry.lookup(argMode.cmdName) ??
        registry.lookup(argMode.cmdName.toLowerCase())
      if (cmd?.getArgCompletions) {
        const candidates = cmd.getArgCompletions(argMode.argPrefix, {
          chatId: slashCtx.chatId,
        })
        if (candidates.length === 0) {
          hideSuggest()
          lastActiveIndex = null
          return
        }

        const ta = document.querySelector<HTMLTextAreaElement>(SELECTOR_TEXTAREA)
        if (!ta) return

        // Sticky active index while typing a non-empty arg prefix.
        let activeIndex = 0
        if (
          lastActiveIndex != null &&
          lastActiveIndex >= 0 &&
          lastActiveIndex < candidates.length &&
          argMode.argPrefix.trim().length > 0
        ) {
          activeIndex = lastActiveIndex
        }
        lastActiveIndex = activeIndex

        const rows = argCompletionRows(cmd, candidates)
        showSuggest(ta, rows, activeIndex, (i, activeCmd) => {
          lastActiveIndex = i
          const fullArg = activeCmd?.name ?? pickActive(candidates, i)
          syncGhostForArg(
            ta,
            fullArg,
            argMode.argStart,
            argMode.argEnd,
            argMode.argPrefix,
          )
        })

        const fullArg = pickActive(candidates, activeIndex)
        syncGhostForArg(
          ta,
          fullArg,
          argMode.argStart,
          argMode.argEnd,
          argMode.argPrefix,
        )
        return
      }
    }

    // ── Command-name mode (or arg mode without getArgCompletions)
    hideGhost()
    const prefix = text.split(/\s/)[0]!.slice(1).toLowerCase()
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
  }

  const detachIntercept = installIntercept(ctx, {
    onParsed: (parsed) => {
      dispatchCommand(parsed, slashCtx, registry)
    },
    onTextChange,
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

  // Persona (and similar) warm caches async; refresh suggest when ready.
  const completionsChangedListener = (): void => {
    const ta = document.querySelector<HTMLTextAreaElement>(SELECTOR_TEXTAREA)
    if (!ta) return
    if (!ta.value.startsWith('/')) return
    onTextChange(ta.value)
  }
  window.addEventListener('canvas:slash-completions-changed', completionsChangedListener)

  // And in teardown:
  return () => {
    unmountToast()
    detachIntercept()
    window.removeEventListener('canvas:slash-register', registerListener)
    window.removeEventListener('canvas:slash-unregister', unregisterListener)
    window.removeEventListener('canvas:slash-completions-changed', completionsChangedListener)
    unregisterByName.clear()
    registry.clear()
    hideGhost()
  }
}
