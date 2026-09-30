import {
  isHostDrawerSettingsWritable,
  patchHostDrawerSettings,
  refreshHostDrawerSettings,
  writeHostDrawerSettingsViaApi,
} from '../dom/host-settings'
import { dlog } from '../debug/log'
import { currentLifecycleGeneration, isLifecycleCurrent } from '../lifecycle/instance'
import { normalizeHiddenIds } from './canvas-hidden'
import { syncHiddenTabsFromHost } from './hidden-tabs'

const CHECK_INTERVAL_MS = 1000
const CONFIGURE_READY_TIMEOUT_MS = 3500

let _activeStop: (() => void) | null = null
let _ensureBeforeConfigure: (() => Promise<void>) | null = null

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** Wait for the startup unhide to land before Configure Tabs snapshots inventory. */
export async function ensureVanillaTabsUnhiddenBeforeConfigure(): Promise<void> {
  await _ensureBeforeConfigure?.()
}

/**
 * Keep Lumiverse's own hidden-tab list clear while the member opts in.
 * Canvas's separately-owned Configure Tabs hides remain in effect.
 */
export function startUnhideVanillaTabs(): () => void {
  if (_activeStop) return _activeStop

  const generation = currentLifecycleGeneration()
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null
  let apiWrite: AbortController | null = null
  let apiWritePromise: Promise<boolean> | null = null
  let modelUnhideInFlight = false
  const pendingModelUnhideIds = new Set<string>()

  const reconcileOwnedHiddenTabs = async (): Promise<void> => {
    if (stopped || !isLifecycleCurrent(generation)
      || modelUnhideInFlight || pendingModelUnhideIds.size === 0) return
    modelUnhideInFlight = true
    try {
      // Keep the owned model (and its persisted layout) in sync with the
      // host-setting change. Resolve IDs only through the host identity
      // facade; never invent a TabKey for an unobserved panel.
      const { dispatchBatch, getHost, getModel } = await import('../recon/dispatch')
      if (stopped || !isLifecycleCurrent(generation)) return
      const host = getHost()
      const model = getModel()
      if (!host || !model) return

      const intents: Array<{ t: 'setHidden'; key: string; hidden: false }> = []
      const resolvedIds: string[] = []
      for (const id of pendingModelUnhideIds) {
        const key = host.findKey(id)
        if (!key) continue
        if (!model.hidden.includes(key)) {
          pendingModelUnhideIds.delete(id)
          continue
        }
        intents.push({ t: 'setHidden', key, hidden: false })
        resolvedIds.push(id)
      }
      if (intents.length === 0) return

      await dispatchBatch(intents)
      for (const id of resolvedIds) pendingModelUnhideIds.delete(id)
    } catch (err) {
      dlog('[tabs] clearing host-originated model hides failed', String(err))
    } finally {
      modelUnhideInFlight = false
    }
  }

  const check = (): void => {
    if (stopped || !isLifecycleCurrent(generation)) return

    let hostSettings
    try {
      // The vanilla Configure Tabs UI can update this list without going
      // through Canvas, so read the current host store rather than the cache.
      hostSettings = refreshHostDrawerSettings()
    } catch (err) {
      dlog('[tabs] refresh host settings for unhide failed', String(err))
      return
    }

    const hostHidden = normalizeHiddenIds(hostSettings?.hiddenTabIds)
    for (const id of hostHidden) pendingModelUnhideIds.add(id)

    if (hostHidden.length > 0) {
      // Drop these host-originated hides from Canvas's copy before the host
      // re-renders the newly-unhidden tab buttons. This also preserves Canvas's
      // closed-window suppression and Configure-only hides for other tabs.
      try {
        syncHiddenTabsFromHost({ unhideHostTabs: true })
      } catch (err) {
        dlog('[tabs] sync hidden tabs during unhide failed', String(err))
      }

      // Prefer the live store setter. If that bridge is unavailable in this
      // Lumiverse build, use Lumiverse's own authenticated settings endpoint.
      try {
        if (isHostDrawerSettingsWritable()
          && patchHostDrawerSettings({ hiddenTabIds: [] })) {
          dlog('[tabs] cleared Lumiverse hidden-tab list via store')
          void reconcileOwnedHiddenTabs()
          return
        }
      } catch (err) {
        dlog('[tabs] clearing Lumiverse hidden-tab list via store failed', String(err))
      }

      if (!apiWrite) {
        const controller = new AbortController()
        apiWrite = controller
        const request = writeHostDrawerSettingsViaApi({ hiddenTabIds: [] }, controller.signal)
        apiWritePromise = request
        void request
          .then((ok) => {
            if (ok && !stopped && isLifecycleCurrent(generation)) {
              dlog('[tabs] cleared Lumiverse hidden-tab list via settings API')
            }
          })
          .finally(() => {
            if (apiWrite === controller) {
              apiWrite = null
              if (apiWritePromise === request) apiWritePromise = null
            }
          })
      }
    }

    void reconcileOwnedHiddenTabs()
  }

  const ensureBeforeConfigure = async (): Promise<void> => {
    if (stopped || !isLifecycleCurrent(generation)) return
    const deadline = Date.now() + CONFIGURE_READY_TIMEOUT_MS
    while (!stopped && isLifecycleCurrent(generation)) {
      // The feature normally starts this write at boot. Recheck here so an
      // early Configure click joins that request, or retries it if it failed.
      check()

      let latest
      try {
        latest = refreshHostDrawerSettings()
      } catch (err) {
        dlog('[tabs] refresh host settings before Configure failed', String(err))
        return
      }

      if (normalizeHiddenIds(latest?.hiddenTabIds).length === 0) {
        await waitForPaint()
        return
      }
      if (Date.now() >= deadline) return

      if (apiWritePromise) {
        await Promise.race([apiWritePromise.then(() => undefined, () => undefined), wait(100)])
      } else {
        await wait(100)
      }
    }
  }
  _ensureBeforeConfigure = ensureBeforeConfigure

  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    apiWrite?.abort()
    apiWrite = null
    apiWritePromise = null
    pendingModelUnhideIds.clear()
    if (_ensureBeforeConfigure === ensureBeforeConfigure) {
      _ensureBeforeConfigure = null
    }
    if (_activeStop === stop) _activeStop = null
  }

  _activeStop = stop
  check()
  timer = setInterval(check, CHECK_INTERVAL_MS)
  return stop
}
