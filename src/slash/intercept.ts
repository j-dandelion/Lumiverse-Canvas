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
import { getIntent, clearIntent, setIntent, reconcileWithTextarea } from './intent'
import {
  hideSuggest,
  isSuggestVisible,
  getSuggestController,
} from './suggest'
import { SELECTOR_SEND_BTN, SELECTOR_TEXTAREA } from '../dom/selectors'
import {
  applySuggestion,
  consumeSkipNextTextChange,
  isValidSlashContext,
  resetSkipNextTextChange,
  textareaHasUsage,
} from './dom-utils'

export interface InterceptCallbacks {
  onParsed: (parsed: ParsedCommand, textarea: HTMLTextAreaElement) => void
  onTextChange: (text: string) => void
}

// The skip flag is now owned by dom-utils.ts so intercept.ts and
// suggest.ts can share it without forming a circular import.

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
      // Slash rule: autocomplete is only valid when '/' is at column 0.
      // If the popup is somehow visible with a non-'/' prefix (race or
      // legacy state), dismiss and let default Tab focus-shift happen.
      if (!isValidSlashContext(ta)) {
        hideSuggest()
        return
      }
      // No-op guard: same as Enter. If the textarea already contains
      // the active command's full usage (with possible trailing
      // whitespace), just dismiss the popup and let default Tab
      // focus-shift happen (no preventDefault — the user might be
      // tabbing away from the textarea). Equality (textarea == usage)
      // is NOT a no-op — autocomplete should add the trailing space.
      if (textareaHasUsage(ta, activeCmd)) {
        hideSuggest()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      const label = activeCmd.usage ?? `/${activeCmd.name}`
      applySuggestion(ta, label)
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
      // Popup visible → always autocomplete the active row's usage.
      // This is the contract: "press Enter on a suggestion → menu
      // closes, suggestion appears with trailing space, cursor lands
      // after the space; a second Enter then sends." Works regardless
      // of what's currently in the textarea.
      if (popupVisible) {
        if (!ctrl) {
          // Popup visible but no controller — degenerate case. Hide
          // the popup and let Enter fall through to natural newline.
          hideSuggest()
          return
        }
        const activeCmd = ctrl.getActiveCommand()
        if (!activeCmd) {
          hideSuggest()
          return
        }
        // Slash rule: autocomplete is only valid when '/' is at column 0.
        // If the popup is somehow visible with a non-'/' prefix, dismiss
        // the popup and let Enter fall through to natural newline.
        if (!isValidSlashContext(ta)) {
          hideSuggest()
          return
        }
        // No-op guard: if the textarea already contains the active
        // command's full usage (with possible trailing whitespace),
        // pressing Enter should just dismiss the popup without
        // overwriting the user's typed args. We preventDefault to
        // consume the Enter (no newline inserted); a second Enter
        // then dispatches the complete command.
        //
        // Equality (textarea == usage) is NOT a no-op — autocomplete
        // should add the trailing space. This is the "first Enter
        // after the bare command" case: `/select` + Enter → `/select `
        // (with trailing space), then a second Enter dispatches.
        //
        // We must call stopPropagation + stopImmediatePropagation
        // here too — not just preventDefault — because Lumiverse's
        // chat-submit handler listens for Enter in bubble phase and
        // will submit `/select ` to the LLM as a regular chat message
        // otherwise. preventDefault alone blocks the browser's default
        // form submit, but doesn't stop Lumiverse's explicit submit.
        // This is the same set of calls the autocomplete and dispatch
        // branches make; the no-op branch was missing them and
        // leaked `/select ` to the LLM in the "popup visible, no-op"
        // case (textareaHasUsage == true, e.g. `/select ` with
        // trailing space).
        if (textareaHasUsage(ta, activeCmd)) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          hideSuggest()
          ta.focus()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        const label = activeCmd.usage ?? `/${activeCmd.name}`
        applySuggestion(ta, label)
        const parsed = parseCommand(label)
        if (parsed) setIntent(parsed, 'enter-popup')
        hideSuggest()
        ta.focus()
        return
      }

      // Popup hidden: dispatch a complete slash command if parseable.
      // (See the comment at the previous block for why parseCommand
      // is intentionally NOT checked when the popup is visible.)
      // A user pressing Enter with a complete slash command has a fresh intent:
      // the typed value IS the source of truth. Clear any prior intent first so
      // it doesn't bleed into a future send-button tap.
      clearIntent()
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

    // --- Mobile-aware dispatch: prefer the intent (authoritative for slash
    //     commands) and fall back to DOM parsing. The intent survives DOM/React
    //     state clobbers that happen between suggestion-tap and send-tap on
    //     touch devices. The DOM path is the original PC flow.
    let parsed: ParsedCommand | null = null
    const intent = getIntent()
    if (intent) {
      const cmdPrefix = '/' + intent.command.name
      if (ta.value.startsWith(cmdPrefix)) {
        // Textarea still reflects the intent — use its args (the user may have
        // typed more after the command). Strip the command + space; keep the rest.
        const args = ta.value.startsWith(cmdPrefix + ' ')
          ? ta.value.slice(cmdPrefix.length + 1)
          : intent.command.args
        parsed = { name: intent.command.name, args }
      } else if (ta.value.trim() === '' || ta.value === '/') {
        // React clobbered the value. Use the intent's command directly. This is
        // the mobile bug-fix path: the user tapped a suggestion, then tapped
        // send, and React reset the textarea to '/' or '' in between.
        parsed = intent.command
      }
      // Consume the intent (single-shot).
      clearIntent()
    }
    if (!parsed) {
      parsed = parseCommand(ta.value)
    }
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

    // Tab/Enter/click commit set this flag — see dom-utils.ts. Consume
    // (read+clear) and skip the runtime callback so the popup doesn't
    // re-open with the typed command already in the textarea.
    if (consumeSkipNextTextChange()) {
      return
    }

    const value = (target as HTMLTextAreaElement).value
    reconcileWithTextarea(value)
    callbacks.onTextChange(value)
  }

  document.addEventListener('input', inputHandler, true)

  return () => {
    document.removeEventListener('keydown', keydownHandler, true)
    document.removeEventListener('click', clickHandler, true)
    document.removeEventListener('input', inputHandler, true)
    document.removeEventListener('compositionstart', compositionStartHandler, true)
    document.removeEventListener('compositionend', compositionEndHandler, true)
    _isComposing = false
    resetSkipNextTextChange()
    clearIntent()
    hideSuggest()
  }
}