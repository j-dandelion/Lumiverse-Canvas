import type { LoadResult } from './result'

interface BackendCtx {
  sendToBackend(msg: { type: string; [key: string]: unknown }): void
  onBackendMessage(handler: (payload: unknown) => void): () => void
}

let _ctx: BackendCtx | null = null
let _armed = false
let _saveCounter = 0
const _pendingSaves = new Map<number, { resolve: (r: LoadResult<void>) => void; reject: (err: unknown) => void; timer: ReturnType<typeof setTimeout> }>()

export function setSettingsRepoBackendCtx(ctx: BackendCtx | null): void { _ctx = ctx }
export function getSettingsRepoBackendCtx(): BackendCtx | null { return _ctx }
export function isSettingsRepoArmed(): boolean { return _armed }

export function armSettingsRepo(): void { _armed = true }

/**
 * Disarm the repo so subsequent save calls reject immediately. Any
 * in-flight saves are rejected with a "disarmed" error. Call this if
 * a bootstrap encounters an error mid-flight to stop further writes
 * from a broken state. After disarm, the repo can be re-armed with
 * `armSettingsRepo()`.
 */
export function disarmSettingsRepo(): void {
  _armed = false
  for (const [id, { reject, timer }] of _pendingSaves) {
    clearTimeout(timer)
    _pendingSaves.delete(id)
    reject(new Error('settings repo disarmed'))
  }
}

export function __resetSettingsRepoForTest(): void {
  _armed = false
  _ctx = null
  for (const [id, { resolve, timer }] of _pendingSaves) {
    clearTimeout(timer)
    _pendingSaves.delete(id)
    // Resolve silently with error so unhandled rejection handlers in
    // tests do not fire. Production disarms still reject (see above).
    resolve({ status: 'error', reason: 'settings repo reset' })
  }
  _saveCounter = 0
}

export function loadSettingsFromDisk(): Promise<LoadResult<any>> {
  const ctx = _ctx
  if (!ctx) return Promise.resolve({ status: 'error', reason: 'no backend' })

  return new Promise((resolve) => {
    let settled = false
    let unsub: (() => void) | null = null
    let retries = 0
    const maxRetries = 3
    const retryDelays = [500, 1000, 2000]

    function attempt() {
      if (settled) return

      const handler = (payload: any) => {
        if (payload.type !== 'SETTINGS_DATA') return
        if (settled) return
        settled = true
        if (typeof unsub === 'function') unsub()
        const result = (payload && typeof payload === 'object' && 'result' in payload)
          ? payload.result
          : null
        if (result && typeof result === 'object' &&
            (result.status === 'ok' || result.status === 'empty' || result.status === 'error')) {
          resolve(result as LoadResult<any>)
        } else {
          resolve({ status: 'error', reason: 'malformed response' })
        }
      }
      unsub = ctx!.onBackendMessage(handler)
      ctx!.sendToBackend({ type: 'LOAD_SETTINGS' })

      setTimeout(() => {
        if (settled) return
        if (retries < maxRetries) {
          retries++
          if (typeof unsub === 'function') unsub()
          attempt()
        } else {
          settled = true
          if (typeof unsub === 'function') unsub()
          resolve({ status: 'error', reason: 'load timed out after 3 retries' })
        }
      }, retryDelays[Math.min(retries, retryDelays.length - 1)])
    }
    attempt()
  })
}

export function saveSettingsToDisk(settings: unknown): Promise<LoadResult<void>> {
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
    ctx.sendToBackend({ type: 'SAVE_SETTINGS', settings: { version: 2, settings }, saveId: id })
  })
}

/**
 * Resolve a pending save promise when the backend reports the result.
 * Called by the frontend's message handler in setup.ts.
 */
export function __resolveSettingsSave(saveId: number, result: LoadResult<void>): void {
  const pending = _pendingSaves.get(saveId)
  if (!pending) return
  _pendingSaves.delete(saveId)
  clearTimeout(pending.timer)
  pending.resolve(result)
}

/**
 * Register a listener on the backend message stream for SAVE_SETTINGS_RESULT
 * messages. Returns an unsubscribe function. Call this once at setup so
 * each SAVE_SETTINGS gets correlated with the matching backend ack.
 */
export function bindSettingsSaveResultBridge(): () => void {
  const ctx = _ctx
  if (!ctx) return () => {}
  return ctx.onBackendMessage((payload: any) => {
    if (!payload || payload.type !== 'SAVE_SETTINGS_RESULT') return
    const saveId = typeof payload.saveId === 'number' ? payload.saveId : 0
    const result = payload.result
    if (result && typeof result === 'object' &&
        (result.status === 'ok' || result.status === 'error')) {
      __resolveSettingsSave(saveId, result as LoadResult<void>)
    }
  })
}
