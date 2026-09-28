import { describe, expect, mock, test } from 'bun:test'

const applied: Array<{ prev: any; next: any }> = []
const testFeature = {
  id: 'debugMode',
  apply: (prev: any, next: any) => { applied.push({ prev, next }) },
}

mock.module('../../features/registry', () => ({ FEATURES: [testFeature] }))
mock.module('../../layout/snapshot', () => ({
  buildPersistedLayout: () => ({ primary: { tabOrder: [] }, secondary: { tabOrder: [] } }),
}))
mock.module('../../debug/persist-debug', () => ({
  logPersistSave() {},
  syncPersistDebugToBackend() {},
}))

const [{ mountSettingsPanel, clearSettingsPanelContext }, state, settingsRepo, backendCtx, layoutLoad] =
  await Promise.all([
    import('../panel'),
    import('../state'),
    import('../../persist/settings-repo'),
    import('../../persist/backend-ctx'),
    import('../../persist/layout-load'),
  ])

describe('settings teardown quiescence', () => {
  test('setup disarms persistence and clears settings contexts after cleanup flushes', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const source = readFileSync(join(process.cwd(), 'src/setup.ts'), 'utf8')
    const teardownStart = source.lastIndexOf('return () => {')
    const teardown = source.slice(teardownStart)
    const cleanupIndex = teardown.indexOf('cleanupAll()')
    const disarmLayoutIndex = teardown.indexOf('disarmLayoutRepo()')
    const disarmSettingsIndex = teardown.indexOf('disarmSettingsRepo()')
    const settingsRepoContextIndex = teardown.indexOf('setSettingsRepoBackendCtx(null)')
    const panelContextIndex = teardown.indexOf('clearSettingsPanelContext()')
    const flushRegistrationIndex = source.indexOf('flushPendingSaves on teardown failed')

    expect(teardownStart).toBeGreaterThanOrEqual(0)
    expect(flushRegistrationIndex).toBeGreaterThanOrEqual(0)
    expect(flushRegistrationIndex).toBeLessThan(teardownStart)
    expect(cleanupIndex).toBeGreaterThanOrEqual(0)
    expect(disarmLayoutIndex).toBeGreaterThan(cleanupIndex)
    expect(disarmSettingsIndex).toBeGreaterThan(cleanupIndex)
    expect(settingsRepoContextIndex).toBeGreaterThan(disarmSettingsIndex)
    expect(panelContextIndex).toBeGreaterThan(settingsRepoContextIndex)
  })

  test('flushes the intended save, then stale setSettings has no fan-out or IPC', async () => {
    state.cancelSettingsSave()
    settingsRepo.__resetSettingsRepoForTest()
    applied.length = 0

    const sent: Array<{ type: string; saveId?: number }> = []
    let messageHandler: ((payload: unknown) => void) | null = null
    const backend = {
      sendToBackend(message: { type: string; saveId?: number }) {
        sent.push(message)
        if (message.type === 'SAVE_SETTINGS' && message.saveId !== undefined) {
          messageHandler?.({
            type: 'SAVE_SETTINGS_RESULT',
            saveId: message.saveId,
            result: { status: 'ok' },
          })
        }
      },
      onBackendMessage(handler: (payload: unknown) => void) {
        messageHandler = handler
        return () => { messageHandler = null }
      },
    }

    backendCtx.setBackendCtx(backend as any)
    settingsRepo.setSettingsRepoBackendCtx(backend as any)
    const unbindSaveResults = settingsRepo.bindSettingsSaveResultBridge()
    settingsRepo.armSettingsRepo()
    mountSettingsPanel({ ui: { mount: () => null } } as any)

    state.setSettings({ debugMode: true })
    expect(applied).toHaveLength(1)

    // This is the flush called by setup's cleanup chain. It must run while
    // the settings repo is still armed and its backend context is available.
    layoutLoad.flushPendingSaves()
    await Promise.resolve()
    expect(sent.filter((message) => message.type === 'SAVE_SETTINGS')).toHaveLength(1)

    clearSettingsPanelContext()
    settingsRepo.disarmSettingsRepo()
    settingsRepo.setSettingsRepoBackendCtx(null)
    backendCtx.setBackendCtx(null)
    unbindSaveResults()

    const applyCountAfterTeardown = applied.length
    const saveCountAfterTeardown = sent.filter((message) => message.type === 'SAVE_SETTINGS').length
    state.setSettings({ debugMode: false })
    await Promise.resolve()

    expect(applied).toHaveLength(applyCountAfterTeardown)
    expect(sent.filter((message) => message.type === 'SAVE_SETTINGS')).toHaveLength(saveCountAfterTeardown)
    expect(settingsRepo.isSettingsRepoArmed()).toBe(false)
    state.cancelSettingsSave()
  })
})
