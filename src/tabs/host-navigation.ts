import { callHostStoreAction, findHostStoreApi } from '../store'
import { getHostDrawerSettings } from '../dom/host-settings'
import { getFiberFromElement } from '../dom/fiber'
import { getMainSidebar } from '../dom/lumiverse'
import { dispatch, getHost, getModel } from '../recon/dispatch'
import { currentLifecycleGeneration, isLifecycleCurrent } from '../lifecycle/instance'
import { findMainTabButton } from './buttons'

/** Staging keeps folder browsing in a local React hook. A store navigation
 * alone cannot leave it when the target is the already remembered tab. */
export function leaveNativeFolderBrowser(): void {
  const layout = getHostDrawerSettings()?.layout
  if (!Array.isArray(layout)) return
  const ids = new Set(layout.filter(item => item?.type === 'folder').map(item => item.id))
  const sidebar = getMainSidebar(); if (!sidebar) return
  let fiber = getFiberFromElement(sidebar) as any
  while (fiber) {
    let hook = fiber.memoizedState
    for (let i = 0; hook && i < 60; i++, hook = hook.next) {
      if (typeof hook.memoizedState === 'string' && ids.has(hook.memoizedState) && typeof hook.queue?.dispatch === 'function') hook.queue.dispatch(null)
    }
    fiber = fiber.return
  }
}

let internalNavigation = 0

export function navigateHostTab(id: string, suppliedButton?: HTMLElement | null): boolean {
  internalNavigation++
  try {
  leaveNativeFolderBrowser()
  const button = suppliedButton ?? findMainTabButton(id) as HTMLElement | null
  // Ordinary buttons keep their host handler (including native side effects).
  if (button && button.getAttribute('aria-hidden') !== 'true') { button.click(); return true }
  return callHostStoreAction('openDrawer', id)
  } finally { internalNavigation-- }
}

/** Native buttons, keyboard navigation, and SDK callers can select the same
 * remembered ID without changing host state. Observe their explicit action,
 * keeping Canvas's own content-mounting calls out of the selection policy. */
export function observeExplicitHostNavigation(): () => void {
  const api = findHostStoreApi(), original = api?.getState?.()?.openDrawer
  if (!api?.setState || typeof original !== 'function') return () => {}
  const generation = currentLifecycleGeneration()
  const wrapped = function (this: unknown, ...args: unknown[]) {
    if (!internalNavigation && isLifecycleCurrent(generation) && typeof args[0] === 'string') {
      const key = getHost()?.findKey(args[0]), model = getModel()
      if (key && model) {
        const side = model.secondary.includes(key) ? 'secondary' : 'primary'
        if (model.folderBrowser?.[side]) void dispatch({ t: 'activate', key, side })
      }
    }
    return original.apply(this, args)
  }
  const originalModal = api.getState?.()?.openModal
  const wrappedModal = function (this: unknown, ...args: unknown[]) {
    if (args[0] === 'configureTabs' && isLifecycleCurrent(generation)) {
      void import('./configure-modal').then(module => { if (isLifecycleCurrent(generation)) void module.openConfigureTabsModal() })
      return
    }
    if (typeof originalModal === 'function') return originalModal.apply(this, args)
  }
  api.setState({ openDrawer: wrapped, ...(typeof originalModal === 'function' ? { openModal: wrappedModal } : {}) })
  return () => {
    if (api.getState?.()?.openDrawer === wrapped) api.setState?.({ openDrawer: original })
    if (api.getState?.()?.openModal === wrappedModal) api.setState?.({ openModal: originalModal })
  }
}
