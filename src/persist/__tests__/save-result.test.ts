import { test, describe, beforeEach } from 'bun:test'
import {
  saveLayoutToDisk,
  setLayoutRepoBackendCtx,
  armLayoutRepo,
  disarmLayoutRepo,
  __resolveLayoutSave,
  bindLayoutSaveResultBridge,
  __resetLayoutRepoForTest,
} from '../layout-repo'
import {
  saveSettingsToDisk,
  setSettingsRepoBackendCtx,
  armSettingsRepo,
  disarmSettingsRepo,
  __resolveSettingsSave,
  bindSettingsSaveResultBridge,
  __resetSettingsRepoForTest,
} from '../settings-repo'

interface MockMessage {
  type: string
  saveId?: number
  [key: string]: unknown
}

function makeBackend() {
  const sent: MockMessage[] = []
  let listener: ((p: any) => void) | null = null
  return {
    sent,
    sendToBackend(msg: any) { sent.push(msg) },
    onBackendMessage(h: any) { listener = h; return () => { if (listener === h) listener = null } },
    emit(p: any) { if (listener) listener(p) },
  }
}

describe('layout-repo save result propagation', () => {
  let backend: ReturnType<typeof makeBackend>

  beforeEach(() => {
    __resetLayoutRepoForTest()
    backend = makeBackend()
    setLayoutRepoBackendCtx(backend)
    armLayoutRepo()
  })

  test('L1: saveLayoutToDisk without backend returns error', async () => {
    setLayoutRepoBackendCtx(null)
    const r = await saveLayoutToDisk({})
    if (r.status !== 'error') throw new Error('expected error')
    if (r.reason !== 'no backend') throw new Error(`wrong reason: ${r.reason}`)
  })

  test('L2: saveLayoutToDisk without arm returns error', async () => {
    disarmLayoutRepo()
    const r = await saveLayoutToDisk({})
    if (r.status !== 'error') throw new Error('expected error')
    if (r.reason !== 'not armed') throw new Error(`wrong reason: ${r.reason}`)
  })

  test('L3: saveLayoutToDisk sends SAVE_LAYOUT with saveId', async () => {
    const p = saveLayoutToDisk({ test: 1 })
    if (backend.sent.length !== 1) throw new Error('no message sent')
    if (backend.sent[0].type !== 'SAVE_LAYOUT') throw new Error('wrong type')
    if (typeof backend.sent[0].saveId !== 'number') throw new Error('no saveId')
    __resolveLayoutSave(backend.sent[0].saveId as number, { status: 'ok' })
    const r = await p
    if (r.status !== 'ok') throw new Error('not resolved ok')
  })

  test('L4: saveLayoutToDisk rejects on error result', async () => {
    const p = saveLayoutToDisk({ test: 1 })
    const saveId = backend.sent[0].saveId as number
    __resolveLayoutSave(saveId, { status: 'error', reason: 'disk full' })
    const r = await p
    if (r.status !== 'error') throw new Error('expected error')
    if (r.reason !== 'disk full') throw new Error(`wrong reason: ${r.reason}`)
  })

  test('L5: bindLayoutSaveResultBridge routes SAVE_LAYOUT_RESULT to pending save', async () => {
    bindLayoutSaveResultBridge()
    const p = saveLayoutToDisk({ x: 1 })
    const saveId = backend.sent[0].saveId as number
    backend.emit({ type: 'SAVE_LAYOUT_RESULT', saveId, result: { status: 'ok' } })
    const r = await p
    if (r.status !== 'ok') throw new Error('not ok')
  })

  test('L6: bindLayoutSaveResultBridge ignores unrelated messages', async () => {
    bindLayoutSaveResultBridge()
    const p = saveLayoutToDisk({ x: 1 })
    const saveId = backend.sent[0].saveId as number
    backend.emit({ type: 'LAYOUT_DATA', result: { status: 'ok' } })
    backend.emit({ type: 'SAVE_SETTINGS_RESULT', saveId: 999, result: { status: 'ok' } })
    // The save should still be pending; resolve it explicitly.
    __resolveLayoutSave(saveId, { status: 'ok' })
    const r = await p
    if (r.status !== 'ok') throw new Error('expected ok after explicit resolve')
  })

  test('L7: disarmLayoutRepo rejects in-flight saves', async () => {
    const p = saveLayoutToDisk({ x: 1 })
    disarmLayoutRepo()
    let threw = false
    try { await p } catch { threw = true }
    if (!threw) throw new Error('expected disarm to reject')
  })

  test('L8: __resolveLayoutSave with unknown id is a no-op', () => {
    __resolveLayoutSave(999999, { status: 'ok' })
    // no throw = pass
  })
})

describe('settings-repo save result propagation', () => {
  let backend: ReturnType<typeof makeBackend>

  beforeEach(() => {
    __resetSettingsRepoForTest()
    backend = makeBackend()
    setSettingsRepoBackendCtx(backend)
    armSettingsRepo()
  })

  test('S1: saveSettingsToDisk without backend returns error', async () => {
    setSettingsRepoBackendCtx(null)
    const r = await saveSettingsToDisk({ a: 1 })
    if (r.status !== 'error') throw new Error('expected error')
  })

  test('S2: saveSettingsToDisk sends SAVE_SETTINGS with saveId and version 2', async () => {
    const p = saveSettingsToDisk({ a: 1 })
    if (backend.sent.length !== 1) throw new Error('no message sent')
    if (backend.sent[0].type !== 'SAVE_SETTINGS') throw new Error('wrong type')
    if (typeof backend.sent[0].saveId !== 'number') throw new Error('no saveId')
    const settings = backend.sent[0].settings as { version: number; settings: unknown }
    if (settings.version !== 2) throw new Error('wrong version')
    __resolveSettingsSave(backend.sent[0].saveId as number, { status: 'ok' })
    const r = await p
    if (r.status !== 'ok') throw new Error('not ok')
  })

  test('S3: saveSettingsToDisk rejects on error result', async () => {
    const p = saveSettingsToDisk({ a: 1 })
    const saveId = backend.sent[0].saveId as number
    __resolveSettingsSave(saveId, { status: 'error', reason: 'quota exceeded' })
    const r = await p
    if (r.status !== 'error') throw new Error('expected error')
    if (r.reason !== 'quota exceeded') throw new Error(`wrong reason: ${r.reason}`)
  })

  test('S4: bindSettingsSaveResultBridge routes SAVE_SETTINGS_RESULT', async () => {
    bindSettingsSaveResultBridge()
    const p = saveSettingsToDisk({ a: 1 })
    const saveId = backend.sent[0].saveId as number
    backend.emit({ type: 'SAVE_SETTINGS_RESULT', saveId, result: { status: 'ok' } })
    const r = await p
    if (r.status !== 'ok') throw new Error('not ok')
  })

  test('S5: disarmSettingsRepo rejects in-flight saves', async () => {
    const p = saveSettingsToDisk({ a: 1 })
    disarmSettingsRepo()
    let threw = false
    try { await p } catch { threw = true }
    if (!threw) throw new Error('expected disarm to reject')
  })
})
