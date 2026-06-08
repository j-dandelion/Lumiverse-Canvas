// Drag-to-resize handles for both the main and secondary drawers.
//
// Each handle is an 8-px-wide column on the drawer's inner edge that
// captures pointerdown/pointermove/pointerup. The drag direction encodes
// which way the drawer should grow (rightward drag expands a left-edge
// drawer, leftward drag expands a right-edge drawer).
//
// Both handles' setup is gated on CanvasSettings.resizeSidebars via
// refreshResizeHandles, which is also the live-update path: turning the
// setting off removes the handles; turning it on mounts them.
//
// Side-aware positioning is computed in JS because the drawer's CSS
// makes the handle a child of the drawer (not the wrapper), so a fixed
// offset from the inner edge is stable regardless of width or sibling
// presence. The 4px overhang is intentional — see comment in
// mountResizeHandles' secondary block.
import { getMainDrawer, getMainWrapper, getMainDrawerWidth } from '../dom/lumiverse'
import { clampSidebarWidth } from '../dom/clamp'
import { getMainDrawerSide, isMainDrawerOpen } from '../store'
import { scheduleReflow } from '../chat/reflow'
import { getSecondaryWrapper, isSecondarySidebarOpen, SECONDARY_WIDTH_VAR } from '../sidebar/secondary'
import { repositionAssignedTabs } from '../tabs/assignment'
import { persistLayout } from '../layout/persist'
import { getSettings } from '../settings/state'

export function isPointerResizeActive(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

let _resizeDragging = false

export function createResizeHandle(
  direction: 'left' | 'right',
  onResize: (startWidth: number, deltaPx: number) => void,
  onResizeEnd: () => void,
  enabled?: () => boolean
): HTMLElement {
  const handle = document.createElement('div')
  handle.className = 'sidebar-ux-resize-handle'
  handle.style.cssText = `
    position: absolute;
    top: 0; bottom: 0;
    width: 8px;
    cursor: col-resize;
    z-index: 99999;
    touch-action: none;
    background: transparent;
    transition: background 0.15s ease;
  `
  // Hover feedback
  handle.addEventListener('mouseenter', () => {
    handle.style.background = 'var(--lumiverse-primary-015, rgba(255, 255, 255, 0.06))'
  })
  handle.addEventListener('mouseleave', () => {
    if (!_resizeDragging) handle.style.background = 'transparent'
  })

  let startX = 0
  let startWidth = 0

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (enabled && !enabled()) return
    e.preventDefault()
    e.stopPropagation()
    startX = e.clientX
    startWidth = handle.parentElement?.getBoundingClientRect().width || 420
    _resizeDragging = true
    handle.style.background = 'var(--lumiverse-primary-020, rgba(255, 255, 255, 0.1))'

    const onMove = (e: PointerEvent) => {
      // Direction-based delta: 'right' = expand on rightward drag, 'left' = expand on leftward drag
      const delta = direction === 'right' ? e.clientX - startX : startX - e.clientX
      onResize(startWidth, delta)
    }

    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      _resizeDragging = false
      handle.style.background = 'transparent'
      onResizeEnd()
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  })

  return handle
}

export function mountResizeHandles(): void {
  if (isPointerResizeActive()) return // Skip resize handles on mobile

  // Main sidebar resize handle — insert into the drawer (not panel, to avoid overflow: hidden clipping)
  const mainDrawer = getMainDrawer()
  if (mainDrawer && !mainDrawer.querySelector('.sidebar-ux-resize-handle')) {
    const mainSide = getMainDrawerSide()
    // Handle direction: 'right' means expand on rightward drag (drawer is on left, handle at right edge)
    //                   'left' means expand on leftward drag (drawer is on right, handle at left edge)
    const mainDirection = mainSide === 'left' ? 'right' : 'left'

    const handle = createResizeHandle(
      mainDirection,
      (startWidth, delta) => {
        const newWidth = clampSidebarWidth(startWidth + delta)
        const drawer = getMainDrawer()
        const wrapper = getMainWrapper()
        if (drawer) {
          drawer.style.width = `${newWidth}px`
        }
        // Set --drawer-panel-w on the WRAPPER (React sets it there for the close transform)
        if (wrapper) {
          wrapper.style.setProperty('--drawer-panel-w', `${newWidth}px`, 'important')
        }
        scheduleReflow()
      },
      () => {
        const width = getMainDrawerWidth()
        persistLayout()
      },
      () => isMainDrawerOpen()
    )

    // Position at the drawer's inner edge (facing content area)
    // Uses CSS variable so handle tracks the correct edge if tab strip position changes
    handle.style.cssText += `
      ${mainSide === 'left'
        ? `left: calc(var(--drawer-panel-w, 420px) - 4px);`
        : `right: calc(var(--drawer-panel-w, 420px) - 4px);`}
    `

    // Insert handle as sibling of panel inside the drawer
    mainDrawer.appendChild(handle)
  }

  // Secondary sidebar resize handle — insert into the secondary drawer.
  // Direction and position are side-aware: the handle always lives on the
  // drawer's inner edge (the edge facing the content area), and dragging
  // expands the drawer toward the content. This mirrors the main sidebar's
  // handle.
  const secondaryWrapper = getSecondaryWrapper()
  if (secondaryWrapper) {
    const secondaryDrawer = secondaryWrapper.querySelector('.sidebar-ux-drawer') as HTMLElement
    if (secondaryDrawer && !secondaryDrawer.querySelector('.sidebar-ux-resize-handle')) {
      // The secondary lives on the opposite side of the main.
      const mainSide = getMainDrawerSide()
      const secondarySide = mainSide === 'left' ? 'right' : 'left'
      // Direction follows from the secondary's position: a drawer on the
      // right has its handle on the left edge (drag left to expand toward
      // content), and vice versa.
      const secondaryDirection = secondarySide === 'right' ? 'left' : 'right'

      const handle = createResizeHandle(
        secondaryDirection,
        (startWidth, delta) => {
          const newWidth = clampSidebarWidth(startWidth + delta)
          document.documentElement.style.setProperty(SECONDARY_WIDTH_VAR, `${newWidth}px`)
          scheduleReflow()
          // Reposition tabs after resize
          repositionAssignedTabs()
        },
        () => {
          const width = parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
          persistLayout()
        },
        () => isSecondarySidebarOpen()
      )

      // Position the handle on the secondary drawer's inner edge.
      // The drawer is the offset parent (see createSecondarySidebar's
      // `position: relative` on the drawer), so a fixed offset from the
      // inner edge is stable regardless of width or sibling presence.
      // The 4px overhang is intentional — a portion of the handle sits
      // inside the drawer so the cursor lands on it reliably, and the rest
      // bleeds onto the content edge for a visual grab affordance.
      handle.style.cssText += `
        ${secondarySide === 'left' ? 'right' : 'left'}: -4px;
      `

      secondaryDrawer.appendChild(handle)
    }
  }
}

/**
 * Re-evaluate resize handles against the current `resizeSidebars` setting.
 * Mounts both handles (main + secondary) when on, removes both when off.
 * Idempotent — re-mounts skip if the handle is already present, removes are
 * a no-op if the handle is gone.
 *
 * Called from applySettings when `resizeSidebars` changes. Initial mount in
 * setup() goes through the same path so the live update and the cold-start
 * path produce identical DOM.
 */
export function refreshResizeHandles(): void {
  if (isPointerResizeActive()) return // mobile never gets handles

  // Main handle
  const mainDrawer = getMainDrawer()
  const existingMain = mainDrawer?.querySelector('.sidebar-ux-resize-handle') as HTMLElement | null
  if (getSettings().resizeSidebars) {
    if (mainDrawer && !existingMain) {
      mountResizeHandles() // idempotent on the main handle
    }
  } else {
    if (existingMain) existingMain.remove()
  }

  // Secondary handle
  const secondaryWrapper = getSecondaryWrapper()
  const secondaryDrawer = secondaryWrapper?.querySelector('.sidebar-ux-drawer') as HTMLElement | null
  const existingSecondary = secondaryDrawer?.querySelector('.sidebar-ux-resize-handle') as HTMLElement | null
  if (getSettings().resizeSidebars) {
    if (secondaryDrawer && !existingSecondary) {
      mountResizeHandles() // idempotent on the secondary handle
    }
  } else {
    if (existingSecondary) existingSecondary.remove()
  }
}