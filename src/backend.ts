declare const spindle: any

// When true, logs every IPC + storage call for debugging layout persistence.
const DEBUG_LAYOUT_PERSIST = false

const STORAGE_KEY = 'layout.json'
// Atomic write goes through a temp key + storage.move (which is a real
// renameSync on the host, atomic on POSIX and NTFS). We MUST route through
// spindle.storage.* (not raw fs/path) because the host resolves the key
// against the per-extension, per-user storage root in worker-host.ts
// resolveStoragePath, which is NOT process.cwd(). Using path.resolve()
// here would write to a different directory than spindle.storage.read
// reads from, silently reverting settings on every load.
const STORAGE_TMP_KEY = STORAGE_KEY + '.tmp'

async function loadLayout(): Promise<any> {
  if (DEBUG_LAYOUT_PERSIST) spindle.log.info(`[SidebarUX-DIAG] loadLayout: reading ${STORAGE_KEY}`)
  try {
    const data = await spindle.storage.read(STORAGE_KEY)
    if (DEBUG_LAYOUT_PERSIST) {
      spindle.log.info(`[SidebarUX-DIAG] loadLayout: read returned ${data === null ? 'null' : `${(data as string).length} bytes`}`)
    }
    if (data && typeof data === 'string') {
      return JSON.parse(data)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (DEBUG_LAYOUT_PERSIST) spindle.log.error(`[SidebarUX-DIAG] loadLayout: read threw: ${msg}`)
    spindle.log.warn(`[SidebarUX] Failed to load layout: ${msg}`)
  }
  return null
}

async function saveLayout(state: any): Promise<void> {
  const json = JSON.stringify(state, null, 2)
  if (DEBUG_LAYOUT_PERSIST) {
    spindle.log.info(`[SidebarUX-DIAG] saveLayout: writing ${json.length} bytes, settings.layoutPersistence=${state?.settings?.layoutPersistence}, secondary.open=${state?.secondary?.open}, detachedTabs=${state?.detachedTabs?.length ?? 0}`)
  }
  try {
    // Write the full payload to a temp key, then atomically move it over the
    // canonical key. spindle.storage.move() invokes renameSync on the host
    // (worker-host.ts handleStorageMove), so a process kill mid-rename leaves
    // either the old or the new file intact — never a torn half-write.
    await spindle.storage.write(STORAGE_TMP_KEY, json)
    if (DEBUG_LAYOUT_PERSIST) spindle.log.info(`[SidebarUX-DIAG] saveLayout: write(.tmp) ok`)
    try {
      await spindle.storage.move(STORAGE_TMP_KEY, STORAGE_KEY)
      if (DEBUG_LAYOUT_PERSIST) spindle.log.info(`[SidebarUX-DIAG] saveLayout: move ok`)
    } catch (moveErr: unknown) {
      // Cross-device or Windows EBUSY — fall back to a direct write so we
      // never lose data. Clean up the leftover temp key best-effort.
      const mmsg = moveErr instanceof Error ? moveErr.message : String(moveErr)
      if (DEBUG_LAYOUT_PERSIST) spindle.log.error(`[SidebarUX-DIAG] saveLayout: move threw: ${mmsg}`)
      spindle.log.warn(`[SidebarUX] Atomic move failed, falling back to direct write: ${mmsg}`)
      await spindle.storage.write(STORAGE_KEY, json)
      try { await spindle.storage.delete(STORAGE_TMP_KEY) } catch { /* best-effort */ }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (DEBUG_LAYOUT_PERSIST) spindle.log.error(`[SidebarUX-DIAG] saveLayout: write threw: ${msg}`)
    spindle.log.error(`[SidebarUX] Failed to save layout: ${msg}`)
  }
}

spindle.onFrontendMessage(async (payload: any) => {
  if (DEBUG_LAYOUT_PERSIST) spindle.log.info(`[SidebarUX-DIAG] onFrontendMessage: type=${payload?.type}`)
  if (payload.type === 'SAVE_LAYOUT') {
    await saveLayout(payload.layout)
  } else if (payload.type === 'LOAD_LAYOUT') {
    const layout = await loadLayout()
    spindle.sendToFrontend({ type: 'LAYOUT_DATA', layout })
  }
})

spindle.log.info('[SidebarUX] Backend started')
