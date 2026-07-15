/**
 * Validation boundary for layout blobs loaded from disk / IPC.
 * Lenient: drop bad detachedTabs entries; null only if top-level is not an object.
 */

import { dlog } from '../debug/log'

export interface ParsedLayoutPrimary {
  open?: boolean
  width?: number
  tabId?: string | null
}

export interface ParsedLayoutSecondary {
  open?: boolean
  width?: number
  activeTabId?: string | null
}

export interface ParsedLayout {
  version?: string
  primary?: ParsedLayoutPrimary
  secondary?: ParsedLayoutSecondary
  detachedTabs: { tabId: string; [key: string]: unknown }[]
  /** Canvas-owned Configure hide list (optional on older layouts). */
  hiddenTabIds?: string[]
  settings?: unknown
  [key: string]: unknown
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Parse an unknown layout blob into a shape safe for applyLayout / applyMainDrawer.
 * Returns null if the top-level value is not an object (caller should no-op).
 */
export function parseLayoutBlob(input: unknown): ParsedLayout | null {
  if (!isPlainObject(input)) {
    dlog('parseLayoutBlob: top-level is not an object')
    return null
  }

  const out: ParsedLayout = {
    detachedTabs: [],
  }

  if (typeof input.version === 'string') out.version = input.version
  if ('settings' in input) out.settings = input.settings

  if (Array.isArray(input.hiddenTabIds)) {
    const ids: string[] = []
    for (const id of input.hiddenTabIds) {
      if (typeof id === 'string' && id.length > 0) ids.push(id)
    }
    out.hiddenTabIds = ids
  }

  if (isPlainObject(input.primary)) {
    const p = input.primary
    const primary: ParsedLayoutPrimary = {}
    if (typeof p.open === 'boolean') primary.open = p.open
    if (typeof p.width === 'number' && isFinite(p.width)) primary.width = p.width
    if (p.tabId === null || typeof p.tabId === 'string') primary.tabId = p.tabId as string | null
    out.primary = primary
  }

  if (isPlainObject(input.secondary)) {
    const s = input.secondary
    const secondary: ParsedLayoutSecondary = {}
    if (typeof s.open === 'boolean') secondary.open = s.open
    if (typeof s.width === 'number' && isFinite(s.width)) secondary.width = s.width
    if (s.activeTabId === null || typeof s.activeTabId === 'string') {
      secondary.activeTabId = s.activeTabId as string | null
    }
    out.secondary = secondary
  }

  if (Array.isArray(input.detachedTabs)) {
    for (const row of input.detachedTabs) {
      if (!isPlainObject(row)) {
        dlog('parseLayoutBlob: dropping non-object detachedTabs entry')
        continue
      }
      if (typeof row.tabId !== 'string' || !row.tabId) {
        dlog('parseLayoutBlob: dropping detachedTabs entry without string tabId')
        continue
      }
      out.detachedTabs.push(row as { tabId: string })
    }
  } else if (input.detachedTabs !== undefined) {
    dlog('parseLayoutBlob: detachedTabs is not an array; treating as empty')
  }

  // Preserve other top-level keys (forward-compat) without trusting shape.
  for (const key of Object.keys(input)) {
    if (
      key === 'primary'
      || key === 'secondary'
      || key === 'detachedTabs'
      || key === 'version'
      || key === 'settings'
      || key === 'hiddenTabIds'
    ) {
      continue
    }
    out[key] = input[key]
  }

  return out
}
