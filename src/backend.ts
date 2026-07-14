declare const spindle: any

const STORAGE_KEY = 'layout.json'
// Atomic write goes through a temp key + storage.move (which is a real
// renameSync on the host, atomic on POSIX and NTFS). We MUST route through
// spindle.storage.* (not raw fs/path) because the host resolves the key
// against the per-extension, per-user storage root in worker-host.ts
// resolveStoragePath, which is NOT process.cwd(). Using path.resolve()
// here would write to a different directory than spindle.storage.read
// reads from, silently reverting settings on every load.
const STORAGE_TMP_KEY = STORAGE_KEY + '.tmp'

// Debug flag — set via a frontend message when the user toggles
// CanvasSettings.debugMode. Starts false; real errors always use
// spindle.log.error (they're rare and important). Verbose DIAG lines
// are gated behind this flag.
let DEBUG = false

// Frontend IPC handlers are async and may overlap. Serialize writes so a
// slower older save cannot finish after a newer save and roll layout.json
// back. Loads wait for the queue so an update/reload observes the last save.
let saveQueue: Promise<void> = Promise.resolve()

async function loadLayout(): Promise<any> {
  try {
    const data = await spindle.storage.read(STORAGE_KEY)
    if (data && typeof data === 'string') {
      return JSON.parse(data)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (DEBUG) spindle.log.warn(`[SidebarUX] Failed to load layout: ${msg}`)
  }
  return null
}

async function saveLayout(state: any): Promise<void> {
  const json = JSON.stringify(state, null, 2)
  try {
    // Write the full payload to a temp key, then atomically move it over the
    // canonical key. spindle.storage.move() invokes renameSync on the host
    // (worker-host.ts handleStorageMove), so a process kill mid-rename leaves
    // either the old or the new file intact — never a torn half-write.
    await spindle.storage.write(STORAGE_TMP_KEY, json)
    try {
      await spindle.storage.move(STORAGE_TMP_KEY, STORAGE_KEY)
    } catch (moveErr: unknown) {
      // Cross-device or Windows EBUSY — fall back to a direct write so we
      // never lose data. Clean up the leftover temp key best-effort.
      const mmsg = moveErr instanceof Error ? moveErr.message : String(moveErr)
      if (DEBUG) spindle.log.warn(`[SidebarUX] Atomic move failed, falling back to direct write: ${mmsg}`)
      await spindle.storage.write(STORAGE_KEY, json)
      try { await spindle.storage.delete(STORAGE_TMP_KEY) } catch { /* best-effort */ }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (DEBUG) spindle.log.error(`[SidebarUX] Failed to save layout: ${msg}`)
  }
}

spindle.onFrontendMessage(async (payload: any) => {
  if (payload.type === 'SET_DEBUG') {
    DEBUG = !!payload.debug
    return
  }
  if (payload.type === 'SAVE_LAYOUT') {
    saveQueue = saveQueue
      .then(() => saveLayout(payload.layout))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (DEBUG) spindle.log.warn(`[SidebarUX] Queued layout save failed: ${msg}`)
      })
    await saveQueue
  } else if (payload.type === 'LOAD_LAYOUT') {
    await saveQueue
    const layout = await loadLayout()
    spindle.sendToFrontend({ type: 'LAYOUT_DATA', layout })
  }
})
