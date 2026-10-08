import { organizationFor, references, type Organization } from '../core/organization'
import { getHost, getModel } from '../recon/dispatch'
import { createDraft } from './configure-model'
import { getFullCatalog } from './configure-catalog'
import { commitDraftToOwnedModel } from './owned-commit'
import { currentLifecycleGeneration, isLifecycleCurrent } from '../lifecycle/instance'

let queue: Promise<void> = Promise.resolve()
/** Organization gestures share Configure's placement/rollback transaction. */
export function commitOrganization(change: (current: Organization) => Organization): Promise<void> {
  const generation = currentLifecycleGeneration()
  const task = queue.then(async () => {
    if (!isLifecycleCurrent(generation)) return
    const modal = await import('./configure-modal')
    await modal.flushConfigureCommits()
    if (!isLifecycleCurrent(generation)) return
    const host = getHost(), model = getModel(); if (!host || !model) return
    // Apply the gesture after pending editor/gesture commits. A captured
    // organization snapshot can otherwise undo a rename or an earlier move.
    const organization = change(organizationFor(model))
    const ids = (side: 'primary' | 'secondary') => references(organization[side]).flatMap(ref => {
      const id = ref.key ? host.resolve(ref.key) : null
      return id && host.findKey(id) ? [id] : []
    })
    const primaryIds = ids('primary'), secondaryIds = ids('secondary')
    const draft = createDraft({ catalog: getFullCatalog(), tabOrder: [...primaryIds, ...secondaryIds], drawerSide: model.side, hiddenTabIds: model.hidden.flatMap(key => host.resolve(key) ? [host.resolve(key)!] : []), assignments: new Map(secondaryIds.map(id => [id, 'secondary' as const])) })
    const result = await commitDraftToOwnedModel({ ...draft, primaryIds, secondaryIds, organization }, model.active)
    if (!isLifecycleCurrent(generation)) return
    if (!result.ok) { if (result.superseded) return; throw new Error(result.error) }
    modal.refreshConfigureDraftFromLive()
  })
  queue = task.catch(() => {})
  return task
}

export function showOrganizationError(error: unknown): void {
  const notice = document.createElement('div')
  notice.className = 'canvas-organization-error'; notice.setAttribute('role', 'alert')
  notice.textContent = error instanceof Error ? error.message : String(error)
  document.body.appendChild(notice); setTimeout(() => notice.remove(), 6000)
}
