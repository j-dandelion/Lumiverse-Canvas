// Capture-phase keydown + send-button click intercept.
// Exported: installIntercept(ctx, callbacks: InterceptCallbacks): () => void
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { ParsedCommand } from './parse'
import { parseCommand } from './parse'
import { hideSuggest } from './suggest'

// CSS-module class is hashed. The prefix `sendBtn` is stable across builds.
const SELECTOR_SEND_BTN = 'button[class*="sendBtn"]'
const SELECTOR_TEXTAREA = 'textarea[name="chat-message"]'

export interface InterceptCallbacks {
  onParsed: (parsed: ParsedCommand, textarea: HTMLTextAreaElement) => void
  onTextChange: (text: string) => void
}

export function installIntercept(
  _ctx: SpindleFrontendContext,
  callbacks: InterceptCallbacks,
): () => void {
  // ── Keydown: capture phase so we run BEFORE Lumiverse's bubble-phase handler
  const keydownHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    const target = e.target as HTMLElement | null
    if (!target || target.tagName !== 'TEXTAREA') return
    if (target.getAttribute('name') !== 'chat-message') return

    const ta = target as HTMLTextAreaElement
    const parsed = parseCommand(ta.value)
    if (!parsed) return

    // Slash command matched. Bypass Lumiverse's handleSend entirely.
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    // Clear the textarea on the next frame (rAF fires after the current paint).
    // The textarea is a React controlled component — useState for `text` won't
    // re-render without a synthetic `input` event. Dispatching it manually
    // after rAF is the load-bearing pattern. (Chronicle skill pitfall #5)
    requestAnimationFrame(() => {
      ta.value = ''
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })

    hideSuggest()
    callbacks.onParsed(parsed, ta)
  }

  document.addEventListener('keydown', keydownHandler, true)

  // ── Send button: capture-phase click (works for both mouse and touch,
  //    since mobile browsers fire click after touchend).
  const clickHandler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    if (!target.closest(SELECTOR_SEND_BTN)) return

    const ta = document.querySelector<HTMLTextAreaElement>(SELECTOR_TEXTAREA)
    if (!ta) return

    const parsed = parseCommand(ta.value)
    if (!parsed) return

    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()

    requestAnimationFrame(() => {
      ta.value = ''
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })

    hideSuggest()
    callbacks.onParsed(parsed, ta)
  }

  document.addEventListener('click', clickHandler, true)

  // ── Suggest overlay: update on every input event in the chat textarea
  const inputHandler = (e: Event) => {
    const target = e.target as HTMLElement | null
    if (!target || target.tagName !== 'TEXTAREA') return
    if (target.getAttribute('name') !== 'chat-message') return

    const ta = target as HTMLTextAreaElement
    if (ta.value.startsWith('/')) {
      // Show suggestion overlay — implementation in Task 2.5
      // (placeholder for now)
    } else {
      hideSuggest()
    }
    callbacks.onTextChange(ta.value)
  }

  document.addEventListener('input', inputHandler, true)

  return () => {
    document.removeEventListener('keydown', keydownHandler, true)
    document.removeEventListener('click', clickHandler, true)
    document.removeEventListener('input', inputHandler, true)
    hideSuggest()
  }
}
