// Opt-in diagnostics for layout SAVE/LOAD (settings-reset investigation).
//
// Enable in the browser console:
//   localStorage.canvasPersistDebug = '1'
//   // then hard-refresh
// Disable:
//   localStorage.removeItem('canvasPersistDebug')
//
// Also honors sidebarUxDebug=1 so an existing debug session sees persist lines.
//
// Zero behavior change when off. When on, logs compact one-liners only —
// enough to prove: who wrote, whether settings look like full defaults,
// load outcome (ok / null / timeout / cancel), and load-guard state.

import {
  DEFAULT_CANVAS_SETTINGS,
  mergeCanvasSettings,
  type CanvasSettings,
} from '../types'

const LS_KEY = 'canvasPersistDebug'

let _enabled: boolean | null = null
let _seq = 0
let _backendSynced = false

export function isPersistDebugEnabled(): boolean {
  if (_enabled !== null) return _enabled
  try {
    _enabled =
      localStorage.getItem(LS_KEY) === '1'
      || localStorage.getItem('sidebarUxDebug') === '1'
  } catch {
    _enabled = false
  }
  return _enabled
}

/** Force re-read of localStorage (tests / console toggle without reload). */
export function refreshPersistDebugFlag(): void {
  _enabled = null
  _backendSynced = false
}

function nextSeq(): number {
  _seq += 1
  return _seq
}

export function plog(...args: unknown[]): void {
  if (!isPersistDebugEnabled()) return
  // eslint-disable-next-line no-console
  console.log('[Canvas][persist]', ...args)
}

/** Best-effort: ask backend to log SAVE/LOAD too (no-op if no ctx). */
export function syncPersistDebugToBackend(
  send: ((msg: { type: string; [key: string]: unknown }) => void) | null | undefined,
): void {
  if (!isPersistDebugEnabled() || _backendSynced || !send) return
  _backendSynced = true
  try {
    send({ type: 'SET_PERSIST_DEBUG', enabled: true })
  } catch {
    _backendSynced = false
  }
}

export function summarizeLayout(layout: unknown): string {
  if (layout == null) return 'layout=null'
  if (typeof layout !== 'object') return `layout=type:${typeof layout}`
  const L = layout as Record<string, unknown>
  const primary = (L.primary && typeof L.primary === 'object')
    ? L.primary as Record<string, unknown>
    : null
  const secondary = (L.secondary && typeof L.secondary === 'object')
    ? L.secondary as Record<string, unknown>
    : null
  const tabs = Array.isArray(L.detachedTabs) ? L.detachedTabs.length : -1
  const hidden = Array.isArray(L.hiddenTabIds) ? L.hiddenTabIds.length : -1
  const settings = L.settings
  const hasSettings = settings != null && typeof settings === 'object'
  let settingsKeys = 0
  let nonDefault = 0
  if (hasSettings) {
    const s = settings as Record<string, unknown>
    const keys = Object.keys(DEFAULT_CANVAS_SETTINGS) as string[]
    for (const k of keys) {
      if (s[k] === undefined) continue
      settingsKeys++
      if (s[k] !== (DEFAULT_CANVAS_SETTINGS as Record<string, unknown>)[k]) nonDefault++
    }
  }
  return [
    `v=${L.version ?? '?'}`,
    `pOpen=${primary?.open ?? '?'}`,
    `sOpen=${secondary?.open ?? '?'}`,
    `tabs=${tabs}`,
    `hidden=${hidden}`,
    hasSettings
      ? `settings{keys=${settingsKeys} nonDef=${nonDefault}}`
      : 'settings=none',
  ].join(' ')
}

export type PersistLoadPhase =
  | 'start'
  | 'ok'
  | 'null-response'
  | 'timeout'
  | 'cancel'
  | 'no-backend'
  | 'hydrate'

export function logPersistLoad(
  phase: PersistLoadPhase,
  detail: {
    layout?: unknown
    reason?: string
    loadInProgress?: boolean
    generation?: number
    userTouched?: boolean
  } = {},
): void {
  if (!isPersistDebugEnabled()) return
  const n = nextSeq()
  const parts = [
    `#${n}`,
    'LOAD',
    phase,
    detail.reason ? `reason=${detail.reason}` : null,
    detail.loadInProgress !== undefined ? `guard=${detail.loadInProgress}` : null,
    detail.generation !== undefined ? `gen=${detail.generation}` : null,
    detail.userTouched !== undefined ? `userTouched=${detail.userTouched}` : null,
    detail.layout !== undefined ? summarizeLayout(detail.layout) : null,
  ].filter(Boolean)
  plog(parts.join(' '))
}

export function logPersistSave(
  reason: string,
  layout: unknown,
  detail: {
    loadInProgress?: boolean
    restoreActive?: boolean
    skipped?: string
  } = {},
): void {
  if (!isPersistDebugEnabled()) return
  const n = nextSeq()
  if (detail.skipped) {
    plog(`#${n} SAVE-SKIP reason=${reason} skip=${detail.skipped}`,
      detail.loadInProgress !== undefined ? `guard=${detail.loadInProgress}` : '',
      detail.restoreActive !== undefined ? `restore=${detail.restoreActive}` : '',
    )
    return
  }
  const settings = layout && typeof layout === 'object'
    ? (layout as { settings?: unknown }).settings
    : undefined
  plog(
    `#${n} SAVE reason=${reason}`,
    detail.loadInProgress !== undefined ? `guard=${detail.loadInProgress}` : '',
    detail.restoreActive !== undefined ? `restore=${detail.restoreActive}` : '',
    summarizeLayout(layout),
  )
}
