// DrawerObserver: MutationObserver-based tab registration watcher.
//
// Replaces the 3s polling in drawer-sync.ts:startTabRegistrationWatcher
// with a proper MutationObserver on the main sidebar's tab container.
// Maintains a Map of observed tabs and emits events when tabs are
// registered or unregistered.

import { registerCleanup } from './cleanup'
import { getMainSidebar } from '../dom/lumiverse'

export interface ObservedTab {
  tabId: string
  button: HTMLElement   // the tab button in the main sidebar
  extensionId: string   // parsed from tabId
  title: string
}

export type InventoryStatus = 'empty' | 'partial' | 'ready' | 'degraded'

export interface InventorySnapshot {
  readonly status: InventoryStatus
  readonly revision: number
  readonly tabs: readonly ObservedTab[]
}

type TabHandler = (tab: ObservedTab) => void
type UnregHandler = (tabId: string) => void

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
    
    // Start observing
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
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
    
    this.observer.observe(sidebar, { childList: true, subtree: true })
    registerCleanup(() => this.stop())
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

    // Re-key: a button registered by title (untagged extension) may gain a
    // real data-tab-id later (Canvas tagger). Never hold two entries for the
    // same button — drop the old key so the store id becomes authoritative.
    for (const [key, tab] of this.tabs) {
      if (tab.button === button) {
        if (key === tabId) return
        this.tabs.delete(key)
        break
      }
    }
    if (this.tabs.has(tabId)) return

    // extensionId: preserve the original parse for tagged buttons
    // ("spindle:{extId}:tab:{id}:{counter}" → parts[1]; persisted TabKeys
    // depend on it). Untagged extension buttons are known extensions but
    // their id is unknown until tagged.
    const parts = tabId.split(':')
    const extensionId = existingId
      ? (parts[1] || 'unknown')
      : (isExtensionBtn ? (parts[1] || 'unknown') : '')

    const tab: ObservedTab = {
      tabId,
      button,
      extensionId,
      title: button.getAttribute('title') || button.textContent?.trim() || tabId,
    }

    this.tabs.set(tabId, tab)
    for (const h of this.tabHandlers) h(tab)
  }
}

// Singleton instance
export const drawerObserver = new DrawerObserver()
