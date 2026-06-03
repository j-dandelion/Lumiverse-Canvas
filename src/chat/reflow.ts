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
import { getChatColumn, getMainSidebar, getMainWrapper, getMainDrawerWidth } from '../dom/lumiverse'
import { findStoreData, getDrawerTabs, getMainDrawerSide, isMainDrawerOpen } from '../store'
import { dlog } from '../debug/log'
import { isSecondarySidebarOpen, SECONDARY_WIDTH_VAR } from '../frontend'  // FIXME-decomp(step 9): re-point to '../sidebar/secondary'

export function setChatMargin(side: 'left' | 'right', px: number): void {
  const chat = getChatColumn()
  if (!chat) return
  const varName = side === 'left' ? '--sidebar-ux-chat-ml' : '--sidebar-ux-chat-mr'
  chat.style.setProperty(varName, `${px}px`)
}

export function injectReflowStyles(): void {
  if (document.getElementById('sidebar-ux-reflow')) return
  const style = document.createElement('style')
  style.id = 'sidebar-ux-reflow'
  style.textContent = `
    [class*="_chatColumn_"] {
      margin-left: var(--sidebar-ux-chat-ml, 0px) !important;
      margin-right: var(--sidebar-ux-chat-mr, 0px) !important;
      transition: margin 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
  `
  document.head.appendChild(style)
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
// sidebar/secondary.tsx after Step 9. Until then, frontend.ts owns it and
// the callers reference it via the still-large entry. Re-exported from
// chat/reflow for setup()'s convenience; the canonical home is M10.
export { injectDrawerTabStyles } from '../frontend'  // FIXME-decomp(step 9)

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

  // Separate observer on the main sidebar for child-list changes. When a tab
  // is added or replaced (e.g., after a Spindle extension reloads), we need
  // to re-tag its button with data-tab-id so the id-based match in
  // findMainTabButton / switchMainDrawerToFallback works. Without this, we'd
  // fall back to title-matching, which is the bug class Finding #7 fixes.
  const sidebarObserver = new MutationObserver(() => scheduleTagMainSidebarButtons())
  const waitForSidebar = () => {
    const sidebar = getMainSidebar()
    if (sidebar) {
      sidebarObserver.observe(sidebar, { childList: true, subtree: true })
      // Initial tag pass — sidebar exists, but buttons may already be rendered.
      tagMainSidebarButtons()
      return
    }
    requestAnimationFrame(waitForSidebar)
  }
  waitForSidebar()

  return () => {
    observer.disconnect()
    sidebarObserver.disconnect()
  }
}

let _tagMainSidebarButtonsRaf: number | null = null

export function scheduleTagMainSidebarButtons(): void {
  if (_tagMainSidebarButtonsRaf !== null) return
  _tagMainSidebarButtonsRaf = requestAnimationFrame(() => {
    _tagMainSidebarButtonsRaf = null
    tagMainSidebarButtons()
  })
}

/**
 * Tag every extension tab button in the main sidebar with a `data-tab-id`
 * attribute. Walks the store's drawerTabs and matches each by title.
 * Idempotent — skips buttons that are already tagged.
 *
 * Returns the number of buttons tagged in this pass.
 */
export function tagMainSidebarButtons(): number {
  const sidebar = getMainSidebar()
  if (!sidebar) return 0

  // Force a fresh fiber walk — the cached snapshot may predate the latest
  // tab registration (e.g., LumiBooks registers after Prompt Viewer). The
  // cache TTL is 3s, but sidebar mutations can fire well inside that window
  // with an incomplete view of the store.
  findStoreData(true)
  const tabs = getDrawerTabs()
  if (tabs.length === 0) return 0

  let tagged = 0
  // Iterate buttons, not tabs, because the title-match is the *initial*
  // identity. A button's title is set by Lumiverse and is what the user sees.
  const buttons = sidebar.querySelectorAll('button[title]')
  for (const btn of buttons) {
    const existing = btn.getAttribute('data-tab-id')
    if (existing) continue  // already tagged
    const btnTitle = btn.getAttribute('title')
    if (!btnTitle) continue
    const tab = tabs.find(t => t.title === btnTitle)
    if (tab) {
      btn.setAttribute('data-tab-id', tab.id)
      tagged++
    }
  }
  if (tagged > 0) dlog(`tagMainSidebarButtons: tagged ${tagged} button(s)`)
  return tagged
}
