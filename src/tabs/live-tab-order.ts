// Live drawer tab-button order readers.
//
// Used by live strip DnD (buildDraftAndBase) and Configure Tabs open/refresh
// so both paths see the same primary/secondary order as the DOM strips.

import { isSettingsButton, buttonTabId } from './buttons'
import { getSecondaryTabList } from '../sidebar/secondary'
import { getMainSidebar } from '../dom/lumiverse'
import { dlog } from '../debug/log'

// Diagnostic noise guard: log each no-data-tab-id resolution once per id so
// the reader's extension-mirror-button coverage is observable without
// spamming every buildDraftAndBase call.
const _titleResolvedLogged = new Set<string>()

/**
 * data-tab-id order of displayed (not display:none) tab buttons in a list.
 * Skips Settings chrome.
 *
 * Untagged extension-tab buttons carry no `data-tab-id` (never tagged / tag
 * removed by a re-render). Without them the live order misses extension
 * tabs, the draft aligns to a shortened order, and a DnD drop lands one slot
 * lower than the DOM hit-test promised — and a reconcile's setOrder can
 * never converge (observed shorter than model → setOrder every round →
 * infinite SAVE_LAYOUT cascade). Match mirror buttons and untagged host
 * extension buttons by class and resolve the id via buttonTabId so every
 * visible button is counted in DOM order.
 */
export function readVisibleTabIdsFromList(list: HTMLElement | null): string[] {
  if (!list) return []
  const out: string[] = []
  for (const el of Array.from(
    list.querySelectorAll(
      'button[data-tab-id], button.sidebar-ux-main-tab-mirror-btn, button[class*="tabBtnExtension"]',
    ),
  ) as HTMLElement[]) {
    if (isSettingsButton(el)) continue
    // Hidden tabs keep display:none via applyHiddenTabIds*; omit so
    // alignIdsToLiveVisibleOrder can park them via hiddenIds slots.
    if (el.style?.display === 'none') continue
    const hasAttr = el.getAttribute('data-tab-id') !== null
    const id = buttonTabId(el)
    if (id) {
      if (!hasAttr && !_titleResolvedLogged.has(id)) {
        _titleResolvedLogged.add(id)
        dlog('[live-order] no data-tab-id button counted via title fallback', {
          id,
          title: el.getAttribute('title') || el.getAttribute('aria-label') || null,
          cls: String(el.className || ''),
          parentCls: el.parentElement ? String(el.parentElement.className || '') : null,
        })
      }
      out.push(id)
    }
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
