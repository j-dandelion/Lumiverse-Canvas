// Main-sidebar extension-tab-button tagging.
//
// Walks the store's drawerTabs and matches each by title, setting
// `data-tab-id` on every extension tab button. The id-based match is what
// findMainTabButton / switchMainDrawerToFallback / isMovedTabNode rely
// on; the previous title-match was the bug class v1.3.0 closed.
//
// Lives in its own module so chat/reflow.ts (which owns the chat-margin
// reflow watcher) does not have to know about the tab-tagging concern.
// The two are bundled into startReflowObserver's lifecycle by
// chat/reflow.startReflowObserver (which calls startTagObserver here);
// the two become independently gateable when setup() is decomposed.
import { getMainSidebar } from '../dom/lumiverse'
import { findStoreData, getDrawerTabs } from '../store'
import { dlog } from '../debug/log'

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

/**
 * Install the sidebar MutationObserver that re-tags on tab add/replace and
 * runs the initial tag pass once the sidebar is in the DOM. Returned
 * teardown is called by chat/reflow.startReflowObserver's wrapper.
 */
export function startTagObserver(): () => void {
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
    sidebarObserver.disconnect()
  }
}
