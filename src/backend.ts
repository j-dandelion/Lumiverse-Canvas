declare const spindle: any

import { migrateLegacyPayload } from './persist/migration'
import { moveCorruptFile as moveCorruptFileImpl } from './persist/corrupt-file'

const LAYOUT_KEY = 'layout.json'
const SETTINGS_KEY = 'settings.json'
const LAYOUT_TMP_KEY = LAYOUT_KEY + '.tmp'
const SETTINGS_TMP_KEY = SETTINGS_KEY + '.tmp'

interface LayoutPayload {
  version: number
  primary?: unknown
  secondary?: unknown
  detachedTabs?: unknown[]
  hiddenTabIds?: string[]
  tabOrder?: string[]
  [key: string]: unknown
}

interface SettingsPayload {
  version: number
  settings: unknown
}

type LoadResult =
  | { status: 'ok'; data: unknown }
  | { status: 'empty' }
  | { status: 'error'; reason: string }

let DEBUG = false
let PERSIST_DEBUG = false

function pblog(...args: unknown[]): void {
  if (!DEBUG && !PERSIST_DEBUG) return
  try {
    spindle.log.info(`[SidebarUX][persist] ${args.map(String).join(' ')}`)
  } catch {
    /* ignore */
  }
}

let saveQueue: Promise<void> = Promise.resolve()

async function readJsonFile(key: string): Promise<{ data: unknown; bytes: number } | null> {
  let data: unknown
  try {
    data = await spindle.storage.read(key)
  } catch {
    // The host REJECTS with `Error: File not found` when the file does not
    // exist (worker-host-storage-api handleStorageRead → fail) — it does not
    // return null. A missing file is NOT corruption: callers must fall through
    // to `emptyResult()` so the frontend still arms the persistence repos and
    // can write the first save. (Regression from the 08-16 persistence rewrite,
    // which dropped the pre-rewrite try/catch that mapped missing → null.)
    return null
  }
  if (data && typeof data === 'string') return { data, bytes: data.length }
  return null
}

async function atomicWrite(key: string, tmpKey: string, json: string): Promise<void> {
  await spindle.storage.write(tmpKey, json)
  try {
    await spindle.storage.move(tmpKey, key)
  } catch (moveErr: unknown) {
    const mmsg = moveErr instanceof Error ? moveErr.message : String(moveErr)
    if (DEBUG || PERSIST_DEBUG) {
      spindle.log.warn(`[SidebarUX] Atomic move failed, falling back to direct write: ${mmsg}`)
    }
    await spindle.storage.write(key, json)
    try { await spindle.storage.delete(tmpKey) } catch { /* best-effort */ }
  }
}

function currentVersion(): number { return 2 }

function makePayload(version: number, data: unknown): LoadResult {
  return { status: 'ok', data }
}

function emptyResult(): LoadResult {
  return { status: 'empty' }
}

function errorResult(reason: string): LoadResult {
  return { status: 'error', reason }
}

async function tryMigrateV1ToV2(raw: string): Promise<boolean> {
  const migrated = migrateLegacyPayload(raw)
  if (migrated) {
    const layoutJson = JSON.stringify(migrated.layout, null, 2)
    const settingsJson = JSON.stringify(migrated.settings, null, 2)

    await atomicWrite(LAYOUT_KEY, LAYOUT_TMP_KEY, layoutJson)
    await atomicWrite(SETTINGS_KEY, SETTINGS_TMP_KEY, settingsJson)
    pblog('v1→v2 migration: wrote layout.json + settings.json')
    return true
  }
  return false
}

async function loadLayout(): Promise<LoadResult> {
  try {
    const raw = await readJsonFile(LAYOUT_KEY)
    if (!raw) return emptyResult()

    let parsed: any
    try {
      parsed = JSON.parse(raw.data as string)
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      if (DEBUG || PERSIST_DEBUG) {
        spindle.log.warn(`[SidebarUX] Failed to parse layout: ${msg}`)
      }
      await moveCorruptFile(LAYOUT_KEY, msg)
      return errorResult(`parse failed: ${msg}`)
    }

    if (parsed && typeof parsed === 'object') {
      if (parsed.version === 1 || (parsed.settings !== undefined && parsed.version !== 2)) {
        const migrated = await tryMigrateV1ToV2(raw.data as string)
        if (migrated) {
          const fresh = await readJsonFile(LAYOUT_KEY)
          if (fresh) {
            try {
              parsed = JSON.parse(fresh.data as string)
            } catch {
              return errorResult('migration succeeded but re-read failed')
            }
          }
        }
      }
      pblog('disk-read layout ok', `bytes=${raw.bytes}`, `version=${parsed?.version ?? '?'}`)
      return makePayload(currentVersion(), parsed)
    }
    pblog('disk-read layout empty-or-missing')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    pblog('disk-read layout error', msg)
    if (DEBUG) spindle.log.warn(`[SidebarUX] Failed to load layout: ${msg}`)
    return errorResult(`read failed: ${msg}`)
  }
  return emptyResult()
}

async function loadSettings(): Promise<LoadResult> {
  try {
    const raw = await readJsonFile(SETTINGS_KEY)
    if (!raw) {
      const layoutRaw = await readJsonFile(LAYOUT_KEY)
      if (layoutRaw) {
        let parsed: any
        try {
          parsed = JSON.parse(layoutRaw.data as string)
        } catch {
          // corrupted layout handled by loadLayout
        }
        if (parsed && typeof parsed === 'object' && parsed.settings !== undefined) {
          const migrated = await tryMigrateV1ToV2(layoutRaw.data as string)
          if (migrated) {
            const fresh = await readJsonFile(SETTINGS_KEY)
            if (fresh) {
              try {
                const freshParsed = JSON.parse(fresh.data as string)
                pblog('disk-read settings ok (v1→v2 migrated)')
                return makePayload(currentVersion(), freshParsed)
              } catch {
                return errorResult('migration succeeded but re-read failed')
              }
            }
          }
        }
      }
      pblog('disk-read settings empty-or-missing')
      return emptyResult()
    }

    let parsed: any
    try {
      parsed = JSON.parse(raw.data as string)
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      if (DEBUG || PERSIST_DEBUG) {
        spindle.log.warn(`[SidebarUX] Failed to parse settings: ${msg}`)
      }
      await moveCorruptFile(SETTINGS_KEY, msg)
      return errorResult(`parse failed: ${msg}`)
    }

    pblog('disk-read settings ok', `bytes=${raw.bytes}`, `version=${parsed?.version ?? '?'}`)
    return makePayload(currentVersion(), parsed)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    pblog('disk-read settings error', msg)
    if (DEBUG) spindle.log.warn(`[SidebarUX] Failed to load settings: ${msg}`)
    return errorResult(`read failed: ${msg}`)
  }
}

async function moveCorruptFile(key: string, reason: string): Promise<void> {
  const newKey = await moveCorruptFileImpl(
    {
      read: (k) => spindle.storage.read(k).then((v: any) => (typeof v === 'string' ? v : (v?.data ?? null))),
      write: (k, contents) => spindle.storage.write(k, contents),
      move: (from, to) => spindle.storage.move(from, to),
      delete: (k) => spindle.storage.delete(k),
    },
    key,
  )
  if (newKey) {
    pblog(`moved corrupt ${key} → ${newKey}`, reason)
    if (DEBUG) {
      spindle.log.warn(`[SidebarUX] Corrupt ${key} preserved as ${newKey}: ${reason}`)
    }
  } else {
    pblog(`failed to move corrupt ${key}`, reason)
  }
}

async function saveLayout(state: any): Promise<void> {
  if (!state || typeof state !== 'object') return
  const json = JSON.stringify(state, null, 2)
  pblog('disk-write layout start', `bytes=${json.length}`)
  try {
    await atomicWrite(LAYOUT_KEY, LAYOUT_TMP_KEY, json)
    pblog('disk-write layout ok')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    pblog('disk-write layout fail', msg)
    if (DEBUG) spindle.log.error(`[SidebarUX] Failed to save layout: ${msg}`)
  }
}

async function saveSettings(state: { version?: number; settings?: unknown }): Promise<void> {
  if (!state || typeof state !== 'object') return
  const json = JSON.stringify(state, null, 2)
  pblog('disk-write settings start', `bytes=${json.length}`)
  try {
    await atomicWrite(SETTINGS_KEY, SETTINGS_TMP_KEY, json)
    pblog('disk-write settings ok')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    pblog('disk-write settings fail', msg)
    if (DEBUG) spindle.log.error(`[SidebarUX] Failed to save settings: ${msg}`)
  }
}

spindle.onFrontendMessage(async (payload: any) => {
  if (payload.type === 'SET_DEBUG') {
    DEBUG = !!payload.debug
    return
  }
  if (payload.type === 'SET_PERSIST_DEBUG') {
    PERSIST_DEBUG = !!payload.enabled
    pblog('persist-debug', PERSIST_DEBUG ? 'on' : 'off')
    return
  }
  if (payload.type === 'SAVE_LAYOUT') {
    pblog('ipc SAVE_LAYOUT')
    const saveId = typeof payload.saveId === 'number' ? payload.saveId : 0
    saveQueue = saveQueue
      .then(() => saveLayout(payload.layout))
      .then(() => {
        if (saveId > 0) {
          spindle.sendToFrontend({ type: 'SAVE_LAYOUT_RESULT', saveId, result: { status: 'ok' } })
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (DEBUG || PERSIST_DEBUG) {
          spindle.log.warn(`[SidebarUX] Queued layout save failed: ${msg}`)
        }
        if (saveId > 0) {
          spindle.sendToFrontend({ type: 'SAVE_LAYOUT_RESULT', saveId, result: { status: 'error', reason: msg } })
        }
      })
    await saveQueue
  } else if (payload.type === 'SAVE_SETTINGS') {
    pblog('ipc SAVE_SETTINGS')
    const saveId = typeof payload.saveId === 'number' ? payload.saveId : 0
    saveQueue = saveQueue
      .then(() => saveSettings(payload.settings))
      .then(() => {
        if (saveId > 0) {
          spindle.sendToFrontend({ type: 'SAVE_SETTINGS_RESULT', saveId, result: { status: 'ok' } })
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (DEBUG || PERSIST_DEBUG) {
          spindle.log.warn(`[SidebarUX] Queued settings save failed: ${msg}`)
        }
        if (saveId > 0) {
          spindle.sendToFrontend({ type: 'SAVE_SETTINGS_RESULT', saveId, result: { status: 'error', reason: msg } })
        }
      })
    await saveQueue
  } else if (payload.type === 'LOAD_LAYOUT') {
    pblog('ipc LOAD_LAYOUT')
    await saveQueue
    const result = await loadLayout()
    const status = result.status
    pblog('ipc LAYOUT_DATA', status)
    spindle.sendToFrontend({ type: 'LAYOUT_DATA', result })
  } else if (payload.type === 'LOAD_SETTINGS') {
    pblog('ipc LOAD_SETTINGS')
    await saveQueue
    const result = await loadSettings()
    const status = result.status
    pblog('ipc SETTINGS_DATA', status)
    spindle.sendToFrontend({ type: 'SETTINGS_DATA', result })
  }
})
