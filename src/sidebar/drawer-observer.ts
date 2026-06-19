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

type TabHandler = (tab: ObservedTab) => void
type UnregHandler = (tabId: string) => void

export class DrawerObserver {
  private observer: MutationObserver | null = null
  private tabs: Map<string, ObservedTab> = new Map()
  private tabHandlers: TabHandler[] = []
  private unregHandlers: UnregHandler[] = []

  start(): void {
    const sidebar = getMainSidebar()
    if (!sidebar) {
      console.warn('[DrawerObserver] main sidebar not found')
      return
    }
    
    // Initial scan
    this.scanExistingTabs(sidebar)
    
    // Start observing
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement) {
              this.handleAddedNode(node)
            }
          }
          for (const node of mutation.removedNodes) {
            if (node instanceof HTMLElement) {
              this.handleRemovedNode(node)
            }
          }
        }
      }
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
    return Array.from(this.tabs.values())
  }

  private scanExistingTabs(sidebar: HTMLElement): void {
    const buttons = sidebar.querySelectorAll('[data-tab-id]')
    for (const btn of buttons) {
      if (btn instanceof HTMLElement) {
        this.registerTab(btn)
      }
    }
  }

  private handleAddedNode(node: HTMLElement): void {
    // Check if it's a tab button
    if (node.hasAttribute?.('data-tab-id')) {
      this.registerTab(node)
    }
    // Check children
    const buttons = node.querySelectorAll?.('[data-tab-id]')
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
    const tabId = button.getAttribute('data-tab-id') || ''
    if (!tabId || this.tabs.has(tabId)) return
    
    // Parse extensionId from tabId: format "spindle:{extId}:tab:{id}:{counter}"
    const parts = tabId.split(':')
    const extensionId = parts[2] || 'unknown'
    
    const tab: ObservedTab = {
      tabId,
      button,
      extensionId,
      title: button.getAttribute('title') || button.textContent?.trim() || '',
    }
    
    this.tabs.set(tabId, tab)
    for (const h of this.tabHandlers) h(tab)
  }
}

// Singleton instance
export const drawerObserver = new DrawerObserver()