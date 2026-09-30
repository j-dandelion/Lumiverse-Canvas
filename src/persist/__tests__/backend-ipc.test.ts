// Backend IPC regression tests for the canvas extension backend (src/backend.ts).
//
// This drives the REAL backend module in a worker-like environment: the
// `spindle` global is stubbed with an in-memory storage that mirrors the
// host contract — `storage.read` REJECTS with `Error: File not found` when
// the key is missing (worker-host-storage-api.ts handleStorageRead → fail)
// and can return either a string or `{ data: string }`. Missing files must
// stay distinct from other read failures so the frontend write fence protects
// existing files after a transient storage or IPC error.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

// ── In-memory storage mirroring the host storage API contract ──────────────
const mem = new Map<string, string>()
const written: Array<{ key: string; json: string }> = []

const sent: Array<{ type: string; [k: string]: unknown }> = []
const handlers: Array<(payload: any) => Promise<void>> = []

;(globalThis as any).spindle = {
  onFrontendMessage(h: (payload: any) => Promise<void>) {
    handlers.push(h)
    return () => {}
  },
  sendToFrontend(payload: any) {
    sent.push(payload)
  },
  log: { info() {}, warn() {}, error() {} },
  storage: {
    async read(key: string) {
      if (!mem.has(key)) throw new Error('File not found')
      return mem.get(key)!
    },
    async write(key: string, data: string) {
      mem.set(key, data)
      written.push({ key, json: data })
      return true
    },
    async move(from: string, to: string) {
      if (mem.has(from)) {
        mem.set(to, mem.get(from)!)
        mem.delete(from)
      }
      return true
    },
    async delete(key: string) {
      mem.delete(key)
      return true
    },
  },
}

async function dispatch(payload: any): Promise<void> {
  for (const h of handlers) { await h(payload) }
}

function lastSent(type: string): any {
  const matches = sent.filter((m) => m.type === type)
  return matches.length > 0 ? matches[matches.length - 1] : undefined
}

async function main(): Promise<void> {
  const backend = await import('../../backend')
  void backend

  // B1 — fresh install: neither file exists → load must be 'empty' (not
  // 'error'), so the frontend arms the repos and can write the first save.
  mem.clear(); written.length = 0; sent.length = 0
  await dispatch({ type: 'LOAD_SETTINGS' })
  assertEqual(lastSent('SETTINGS_DATA')?.result?.status, 'empty', 'B1a missing settings.json → status empty')
  await dispatch({ type: 'LOAD_LAYOUT' })
  assertEqual(lastSent('LAYOUT_DATA')?.result?.status, 'empty', 'B1b missing layout.json → status empty')

  // B1c — a non-missing read rejection must surface as an error, preserving
  // the existing bytes instead of treating the file as absent.
  {
    const storage = (globalThis as any).spindle.storage
    const originalRead = storage.read
    const original = JSON.stringify({ version: 2, marker: 'keep-existing-layout' })
    mem.clear(); written.length = 0; sent.length = 0
    mem.set('layout.json', original)
    storage.read = async (key: string) => {
      if (key === 'layout.json') throw new Error('temporary storage failure')
      return originalRead(key)
    }
    try {
      await dispatch({ type: 'LOAD_LAYOUT' })
      const result = lastSent('LAYOUT_DATA')?.result
      assertEqual(result?.status, 'error', 'B1c read failure → status error')
      assertEqual(result?.reason, 'read failed: temporary storage failure', 'B1c read failure is reported')
      assertEqual(mem.get('layout.json'), original, 'B1c existing layout bytes remain unchanged')
      assertEqual(written.length, 0, 'B1c read failure writes nothing')
    } finally {
      storage.read = originalRead
    }
  }

  // B1d — accept the wrapper-shaped storage payload as readable JSON.
  {
    const storage = (globalThis as any).spindle.storage
    const originalRead = storage.read
    const wrappedLayout = JSON.stringify({ version: 2, marker: 'wrapped-read' })
    mem.clear(); written.length = 0; sent.length = 0
    mem.set('layout.json', wrappedLayout)
    storage.read = async (key: string) => {
      const value = await originalRead(key)
      return { data: value }
    }
    try {
      await dispatch({ type: 'LOAD_LAYOUT' })
      const result = lastSent('LAYOUT_DATA')?.result
      assertEqual(result?.status, 'ok', 'B1d wrapper-shaped read → status ok')
      assertEqual(result?.data?.marker, 'wrapped-read', 'B1d wrapper payload is parsed')
    } finally {
      storage.read = originalRead
    }
  }

  // B2 — fresh-install regression: save → reload round-trips through disk.
  mem.clear(); written.length = 0; sent.length = 0
  await dispatch({ type: 'SAVE_SETTINGS', settings: { version: 2, settings: { debugMode: true } }, saveId: 7 })
  assertEqual(lastSent('SAVE_SETTINGS_RESULT')?.saveId, 7, 'B2a settings save result carries saveId')
  assertEqual(lastSent('SAVE_SETTINGS_RESULT')?.result?.status, 'ok', 'B2b settings save ok')
  assert(mem.has('settings.json'), 'B2c settings.json written to disk')
  assertEqual(JSON.parse(mem.get('settings.json')!).settings.debugMode, true, 'B2d saved payload round-trips')

  await dispatch({ type: 'LOAD_SETTINGS' })
  const s2 = lastSent('SETTINGS_DATA')
  assertEqual(s2?.result?.status, 'ok', 'B2e settings reload ok')
  assertEqual(s2?.result?.data?.settings?.debugMode, true, 'B2f reloaded settings value')

  await dispatch({ type: 'SAVE_LAYOUT', layout: { version: 2, drawerSide: 'left' }, saveId: 8 })
  assertEqual(lastSent('SAVE_LAYOUT_RESULT')?.result?.status, 'ok', 'B2g layout save ok')
  assert(mem.has('layout.json'), 'B2h layout.json written to disk')
  await dispatch({ type: 'LOAD_LAYOUT' })
  const l2 = lastSent('LAYOUT_DATA')
  assertEqual(l2?.result?.status, 'ok', 'B2i layout reload ok')
  assertEqual(l2?.result?.data?.drawerSide, 'left', 'B2j reloaded layout value')

  // B3 — atomic write: tmp key first, moved into place, tmp cleaned up.
  mem.clear(); written.length = 0; sent.length = 0
  await dispatch({ type: 'SAVE_SETTINGS', settings: { version: 2, settings: { secondSidebarEnabled: false } }, saveId: 9 })
  assert(written.some((w) => w.key === 'settings.json.tmp'), 'B3a write went to settings.json.tmp first')
  assert(mem.has('settings.json'), 'B3b final key in place')
  assertEqual(mem.has('settings.json.tmp'), false, 'B3c tmp key cleaned after move')

  // B4 — corrupt file → 'error', and the original bytes are moved aside
  // (never overwritten with defaults).
  mem.clear(); written.length = 0; sent.length = 0
  mem.set('settings.json', 'not-json{{{')
  await dispatch({ type: 'LOAD_SETTINGS' })
  assertEqual(lastSent('SETTINGS_DATA')?.result?.status, 'error', 'B4a corrupt settings.json → status error')
  assertEqual(mem.has('settings.json'), false, 'B4b corrupt file moved out of the live key')
  assert([...mem.keys()].some((k) => k.startsWith('settings.corrupt-')), 'B4c corrupt file preserved under .corrupt- key')

  mem.clear(); written.length = 0; sent.length = 0
  mem.set('layout.json', 'also-not-json{{{')
  await dispatch({ type: 'LOAD_LAYOUT' })
  assertEqual(lastSent('LAYOUT_DATA')?.result?.status, 'error', 'B4d corrupt layout.json → status error')
  assert([...mem.keys()].some((k) => k.startsWith('layout.corrupt-')), 'B4e corrupt layout preserved under .corrupt- key')

  // B5 — a storage failure must ack {status:'error'}, not ok. The old
  // saveLayout/saveSettings caught and logged, so the chained `.then` always
  // acked ok and the frontend's reliability layer never retried (review B2).
  mem.clear(); written.length = 0; sent.length = 0
  const storage = (globalThis as any).spindle.storage
  const origWrite = storage.write
  storage.write = async () => { throw new Error('disk full') }
  try {
    await dispatch({ type: 'SAVE_LAYOUT', layout: { version: 2, drawerSide: 'left' }, saveId: 11 })
    assertEqual(lastSent('SAVE_LAYOUT_RESULT')?.saveId, 11, 'B5a failed layout save result carries saveId')
    assertEqual(lastSent('SAVE_LAYOUT_RESULT')?.result?.status, 'error', 'B5b failed layout write → status error')

    await dispatch({ type: 'SAVE_SETTINGS', settings: { version: 2, settings: {} }, saveId: 12 })
    assertEqual(lastSent('SAVE_SETTINGS_RESULT')?.result?.status, 'error', 'B5c failed settings write → status error')

    // Invalid payloads are programmer errors, not silent successes.
    await dispatch({ type: 'SAVE_LAYOUT', saveId: 13 })
    assertEqual(lastSent('SAVE_LAYOUT_RESULT')?.result?.status, 'error', 'B5d invalid layout payload → status error')
  } finally {
    storage.write = origWrite
  }
  // The queue must stay usable after a failure.
  await dispatch({ type: 'SAVE_LAYOUT', layout: { version: 2, drawerSide: 'right' }, saveId: 14 })
  assertEqual(lastSent('SAVE_LAYOUT_RESULT')?.result?.status, 'ok', 'B5e queue recovers after a failed save')
  assertEqual(lastSent('SAVE_LAYOUT_RESULT')?.saveId, 14, 'B5f recovery ack correlates saveId')

  console.log(`persist/backend-ipc: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exitCode = 1
    process.exit(1)
  }
}

void main()

// Make this file a module so the top-level helpers stay file-scoped under
// the repo-wide tsc invocation (test files share the same compilation unit).
export {}
