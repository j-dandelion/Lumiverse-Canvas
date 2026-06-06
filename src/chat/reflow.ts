// Chat-margin reflow + main-sidebar button tagging.
//
// Two related concerns share a single startReflowObserver lifecycle:
//   1. Chat reflow — watch the main wrapper's class/style mutations and
//      recompute the chat column's --sidebar-ux-chat-ml/mr CSS variables
//      so the chat stays centered in the visible area when the main and/or
//      secondary drawer is open.
//   2. Main-sidebar button tagging — watch the main sidebar for child-list
//      changes (tab add/replace) and tag each extension tab button with a
//      stable `data-tab-id` attribute. The id-based match is what
//      findMainTabButton / switchMainDrawerToFallback / isMovedTabNode rely
//      on; the previous title-match was the bug class v1.3.0 closed.
//
// Both observers are gated on this function being called, which in setup()
// only happens when CanvasSettings.chatReflow is on.
//
// The tagger is currently co-located here. After the v1.4.0 refactor the
// tagger will move to its own chat/tag-buttons.ts module; the function
// bodies are independent — the tagger does not read or write any of the
// reflow state.
import { getChatColumn, getMainWrapper, getMainDrawerWidth } from '../dom/lumiverse'
import { getMainDrawerSide, isMainDrawerOpen } from '../store'
import { isSecondarySidebarOpen, SECONDARY_WIDTH_VAR } from '../sidebar/secondary'
import { startTagObserver } from './tag-buttons'
import { injectStyles } from '../debug/styles'

export function setChatMargin(side: 'left' | 'right', px: number): void {
  const chat = getChatColumn()
  if (!chat) return
  const varName = side === 'left' ? '--sidebar-ux-chat-ml' : '--sidebar-ux-chat-mr'
  chat.style.setProperty(varName, `${px}px`)
}

export function injectReflowStyles(): void {
  injectStyles('sidebar-ux-reflow', `
    [class*="_chatColumn_"] {
      margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
      margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
      transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
  `)
}

let _reflowRaf: number | null = null

export function scheduleReflow(): void {
  if (_reflowRaf !== null) return
  _reflowRaf = requestAnimationFrame(() => {
    _reflowRaf = null
    updateChatReflow()
  })
}

export function updateChatReflow(): void {
  const mainSide = getMainDrawerSide()
  const mainOpen = isMainDrawerOpen()
  const mainWidth = mainOpen ? getMainDrawerWidth() : 0

  // Secondary sidebar is on the opposite side
  const secondaryWidth = isSecondarySidebarOpen()
    ? parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
    : 0

  // Set CSS variables for chat column margins (centering)
  if (mainSide === 'left') {
    setChatMargin('left', mainWidth)
    setChatMargin('right', secondaryWidth)
  } else {
    setChatMargin('right', mainWidth)
    setChatMargin('left', secondaryWidth)
  }
}

// injectDrawerTabStyles (sidebar-ux-drawer-tab CSS) lives in
// sidebar/secondary.tsx. Until then, frontend.ts owns it and
// the callers reference it via the still-large entry. Re-exported from
// chat/reflow for setup()'s convenience; the canonical home is M10.
export { injectDrawerTabStyles } from '../sidebar/secondary'

export function startReflowObserver(): () => void {
  injectReflowStyles()

  const observer = new MutationObserver(() => scheduleReflow())
  const waitForWrapper = () => {
    const wrapper = getMainWrapper()
    if (wrapper) {
      observer.observe(wrapper, { attributes: true, attributeFilter: ['class', 'style'] })
      updateChatReflow()
      return
    }
    requestAnimationFrame(waitForWrapper)
  }
  waitForWrapper()

  // Tagger observer: bundled with the reflow observer so the v1.4.2 lifecycle
  // (gated on CanvasSettings.chatReflow) is preserved. The tagger is exported
  // as its own startTagObserver() in chat/tag-buttons.ts and can be wired
  // independently when setup() is decomposed.
  const stopTagObserver = startTagObserver()

  return () => {
    observer.disconnect()
    stopTagObserver()
  }
}
