import { getHost, getModel } from '../recon/dispatch'
import {
  itemId,
  organizationFor,
  referenceId,
  relocateOrganizationItem,
  type OrganizationItem,
} from '../core/organization'
import type { Side } from '../core/model'
import { isDragAndDropDrawerTabsEnabled } from '../settings/state'
import { getMainMirrorTabList } from '../sidebar/main-mirror-drawer'
import { getSecondaryTabList } from '../sidebar/secondary'
import { appendSecondaryTabNode, getSecondaryStartDock } from './secondary-start-dock'
import {
  axisCoordinate,
  axisMidpoint,
  containerAxis,
  dragHitGeometry,
  flipDelta,
  injectDndStyles,
  seamChoice,
  type DndAxis,
} from './tab-list-dnd'
import { commitOrganization, showOrganizationError } from './organization-actions'
import { currentLifecycleGeneration, isLifecycleCurrent } from '../lifecycle/instance'

type Surface = { side: Side; container: HTMLElement; parent: HTMLElement; axis: DndAxis }
type DropTarget = { side: Side; index: number; folder?: string; node?: HTMLElement; after?: boolean }
type DragSession = {
  id: string
  source: HTMLElement
  sourceItem: OrganizationItem
  from: Side
  originalParent: HTMLElement
  originalNextSibling: ChildNode | null
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  width: number
  height: number
  overlay: HTMLElement | null
  overlayX: number
  overlayY: number
  started: boolean
  target: DropTarget | null
  targetKey: string | null
  targetNode: HTMLElement | null
  frame: number | null
  armTimer: ReturnType<typeof setTimeout> | null
  touchReady: boolean
  generation: number
  cancel: boolean
  move: (event: PointerEvent) => void
  up: (event: PointerEvent) => void
  pointerCancel: () => void
  key: (event: KeyboardEvent) => void
  contextMenu: (event: Event) => void
}

const ACTIVATION_DISTANCE_PX = 6
const LONG_PRESS_MS = 200
const SETTLE_DURATION_MS = 140
const SETTLE_MIN_DISTANCE_PX = 2

let activeDrag: DragSession | null = null
let suppressClickUntil = 0
let flipToken = 0
const flipTokens = new WeakMap<HTMLElement, number>()

/** The folder strip shares Canvas 2.0's live tab drag visuals and gestures. */
export function isOrganizationDragActive(): boolean {
  return activeDrag !== null
}

function mainSurface(): HTMLElement | null {
  const list = getMainMirrorTabList()
  return list?.querySelector<HTMLElement>('.sidebar-ux-tab-list-main') ?? list
}

function getSurfaces(): Surface[] {
  const surfaces: Surface[] = []
  const primary = mainSurface()
  if (primary) surfaces.push({ side: 'primary', container: primary, parent: primary, axis: containerAxis(primary) })
  const secondary = getSecondaryTabList()
  if (secondary) surfaces.push({ side: 'secondary', container: secondary, parent: secondary, axis: containerAxis(secondary) })
  return surfaces
}

function visibleNodes(parent: HTMLElement): HTMLElement[] {
  return Array.from(parent.children).filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement)) return false
    if (!node.hasAttribute('data-canvas-organization') || node.hasAttribute('data-canvas-folder-member')) return false
    return node.style.display !== 'none'
  })
}

function findItemLocation(id: string, organization: ReturnType<typeof organizationFor>): { side: Side; item: OrganizationItem } | null {
  for (const side of ['primary', 'secondary'] as const) {
    for (const item of organization[side]) {
      if (itemId(item) === id) return { side, item }
      if (item.type === 'folder') {
        const child = item.children.find(ref => referenceId(ref) === id)
        if (child) return { side, item: { type: 'tab', ...child } }
      }
    }
  }
  return null
}

function resolveSource(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const candidate = target.closest<HTMLElement>('[data-canvas-organization],button[data-tab-id]')
  if (!candidate || candidate.hasAttribute('data-canvas-folder-member')) return null
  return candidate
}

function sourceId(source: HTMLElement): string | null {
  const tagged = source.getAttribute('data-canvas-organization')
  if (tagged) return tagged
  const tabId = source.getAttribute('data-tab-id')
  return tabId ? getHost()?.findKey(tabId) ?? null : null
}

function destinationItems(side: Side, sourceId: string): OrganizationItem[] {
  const model = getModel()
  return model ? organizationFor(model)[side].filter(item => itemId(item) !== sourceId) : []
}

function surfaceContainsSource(surface: Surface, source: HTMLElement): boolean {
  return surface.container.contains(source)
}

function overlayOverlaps(
  geom: ReturnType<typeof dragHitGeometry>,
  rect: DOMRect,
  axis: DndAxis,
): boolean {
  // Match Canvas 2.0's generous cross-axis hit region and narrow strip-axis
  // pad so adjacent horizontal drawers remain distinguishable.
  const padY = axis === 'x' ? 80 : 8
  const padX = axis === 'x' ? 8 : 80
  return geom.right > rect.left - padX && geom.left < rect.right + padX &&
    geom.bottom > rect.top - padY && geom.top < rect.bottom + padY
}

function chooseSurface(
  surfaces: Surface[],
  geom: ReturnType<typeof dragHitGeometry>,
): Surface | null {
  const candidates = surfaces.filter(surface => overlayOverlaps(geom, surface.container.getBoundingClientRect(), surface.axis))
  if (!candidates.length) return null
  const horizontal = candidates.filter(surface => surface.axis === 'x')
  if (horizontal.length >= 2) {
    const sorted = [...horizontal].sort((a, b) => a.container.getBoundingClientRect().left - b.container.getBoundingClientRect().left)
    const left = sorted[0]!, right = sorted[sorted.length - 1]!
    return seamChoice(geom.centerX, left.container.getBoundingClientRect(), right.container.getBoundingClientRect()) === 'left' ? left : right
  }
  return candidates.reduce((best, next) => {
    const a = best.container.getBoundingClientRect(), b = next.container.getBoundingClientRect()
    const da = Math.abs(geom.centerX - (a.left + a.width / 2))
    const db = Math.abs(geom.centerX - (b.left + b.width / 2))
    return db < da ? next : best
  })
}

function calculateTarget(drag: DragSession): DropTarget | null {
  const model = getModel()
  if (!model || !drag.overlay) return null
  const organization = organizationFor(model)
  const geom = dragHitGeometry(drag.overlayX, drag.overlayY, drag.width, drag.height)
  const surface = chooseSurface(getSurfaces(), geom)
  if (!surface) return null

  const center = axisCoordinate(geom, surface.axis)
  const nodes = visibleNodes(surface.parent).filter(node => node.getAttribute('data-canvas-organization') !== drag.id)
  const destination = destinationItems(surface.side, drag.id)
  const itemById = new Map(destination.map(item => [itemId(item), item]))

  let visibleBefore = 0
  for (const node of nodes) {
    const id = node.getAttribute('data-canvas-organization')
    if (!id) continue
    const item = itemById.get(id)
    const rect = node.getBoundingClientRect()
    const start = surface.axis === 'x' ? rect.left : rect.top
    const size = surface.axis === 'x' ? rect.width : rect.height
    const fraction = size > 0 ? (center - start) / size : 0.5

    // Dropping a tab over the middle of a folder files it there. Folders and
    // dividers remain root-level items, matching Configure Tabs behavior.
    if (item?.type === 'folder' && drag.sourceItem.type === 'tab' && fraction >= 0.3 && fraction <= 0.7) {
      const folder = organization[surface.side].find(candidate => candidate.type === 'folder' && candidate.id === item.id)
      if (folder?.type === 'folder') {
        return { side: surface.side, index: folder.children.filter(ref => referenceId(ref) !== drag.id).length, folder: folder.id, node }
      }
    }

    if (center < axisMidpoint(rect, surface.axis)) {
      const index = destination.findIndex(candidate => itemId(candidate) === id)
      return { side: surface.side, index: index >= 0 ? index : visibleBefore, node, after: false }
    }
    visibleBefore++
  }

  // Insert after the last visible item but before trailing hidden folders or
  // tabs, the same visible-order convention used by Canvas 2.0.
  const lastNode = nodes[nodes.length - 1]
  const lastVisible = lastNode?.getAttribute('data-canvas-organization')
  const lastIndex = lastVisible ? destination.findIndex(item => itemId(item) === lastVisible) : -1
  return { side: surface.side, index: lastIndex >= 0 ? lastIndex + 1 : 0, node: lastNode, after: !!lastNode }
}

function clearTargetIndicator(drag: DragSession): void {
  drag.targetNode?.classList.remove('canvas-folder-drop', 'canvas-organization-insert-before', 'canvas-organization-insert-after')
  drag.targetNode = null
}

function indicateTarget(drag: DragSession, target: DropTarget | null): void {
  clearTargetIndicator(drag)
  if (!target?.node) return
  drag.targetNode = target.node
  if (target.folder) drag.targetNode.classList.add('canvas-folder-drop')
  else drag.targetNode.classList.add(target.after ? 'canvas-organization-insert-after' : 'canvas-organization-insert-before')
}

function snapshotRects(parents: HTMLElement[]): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  for (const parent of parents) for (const node of visibleNodes(parent)) {
    const id = node.getAttribute('data-canvas-organization')
    if (id) rects.set(id, node.getBoundingClientRect())
  }
  return rects
}

function applyFLIP(previous: Map<string, DOMRect>, excludedId: string, parents: HTMLElement[]): void {
  const animated: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  for (const parent of parents) for (const node of visibleNodes(parent)) {
    if (seen.has(node)) continue
    seen.add(node)
    const id = node.getAttribute('data-canvas-organization')
    const before = id ? previous.get(id) : null
    if (!id || id === excludedId || !before) continue
    const { dx, dy } = flipDelta(before, node.getBoundingClientRect())
    if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) continue
    node.style.setProperty('transition', 'none', 'important')
    node.style.setProperty('transform', `translate(${dx}px, ${dy}px)`, 'important')
    animated.push(node)
  }
  if (!animated.length) return
  void document.body.offsetHeight
  const token = ++flipToken
  requestAnimationFrame(() => {
    for (const node of animated) {
      flipTokens.set(node, token)
      node.style.setProperty('transition', 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)', 'important')
      node.style.removeProperty('transform')
      setTimeout(() => {
        if (flipTokens.get(node) !== token) return
        node.style.removeProperty('transition')
        node.style.removeProperty('transform')
        flipTokens.delete(node)
      }, 220)
    }
  })
}

function parkSource(drag: DragSession, target: DropTarget): void {
  if (target.folder) return
  const surface = getSurfaces().find(candidate => candidate.side === target.side)
  if (!surface) return
  const nextItem = destinationItems(target.side, drag.id)[target.index]
  const nextNode = nextItem
    ? Array.from(surface.parent.children).find((node): node is HTMLElement =>
        node instanceof HTMLElement && node !== drag.source && node.getAttribute('data-canvas-organization') === itemId(nextItem),
      )
    : null
  if (nextNode) {
    if (drag.source.parentElement !== surface.parent || drag.source.nextElementSibling !== nextNode) surface.parent.insertBefore(drag.source, nextNode)
    return
  }
  const dock = target.side === 'secondary' ? getSecondaryStartDock(surface.parent) : null
  if (dock) {
    if (drag.source.parentElement !== surface.parent || drag.source.nextElementSibling !== dock) surface.parent.insertBefore(drag.source, dock)
  } else if (drag.source.parentElement !== surface.parent || drag.source.nextElementSibling !== null) {
    if (target.side === 'secondary') appendSecondaryTabNode(surface.parent, drag.source)
    else surface.parent.appendChild(drag.source)
  }
}

function setDropTarget(drag: DragSession, target: DropTarget): void {
  const key = `${target.side}|${target.folder ?? ''}|${target.index}`
  if (drag.targetKey === key) {
    drag.target = target
    indicateTarget(drag, target)
    return
  }
  drag.targetKey = key
  drag.target = target
  indicateTarget(drag, target)
  if (target.folder) {
    const sourceSurface = getSurfaces().find(surface => surface.container.contains(drag.source))
    if (sourceSurface && drag.source.parentElement !== drag.originalParent) {
      const previous = snapshotRects([sourceSurface.parent, drag.originalParent])
      restoreSource(drag)
      applyFLIP(previous, drag.id, [sourceSurface.parent, drag.originalParent])
    }
    return
  }

  const surfaces = getSurfaces()
  const sourceSurface = surfaces.find(surface => surface.container.contains(drag.source))
  const destinationSurface = surfaces.find(surface => surface.side === target.side)
  if (!destinationSurface) return
  const parents = [sourceSurface?.parent, destinationSurface.parent].filter((value, index, all): value is HTMLElement => !!value && all.indexOf(value) === index)
  const previous = snapshotRects(parents)
  parkSource(drag, target)
  applyFLIP(previous, drag.id, parents)
}

function moveOverlay(drag: DragSession, x: number, y: number): void {
  drag.overlayX = x - drag.offsetX
  drag.overlayY = y - drag.offsetY
  if (drag.overlay) drag.overlay.style.transform = `translate3d(${drag.overlayX}px, ${drag.overlayY}px, 0)`
}

function processFrame(drag: DragSession): void {
  drag.frame = null
  if (activeDrag !== drag || !drag.started || !isLifecycleCurrent(drag.generation)) return
  const target = calculateTarget(drag)
  // Like Canvas 2.0's live tab strip, retain the last valid target briefly
  // when the floating tab crosses a narrow seam between drop surfaces.
  if (target) setDropTarget(drag, target)
}

function scheduleFrame(drag: DragSession): void {
  if (drag.frame !== null) return
  drag.frame = requestAnimationFrame(() => processFrame(drag))
}

function createOverlay(source: HTMLElement): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'canvas-tab-list-dnd-overlay-clone'
  const clone = source.cloneNode(true) as HTMLElement
  clone.classList.remove('canvas-tab-list-dnd-placeholder')
  if (clone.tagName === 'BUTTON') clone.classList.add('canvas-tab-list-dnd-overlay-clone-btn')
  const rect = source.getBoundingClientRect()
  wrapper.style.width = `${rect.width}px`
  wrapper.style.height = `${rect.height}px`
  wrapper.style.left = '0px'
  wrapper.style.top = '0px'
  wrapper.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`
  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)
  return wrapper
}

function removeListeners(drag: DragSession): void {
  document.removeEventListener('pointermove', drag.move, true)
  document.removeEventListener('pointerup', drag.up, true)
  document.removeEventListener('pointercancel', drag.pointerCancel, true)
  document.removeEventListener('keydown', drag.key, true)
  document.removeEventListener('contextmenu', drag.contextMenu, true)
  if (drag.armTimer !== null) clearTimeout(drag.armTimer)
  if (drag.frame !== null) cancelAnimationFrame(drag.frame)
  drag.frame = null
}

function restoreSource(drag: DragSession): void {
  const { source, originalParent, originalNextSibling } = drag
  if (source.parentNode === originalParent) {
    if (originalNextSibling && source.nextSibling !== originalNextSibling) originalParent.insertBefore(source, originalNextSibling)
    else if (!originalNextSibling && source.nextSibling) originalParent.appendChild(source)
  } else if (originalNextSibling?.parentNode === originalParent) originalParent.insertBefore(source, originalNextSibling)
  else originalParent.appendChild(source)
}

function cleanupVisuals(drag: DragSession, restore: boolean): void {
  removeListeners(drag)
  if (restore) restoreSource(drag)
  drag.overlay?.remove()
  drag.source.classList.remove('canvas-tab-list-dnd-placeholder')
  clearTargetIndicator(drag)
  document.body.classList.remove('canvas-tab-list-dnd-dragging')
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

function settleOverlay(drag: DragSession, target: DropTarget): Promise<void> {
  if (!drag.overlay) return Promise.resolve()
  const targetNode = target.folder
    ? getSurfaces().find(surface => surface.side === target.side)?.parent.querySelector<HTMLElement>(`[data-canvas-organization="folder:${CSS.escape(target.folder)}"]`)
    : drag.source
  const rect = targetNode?.getBoundingClientRect()
  if (!rect) return Promise.resolve()
  const dx = rect.left - drag.overlayX, dy = rect.top - drag.overlayY
  if (Math.hypot(dx, dy) < SETTLE_MIN_DISTANCE_PX) return Promise.resolve()
  return new Promise(resolve => {
    const overlay = drag.overlay!
    let done = false
    const finish = () => {
      if (done) return
      done = true
      overlay.removeEventListener('transitionend', onEnd)
      clearTimeout(timer)
      resolve()
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === overlay && (!event.propertyName || event.propertyName === 'transform')) finish()
    }
    overlay.addEventListener('transitionend', onEnd)
    overlay.classList.add('canvas-tab-list-dnd-overlay-settling')
    void overlay.offsetWidth
    overlay.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`
    const timer = setTimeout(finish, SETTLE_DURATION_MS + 40)
  })
}

function finishSession(drag: DragSession, restore: boolean): void {
  cleanupVisuals(drag, restore)
  if (activeDrag === drag) activeDrag = null
}

function startVisualDrag(drag: DragSession, event: PointerEvent): void {
  if (drag.started || !isDragAndDropDrawerTabsEnabled() || !isLifecycleCurrent(drag.generation)) return
  drag.started = true
  const rect = drag.source.getBoundingClientRect()
  drag.offsetX = event.clientX - rect.left
  drag.offsetY = event.clientY - rect.top
  drag.width = rect.width
  drag.height = rect.height
  drag.source.classList.add('canvas-tab-list-dnd-placeholder')
  drag.overlay = createOverlay(drag.source)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'grabbing'
  document.body.classList.add('canvas-tab-list-dnd-dragging')
  moveOverlay(drag, event.clientX, event.clientY)
  scheduleFrame(drag)
}

function noOpDrop(drag: DragSession, target: DropTarget): boolean {
  const model = getModel()
  if (!model) return true
  const organization = organizationFor(model)
  const sourceIndex = organization[drag.from].findIndex(item => itemId(item) === drag.id)
  const parent = organization[drag.from].find(item => item.type === 'folder' && item.children.some(ref => referenceId(ref) === drag.id))
  const parentId = parent?.type === 'folder' ? parent.id : undefined
  const childIndex = parent?.type === 'folder' ? parent.children.findIndex(ref => referenceId(ref) === drag.id) : -1
  return drag.from === target.side && parentId === target.folder && (parentId ? childIndex === target.index : sourceIndex === target.index)
}

function makeSession(source: HTMLElement, id: string, item: OrganizationItem, from: Side, event: PointerEvent): DragSession {
  const session = {} as DragSession
  Object.assign(session, {
    id, source, sourceItem: item, from,
    originalParent: source.parentElement!,
    originalNextSibling: source.nextSibling,
    startX: event.clientX, startY: event.clientY,
    offsetX: 0, offsetY: 0, width: 0, height: 0,
    overlay: null, overlayX: 0, overlayY: 0,
    started: false, target: null, targetKey: null, targetNode: null,
    frame: null, armTimer: null,
    touchReady: event.pointerType !== 'touch' && event.pointerType !== 'pen',
    generation: currentLifecycleGeneration(), cancel: false,
  })

  session.contextMenu = (ev: Event) => { ev.preventDefault(); ev.stopPropagation() }
  session.key = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.preventDefault(); ev.stopImmediatePropagation()
    session.cancel = true
    finishSession(session, true)
  }
  session.pointerCancel = () => {
    session.cancel = true
    finishSession(session, true)
  }
  session.move = (ev: PointerEvent) => {
    if (activeDrag !== session || !isLifecycleCurrent(session.generation)) {
      session.cancel = true
      finishSession(session, true)
      return
    }
    const distance = Math.hypot(ev.clientX - session.startX, ev.clientY - session.startY)
    if (!session.started && !session.touchReady) {
      if (distance > ACTIVATION_DISTANCE_PX) finishSession(session, true)
      return
    }
    if (!session.started) {
      if (distance < ACTIVATION_DISTANCE_PX) return
      startVisualDrag(session, ev)
    }
    if (!session.started) return
    ev.preventDefault()
    ev.stopImmediatePropagation()
    moveOverlay(session, ev.clientX, ev.clientY)
    scheduleFrame(session)
  }
  session.up = event_ => {
    removeListeners(session)
    if (!session.started || session.cancel || !isLifecycleCurrent(session.generation)) {
      finishSession(session, true)
      return
    }
    event_.preventDefault()
    event_.stopImmediatePropagation()
    suppressClickUntil = Date.now() + 250
    moveOverlay(session, event_.clientX, event_.clientY)
    const finalTarget = calculateTarget(session)
    if (finalTarget) setDropTarget(session, finalTarget)
    const target = session.target
    if (!target || noOpDrop(session, target)) {
      void settleOverlay(session, target ?? { side: session.from, index: 0 }).finally(() => finishSession(session, true))
      return
    }
    const settle = settleOverlay(session, target)
    void settle.then(async () => {
      if (activeDrag !== session || !isLifecycleCurrent(session.generation)) return
      try {
        await commitOrganization(organization => relocateOrganizationItem(organization, session.id, target.side, target.index, target.folder))
      } catch (error) {
        showOrganizationError(error)
        restoreSource(session)
      } finally {
        if (activeDrag === session) {
          cleanupVisuals(session, false)
          activeDrag = null
          // Commit notifications can coalesce with the temporary DOM moves;
          // explicitly reconcile once the organization transaction completes.
          void import('./folder-ui').then(module => module.renderFolders())
        }
      }
    })
  }
  return session
}

function suppressSyntheticClick(event: MouseEvent): void {
  if (Date.now() >= suppressClickUntil) return
  event.preventDefault()
  event.stopImmediatePropagation()
}

/** Pointer DnD for the live organization strip, using Canvas 2.0's drag lifecycle. */
export function installOrganizationDrag(): () => void {
  injectDndStyles()
  const down = (event: PointerEvent) => {
    if (!getModel()?.organization || !isDragAndDropDrawerTabsEnabled() || event.button !== 0 || activeDrag) return
    const source = resolveSource(event.target)
    if (!source) return
    const surfaces = getSurfaces()
    const surface = surfaces.find(candidate => surfaceContainsSource(candidate, source))
    if (!surface) return
    const model = getModel()
    const id = sourceId(source)
    if (!model || !id) return
    const location = findItemLocation(id, organizationFor(model))
    if (!location || location.side !== surface.side) return
    const session = makeSession(source, id, location.item, surface.side, event)
    activeDrag = session
    if (!session.touchReady) {
      session.armTimer = setTimeout(() => {
        session.armTimer = null
        if (activeDrag !== session || session.cancel) return
        session.touchReady = true
        startVisualDrag(session, event)
      }, LONG_PRESS_MS)
    }
    document.addEventListener('pointermove', session.move, { capture: true, passive: false })
    document.addEventListener('pointerup', session.up, true)
    document.addEventListener('pointercancel', session.pointerCancel, true)
    document.addEventListener('keydown', session.key, true)
    document.addEventListener('contextmenu', session.contextMenu, true)
  }
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('click', suppressSyntheticClick, true)
  return () => {
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('click', suppressSyntheticClick, true)
    if (activeDrag) finishSession(activeDrag, true)
  }
}
