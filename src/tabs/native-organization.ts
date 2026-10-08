import type { HostPort } from '../host/port'
import { buildModelFromLayout, serializeModelToLayout, type LegacyLayout } from '../persist/layout-model'
import { importNativeOrganization, normalizeOrganization, projectNativeOrganization } from '../core/organization'
import { reduce } from '../core/reduce'
import { refreshHostDrawerSettings, patchHostDrawerSettings } from '../dom/host-settings'
import { callHostStoreAction, findHostStoreApi } from '../store'
import { getModel, onModelChanged } from '../recon/dispatch'

/** Called only at extension enable, never on a mode-profile restore. */
export function adoptNativeOrganization(layout: unknown, host: HostPort): LegacyLayout {
  const saved = (layout && typeof layout === 'object' ? layout : {}) as LegacyLayout
  let model = buildModelFromLayout(saved, id => host.findKey(id))
  const native = findHostStoreApi()?.getState?.()?.drawerSettings as import('../dom/host-settings').HostDrawerSettings | undefined ?? refreshHostDrawerSettings()
  const raw = Array.isArray(native?.layout) ? native.layout : []
  const fingerprint = JSON.stringify(raw)
  const baseline = typeof native?.canvasOrganizationProjection === 'string' ? native.canvasOrganizationProjection : saved.nativeOrganizationProjection ?? saved.nativeOrganizationBaseline
  const changedOutside = baseline !== undefined && fingerprint !== baseline
  if (changedOutside || !saved.organization) {
    model = reduce(model, { t: 'setOrganization', organization: raw.length || changedOutside ? importNativeOrganization(raw.length ? raw : (native?.tabOrder ?? []).map((tabId: string) => ({ type: 'tab', tabId })), model, id => host.findKey(id)) : normalizeOrganization(model) })
  }
  return { ...saved, ...serializeModelToLayout({ ...model, nativeOrganizationBaseline: fingerprint }, key => host.resolve(key), saved.version ?? 'unknown') }
}

/** Snapshot the projection while the model and identity inventory are live.
 * Cleanup can then publish through the raw host action after Canvas teardown. */
export function keepNativeDisableProjection(host: HostPort): () => void {
  let projection: unknown[] | null = null
  const addresses: Record<string, string> = {}
  const capture = () => {
    const model = getModel(); if (!model?.organization) return
    Object.assign(addresses, model.nativeAddresses)
    for (const key of [...model.primary, ...model.secondary]) { const id = host.resolve(key); if (id) addresses[key] = id }
    projection = projectNativeOrganization(model.organization, key => host.resolve(key) ?? addresses[key] ?? null)
  }
  capture(); const stop = onModelChanged(capture)
  return () => {
    stop(); if (!projection) return
    const api = findHostStoreApi()
    const current = api?.getState?.()?.drawerSettings ?? refreshHostDrawerSettings() ?? {}
    const layout = projection
    const tabOrder = layout.flatMap((item: any) => item.type === 'tab' ? [item.tabId] : item.type === 'folder' ? item.children : [])
    // Full native shape, with a projection marker. Native Configure preserves
    // the marker, so a later comparison detects actual external edits.
    const settings = { ...current, layout, tabOrder, canvasOrganizationProjection: JSON.stringify(layout) }
    if (!callHostStoreAction('setSetting', 'drawerSettings', settings) && !patchHostDrawerSettings(settings)) console.warn('[canvas] Native folder projection could not be saved: host settings bridge unavailable.')
  }
}
