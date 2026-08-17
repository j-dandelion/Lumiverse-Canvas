// DrawerObserver: MutationObserver-based tab registration watcher.
//
// Replaces the 3s polling in drawer-sync.ts:startTabRegistrationWatcher
// with a proper MutationObserver on the main sidebar's tab container.
// Maintains a Map of observed tabs and emits events when tabs are
// registered or unregistered.
//
// ── Canvas's LIVE TAB IDENTITY STORE (REFACTOR-PLAN v2 §4.1) ──
// Each entry carries a FROZEN TabKey assigned ONCE at first registration:
//   - builtin buttons (bare data-tab-id, no extension class)  → 'builtin:{id}'
//   - extension buttons (tabBtnExtension class or spindle-prefixed id)
//     → 'ext:{extId}/{title}' with whatever extId is known at birth ('unknown'
//     while untagged), disambiguated with an '@N' suffix when two tabs would
//     share a key.
// The tagger's `data-tab-id` attribute writes are OBSERVED (attributes: true)
// and update the entry's ADDRESS (tabId/extensionId/title) in place — the key
// never changes, so the re-key flip class of bugs is structurally impossible.

import { registerCleanup } from './cleanup'
import { getMainSidebar } from '../dom/lumiverse'
import { builtinKey, extensionKey, type TabKey } from '../core/model'
import { dlog } from '../debug/log'

export interface ObservedTab {
  tabId: string
  button: HTMLElement   // the tab button in the main sidebar
  extensionId: string   // parsed from tabId; may upgrade 'unknown' → real on tagging
  title: string
  /** FROZEN at first registration — the tab's identity ('builtin:{id}' | 'ext:{extId}/{title}').
   *  Never re-derived; tagging updates the address fields, not this. */
  key: TabKey
  /** Every title this button has ever carried (first-seen + current). */
  titles: ReadonlySet<string>
}

export type InventoryStatus = 'empty' | 'partial' | 'ready' | 'degraded'

export interface InventorySnapshot {
  readonly status: InventoryStatus
  readonly revision: number
  readonly tabs: readonly ObservedTab[]
}

type TabHandler = (tab: ObservedTab) => void
type UnregHandler = (tabId: string) => void

// extensionId: preserve the original parse for tagged buttons
// ("spindle:{extId}:tab:{id}:{counter}" → parts[1]; persisted TabKeys
// depend on it). Untagged extension buttons are known extensions but
// their id is unknown until tagged.
function parseExtensionId(tabId: string, existingId: string, isExtensionBtn: boolean): string {
  const parts = tabId.split(':')
  return existingId
    ? (parts[1] || 'unknown')
    : (isExtensionBtn ? (parts[1] || 'unknown') : '')
}

/**
 * Pure key derivation for a tab SHAPE that has no observer entry yet (e.g.
 * the store-fallback construction in secondary-drawer). Mirrors
 * freezeKey's classification: spindle-prefixed id or known extensionId →
 * 'ext:{extId}/{title}' (extId 'unknown' while untagged), else
 * 'builtin:{id}'. Once the observer scans the button, the entry updates in
 * place to the canonical frozen key.
 */
export function keyForTabShape(tabId: string, extensionId: string, title: string): TabKey {
  const extId = extensionId && extensionId !== 'unknown' ? extensionId : ''
  if (!extId && !tabId.includes(':')) return builtinKey(tabId)
  return extensionKey(extId || 'unknown', title)
}

export class DrawerObserver {
  private observer: MutationObserver | null = null
  private tabs: Map<string, ObservedTab> = new Map()
  private tabHandlers: TabHandler[] = []
  private unregHandlers: UnregHandler[] = []
  private revision = 0
  private started = false

  start(): void {
    if (this.started) return
    const sidebar = getMainSidebar()
    if (!sidebar) {
      console.warn('[DrawerObserver] main sidebar not found')
      return
    }
    this.started = true

    // Initial scan
    this.scanExistingTabs(sidebar)

    // Start observing. attributes: true + attributeFilter makes the Canvas
    // tagger's data-tab-id / title / class writes visible so entries update
    // IN PLACE instead of going stale until the next childList mutation
    // (the stale-entry bug class — see REFACTOR-PLAN v2 §4.1).
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const target = mutation.target
          if (target instanceof HTMLElement) this.registerTab(target)
          continue
        }
        for (const node of mutation.addedNodes ?? []) {
          if (node instanceof HTMLElement) this.handleAddedNode(node)
        }
      }
      // React can replace a whole subtree or move existing buttons without
      // producing useful incremental identity events. A full scan keeps the
      // inventory and DOM order coherent at the commit boundary.
      this.scanExistingTabs(sidebar)
      this.removeDetachedTabs()
      this.revision++
    })

    this.observer.observe(sidebar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tab-id', 'title', 'class'],
    })

    // RE-SCAN after observe(): registering a NEW tab fires the
    // onTabRegistered handlers, and setup.ts's handler calls
    // tagMainSidebarButtons() SYNCHRONOUSLY — writing data-tab-id on
    // untagged extension buttons BEFORE this observer was observing.
    // Those attribute writes are never delivered as mutations, so without
    // this second scan the entry stays keyed by its title with
    // extensionId 'unknown' → the boot restore misclassifies the extension
    // tab as a built-in, its secondary placement fails, and the model ends
    // up ahead of the DOM ("dragging an extension tab to another drawer
    // doesn't move it in the main UI" / "activating it activates on the
    // drawer it was moved from"). The second scan re-registers each button
    // with its CURRENT attributes — entryForButton finds the existing entry
    // and updateEntry moves the address slot (title → spindle id) in place.
    this.scanExistingTabs(sidebar)
    registerCleanup(() => this.stop())

    // Diagnostic: after the re-scan, any extension entry that is STILL
    // title-keyed with extensionId 'unknown' would misclassify the tab as a
    // built-in at boot restore (the "drag an extension tab to another
    // drawer" bug family). Dump the survivors so the next capture pinpoints
    // why the tagger's write did not upgrade the entry.
    const stale = Array.from(this.tabs.entries()).filter(
      ([, t]) => t.extensionId === 'unknown' && !t.key.startsWith('builtin:'),
    )
    if (stale.length > 0) {
      dlog('[DrawerObserver] post-start scan: extension entries still title-keyed', {
        stale: stale.map(([id, t]) => ({ id, key: t.key, title: t.title })),
      })
    }
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    this.tabs.clear()
    this.started = false
    this.revision++
  }

  onTabRegistered(handler: TabHandler): () => void {
    this.tabHandlers.push(handler)
    return () => {
      const idx = this.tabHandlers.indexOf(handler)
      if (idx >= 0) this.tabHandlers.splice(idx, 1)
    }
  }

  onTabUnregistered(handler: UnregHandler): () => void {
    this.unregHandlers.push(handler)
    return () => {
      const idx = this.unregHandlers.indexOf(handler)
      if (idx >= 0) this.unregHandlers.splice(idx, 1)
    }
  }


  getTab(tabId: string): ObservedTab | null {
    return this.tabs.get(tabId) || null
  }

  getAllTabs(): ObservedTab[] {
    return Array.from(this.tabs.values()).sort((a, b) => {
      if (typeof a.button.compareDocumentPosition !== 'function') return 0
      const relation = a.button.compareDocumentPosition(b.button)
      return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    })
  }

  getSnapshot(): InventorySnapshot {
    const tabs = this.getAllTabs()
    return {
      status: !this.started ? 'empty' : tabs.length === 0 ? 'partial' : 'ready',
      revision: this.revision,
      tabs,
    }
  }

  private scanExistingTabs(sidebar: HTMLElement): void {
    // data-tab-id covers built-ins (and tagged extensions); untagged
    // extension host buttons are matched by their class instead.
    const buttons = sidebar.querySelectorAll(
      '[data-tab-id], button[class*="tabBtnExtension"]',
    )
    for (const btn of buttons) {
      if (btn instanceof HTMLElement) {
        this.registerTab(btn)
      }
    }
  }

  private removeDetachedTabs(): void {
    for (const [tabId, tab] of this.tabs) {
      // Test doubles and older host elements may not expose isConnected.
      // Treat only an explicit false as detached.
      if (tab.button.isConnected === false) {
        // DOM-placed Canvas tabs intentionally leave the host sidebar while
        // their content root lives in the secondary drawer. Keep their host
        // identity in the inventory until the move marker is removed or the
        // tab is explicitly restored to the main drawer.
        let moved: Element | null = null
        if (typeof document !== 'undefined') {
          try {
            moved = document.querySelector(
              `[data-canvas-moved="${CSS.escape(tabId)}"]`,
            )
          } catch {
            moved = null
          }
        }
        if (moved) continue
        this.tabs.delete(tabId)
        for (const h of this.unregHandlers) h(tabId)
      }
    }
  }

  private handleAddedNode(node: HTMLElement): void {
    // Check if it's a tab button (data-tab-id, or an untagged extension
    // host button matched by class).
    if (
      node.hasAttribute?.('data-tab-id') ||
      String(node.className || '').includes('tabBtnExtension')
    ) {
      this.registerTab(node)
    }
    // Check children
    const buttons = node.querySelectorAll?.(
      '[data-tab-id], button[class*="tabBtnExtension"]',
    )
    if (buttons) {
      for (const btn of buttons) {
        if (btn instanceof HTMLElement) {
          this.registerTab(btn)
        }
      }
    }
  }

  private handleRemovedNode(node: HTMLElement): void {
    if (node instanceof HTMLElement && node.hasAttribute?.('data-tab-id')) {
      const tabId = node.getAttribute('data-tab-id') || ''
      if (this.tabs.has(tabId)) {
        this.tabs.delete(tabId)
        for (const h of this.unregHandlers) h(tabId)
      }
    }
    const buttons = node.querySelectorAll?.('[data-tab-id]')
    if (buttons) {
      for (const btn of buttons) {
        if (btn instanceof HTMLElement) {
          const tabId = btn.getAttribute('data-tab-id') || ''
          if (this.tabs.has(tabId)) {
            this.tabs.delete(tabId)
            for (const h of this.unregHandlers) h(tabId)
          }
        }
      }
    }
  }

  /** Find the registered entry for a button (identity lookup — the map is keyed by address). */
  private entryForButton(button: HTMLElement): ObservedTab | null {
    for (const tab of this.tabs.values()) {
      if (tab.button === button) return tab
    }
    return null
  }

  private registerTab(button: HTMLElement): void {
    const existingId = button.getAttribute('data-tab-id') || ''
    const isExtensionBtn = String(button.className || '').includes('tabBtnExtension')
    // Only buttons with a data-tab-id, or known extension buttons (class),
    // are tabs. Host chrome (Settings etc.) without an id is skipped.
    if (!existingId && !isExtensionBtn) return
    const tabId = existingId ||
      button.getAttribute('title') ||
      button.getAttribute('aria-label') ||
      ''
    if (!tabId) return

    // Same button re-scanned (tagger wrote data-tab-id, attribute mutation,
    // React re-render): update the ADDRESS in place — identity is frozen.
    const existing = this.entryForButton(button)
    if (existing) {
      this.updateEntry(existing, button, tabId, existingId, isExtensionBtn)
      return
    }
    if (this.tabs.has(tabId)) return

    const title = button.getAttribute('title') || button.textContent?.trim() || tabId
    const tab: ObservedTab = {
      tabId,
      button,
      extensionId: parseExtensionId(tabId, existingId, isExtensionBtn),
      title,
      key: this.freezeKey(tabId, isExtensionBtn, title),
      titles: new Set([title]),
    }

    this.tabs.set(tabId, tab)
    for (const h of this.tabHandlers) h(tab)
  }

  /**
   * Update an existing entry's ADDRESS fields (tabId/extensionId/title) from
   * the current button attributes. The frozen `key` is never touched — the
   * tab's identity is stable across tagging, suffix drift, and title changes
   * (renames are recorded in `titles` so legacy title-based resolution still
   * finds the tab).
   */
  private updateEntry(
    entry: ObservedTab,
    button: HTMLElement,
    tabId: string,
    existingId: string,
    isExtensionBtn: boolean,
  ): void {
    const title = button.getAttribute('title') || button.textContent?.trim() || tabId
    const nextExtensionId = parseExtensionId(tabId, existingId, isExtensionBtn)
    if (entry.tabId === tabId && entry.title === title && entry.extensionId === nextExtensionId) {
      return
    }
    if (entry.tabId !== tabId) {
      dlog('[DrawerObserver] entry address upgraded', {
        from: entry.tabId,
        to: tabId,
        extFrom: entry.extensionId,
        extTo: nextExtensionId,
      })
    }
    entry.tabId = tabId
    entry.title = title
    entry.extensionId = nextExtensionId
    if (!entry.titles.has(title)) {
      entry.titles = new Set(entry.titles).add(title)
    }
    // The map is keyed by ADDRESS (getTab(tabId)); move the slot when the
    // address changed so address lookups stay correct. Never re-key the
    // identity.
    for (const [key, tab] of this.tabs) {
      if (tab === entry) {
        if (key !== tabId) {
          this.tabs.delete(key)
          this.tabs.set(tabId, entry)
        }
        break
      }
    }
  }

  /**
   * Assign the FROZEN TabKey for a fresh registration. Classification is
   * decided ONCE here and never revisited: extension buttons (host class or
   * spindle-prefixed id) key as 'ext:{extId}/{title}' — extId is whatever is
   * known at birth ('unknown' while untagged) and tagging later upgrades the
   * metadata, never the key. Builtin buttons key as 'builtin:{id}'.
   * Same-key collisions (two tabs from one extension with the same title)
   * get an '@N' suffix on the KEY only (addresses and titles stay
   * un-suffixed).
   */
  private freezeKey(tabId: string, isExtensionBtn: boolean, title: string): TabKey {
    if (!isExtensionBtn && !tabId.includes(':')) return builtinKey(tabId)
    const extensionId = tabId.split(':')[1] || 'unknown'
    const base = extensionKey(extensionId || 'unknown', title)
    if (!this.hasKey(base)) return base
    let n = 2
    while (this.hasKey(`${base}@${n}`)) n++
    return `${base}@${n}` as TabKey
  }

  private hasKey(key: TabKey): boolean {
    for (const tab of this.tabs.values()) {
      if (tab.key === key) return true
    }
    return false
  }
}

// Singleton instance
export const drawerObserver = new DrawerObserver()
