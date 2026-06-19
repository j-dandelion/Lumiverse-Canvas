// TabVisibilityObserver: watches an extension's root element for display transitions.
//
// When the root goes from display:none to visible, fire onVisible callback.
// This replaces the node-guard monkey-patching of appendChild/removeChild/replaceChildren.
//
// node-guard existed to prevent React from reclaiming moved DOM nodes.
// With re-execution, no DOM is moved - extensions own their visibility via observation.
// This file handles the legitimate use case: knowing when a tab becomes visible.

type VisibilityHandler = () => void

interface WatchedRoot {
  observer: MutationObserver
  onVisible: VisibilityHandler[]
  onHidden?: VisibilityHandler[]
}

export class TabVisibilityObserver {
  private watched: Map<HTMLElement, WatchedRoot> = new Map()

  watch(
    root: HTMLElement,
    onVisible: VisibilityHandler,
    onHidden?: VisibilityHandler
  ): () => void {
    if (this.watched.has(root)) {
      // Already watching - add another handler
      const entry = this.watched.get(root)!
      entry.onVisible.push(onVisible)
      if (onHidden) entry.onHidden?.push(onHidden)
      return () => this.unwatch(root, onVisible)
    }

    const handler = (mutations: MutationRecord[]) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'style') {
          const display = (m.target as HTMLElement).style.display
          if (display === '' || display === 'none') {
            // Becoming hidden - could fire onHidden
          } else {
            // Becoming visible
            queueMicrotask(() => {
              for (const cb of this.watched.get(root)!.onVisible) cb()
            })
          }
        }
      }
    }

    const observer = new MutationObserver(handler)
    observer.observe(root, { attributes: true, attributeFilter: ['style'] })

    this.watched.set(root, { observer, onVisible: [onVisible], onHidden: onHidden ? [onHidden] : undefined })

    return () => this.unwatch(root, onVisible)
  }

  unwatch(root: HTMLElement, handler: VisibilityHandler): void {
    const entry = this.watched.get(root)
    if (!entry) return

    const idx = entry.onVisible.indexOf(handler)
    if (idx >= 0) entry.onVisible.splice(idx, 1)

    if (entry.onVisible.length === 0) {
      entry.observer.disconnect()
      this.watched.delete(root)
    }
  }

  unwatchAll(): void {
    for (const entry of this.watched.values()) {
      entry.observer.disconnect()
    }
    this.watched.clear()
  }

  isVisible(root: HTMLElement): boolean {
    const display = getComputedStyle(root).display
    return display !== 'none'
  }
}

// Singleton
export const tabVisibilityObserver = new TabVisibilityObserver()