import { getHost, getModel } from '../recon/dispatch'
import { itemId, organizationFor, relocateOrganizationItem } from '../core/organization'
import type { Side } from '../core/model'
import { isDragAndDropDrawerTabsEnabled, isHorizontalStrip } from '../settings/state'
import { getMainMirrorTabList } from '../sidebar/main-mirror-drawer'
import { getSecondaryTabList } from '../sidebar/secondary'
import { commitOrganization, showOrganizationError } from './organization-actions'
import { currentLifecycleGeneration, isLifecycleCurrent } from '../lifecycle/instance'

/** Pointer DnD for organization representatives. Legacy flat DnD remains
 * available only before organization initialization. No React nodes move. */
export function installOrganizationDrag(): () => void {
  const generation = currentLifecycleGeneration()
  let cleanupDrag: (() => void) | null = null
  let suppressClickUntil = 0
  const suppressClick = (e: MouseEvent) => { if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopImmediatePropagation() } }
  const down = (e: PointerEvent) => {
    if (!getModel()?.organization || e.button !== 0) return
    const element = e.target as Element
    const configureHandle = element?.closest('.canvas-configure-tabs-drag-handle')
    const configureSource = configureHandle?.closest<HTMLElement>('[data-organization-ref]')
    // Configure Tabs has a dedicated pointer-driven editor path with Canvas
    // 2.0's FLIP and drop-settle animations. Live drawer DnD stays here.
    if (configureSource) return
    const source = element?.closest<HTMLElement>('[data-canvas-organization],button[data-tab-id]')
    if (!source || !isDragAndDropDrawerTabsEnabled() || source.closest('.canvas-configure-tabs-overlay') || source.hasAttribute('data-canvas-folder-member')) return
    const primaryList = getMainMirrorTabList(), secondaryList = getSecondaryTabList()
    const from: Side | null = primaryList?.contains(source) ? 'primary' : secondaryList?.contains(source) ? 'secondary' : null
    if (!from) return
    const id = source.getAttribute('data-canvas-organization') ?? getHost()?.findKey(source.getAttribute('data-tab-id') ?? '')
    if (!id) return
    cleanupDrag?.()
    let touchReady = e.pointerType !== 'touch' && e.pointerType !== 'pen'
    const armTimer = setTimeout(() => { touchReady = true }, 200)
    let folderDwell: ReturnType<typeof setTimeout> | null = null
    let started = false, overlay: HTMLElement | null = null, target: { side: Side; index: number; folder?: string } | null = null, highlighted: HTMLElement | null = null
    const x = e.clientX, y = e.clientY
    const finish = () => { clearTimeout(armTimer); if (folderDwell) clearTimeout(folderDwell); document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', cancel, true); document.removeEventListener('keydown', key, true); overlay?.remove(); source.classList.remove('canvas-organization-drag-source'); highlighted?.classList.remove('canvas-folder-drop', 'canvas-organization-insert-before', 'canvas-organization-insert-after'); cleanupDrag = null }
    const cancel = () => { if (started) suppressClickUntil = Date.now() + 250; finish() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel() } }
    const move = (event: PointerEvent) => {
      if (!isLifecycleCurrent(generation)) { cancel(); return }
      const distance = Math.hypot(event.clientX - x, event.clientY - y)
      if (!started && !touchReady) { if (distance > 7) cancel(); return }
      if (!started && distance < 7) return
      if (!started) { started = true; source.classList.add('canvas-organization-drag-source'); overlay = source.cloneNode(true) as HTMLElement; overlay.style.cssText = `position:fixed;pointer-events:none;z-index:12000;width:${source.getBoundingClientRect().width}px;height:${source.getBoundingClientRect().height}px;opacity:.85`; document.body.appendChild(overlay) }
      event.preventDefault(); event.stopImmediatePropagation()
      if (overlay) { overlay.style.left = `${event.clientX + 12}px`; overlay.style.top = `${event.clientY + 12}px` }
      highlighted?.classList.remove('canvas-folder-drop', 'canvas-organization-insert-before', 'canvas-organization-insert-after'); highlighted = null; target = null
      const model = getModel(); if (!model) return
      const horizontal = isHorizontalStrip()
      for (const [side, list] of [['primary', getMainMirrorTabList()], ['secondary', getSecondaryTabList()]] as const) {
        if (!list) continue
        const rect = list.getBoundingClientRect()
        if (event.clientX < rect.left - 12 || event.clientX > rect.right + 12 || event.clientY < rect.top - 12 || event.clientY > rect.bottom + 12) continue
        const items = organizationFor(model)[side]
        target = { side, index: items.length }
        for (let index = 0; index < items.length; index++) {
          const item = items[index]!
          const node = item.type === 'tab' ? Array.from(list.querySelectorAll<HTMLElement>('button[data-tab-id]')).find(btn => item.key && getHost()?.findKey(btn.getAttribute('data-tab-id') ?? '') === item.key) : Array.from(list.querySelectorAll<HTMLElement>('[data-canvas-organization]')).find(node => node.getAttribute('data-canvas-organization') === itemId(item))
          if (!node || node.getAttribute('data-canvas-folder-member') !== null || node.style.display === 'none') continue
          const box = node.getBoundingClientRect(), position = horizontal ? event.clientX : event.clientY, start = horizontal ? box.left : box.top, size = horizontal ? box.width : box.height
          if (position > start + size) continue
          const fraction = (position - start) / size
          target = { side, index: index + (fraction > .7 ? 1 : 0) }
          if (item.type === 'folder' && !id.startsWith('folder:') && !id.startsWith('divider:') && fraction >= .3 && fraction <= .7) target = { side, index: -1, folder: item.id }
          highlighted = node; node.classList.add(target.folder ? 'canvas-folder-drop' : fraction > .7 ? 'canvas-organization-insert-after' : 'canvas-organization-insert-before'); break
        }
      }
    }
    const up = (event: PointerEvent) => {
      const model = getModel(), dest = target
      if (started) { event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = Date.now() + 250 }
      finish()
      if (started && dest && model && isLifecycleCurrent(generation)) {
        void commitOrganization(org => {
          const sourceIndex = org[from].findIndex(item => itemId(item) === id)
          const childSource = dest.folder ? org[from].find(item => item.type === 'folder' && item.id === dest.folder) : null
          const childIndex = childSource?.type === 'folder' ? childSource.children.findIndex(ref => referenceId(ref) === id) : -1
          const index = from === dest.side && (dest.folder ? childIndex >= 0 && childIndex < dest.index : sourceIndex >= 0 && sourceIndex < dest.index) ? dest.index - 1 : dest.index
          return relocateOrganizationItem(org, id, dest.side, index, dest.folder)
        }).catch(showOrganizationError)
      }
    }
    cleanupDrag = finish
    document.addEventListener('pointermove', move, { capture: true, passive: false }); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', cancel, true); document.addEventListener('keydown', key, true)
  }
  document.addEventListener('pointerdown', down, true); document.addEventListener('click', suppressClick, true)
  return () => { cleanupDrag?.(); document.removeEventListener('pointerdown', down, true); document.removeEventListener('click', suppressClick, true) }
}
