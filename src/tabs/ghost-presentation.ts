// Presentation-only suppression for extension tabs that have just left the
// live host inventory. Their model entry stays through the ghost grace window
// so a quick host re-render can restore them without losing placement.

import type { TabKey } from '../core/model'

type GhostPresentationListener = (key: TabKey, pending: boolean) => void

const _pendingKeys = new Set<TabKey>()
const _listeners = new Set<GhostPresentationListener>()

export function isGhostPresentationPending(key: TabKey): boolean {
  return _pendingKeys.has(key)
}

export function getGhostPresentationPendingKeys(): readonly TabKey[] {
  return Array.from(_pendingKeys)
}

export function onGhostPresentationChanged(
  listener: GhostPresentationListener,
): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

export function setGhostPresentationPending(key: TabKey, pending: boolean): void {
  const changed = pending ? !_pendingKeys.has(key) : _pendingKeys.has(key)
  if (!changed) return

  if (pending) _pendingKeys.add(key)
  else _pendingKeys.delete(key)

  for (const listener of Array.from(_listeners)) {
    try {
      listener(key, pending)
    } catch {
      // Presentation cleanup must not break host observation or model sync.
    }
  }
}

export function clearGhostPresentationPending(): void {
  for (const key of Array.from(_pendingKeys)) {
    setGhostPresentationPending(key, false)
  }
}
