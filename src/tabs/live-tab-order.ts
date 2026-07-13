// Live drawer tab-button order readers.
//
// Used by live strip DnD (buildDraftAndBase) and Configure Tabs open/refresh
// so both paths see the same primary/secondary order as the DOM strips.

import { isSettingsButton } from './buttons'
import { getSecondaryTabList } from '../sidebar/secondary'
import { getMainSidebar } from '../dom/lumiverse'

/**
 * data-tab-id order of displayed (not display:none) tab buttons in a list.
 * Skips Settings chrome.
 */
export function readVisibleTabIdsFromList(list: HTMLElement | null): string[] {
  if (!list) return []
  const out: string[] = []
  for (const el of Array.from(
    list.querySelectorAll('button[data-tab-id]'),
  ) as HTMLElement[]) {
    if (isSettingsButton(el)) continue
    // Hidden tabs keep display:none via applyHiddenTabIds*; omit so
    // alignIdsToLiveVisibleOrder can park them via hiddenIds slots.
    if (el.style?.display === 'none') continue
    const id = el.getAttribute('data-tab-id') || ''
    if (id) out.push(id)
  }
  return out
}

/** Live primary strip: main-mirror main section (taskbar DnD) or host tabList. */
export function readLivePrimaryTabIds(): string[] {
  const mirrorMain = document.querySelector(
    '.sidebar-ux-main-tab-list-mirror .sidebar-ux-tab-list-main',
  ) as HTMLElement | null
  if (mirrorMain) return readVisibleTabIdsFromList(mirrorMain)

  const sidebar = getMainSidebar()
  if (!sidebar) return []
  const tabList =
    (sidebar.querySelector(
      '[class*="tabListWrap"] > [class*="tabList"]',
    ) as HTMLElement | null) ||
    (sidebar.querySelector('[class*="tabList"]') as HTMLElement | null)
  return readVisibleTabIdsFromList(tabList)
}

/** Live secondary strip tab-button order. */
export function readLiveSecondaryTabIds(): string[] {
  return readVisibleTabIdsFromList(getSecondaryTabList())
}
