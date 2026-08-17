import type { LoadResult } from './result'
import { bootStep, bootWarn } from '../debug/boot-diag'

// Boot-load resilience: the layout/settings requests travel over the host
// WebSocket, and BOTH ends drop messages silently while not ready — the
// frontend's wsClient drops sends while the socket is CONNECTING, and the
// server's SPINDLE_BACKEND_MSG handler drops requests while the extension
// worker is still spawning. The retry budget must therefore cover the whole
// boot-readiness window, not a fixed 3.5s. Loads are idempotent reads that
// resolve on the FIRST response, so retrying is always safe; the only cost
// of a slow transport is that setup waits (bounded) before mounting with
// in-memory defaults.
export const BOOT_LOAD_WINDOW_MS = 15_000
export const BOOT_LOAD_INTERVAL_MS = 1_000

// Test-only overrides: shrink the retry window so resilience tests don't
// need 15s of wall clock. Production defaults are restored on reset.
let _windowMs = BOOT_LOAD_WINDOW_MS
let _intervalMs = BOOT_LOAD_INTERVAL_MS
export function getBootLoadWindowMs(): number { return _windowMs }
export function getBootLoadIntervalMs(): number { return _intervalMs }
export function __setBootLoadParamsForTest(params: { windowMs?: number; intervalMs?: number }): void {
  if (params.windowMs !== undefined) _windowMs = params.windowMs
  if (params.intervalMs !== undefined) _intervalMs = params.intervalMs
}
export function __resetBootLoadParamsForTest(): void {
  _windowMs = BOOT_LOAD_WINDOW_MS
  _intervalMs = BOOT_LOAD_INTERVAL_MS
}

interface BackendCtx {
  sendToBackend(msg: { type: string; [key: string]: unknown }): void
  onBackendMessage(handler: (payload: unknown) => void): () => void
}

let _ctx: BackendCtx | null = null
let _armed = false
let _saveCounter = 0
const _pendingSaves = new Map<number, { resolve: (r: LoadResult<void>) => void; reject: (err: unknown) => void; timer: ReturnType<typeof setTimeout> }>()

export function setLayoutRepoBackendCtx(ctx: BackendCtx | null): void { _ctx = ctx }
export function getLayoutRepoBackendCtx(): BackendCtx | null { return _ctx }
export function isLayoutRepoArmed(): boolean { return _armed }

export function armLayoutRepo(): void { _armed = true }

/**
 * Disarm the repo so subsequent save calls reject immediately. Any
 * in-flight saves are rejected with a "disarmed" error. Call this if
 * a bootstrap encounters an error mid-flight to stop further writes
 * from a broken state. After disarm, the repo can be re-armed with
 * `armLayoutRepo()`.
 */
export function disarmLayoutRepo(): void {
  _armed = false
  for (const [id, { reject, timer }] of _pendingSaves) {
    clearTimeout(timer)
    _pendingSaves.delete(id)
    reject(new Error('layout repo disarmed'))
  }
}

export function __resetLayoutRepoForTest(): void {
  _armed = false
  _ctx = null
  for (const [id, { resolve, timer }] of _pendingSaves) {
    clearTimeout(timer)
    _pendingSaves.delete(id)
    // Resolve silently with error so unhandled rejection handlers in
    // tests do not fire. Production disarms still reject (see above).
    resolve({ status: 'error', reason: 'layout repo reset' })
  }
  _saveCounter = 0
}

export function loadLayoutFromDisk(): Promise<LoadResult<any>> {
  const ctx = _ctx
  if (!ctx) return Promise.resolve({ status: 'error', reason: 'no backend' })

  return new Promise((resolve) => {
    let settled = false
    let unsub: (() => void) | null = null
    let attempts = 0
    const startedAt = Date.now()

    function attempt() {
      if (settled) return

      const handler = (payload: any) => {
        if (payload.type !== 'LAYOUT_DATA') return
        if (settled) return
        settled = true
        if (typeof unsub === 'function') unsub()
        const result = (payload && typeof payload === 'object' && 'result' in payload)
          ? payload.result
          : null
        if (result && typeof result === 'object' &&
            (result.status === 'ok' || result.status === 'empty' || result.status === 'error')) {
          bootStep(`layout-load-resolved`, `attempt ${attempts} after ${Date.now() - startedAt}ms (${result.status})`)
          resolve(result as LoadResult<any>)
        } else {
          resolve({ status: 'error', reason: 'malformed response' })
        }
      }
      unsub = ctx!.onBackendMessage(handler)
      attempts++
      ctx!.sendToBackend({ type: 'LOAD_LAYOUT' })

      setTimeout(() => {
        if (settled) return
        const elapsed = Date.now() - startedAt
        if (elapsed < getBootLoadWindowMs()) {
          if (typeof unsub === 'function') unsub()
          if (attempts > 1 && attempts % 5 === 1) {
            bootWarn(`layout-load-still-pending`, `attempt ${attempts} no response after ${elapsed}ms — transport not ready (WS connecting or worker spawning)`)
          }
          attempt()
        } else {
          settled = true
          if (typeof unsub === 'function') unsub()
          const reason = `load timed out after ${attempts} attempts (${elapsed}ms)`
          bootWarn(`layout-load-timeout`, reason)
          resolve({ status: 'error', reason })
        }
      }, getBootLoadIntervalMs())
    }
    attempt()
  })
}

export function saveLayoutToDisk(layout: any): Promise<LoadResult<void>> {
  const ctx = _ctx
  if (!ctx) return Promise.resolve({ status: 'error', reason: 'no backend' })
  if (!_armed) return Promise.resolve({ status: 'error', reason: 'not armed' })
  const id = ++_saveCounter
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (_pendingSaves.has(id)) {
        _pendingSaves.delete(id)
        resolve({ status: 'error', reason: 'save timed out' })
      }
    }, 5000)
    _pendingSaves.set(id, { resolve, reject, timer })
    ctx.sendToBackend({ type: 'SAVE_LAYOUT', layout, saveId: id })
  })
}

/**
 * Resolve a pending save promise when the backend reports the result.
 * Called by the frontend's message handler in setup.ts.
 */
export function __resolveLayoutSave(saveId: number, result: LoadResult<void>): void {
  const pending = _pendingSaves.get(saveId)
  if (!pending) return
  _pendingSaves.delete(saveId)
  clearTimeout(pending.timer)
  pending.resolve(result)
}

/**
 * Register a listener on the backend message stream for SAVE_LAYOUT_RESULT
 * messages. Returns an unsubscribe function. Call this once at setup so
 * each SAVE_LAYOUT gets correlated with the matching backend ack.
 */
export function bindLayoutSaveResultBridge(): () => void {
  const ctx = _ctx
  if (!ctx) return () => {}
  return ctx.onBackendMessage((payload: any) => {
    if (!payload || payload.type !== 'SAVE_LAYOUT_RESULT') return
    const saveId = typeof payload.saveId === 'number' ? payload.saveId : 0
    const result = payload.result
    if (result && typeof result === 'object' &&
        (result.status === 'ok' || result.status === 'error')) {
      __resolveLayoutSave(saveId, result as LoadResult<void>)
    }
  })
}
