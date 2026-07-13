// Drag-and-drop tab reorder on live drawer tabs.
//
// Long-press (~300ms) on any tab button lifts it into a floating overlay
// clone. While dragging, hit-test finds the drop target (within or across
// drawers). On pointerup, builds a ConfigureDraft from current state,
// applies the reorder/move, and commits via the configure pipeline
// (commitConfigureDraft) — same backend as the Configure Tabs modal.
//
// Surfaces:
//   - Secondary:  button[data-tab-id] in .sidebar-ux-tab-list
//   - Main-mirror: .sidebar-ux-main-tab-mirror-btn[data-tab-id]
//   - Host main:  button[data-tab-id] in host Sidebar
//
// Style: overlay clone matches .canvas-configure-tabs-overlay-clone (same
// border + primary ring + background treatment).

import {
  createDraft,
  moveTab,
  reorderWithin,
  type ConfigureDraft,
  type BaseSnapshot,
  type DrawerSide,
} from './configure-model'
import { commitConfigureDraft } from './configure-commit'
import { getFullCatalog, type CatalogTab } from './configure-catalog'
import { getHostDrawerSettings } from '../dom/host-settings'
import { getTabAssignments } from './assignment'
import { getMainDrawerSide } from '../store'
import { getSecondaryWrapper, getSecondaryTabList } from '../sidebar/secondary'
import { dwarn } from '../debug/log'

// ── Module-level drag state ──

let _isDragging = false
let _dragTabId: string | null = null
/** The source button element (dimmed during drag). */
let _dragElement: HTMLElement | null = null
/** Whether the source is from the secondary drawer. */
let _dragFromSecondary = false
/** Floating clone that follows the pointer. */
let _dragOverlay: HTMLElement | null = null
let _dragOffsetX = 0
let _dragOffsetY = 0
let _lastDropTarget: { container: HTMLElement; index: number; secondary: boolean } | null = null
/** Insert indicator element (insert-before-highlight). */
let _insertIndicatorEl: HTMLElement | null = null

let _moveHandler: ((e: PointerEvent) => void) | null = null
let _upHandler: ((e: PointerEvent) => void) | null = null

/** Capture-phase click suppressor — installed during drag, removed on next task. */
let _clickSuppressor: ((e: Event) => void) | null = null
let _clickSuppressorTimer: ReturnType<typeof setTimeout> | null = null

// ── Long-press state per button ──

/** Buttons that already have long-press handlers installed. */
const _installed = new WeakSet<HTMLElement>()

// ── Style injection ──

const DND_STYLE_ID = 'canvas-tab-list-dnd-styles'

function injectDndStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(DND_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = DND_STYLE_ID
  style.textContent = `
    /* Floating overlay clone — matches configure-modal overlay-clone treatment */
    .canvas-tab-list-dnd-overlay-clone {
      position: fixed;
      z-index: 13000;
      pointer-events: none;
      margin: 0;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 10px;
      background: color-mix(in srgb, var(--lumiverse-primary, #4a9eff) 8%, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)));
      box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.45),
        0 0 0 1px var(--lumiverse-primary-040, var(--lumiverse-primary, #4a9eff));
      color: var(--lumiverse-text, #eee);
      font-family: var(--lumiverse-font-family, sans-serif);
      opacity: 1;
      will-change: left, top;
      cursor: grabbing;
    }

    /* Source button while being dragged — same dim as .row-dragging */
    .canvas-tab-list-dnd-placeholder {
      opacity: 0.35 !important;
    }

    /* Drop-insert indicator: a subtle primary underline at the top of the
       target button where the tab will be inserted. */
    .canvas-tab-list-dnd-insert-before {
      box-shadow: inset 0 2px 0 0 var(--lumiverse-primary, #4a9eff) !important;
    }
  `
  document.head.appendChild(style)
}

// ── Surface helpers ──

/** True when the button lives in the secondary drawer's tab list. */
function isSecondaryButton(btn: HTMLElement): boolean {
  return !!btn.closest('.sidebar-ux-tab-list')
}

/** Get the tab id from any surface button (data-tab-id on all surfaces). */
function getButtonTabId(btn: HTMLElement): string | null {
  return btn.getAttribute('data-tab-id')
}

/**
 * Collect all potential drop containers and their side.
 * A container is a parent element that holds tab buttons.
 * Returns an empty array when no valid containers exist (e.g. second drawer
 * disabled and no primary container available).
 */
function getDropContainers(): { el: HTMLElement; secondary: boolean }[] {
  const containers: { el: HTMLElement; secondary: boolean }[] = []

  // 1. Secondary tab list (only when second drawer is mounted)
  if (getSecondaryWrapper()) {
    const secList = getSecondaryTabList()
    if (secList) containers.push({ el: secList, secondary: true })
  }

  // 2. Main-mirror tab list (Canvas-owned primary strip when taskbar mode on)
  const mirrorList = document.querySelector(
    '.sidebar-ux-main-tab-list-mirror',
  ) as HTMLElement | null
  if (mirrorList) {
    containers.push({ el: mirrorList, secondary: false })
  }

  // 3. Host sidebar fallback (no main-mirror, e.g. taskbar mode off)
  if (!mirrorList) {
    const hostSidebar = document.querySelector(
      '[class*="sidebarLeft" i], [class*="sidebarRight" i]',
    ) as HTMLElement | null
    // Only use the main (tab-button) section — skip the Settings bottom area
    const tabListWrap = hostSidebar?.querySelector(
      ':scope > [class*="tabListWrap"], :scope > div > [class*="tabListWrap"]',
    ) as HTMLElement | null
    // Fall back to the sidebar itself if we can't find a specific sub-container
    if (tabListWrap) {
      containers.push({ el: tabListWrap, secondary: false })
    } else if (hostSidebar) {
      containers.push({ el: hostSidebar, secondary: false })
    }
  }

  return containers
}

/**
 * Collect tab buttons from a drop container for hit-test math.
 * Filters out the dragged tab (excludeTabId) if present.
 */
function getButtonsInContainer(
  container: HTMLElement,
  secondary: boolean,
  excludeTabId: string | null,
): HTMLElement[] {
  let buttons: HTMLElement[]

  if (secondary) {
    // Secondary: direct child button[data-tab-id]
    buttons = Array.from(
      container.querySelectorAll(':scope > button[data-tab-id]'),
    )
  } else if (container.classList.contains('sidebar-ux-main-tab-list-mirror')) {
    // Main-mirror: mirror button class
    buttons = Array.from(
      container.querySelectorAll(':scope > button.sidebar-ux-main-tab-mirror-btn'),
    )
  } else {
    // Host sidebar: look for button[data-tab-id] (tagged by tagMainSidebarButtons)
    buttons = Array.from(
      container.querySelectorAll(':scope button[data-tab-id]'),
    )
  }

  if (!excludeTabId) return buttons

  return buttons.filter(
    (el) => el.getAttribute('data-tab-id') !== excludeTabId,
  )
}

// ── Build ConfigureDraft from live state ──

function buildDraftAndBase(): {
  draft: ConfigureDraft
  base: BaseSnapshot
  catalog: CatalogTab[]
} {
  const catalog = getFullCatalog()
  const hostSettings = getHostDrawerSettings()
  const currentAssignments = new Map(getTabAssignments())
  const drawerSide =
    (hostSettings?.side as DrawerSide) || getMainDrawerSide()

  const draft = createDraft({
    catalog,
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: hostSettings?.hiddenTabIds || [],
    drawerSide,
    assignments: currentAssignments,
  })

  const base: BaseSnapshot = {
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: hostSettings?.hiddenTabIds || [],
    drawerSide,
    assignments: new Map(currentAssignments),
  }

  return { draft, base, catalog }
}

// ── Hit-test ──

/**
 * Find the drop target under the pointer.
 *
 * Returns the container element, insertion index (the index BEFORE which the
 * dragged tab would be inserted, in the post-removal button layout), and
 * whether the target is the secondary drawer.
 *
 * Same convention as configure-modal hitTestDropTarget: the dragged row is
 * excluded from midpoint math, so the returned index is the post-removal
 * insert position that can be passed directly to reorderWithin / moveTab.
 */
function hitTestDropTarget(
  x: number,
  y: number,
): { container: HTMLElement; index: number; secondary: boolean } | null {
  const containers = getDropContainers()

  for (const { el: container, secondary } of containers) {
    const rect = container.getBoundingClientRect()
    // Expand vertical hit zone so empty/near-edge drops still work
    if (x < rect.left || x > rect.right) continue
    if (y < rect.top - 8 || y > rect.bottom + 8) continue

    const buttons = getButtonsInContainer(
      container,
      secondary,
      _dragTabId,
    )

    if (buttons.length === 0) {
      return { container, index: 0, secondary }
    }

    for (let i = 0; i < buttons.length; i++) {
      const btnRect = buttons[i].getBoundingClientRect()
      const mid = btnRect.top + btnRect.height / 2
      if (y < mid) return { container, index: i, secondary }
    }
    // After the last button
    return { container, index: buttons.length, secondary }
  }

  return null
}

// ── Insert indicator management ──

function clearInsertIndicator(): void {
  if (_insertIndicatorEl) {
    _insertIndicatorEl.classList.remove(
      'canvas-tab-list-dnd-insert-before',
    )
    _insertIndicatorEl = null
  }
}

function setInsertIndicator(
  target: {
    container: HTMLElement
    index: number
    secondary: boolean
  },
): void {
  clearInsertIndicator()

  const buttons = getButtonsInContainer(
    target.container,
    target.secondary,
    _dragTabId,
  )

  if (buttons.length === 0 || target.index >= buttons.length) {
    // Dropping after the last button — no good element to highlight.
    // Leave no indicator (insert-after-last is self-evident).
    return
  }

  const targetBtn = buttons[target.index]
  targetBtn.classList.add('canvas-tab-list-dnd-insert-before')
  _insertIndicatorEl = targetBtn
}

// ── Drag implementation ──

function createDragOverlay(sourceBtn: HTMLElement): HTMLElement {
  const overlay = sourceBtn.cloneNode(true) as HTMLElement
  overlay.className = 'canvas-tab-list-dnd-overlay-clone'
  const rect = sourceBtn.getBoundingClientRect()
  overlay.style.width = rect.width + 'px'
  overlay.style.height = rect.height + 'px'
  overlay.style.left = rect.left + 'px'
  overlay.style.top = rect.top + 'px'
  document.body.appendChild(overlay)
  return overlay
}

function installClickSuppressor(el: HTMLElement): void {
  const handler = (e: Event) => {
    e.stopImmediatePropagation()
  }
  el.addEventListener('click', handler, true)
  _clickSuppressor = handler
  // Deferred removal after synthetic click has passed (same pattern as
  // drawerTabPosition/drag.ts).
  if (_clickSuppressorTimer !== null) clearTimeout(_clickSuppressorTimer)
  _clickSuppressorTimer = setTimeout(() => {
    if (_clickSuppressor && _dragElement) {
      _dragElement.removeEventListener('click', _clickSuppressor, true)
    }
    _clickSuppressor = null
    _clickSuppressorTimer = null
  }, 0)
}

function removeClickSuppressorNow(): void {
  if (_clickSuppressorTimer !== null) {
    clearTimeout(_clickSuppressorTimer)
    _clickSuppressorTimer = null
  }
  if (_clickSuppressor && _dragElement) {
    _dragElement.removeEventListener('click', _clickSuppressor, true)
  }
  _clickSuppressor = null
}

function startDrag(btn: HTMLElement, pointerEvent: PointerEvent): void {
  const tabId = getButtonTabId(btn)
  if (!tabId) return

  // Determine source side
  _dragFromSecondary = isSecondaryButton(btn)
  _dragTabId = tabId
  _dragElement = btn
  _isDragging = true

  // Calculate overlay offset from pointer
  const rect = btn.getBoundingClientRect()
  _dragOffsetX = pointerEvent.clientX - rect.left
  _dragOffsetY = pointerEvent.clientY - rect.top

  // Dim the source
  btn.classList.add('canvas-tab-list-dnd-placeholder')

  // Create overlay
  _dragOverlay = createDragOverlay(btn)

  // Prevent text selection globally
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'grabbing'

  // Suppress context menu during drag (capture-phase preventDefault)
  // so host long-press contextmenu does not fire while dragging.
  const suppressCtx = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  document.addEventListener('contextmenu', suppressCtx, true)

  // Suppress click on the dragged button after drag ends, so the
  // browser's compatibility click (from pointerup) does not activate
  // the tab. Installed immediately so it catches any synthesised click
  // in the same task as pointerup.
  installClickSuppressor(btn)

  // Pointer move
  const onMove = (ev: PointerEvent) => {
    if (!_dragOverlay) return

    _dragOverlay.style.left = `${ev.clientX - _dragOffsetX}px`
    _dragOverlay.style.top = `${ev.clientY - _dragOffsetY}px`

    // Hit-test for drop target
    const target = hitTestDropTarget(ev.clientX, ev.clientY)
    if (!target) {
      clearInsertIndicator()
      _lastDropTarget = null
      return
    }

    const prev = _lastDropTarget
    if (
      prev &&
      prev.container === target.container &&
      prev.index === target.index &&
      prev.secondary === target.secondary
    ) {
      return // No change — avoid thrashing indicator
    }
    _lastDropTarget = target
    setInsertIndicator(target)
  }

  // Pointer up / cancel
  // Capture all data into locals BEFORE any cleanup / await, so we
  // never rely on module fields that clearDragState zeroes.
  const onUp = async (_ev: PointerEvent) => {
    const capturedTabId = _dragTabId
    const capturedFromSecondary = _dragFromSecondary
    const capturedTarget = _lastDropTarget

    document.removeEventListener('contextmenu', suppressCtx, true)
    clearDragState()

    if (capturedTarget && capturedTabId) {
      await performDrop(capturedTabId, capturedFromSecondary, capturedTarget)
    }

    cleanupDragVisuals()
  }

  _moveHandler = onMove
  _upHandler = onUp

  document.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerup', onUp)
  document.addEventListener('pointercancel', onUp)
}

function clearDragState(): void {
  if (_moveHandler) {
    document.removeEventListener('pointermove', _moveHandler)
    _moveHandler = null
  }
  if (_upHandler) {
    document.removeEventListener('pointerup', _upHandler)
    document.removeEventListener('pointercancel', _upHandler)
    _upHandler = null
  }
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

function cleanupDragVisuals(): void {
  // Remove overlay
  if (_dragOverlay) {
    _dragOverlay.remove()
    _dragOverlay = null
  }

  // Remove placeholder from source
  if (_dragElement) {
    _dragElement.classList.remove('canvas-tab-list-dnd-placeholder')
  }

  // Clear insert indicator
  clearInsertIndicator()

  _isDragging = false
  _dragTabId = null
  _dragElement = null
  _dragFromSecondary = false
  _lastDropTarget = null
}

/**
 * Build a draft from live state, apply the user's drop action, and commit.
 *
 * Same-side reorder: passes target.index directly to reorderWithin.
 * The hit-test index is a post-removal insert position (same convention as
 * configure-modal's hitTestDropTarget), and reorderWithin also expects a
 * post-removal toIndex — it first splices the source out, then inserts at
 * toIndex. No ±1 adjustment needed. (See configure-modal performDragMove.)
 *
 * Cross-drawer move: passes target.index to moveTab, which also expects
 * the insert index in the target list (the source is not in the target list
 * so there is no removal).
 */
async function performDrop(
  tabId: string,
  fromSecondary: boolean,
  target: {
    container: HTMLElement
    index: number
    secondary: boolean
  },
): Promise<void> {
  try {
    const { draft, base } = buildDraftAndBase()

    if (fromSecondary !== target.secondary) {
      // ── Cross-drawer move ──
      const targetSide = target.secondary ? 'secondary' : 'primary'
      const updated = moveTab(draft, tabId, targetSide, target.index)
      const result = await commitConfigureDraft(updated, base)
      if (!result.ok) {
        dwarn(
          '[tab-list-dnd] cross-drawer commit failed:',
          result.error,
        )
      }
    } else {
      // ── Within-drawer reorder ──
      // Pass the post-removal hit-test index directly to reorderWithin
      // (same convention as configure-modal performDragMove).
      const isSecondaryList = target.secondary
      const fullList = isSecondaryList
        ? draft.secondaryIds
        : draft.primaryIds
      const fromIndex = fullList.indexOf(tabId)
      if (fromIndex === -1) {
        dwarn(
          '[tab-list-dnd] tab not found in draft for reorder:',
          tabId,
        )
        return
      }

      // reorderWithin expects a spatial DrawerSide ('left' | 'right').
      // The secondary list is on the side opposite the main drawer.
      let spatialSide: DrawerSide
      if (isSecondaryList) {
        spatialSide =
          draft.drawerSide === 'right' ? 'left' : 'right'
      } else {
        spatialSide = draft.drawerSide
      }

      // toIndex is the post-removal insert index (same as hit-test).
      // reorderWithin first splices out the source, then inserts at toIndex
      // in the already-spliced list — matching our hit-test convention.
      const updated = reorderWithin(
        draft,
        spatialSide,
        fromIndex,
        target.index,
      )
      const result = await commitConfigureDraft(updated, base)
      if (!result.ok) {
        dwarn(
          '[tab-list-dnd] reorder commit failed:',
          result.error,
        )
      }
    }
  } catch (err) {
    dwarn('[tab-list-dnd] drop failed:', err)
  }
}

// ── Long-press installation ──

function installLongPressOnButton(btn: HTMLElement): void {
  if (_installed.has(btn)) return

  // Skip buttons without a tab id
  const tabId = getButtonTabId(btn)
  if (!tabId) return

  _installed.add(btn)

  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressActivated = false
  let moveCancelled = false

  /** Cleanup listeners registered during pointerdown. */
  let pendingPointerMove: ((e: PointerEvent) => void) | null = null
  let pendingPointerUp: (() => void) | null = null
  let pendingPointerCancel: (() => void) | null = null

  const cleanupPendingListeners = () => {
    if (pendingPointerMove) {
      document.removeEventListener('pointermove', pendingPointerMove)
      pendingPointerMove = null
    }
    if (pendingPointerUp) {
      document.removeEventListener('pointerup', pendingPointerUp)
      pendingPointerUp = null
    }
    if (pendingPointerCancel) {
      document.removeEventListener('pointercancel', pendingPointerCancel)
      pendingPointerCancel = null
    }
  }

  const cancelTimer = () => {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    cleanupPendingListeners()
  }

  const onPointerDown = (e: PointerEvent) => {
    // Only respond to left button
    if (e.button !== 0) return
    // Do not activate if already dragging
    if (_isDragging) return

    longPressActivated = false
    moveCancelled = false

    const startX = e.clientX
    const startY = e.clientY

    // Start long-press timer (~300ms)
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      cleanupPendingListeners()
      if (moveCancelled) return
      longPressActivated = true

      // Activate drag
      startDrag(btn, e)
    }, 300)

    // Document-level move listener — stays until timer fires, pointerup,
    // or cancel threshold is crossed. Using document-level ensures that
    // moving the pointer off the button still cancels the long-press.
    const onMove = (ev: PointerEvent) => {
      if (longPressActivated) return // Drag mode handles move itself
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        moveCancelled = true
        cancelTimer()
      }
    }

    // Cancel on up / cancel (click or touch end)
    const onUp = () => {
      cancelTimer()
    }

    pendingPointerMove = onMove
    pendingPointerUp = onUp
    pendingPointerCancel = onUp

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  btn.addEventListener('pointerdown', onPointerDown)
}

// ── Module-level active guard ──

let _active = false

// ── MutationObserver-based installer ──

let _observer: MutationObserver | null = null

/**
 * Install tab-list DnD on all current and future tab buttons.
 *
 * Watches document.body for new buttons. Idempotent (uses WeakSet).
 * Safe to call multiple times (no-ops when already installed).
 * Returns a teardown function.
 */
export function installTabListDnd(): () => void {
  if (_active) return () => {}
  _active = true

  injectDndStyles()

  // Install on existing buttons
  const existing = document.querySelectorAll<HTMLElement>(
    'button[data-tab-id], .sidebar-ux-main-tab-mirror-btn',
  )
  for (const btn of existing) {
    installLongPressOnButton(btn)
  }

  // Watch for new buttons
  _observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        // Check the added node itself
        if (
          node.tagName === 'BUTTON' &&
          (node.hasAttribute('data-tab-id') ||
            node.classList.contains(
              'sidebar-ux-main-tab-mirror-btn',
            ))
        ) {
          installLongPressOnButton(node)
        }
        // Check descendants
        const descendants = node.querySelectorAll<HTMLElement>(
          'button[data-tab-id], .sidebar-ux-main-tab-mirror-btn',
        )
        for (const child of descendants) {
          installLongPressOnButton(child)
        }
      }
    }
  })

  _observer.observe(document.body, { childList: true, subtree: true })

  return () => {
    tearDownTabListDnd()
  }
}

/**
 * Tear down tab-list DnD (disconnect observer, clear state).
 */
export function tearDownTabListDnd(): void {
  _active = false
  if (_observer) {
    _observer.disconnect()
    _observer = null
  }
  if (_isDragging) {
    removeClickSuppressorNow()
    cleanupDragVisuals()
    clearDragState()
  }
}
