// Capture-phase keydown + send-button click intercept.
// Exported: installIntercept(ctx, callbacks: InterceptCallbacks): () => void
//
// Slash key surface:
//   Enter         — popup visible: insert the active row's usage into the
//                   textarea, hide the popup, and focus (matches Tab/click).
//                   popup hidden: dispatch the typed slash command (legacy).
//   Tab           — autocomplete the active row's usage into the textarea
//   ArrowUp/Down  — move the active row when popup is visible
//   Escape        — dismiss the popup (without clearing the textarea)
//
// All other keys fall through to Lumiverse's bubble-phase handlers. The
// capture-phase wiring mirrors the mobile send-button intercept pattern
// Chronicle's /select command uses for its keydown + touchend dual paths.
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { ParsedCommand } from './parse'
import { parseCommand } from './parse'
import {
  hideSuggest,
  isSuggestVisible,
  getSuggestController,
} from './suggest'
import { SELECTOR_SEND_BTN, SELECTOR_TEXTAREA } from '../dom/selectors'

export interface InterceptCallbacks {
  onParsed: (parsed: ParsedCommand, textarea: HTMLTextAreaElement) => void
  onTextChange: (text: string) => void
}

// Set by the Tab handler right before dispatching the synthetic `input`
// event. The inputHandler reads + clears it so the runtime's onTextChange
// doesn't re-show the popup with options that match the freshly-completed
// command. Without this, Tab committing `/se` → `/select ` would
// immediately re-open the popup with the full command list.
let _skipNextTextChange = false

// Toggled by `compositionstart` / `compositionend` capture-phase listeners.
// During CJK IME input the textarea's value can briefly start with `/` mid-
// composition, which would cause the suggest popup to flicker as
// showSuggest / hideSuggest cycle. The inputHandler short-circuits when
// this flag is true. Mirrors the `isComposingRef` pattern in
// ~/Lumiverse/frontend/src/components/chat/InputArea.tsx:200-205, 1879-1889
// and ~/Lumiverse/frontend/src/components/modals/CommandPalette.tsx:47.
let _isComposing = false

export function installIntercept(
  _ctx: SpindleFrontendContext,
  callbacks: InterceptCallbacks,
): () => void {
  // ── Keydown: capture phase so we run BEFORE Lumiverse's bubble-phase handler
  const keydownHandler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    if (!target || target.tagName !== 'TEXTAREA') return
    if (target.getAttribute('name') !== 'chat-message') return

    const ta = target as HTMLTextAreaElement
    const popupVisible = isSuggestVisible()

    // Escape: hide popup if visible. Never interfere with IME composition
    // (some IMEs use Escape to cancel composition, and we should let them).
    if (e.key === 'Escape') {
      if (popupVisible) {
        e.preventDefault()
        e.stopPropagation()
        hideSuggest()
      }
      return
    }

    // All other slash keys below are gated on !isComposing to avoid
    // stealing key events from the IME during CJK / accent input.
    if (e.isComposing) return

    const ctrl = popupVisible ? getSuggestController() : null

    // ArrowDown / ArrowUp: move active row when popup is visible.
    // When the popup is hidden, the textarea's default cursor-movement
    // behavior takes over.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!ctrl) return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      ctrl.setActiveIndex(
        e.key === 'ArrowDown' ? ctrl.getActiveIndex() + 1 : ctrl.getActiveIndex() - 1,
      )
      return
    }

    // Tab: autocomplete the active row's usage into the textarea. We do NOT
    // dispatch — Tab is for "insert this command name, let me keep editing."
    if (e.key === 'Tab') {
      if (!ctrl) return
      const activeCmd = ctrl.getActiveCommand()
      if (!activeCmd) {
        // No active row (e.g. empty options) — just dismiss the popup and
        // let the browser move focus normally.
        hideSuggest()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      const label = activeCmd.usage ?? `/${activeCmd.name}`
      // If the user has already typed args (a space is present), don't
      // re-add a trailing space — preserve whatever they typed.
      const alreadyHasArgs = ta.value.includes(' ')
      const replacement = alreadyHasArgs ? label : `${label} `
      // Flag the input handler to skip re-showing the popup for the
      // synthetic input event we dispatch below.
      _skipNextTextChange = true
      ta.value = replacement
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      hideSuggest()
      return
    }

    // Enter: dispatch a complete slash command if one is parseable. Only
    // treat Enter as autocomplete when the typed value is a *partial*
    // prefix — the "Tab/click" semantic. The old logic dispatched the
    // active row's usage into the textarea on Enter whenever the popup
    // was visible, which wiped user-typed args (e.g. `/select 1-3` →
    // `/select `) and stranded the cursor mid-line. A user with a
    // complete command in the textarea means "send it" — full stop.
    if (e.key === 'Enter' && !e.shiftKey) {
      const parsed = parseCommand(ta.value)
      if (parsed) {
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
        return
      }

      // No parseable command in the textarea. If the popup is visible,
      // treat Enter as Tab/click — autocomplete the active row's usage
      // into the textarea so the user can finish typing before sending.
      if (popupVisible) {
        const activeCmd = ctrl?.getActiveCommand() ?? null
        if (!activeCmd) {
          // Popup visible but no active row — hide and let Enter fall through
          // to the textarea's natural newline behavior.
          hideSuggest()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        const label = activeCmd.usage ?? `/${activeCmd.name}`
        // Match Tab/click: preserve user-typed args if a space is present,
        // otherwise add a trailing space so the cursor is ready for input.
        const alreadyHasArgs = ta.value.includes(' ')
        const replacement = alreadyHasArgs ? label : `${label} `
        // Flag the input handler to skip re-showing the popup for the
        // synthetic input event we dispatch below.
        _skipNextTextChange = true
        ta.value = replacement
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        hideSuggest()
        ta.focus()
      }
    }
  }

  document.addEventListener('keydown', keydownHandler, true)

  // ── IME composition: capture-phase so we set the flag before any
  //    textarea `input` event fires mid-composition. Some Android IMEs
  //    (Gboard swipe, Samsung Keyboard) commit via composition without
  //    firing a trailing `input` event, so compositionend also re-runs
  //    detection explicitly.
  const compositionStartHandler = (): void => {
    _isComposing = true
  }
  const compositionEndHandler = (e: Event): void => {
    _isComposing = false
    const target = e.target as HTMLElement | null
    if (!target || target.tagName !== 'TEXTAREA') return
    if (target.getAttribute('name') !== 'chat-message') return
    const ta = target as HTMLTextAreaElement
    // Defer one microtask so any trailing `input` event (browsers that
    // fire input after compositionend) has a chance to land first; the
    // second onTextChange is idempotent and ensures the popup reflects
    // the committed value even on IMEs that don't fire input at all.
    queueMicrotask(() => callbacks.onTextChange(ta.value))
  }
  document.addEventListener('compositionstart', compositionStartHandler, true)
  document.addEventListener('compositionend', compositionEndHandler, true)

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

  // ── Suggest overlay: forward textarea input to the runtime, which decides
  //    whether to show or hide the popup. The inputHandler is a thin relay.
  const inputHandler = (e: Event) => {
    const target = e.target as HTMLElement | null
    if (!target || target.tagName !== 'TEXTAREA') return
    if (target.getAttribute('name') !== 'chat-message') return

    // IME composition in progress — defer to compositionend, which will
    // re-run detection with the committed value.
    if (_isComposing) return

    // Tab commit set this flag — see keydownHandler. Clear and skip the
    // runtime callback so the popup doesn't re-open with the typed
    // command already in the textarea.
    if (_skipNextTextChange) {
      _skipNextTextChange = false
      return
    }

    callbacks.onTextChange((target as HTMLTextAreaElement).value)
  }

  document.addEventListener('input', inputHandler, true)

  return () => {
    document.removeEventListener('keydown', keydownHandler, true)
    document.removeEventListener('click', clickHandler, true)
    document.removeEventListener('input', inputHandler, true)
    document.removeEventListener('compositionstart', compositionStartHandler, true)
    document.removeEventListener('compositionend', compositionEndHandler, true)
    _isComposing = false
    _skipNextTextChange = false
    hideSuggest()
  }
}