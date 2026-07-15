// Drag-and-drop tab reorder on live drawer tabs.
//
// Runtime drag phases (module `_drag`):
//   idle → dragging → settling → idle
// Pointer arming (long-press / distance threshold) uses local vars only —
// not a `_drag` phase. Settling keeps element + overlay so cleanup can
// remove the ghost after animate/commit; concurrent drag is gated by
// `phase !== idle`.
//
// Activation:
//   - Mouse / non-touch: distance-based (~6px Euclidean). pointerdown arms;
//     first pointermove past threshold calls startDrag with the *move* event
//     so grab offset is correct. Pure click does not lift or suppress clicks.
//   - Touch / pen: long-press (~200ms), then startDrag. Moving >~6px while
//     arming cancels (avoids lift during scroll/tap jitter).
//
// While dragging, hit-test finds the drop target (within or across drawers).
// On pointerup, builds a ConfigureDraft from current state, applies the
// reorder/move, and commits via the configure pipeline (commitConfigureDraft)
// — same backend as the Configure Tabs modal.
//
// Performance: overlay transform via translate3d updated immediately on
// every pointermove (cheap compositor work). Hit-test, DOM reorder, and
// FLIP animation are coalesced via requestAnimationFrame.
//
// Requires taskbar mode (settings-gated): primary mid-drag surface is
// main-mirror only. Reorderable lists get mid-drag FLIP: secondary
// .sidebar-ux-tab-list and main-mirror .sidebar-ux-tab-list-main. Commit
// uses visible-index helpers so hidden tabs do not make primary reorder a
// no-op, and reorders host + mirror DOM so primary sticks before React.
//
// Mobile (≤600px): live strip DnD is a no-op. Reorder/move tabs via
// Configure Tabs only (modal DnD stays enabled). Avoids fighting mobile
// full-bleed drawers and accidental lift during scroll/tap.
//
// Style: overlay clone preserves original classes so label/icon sizing
// inherits from the existing tab stylesheet. A wrapper div provides the
// floating chrome (border + primary ring + background treatment).

import {
  createDraft,
  moveTabVisible,
  reorderWithinVisible,
  alignDraftToLiveVisibleOrder,
  isDraftDirty,
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
import {
  isSettingsButton,
  hideMainTabButton,
  showMainTabButton,
} from './buttons'
import { isMobileViewport } from '../sidebar/mobile-exclusion'
import { dwarn } from '../debug/log'
import {
  readLivePrimaryTabIds,
  readLiveSecondaryTabIds,
} from './live-tab-order'

/**
 * Live drawer tab-list DnD is desktop-only.
 * Configure Tabs modal drag is separate and remains available on mobile.
 */
export function isLiveTabListDndAllowed(): boolean {
  return !isMobileViewport()
}

/**
 * Euclidean distance (px) before mouse drag activates.
 * Also cancels touch/pen long-press arming when exceeded.
 */
export const DRAG_ACTIVATE_DISTANCE_PX = 6

/** Long-press delay (ms) for touch/pen before drag activates. */
export const LONG_PRESS_MS = 200

/**
 * True when pointer travel from arming point should start a distance-based
 * drag (or cancel a touch long-press). Pure helper — exported for testing.
 */
export function shouldActivateDragFromDistance(
  dx: number,
  dy: number,
  threshold: number = DRAG_ACTIVATE_DISTANCE_PX,
): boolean {
  return Math.sqrt(dx * dx + dy * dy) >= threshold
}

/** Touch/pen keep long-press; mouse and empty/unknown use distance. */
function usesLongPressActivation(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen'
}

// ── Discriminated union for drag state ──
// Runtime: idle | dragging | settling only (arming is local to install handlers).

type DragState =
  | { phase: 'idle' }
  | {
      phase: 'dragging'
      tabId: string
      element: HTMLElement
      fromSecondary: boolean
      overlay: HTMLElement
      overlayInner: HTMLElement
      offsetX: number
      offsetY: number
      overlayTx: number
      overlayTy: number
      overlayWidth: number
      overlayHeight: number
      originalParent: HTMLElement
      originalNextSibling: HTMLElement | null
      sourceIsInCanvasList: boolean
      lastDropTarget: { container: HTMLElement; index: number; secondary: boolean } | null
      moveHandler: (e: PointerEvent) => void
      upHandler: (e: PointerEvent) => void
    }
  | {
      phase: 'settling'
      tabId: string
      element: HTMLElement
      fromSecondary: boolean
      overlay: HTMLElement
    }

let _drag: DragState = { phase: 'idle' }

/**
 * Capture-phase click suppressors — kill the browser's synthetic click after
 * pointerup so the tab does not activate / toggle-close.
 *
 * Important: removal is deferred until AFTER pointerup (setTimeout 0), not at
 * install time. An early setTimeout(0) at drag start removed the listener
 * before the user ever released — regression: every drop activated the tab.
 *
 * Kept as separate module-level variables — orthogonal to drag phase.
 */
let _clickSuppressor: ((e: Event) => void) | null = null
let _clickSuppressorEl: HTMLElement | null = null
let _docClickSuppressor: ((e: Event) => void) | null = null
let _clickSuppressorTimer: ReturnType<typeof setTimeout> | null = null

// ── rAF-coalesced drag-frame state ──

let _rafId: number | null = null
let _pendingPointerX = 0
let _pendingPointerY = 0

/** In-flight drop-settle timeout (transitionend fallback). */
let _settleTimer: ReturnType<typeof setTimeout> | null = null

/** Drop-settle duration — keep in sync with CSS transition on .overlay-settling. */
const SETTLE_DURATION_MS = 140
/** Skip settle animation when already within this many CSS pixels of dest. */
const SETTLE_MIN_DISTANCE_PX = 2

// ── Geometry cache (rebuilt each rAF, invalidated on DOM reorder) ──

interface ContainerCache {
  containers: { el: HTMLElement; secondary: boolean }[]
}
let _geometryCache: ContainerCache | null = null
/** True after a DOM reorder — next rAF must rebuild cache. */
let _geomDirty = false

/** Insert indicator element (insert-before-highlight). */
let _insertIndicatorEl: HTMLElement | null = null

// ── Drag install state per button ──

/** Buttons that already have drag-arming handlers installed. */
const _installed = new WeakSet<HTMLElement>()

// ── FLIP state ──

/** Previous button rects snapshot for FLIP (flushed after each animation series). */
let _flipPrevRects: Map<string, DOMRect> | null = null
let _flipActiveTimer: ReturnType<typeof setTimeout> | null = null

// ── Style injection ──

const DND_STYLE_ID = 'canvas-tab-list-dnd-styles'

function injectDndStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(DND_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = DND_STYLE_ID
  style.textContent = `
    /* ── Floating overlay clone (wrapper) — matches configure-modal overlay-clone treatment.
         pointer-events:none so synthetic click targets the real tab under the
         cursor (document capture suppressor can stop activation). ── */
    .canvas-tab-list-dnd-overlay-clone {
      position: fixed;
      z-index: 13000;
      pointer-events: none !important;
      margin: 0;
      padding: 0;
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
      opacity: 1 !important;
      will-change: transform;
      cursor: grabbing;
    }
    /* Defense: never inherit invisible-placeholder opacity onto the float */
    .canvas-tab-list-dnd-overlay-clone .canvas-tab-list-dnd-placeholder,
    .canvas-tab-list-dnd-overlay-clone-btn.canvas-tab-list-dnd-placeholder {
      opacity: 1 !important;
      pointer-events: none !important;
    }

    /* ── Inner button clone — host CSS-module classes may not reflow the
         floating clone the same way; force tab-btn layout so icons stay
         centered (was left-biased after lift). ── */
    .canvas-tab-list-dnd-overlay-clone-btn {
      border: none !important;
      background: none !important;
      box-shadow: none !important;
      outline: none !important;
      width: 100% !important;
      height: 100% !important;
      flex-shrink: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 1px !important;
      padding: 0 !important;
      margin: 0 !important;
      box-sizing: border-box !important;
    }

    /* ── Override label font for overlay clone (lost .sidebar-ux-tab-list ancestry) ── */
    .canvas-tab-list-dnd-overlay-clone .sidebar-ux-tab-label,
    .canvas-tab-list-dnd-overlay-clone span[class*="tabLabel"] {
      font-size: calc(9px * var(--lumiverse-font-scale, 1)) !important;
      font-weight: 500 !important;
      line-height: 1 !important;
      text-align: center !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      max-width: 48px !important;
      flex-shrink: 0 !important;
    }

    /* ── Icon wrap + svg sizing (host builtins = button>svg; mirror/secondary = span>svg) ── */
    .canvas-tab-list-dnd-overlay-clone-btn > span:first-child {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      width: 20px !important;
      height: 20px !important;
    }
    .canvas-tab-list-dnd-overlay-clone-btn svg {
      width: 20px !important;
      height: 20px !important;
      flex-shrink: 0 !important;
      display: block !important;
    }
    .canvas-tab-list-dnd-overlay-clone-btn img {
      width: 20px !important;
      height: 20px !important;
      flex-shrink: 0 !important;
      display: block !important;
    }

    /* ── Source button while being dragged — invisible slot holder (keeps
         layout / mid-drag FLIP geometry; floating overlay is the visible tab).
         transition:none while hidden so removing the class does not fade
         opacity via strip transition:all 0.2s. ── */
    .canvas-tab-list-dnd-placeholder {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: none !important;
    }

    /* ── While dragging: strip buttons do not receive pointer hits.
         Overlay is pointer-events:none so the cursor would otherwise
         :hover the tab underneath (host hover glow/background). Hit-test
         uses document pointer coords, not elementFromPoint. ── */
    body.canvas-tab-list-dnd-dragging button[data-tab-id],
    body.canvas-tab-list-dnd-dragging .sidebar-ux-main-tab-mirror-btn,
    body.canvas-tab-list-dnd-dragging .sidebar-ux-tab-list button,
    body.canvas-tab-list-dnd-dragging .sidebar-ux-main-tab-list-mirror button {
      pointer-events: none !important;
    }

    /* ── FLIP animation on Canvas-owned list buttons during mid-drag reorder ── */
    .canvas-tab-list-dnd-flipping {
      transition: transform 200ms cubic-bezier(0.25, 1, 0.5, 1) !important;
    }

    /* ── Drop settle: floating clone eases into its destination slot ── */
    .canvas-tab-list-dnd-overlay-clone.canvas-tab-list-dnd-overlay-settling {
      transition:
        transform ${SETTLE_DURATION_MS}ms cubic-bezier(0.25, 1, 0.5, 1),
        box-shadow ${SETTLE_DURATION_MS}ms ease,
        opacity ${SETTLE_DURATION_MS}ms ease !important;
      box-shadow: 0 2px 10px -4px rgba(0, 0, 0, 0.35),
        0 0 0 1px var(--lumiverse-border, #333);
      cursor: default;
      opacity: 0.92 !important;
    }
  `
  document.head.appendChild(style)
}

// ── Surface helpers ──
//
// Main-mirror DOM (main-tab-pin.ts) nests buttons — they are NOT direct
// children of the outer list:
//   .sidebar-ux-main-tab-list-mirror  (also has .sidebar-ux-tab-list)
//     .sidebar-ux-tab-list-main       ← primary tabs live here
//     .sidebar-ux-tab-list-bottom     ← Settings dock
// Secondary tabs are direct children of .sidebar-ux-tab-list (no nesting).

const MIRROR_LIST_CLASS = 'sidebar-ux-main-tab-list-mirror'
const MIRROR_MAIN_CLASS = 'sidebar-ux-tab-list-main'
const MIRROR_BOTTOM_CLASS = 'sidebar-ux-tab-list-bottom'
const MIRROR_BTN_CLASS = 'sidebar-ux-main-tab-mirror-btn'
const TAB_LIST_CLASS = 'sidebar-ux-tab-list'

/** True when the button lives in the secondary drawer's tab list (not main-mirror). */
function isSecondaryButton(btn: HTMLElement): boolean {
  // Mirror outer list also carries .sidebar-ux-tab-list — exclude it.
  if (btn.classList.contains(MIRROR_BTN_CLASS)) return false
  if (btn.closest(`.${MIRROR_LIST_CLASS}`)) return false
  return !!btn.closest(`.${TAB_LIST_CLASS}`)
}

/** Get the tab id from any surface button (data-tab-id on all surfaces). */
function getButtonTabId(btn: HTMLElement): string | null {
  return btn.getAttribute('data-tab-id')
}

/**
 * True when the container is eligible for mid-drag FLIP reorder.
 * Secondary list + mirror main/bottom sections only (taskbar mode required).
 */
function isReorderableContainer(el: HTMLElement): boolean {
  if (el.classList.contains(MIRROR_MAIN_CLASS)) return true
  if (el.classList.contains(MIRROR_BOTTOM_CLASS)) return true
  if (el.classList.contains(MIRROR_LIST_CLASS)) return true
  // Secondary .sidebar-ux-tab-list (mirror outer also has this class — already handled)
  if (el.classList.contains(TAB_LIST_CLASS) && !el.classList.contains(MIRROR_LIST_CLASS)) {
    return true
  }
  return false
}

/**
 * Parent element that owns mid-drag insertBefore for this button.
 * Mirror: .sidebar-ux-tab-list-main or .sidebar-ux-tab-list-bottom.
 * Secondary: the .sidebar-ux-tab-list itself.
 */
function getReorderParent(btn: HTMLElement): HTMLElement | null {
  if (btn.classList.contains(MIRROR_BTN_CLASS) || btn.closest(`.${MIRROR_LIST_CLASS}`)) {
    const section = btn.closest(
      `.${MIRROR_MAIN_CLASS}, .${MIRROR_BOTTOM_CLASS}`,
    ) as HTMLElement | null
    return section ?? btn.parentElement
  }
  if (isSecondaryButton(btn)) {
    const list = btn.closest(`.${TAB_LIST_CLASS}`) as HTMLElement | null
    if (list && !list.classList.contains(MIRROR_LIST_CLASS)) return list
  }
  return null
}

/**
 * Collect all potential drop containers and their side.
 * Mirror uses main/bottom *sections* (where buttons actually live) so
 * hit-test and insertBefore stay within the correct flex column.
 * Host React `.tabList` is not a mid-drag surface (taskbar mode required;
 * commit still reorders host buttons via configure-commit).
 */
function getDropContainers(): { el: HTMLElement; secondary: boolean }[] {
  const containers: { el: HTMLElement; secondary: boolean }[] = []

  // 1. Secondary tab list (only when second drawer is mounted)
  if (getSecondaryWrapper()) {
    const secList = getSecondaryTabList()
    if (secList) containers.push({ el: secList, secondary: true })
  }

  // 2. Main-mirror primary strip (Canvas-owned under taskbar mode).
  //    Settings bottom dock is not a drop target — host chrome stays pinned.
  const mirrorList = document.querySelector(
    `.${MIRROR_LIST_CLASS}`,
  ) as HTMLElement | null
  if (mirrorList) {
    const main = mirrorList.querySelector(
      `:scope > .${MIRROR_MAIN_CLASS}`,
    ) as HTMLElement | null
    if (main) {
      containers.push({ el: main, secondary: false })
    } else {
      // Fallback if structure not yet built (legacy flat list)
      containers.push({ el: mirrorList, secondary: false })
    }
  }

  return containers
}

/**
 * Collect tab buttons from a drop container (direct children for Canvas
 * sections; nested for outer mirror fallback).
 */
function getAllButtonsInContainer(container: HTMLElement): HTMLElement[] {
  // Mirror main/bottom sections — buttons are direct children
  if (
    container.classList.contains(MIRROR_MAIN_CLASS) ||
    container.classList.contains(MIRROR_BOTTOM_CLASS)
  ) {
    return Array.from(
      container.querySelectorAll(
        `:scope > button.${MIRROR_BTN_CLASS}, :scope > button[data-tab-id]`,
      ),
    )
  }
  // Outer mirror list (legacy / fallback) — buttons nested under sections
  if (container.classList.contains(MIRROR_LIST_CLASS)) {
    return Array.from(
      container.querySelectorAll(`button.${MIRROR_BTN_CLASS}`),
    )
  }
  // Secondary list — direct children
  if (
    container.classList.contains(TAB_LIST_CLASS) &&
    !container.classList.contains(MIRROR_LIST_CLASS)
  ) {
    return Array.from(
      container.querySelectorAll(':scope > button[data-tab-id]'),
    )
  }
  return Array.from(
    container.querySelectorAll('button[data-tab-id]'),
  )
}

/**
 * Collect tab buttons from a drop container for hit-test math.
 * Filters out the dragged tab (excludeTabId) if present.
 */
function getButtonsInContainer(
  container: HTMLElement,
  _secondary: boolean,
  excludeTabId: string | null,
): HTMLElement[] {
  const buttons = getAllButtonsInContainer(container)
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

  // Host tabOrder alone can disagree with what the strips actually show
  // (especially before the first live DnD commit). Align both sides to
  // live DOM so commit does not reshuffle to host/catalog order.
  const draftFromHost = createDraft({
    catalog,
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: hostSettings?.hiddenTabIds || [],
    drawerSide,
    assignments: currentAssignments,
  })
  const draft = alignDraftToLiveVisibleOrder(
    draftFromHost,
    readLivePrimaryTabIds(),
    readLiveSecondaryTabIds(),
  )

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
 * Geometry of the floating tab used for hit-testing (not the raw pointer).
 *
 * Live strips are narrow; grabbing near an edge made pointer-based hit-test
 * swap neighbors / change drawers before the floating tab itself reached
 * the midpoint. Configure feels "tab-slot" oriented because the row is
 * wide and grab is on a centered handle — we match that intent by using
 * the overlay center for insert Y and overlay bounds for which list is
 * under the drag.
 */
export function dragHitGeometry(
  overlayTx: number,
  overlayTy: number,
  overlayWidth: number,
  overlayHeight: number,
): { centerX: number; centerY: number; left: number; top: number; right: number; bottom: number } {
  const w = Math.max(0, overlayWidth)
  const h = Math.max(0, overlayHeight)
  return {
    centerX: overlayTx + w / 2,
    centerY: overlayTy + h / 2,
    left: overlayTx,
    top: overlayTy,
    right: overlayTx + w,
    bottom: overlayTy + h,
  }
}

/**
 * True when the floating tab overlaps a drop container.
 *
 * Vertical pad keeps empty/near-edge lists accepting the tab. Horizontal
 * pad gives ~80px of sideways leeway so reorder/FLIP still runs when the
 * floating tab (or cursor) drifts off a narrow drawer strip into chat.
 */
export function overlayOverlapsContainer(
  overlay: { left: number; top: number; right: number; bottom: number },
  container: { left: number; top: number; right: number; bottom: number },
  padY = 8,
  padX = 80,
): boolean {
  const overlapsX =
    overlay.right > container.left - padX && overlay.left < container.right + padX
  const overlapsY =
    overlay.bottom > container.top - padY && overlay.top < container.bottom + padY
  return overlapsX && overlapsY
}

/**
 * Post-removal insert index for a Y coordinate against button midpoints
 * (same convention as configure-modal hitTestDropTarget).
 */
export function insertIndexFromMidpoints(y: number, midpoints: number[]): number {
  for (let i = 0; i < midpoints.length; i++) {
    if (y < midpoints[i]) return i
  }
  return midpoints.length
}

/**
 * Find the drop target under the floating tab (tab position, not cursor).
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
  geom: ReturnType<typeof dragHitGeometry>,
  dragTabId: string | null,
): { container: HTMLElement; index: number; secondary: boolean } | null {
  const containers = _geometryCache
    ? _geometryCache.containers
    : getDropContainers()

  // Prefer the container whose horizontal center is closest to the tab
  // center when both overlap (unlikely for opposite-side drawers, but
  // stable if they briefly both match).
  let best: {
    container: HTMLElement
    index: number
    secondary: boolean
    distX: number
  } | null = null

  for (const { el: container, secondary } of containers) {
    const rect = container.getBoundingClientRect()
    if (!overlayOverlapsContainer(geom, rect)) continue

    const buttons = getButtonsInContainer(
      container,
      secondary,
      dragTabId,
    )

    let index = 0
    if (buttons.length > 0) {
      const midpoints = buttons.map((btn) => {
        const btnRect = btn.getBoundingClientRect()
        return btnRect.top + btnRect.height / 2
      })
      // Insert index from floating *tab center* Y (not pointer Y).
      index = insertIndexFromMidpoints(geom.centerY, midpoints)
    }

    const containerMidX = rect.left + rect.width / 2
    const distX = Math.abs(geom.centerX - containerMidX)
    if (!best || distX < best.distX) {
      best = { container, index, secondary, distX }
    }
  }

  return best
    ? { container: best.container, index: best.index, secondary: best.secondary }
    : null
}

/**
 * Predicted top-left of the drop slot from sibling button rects (post-removal
 * insert index). Only valid when `rects` do **not** include the dragged
 * placeholder (siblings have not already shifted around it). Prefer the live
 * placeholder rect when mid-drag has already parked the source in the list.
 *
 * Pure helper — unit-tested.
 */
export function settleDestFromButtonRects(
  index: number,
  rects: { left: number; top: number; width: number; height: number }[],
  emptyFallback: { left: number; top: number },
): { left: number; top: number } {
  if (rects.length === 0) return emptyFallback
  if (index >= rects.length) {
    const last = rects[rects.length - 1]
    return { left: last.left, top: last.top + last.height }
  }
  const ref = rects[index]
  return { left: ref.left, top: ref.top }
}

/**
 * Destination top-left for the floating overlay on release.
 *
 * Mid-drag parks the source button (invisible placeholder) into the drop
 * slot for both same-list and cross-drawer. Prefer that live rect when the
 * placeholder is already in the target container — predicting from siblings
 * *after excluding* the placeholder is one slot too low, because neighbors
 * have already shifted around it.
 *
 * Cross-list prediction (settleDestFromButtonRects) only when the source is
 * not yet in the target (reorder failed / never parked). Cancel: restore
 * source first, then pass target=null.
 */
function resolveSettleDestination(
  dragElement: HTMLElement | null,
  tabId: string | null,
  target: { container: HTMLElement; index: number; secondary: boolean } | null,
  overlayWidth: number,
): { left: number; top: number } | null {
  // Placeholder already in the drop list (same- or cross-drawer mid-drag).
  if (dragElement && target && target.container.contains(dragElement)) {
    const r = dragElement.getBoundingClientRect()
    return { left: r.left, top: r.top }
  }

  // Source not in target — predict insert among remaining buttons.
  if (target && tabId) {
    const buttons = getButtonsInContainer(
      target.container,
      target.secondary,
      tabId,
    )
    const rects = buttons.map((b) => {
      const r = b.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    })
    const cr = target.container.getBoundingClientRect()
    const emptyFallback = {
      left: cr.left + Math.max(0, (cr.width - (overlayWidth || 48)) / 2),
      top: cr.top,
    }
    return settleDestFromButtonRects(target.index, rects, emptyFallback)
  }

  // Cancel / no target after restore
  if (dragElement) {
    const r = dragElement.getBoundingClientRect()
    return { left: r.left, top: r.top }
  }
  return null
}

/**
 * Animate the floating overlay from its current translate to dest top-left.
 * Resolves when the transition ends (or after a timeout fallback).
 */
function animateOverlaySettle(
  overlay: HTMLElement,
  currentTx: number,
  currentTy: number,
  destLeft: number,
  destTop: number,
): Promise<{ tx: number; ty: number }> {
  const dx = destLeft - currentTx
  const dy = destTop - currentTy
  if (Math.hypot(dx, dy) < SETTLE_MIN_DISTANCE_PX) {
    overlay.style.transform = `translate3d(${destLeft}px, ${destTop}px, 0)`
    return Promise.resolve({ tx: destLeft, ty: destTop })
  }

  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      overlay.removeEventListener('transitionend', onEnd)
      if (_settleTimer !== null) {
        clearTimeout(_settleTimer)
        _settleTimer = null
      }
      resolve({ tx: destLeft, ty: destTop })
    }
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== overlay) return
      // Only complete on transform (box-shadow/opacity also transition).
      if (e.propertyName && e.propertyName !== 'transform') return
      finish()
    }

    overlay.addEventListener('transitionend', onEnd)
    overlay.classList.add('canvas-tab-list-dnd-overlay-settling')
    // Ensure the settling class applies before changing transform.
    void overlay.offsetWidth
    overlay.style.transform = `translate3d(${destLeft}px, ${destTop}px, 0)`
    _settleTimer = setTimeout(finish, SETTLE_DURATION_MS + 40)
  })
}

function cancelOverlaySettle(overlay?: HTMLElement | null): void {
  if (_settleTimer !== null) {
    clearTimeout(_settleTimer)
    _settleTimer = null
  }
  if (overlay) {
    overlay.classList.remove('canvas-tab-list-dnd-overlay-settling')
  }
}

/**
 * Hold the drop-slot height when the mid-drag placeholder must leave the
 * target list (cross-drawer restore) before commit creates the correct
 * button type. Without this, siblings collapse into the gap under the
 * settling overlay → visible flicker, then expand again when the real tab
 * lands.
 *
 * Insert *after* the placeholder so when the placeholder is moved back to
 * its origin, the spacer remains between the previous and next siblings.
 */
function installDropSlotSpacer(placeholder: HTMLElement | null): HTMLElement | null {
  if (!placeholder?.parentElement) return null
  const parent = placeholder.parentElement
  const rect = placeholder.getBoundingClientRect()
  const height = Math.max(Math.round(rect.height), 1)
  const spacer = document.createElement('div')
  spacer.className = 'canvas-tab-list-dnd-slot-spacer'
  spacer.setAttribute('aria-hidden', 'true')
  spacer.style.cssText = [
    `height:${height}px`,
    'width:100%',
    'flex-shrink:0',
    'pointer-events:none',
    'visibility:hidden',
    'box-sizing:border-box',
    'margin:0',
    'padding:0',
    'border:none',
  ].join(';')
  parent.insertBefore(spacer, placeholder.nextSibling)
  return spacer
}

function removeDropSlotSpacer(spacer: HTMLElement | null | undefined): void {
  if (spacer?.isConnected) spacer.remove()
  // Belt-and-suspenders: commit reorders may leave a stray spacer if the
  // captured ref was replaced / the list remounted mid-drop.
  if (typeof document !== 'undefined') {
    for (const el of Array.from(
      document.querySelectorAll('.canvas-tab-list-dnd-slot-spacer'),
    )) {
      el.remove()
    }
  }
}

// ── Insert indicator management ──

function clearInsertIndicator(): void {
  if (_insertIndicatorEl) {
    _insertIndicatorEl.classList.remove(
      'canvas-tab-list-dnd-insert-before',
    )
    _insertIndicatorEl = null
  }
  // Legacy class cleanup (indicator UI removed; strip if any stuck).
  if (typeof document !== 'undefined') {
    for (const el of Array.from(
      document.querySelectorAll('.canvas-tab-list-dnd-insert-before'),
    )) {
      el.classList.remove('canvas-tab-list-dnd-insert-before')
    }
  }
}

// ── FLIP animation helpers ──

/**
 * Snapshot bounding rects of all buttons in a container, keyed by data-tab-id.
 */
function snapshotButtonRects(container: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  for (const btn of getAllButtonsInContainer(container)) {
    const id = btn.getAttribute('data-tab-id')
    if (id) rects.set(id, btn.getBoundingClientRect())
  }
  return rects
}

/**
 * Merge rect maps (later entries overwrite).
 */
function mergeRects(
  into: Map<string, DOMRect>,
  from: Map<string, DOMRect>,
): void {
  for (const [k, v] of from) into.set(k, v)
}

/**
 * Apply FLIP transforms to moved buttons after a temporary DOM reorder.
 *
 * Each button that changed vertical position gets:
 *   1. invert translateY (no transition) to appear at its old position
 *   2. force layout
 *   3. transition to identity (200ms cubic-bezier)
 *   4. cleanup inline styles after animation completes
 *
 * Uses setProperty(..., 'important') so FLIP wins over stylesheet
 * `transition: all 0.2s ease` on tab buttons.
 */
function applyFLIP(
  prevRects: Map<string, DOMRect>,
  excludeTabId: string | null,
  containers: HTMLElement[],
): void {
  const animated: HTMLElement[] = []
  const seen = new Set<HTMLElement>()

  for (const container of containers) {
    for (const btn of getAllButtonsInContainer(container)) {
      if (seen.has(btn)) continue
      seen.add(btn)
      const id = btn.getAttribute('data-tab-id')
      if (!id || id === excludeTabId || !prevRects.has(id)) continue
      const prev = prevRects.get(id)!
      const curr = btn.getBoundingClientRect()
      const deltaY = prev.top - curr.top
      if (Math.abs(deltaY) <= 0.5) continue
      btn.style.setProperty('transition', 'none', 'important')
      btn.style.setProperty('transform', `translateY(${deltaY}px)`, 'important')
      animated.push(btn)
    }
  }

  if (animated.length === 0) return

  // Force layout so the invert sticks before we animate
  void document.body.offsetHeight

  requestAnimationFrame(() => {
    for (const node of animated) {
      node.style.setProperty(
        'transition',
        'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
        'important',
      )
      node.style.setProperty('transform', '', 'important')
      // Clear transform so identity plays; removeProperty after empty set
      node.style.removeProperty('transform')
    }
    if (_flipActiveTimer) clearTimeout(_flipActiveTimer)
    _flipActiveTimer = setTimeout(() => {
      for (const node of animated) {
        node.style.removeProperty('transition')
        node.style.removeProperty('transform')
      }
      _flipActiveTimer = null
    }, 220)
  })
}

/**
 * Clear any ongoing FLIP inline styles (used on drag cancel / cleanup).
 */
function clearFLIPStyles(): void {
  if (_flipActiveTimer) {
    clearTimeout(_flipActiveTimer)
    _flipActiveTimer = null
  }
  const containers = _geometryCache?.containers ?? getDropContainers()
  for (const { el: container } of containers) {
    for (const btn of getAllButtonsInContainer(container)) {
      btn.style.removeProperty('transition')
      btn.style.removeProperty('transform')
    }
  }
}

// ── DOM reorder for Canvas-owned lists (mid-drag FLIP reorder) ──

/**
 * Move the dragged source button into `container` at the hit-test index
 * (post-removal insert position). Supports same-list and cross-list
 * (secondary ↔ mirror section) moves among Canvas-owned parents.
 *
 * Returns true if a DOM mutation was performed.
 */
function reorderCanvasListDOM(
  container: HTMLElement,
  target: { index: number; secondary: boolean },
  sourceTabId: string | null,
  dragElement: HTMLElement | null,
): boolean {
  if (!sourceTabId) return false
  if (!isReorderableContainer(container)) return false

  // Prefer the live drag element so cross-list moves work even when the
  // source is not yet a child of the target container.
  const sourceBtn =
    dragElement && dragElement.getAttribute('data-tab-id') === sourceTabId
      ? dragElement
      : getAllButtonsInContainer(container).find(
          (b) => b.getAttribute('data-tab-id') === sourceTabId,
        ) ?? null
  if (!sourceBtn) return false

  const buttons = getAllButtonsInContainer(container)
  const buttonsWithoutSource = buttons.filter((b) => b !== sourceBtn)

  if (target.index >= buttonsWithoutSource.length) {
    // Append to end of container
    if (
      sourceBtn.parentElement === container &&
      sourceBtn.nextElementSibling === null
    ) {
      return false
    }
    container.appendChild(sourceBtn)
    return true
  }

  const referenceBtn = buttonsWithoutSource[target.index]
  if (
    sourceBtn.parentElement === container &&
    sourceBtn.nextElementSibling === referenceBtn
  ) {
    return false
  }
  container.insertBefore(sourceBtn, referenceBtn)
  return true
}

/**
 * Restore the source button to its original DOM position.
 * Used on drag cancel to undo mid-drag reorders.
 */
function restoreSourceButtonDOM(
  dragElement: HTMLElement | null,
  originalParent: HTMLElement | null,
  originalNextSibling: HTMLElement | null,
): void {
  if (!dragElement || !originalParent) return

  // If the source is already in its original parent at the right position, skip
  const parent = dragElement.parentNode
  if (parent === originalParent) {
    if (originalNextSibling) {
      if (dragElement.nextElementSibling === originalNextSibling) return
      originalParent.insertBefore(dragElement, originalNextSibling)
    } else {
      // Was last child
      if (dragElement.nextElementSibling === null &&
          dragElement.parentNode === originalParent) return
      originalParent.insertBefore(dragElement, null)
    }
  } else {
    // Moved to a different container — move back
    if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
      originalParent.insertBefore(dragElement, originalNextSibling)
    } else {
      // Original next sibling may have been removed; append instead
      originalParent.appendChild(dragElement)
    }
  }
}

// ── Drag implementation ──

function createDragOverlay(sourceBtn: HTMLElement): HTMLElement {
  // Create wrapper div with overlay chrome
  const wrapper = document.createElement('div')
  wrapper.className = 'canvas-tab-list-dnd-overlay-clone'

  // Clone the source button preserving all original classes.
  // Strip the live placeholder class if present — cloneNode would copy
  // opacity:0 and the floating tab would appear empty (icon + label gone).
  const clone = sourceBtn.cloneNode(true) as HTMLElement
  clone.classList.remove('canvas-tab-list-dnd-placeholder')
  clone.classList.add('canvas-tab-list-dnd-overlay-clone-btn')

  const rect = sourceBtn.getBoundingClientRect()
  wrapper.style.width = rect.width + 'px'
  wrapper.style.height = rect.height + 'px'
  // left/top = 0; translate3d gives us absolute positioning without layout thrash
  wrapper.style.left = '0px'
  wrapper.style.top = '0px'
  wrapper.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`

  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)

  return wrapper
}

function suppressSyntheticClick(e: Event): void {
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
}

/**
 * Install capture click blockers for the duration of a drag.
 * Call {@link scheduleClickSuppressorRemoval} from pointerup so the
 * browser's same-task synthetic click is still caught; do NOT schedule
 * removal at install time.
 */
function installClickSuppressor(el: HTMLElement): void {
  // Replace any prior suppressors (re-entrant startDrag should not stack).
  removeClickSuppressorNow()

  _clickSuppressor = suppressSyntheticClick
  _clickSuppressorEl = el
  el.addEventListener('click', _clickSuppressor, true)

  // Document capture: mid-drag reorders can put a *different* tab under the
  // pointer; the synthetic click may target that node, not the source.
  _docClickSuppressor = suppressSyntheticClick
  document.addEventListener('click', _docClickSuppressor, true)
}

/**
 * After pointerup: keep suppressors through the current task so the
 * compatibility `click` (dispatched sync after pointerup returns) is
 * blocked, then remove on the next macrotask (drawerTabPosition/drag.ts).
 */
function scheduleClickSuppressorRemoval(): void {
  if (_clickSuppressorTimer !== null) clearTimeout(_clickSuppressorTimer)
  _clickSuppressorTimer = setTimeout(() => {
    removeClickSuppressorNow()
  }, 0)
}

function removeClickSuppressorNow(): void {
  if (_clickSuppressorTimer !== null) {
    clearTimeout(_clickSuppressorTimer)
    _clickSuppressorTimer = null
  }
  if (_clickSuppressor && _clickSuppressorEl) {
    _clickSuppressorEl.removeEventListener('click', _clickSuppressor, true)
  }
  _clickSuppressor = null
  _clickSuppressorEl = null
  if (_docClickSuppressor) {
    document.removeEventListener('click', _docClickSuppressor, true)
    _docClickSuppressor = null
  }
}

/** Schedule rAF-coalesced hit-test + reorder + FLIP work. */
function scheduleDragFrame(): void {
  if (_rafId !== null) return
  _rafId = requestAnimationFrame(() => {
    _rafId = null

    if (_drag.phase !== 'dragging') return

    // Rebuild geometry cache if dirty (after reorder) or on first use
    if (_geomDirty || !_geometryCache) {
      _geometryCache = { containers: getDropContainers() }
      _geomDirty = false
    }

    // Hit-test from floating tab geometry (center + bounds), not raw pointer.
    // Overlay may lag one pointermove if only rAF runs; use latest overlayTx/Ty
    // which onMove updates synchronously before scheduleDragFrame.
    const geom = dragHitGeometry(
      _drag.overlayTx,
      _drag.overlayTy,
      _drag.overlayWidth || 48,
      _drag.overlayHeight || 48,
    )
    const target = hitTestDropTarget(geom, _drag.tabId)

    const prev = _drag.lastDropTarget
    const sameTarget = prev && target &&
      prev.container === target.container &&
      prev.index === target.index &&
      prev.secondary === target.secondary

    if (!target) {
      // Sticky last drop: keep `lastDropTarget` when the float briefly leaves
      // hit-pad (edge of padX/padY, or rAF miss on release). Mid-drag DOM is
      // already reordered to that slot — clearing the target made pointerup
      // take the cancel path and snap back "to where it was".
      if (prev) {
        clearInsertIndicator()
      }
      return
    }

    if (!sameTarget) {
      // Target changed — mid-drag FLIP reorder on any reorderable list
      // (secondary, main-mirror sections, host React tabList).
      const isReorderable = isReorderableContainer(target.container)
      const prevReorderable = prev
        ? isReorderableContainer(prev.container)
        : false

      if (isReorderable && _drag.sourceIsInCanvasList) {
        // Snapshot source parent + target (and prev target) so siblings on
        // both lists animate when crossing secondary ↔ mirror / main ↔ bottom.
        const prevRects = new Map<string, DOMRect>()
        const flipContainers: HTMLElement[] = []
        const sourceParent = _drag.element?.parentElement
        if (sourceParent && isReorderableContainer(sourceParent)) {
          mergeRects(prevRects, snapshotButtonRects(sourceParent))
          flipContainers.push(sourceParent)
        }
        if (prev?.container && prev.container !== sourceParent) {
          mergeRects(prevRects, snapshotButtonRects(prev.container))
          if (!flipContainers.includes(prev.container)) {
            flipContainers.push(prev.container)
          }
        }
        mergeRects(prevRects, snapshotButtonRects(target.container))
        if (!flipContainers.includes(target.container)) {
          flipContainers.push(target.container)
        }

        const didReorder = reorderCanvasListDOM(
          target.container,
          target,
          _drag.tabId,
          _drag.element,
        )

        if (didReorder) {
          applyFLIP(prevRects, _drag.tabId, flipContainers)
          _geomDirty = true
        }
      } else if (prevReorderable && !isReorderable && prev) {
        // Leaving a reorderable surface — restore source DOM
        restoreSourceButtonDOM(_drag.element, _drag.originalParent, _drag.originalNextSibling)
        clearFLIPStyles()
        _geomDirty = true
      }

      _drag.lastDropTarget = target
    }
  })
}

function startDrag(btn: HTMLElement, pointerEvent: PointerEvent): void {
  // Belt-and-suspenders: never lift on mobile (Configure Tabs only).
  if (!isLiveTabListDndAllowed()) return
  const tabId = getButtonTabId(btn)
  if (!tabId) return

  // Determine source side
  const fromSecondary = isSecondaryButton(btn)
  const element = btn

  // Save original DOM position for cancel-restore
  const originalParent = btn.parentElement!
  const originalNextSibling = btn.nextElementSibling as HTMLElement | null
  // Mirror section or secondary list — gates mid-drag DOM reorder.
  const sourceIsInCanvasList = getReorderParent(btn) != null

  // Calculate overlay offset from pointer
  const rect = btn.getBoundingClientRect()
  const offsetX = pointerEvent.clientX - rect.left
  const offsetY = pointerEvent.clientY - rect.top

  // Create overlay *before* hiding the source — cloneNode copies classes,
  // so adding the invisible placeholder first would blank the floating tab.
  const overlay = createDragOverlay(btn)
  const overlayInner = overlay.querySelector('.canvas-tab-list-dnd-overlay-clone-btn') as HTMLElement

  // Invisible slot holder (layout only); overlay is the visible tab.
  btn.classList.add('canvas-tab-list-dnd-placeholder')

  // Initialize geometry cache
  _geometryCache = { containers: getDropContainers() }
  _geomDirty = false

  // Prevent text selection globally; mark drag so strip :hover is suppressed
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'grabbing'
  document.body.classList.add('canvas-tab-list-dnd-dragging')

  // Suppress context menu during drag (capture-phase preventDefault)
  // so host long-press contextmenu does not fire while dragging.
  const suppressCtx = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  document.addEventListener('contextmenu', suppressCtx, true)

  // Suppress post-drag synthetic click (source + document capture).
  // Stay installed until pointerup schedules deferred removal — NOT a
  // setTimeout at install time (that cleared the listener mid-drag).
  installClickSuppressor(btn)

  // Pointer move — updates overlay transform IMMEDIATELY (cheap compositor work)
  // and defers hit-test/reorder to rAF.
  const onMove = (ev: PointerEvent) => {
    if (_drag.phase !== 'dragging') return

    // Update overlay position via translate3d immediately (no layout thrash)
    _drag.overlayTx = ev.clientX - _drag.offsetX
    _drag.overlayTy = ev.clientY - _drag.offsetY
    _drag.overlay.style.transform = `translate3d(${_drag.overlayTx}px, ${_drag.overlayTy}px, 0)`

    // Store latest pointer coords for rAF-coalesced hit-test
    _pendingPointerX = ev.clientX
    _pendingPointerY = ev.clientY

    // Schedule rAF if not already pending
    scheduleDragFrame()
  }

  // Pointer up / cancel
  // Capture all data into locals BEFORE any cleanup / await, so we
  // never rely on module fields that clearDragState zeroes.
  const onUp = async (_ev: PointerEvent) => {
    // Only the active drag's up handler may settle. If phase already left
    // dragging (duplicate event or tearDown), ignore.
    if (_drag.phase !== 'dragging') return

    const capturedTabId = tabId
    const capturedFromSecondary = fromSecondary
    const capturedTarget = _drag.lastDropTarget

    document.removeEventListener('contextmenu', suppressCtx, true)

    // Keep click suppressors through this task so the browser's
    // compatibility click (after pointerup returns / at await yield)
    // is still blocked; remove on next macrotask.
    scheduleClickSuppressorRemoval()

    // Detach move/up while still `dragging` (settling has no handlers).
    // Do NOT idle yet — keep element/overlay for settle + cleanupDragVisuals.
    detachDragPointerListeners()
    _drag = {
      phase: 'settling',
      tabId: capturedTabId,
      element,
      fromSecondary: capturedFromSecondary,
      overlay,
    }
    clearInsertIndicator()

    let slotSpacer: HTMLElement | null = null
    try {
      if (capturedTarget && capturedTabId) {
        // Same-list: keep mid-drag DOM through successful commit so primary/
        // mirror do not flash pre-drag order (commit re-applies draft order).
        //
        // Cross-list is asymmetric:
        //   secondary → primary: secondary btn is parked in main-mirror (wrong
        //     type). Restore + height spacer before commit so removeSecondary
        //     / showMain see a clean secondary list and the mirror slot does
        //     not collapse under the settling overlay.
        //   primary → secondary: mirror btn is parked in secondary (wrong type).
        //     Do NOT restore before commit — that flashes the tab back onto
        //     main-mirror and rearranges both drawers for a frame. Leave the
        //     foreign node in the drop slot; addSecondaryTabButton strips it
        //     and inserts the real secondary button in the same place.
        const crossList = capturedFromSecondary !== capturedTarget.secondary

        // Prefer live placeholder rect while it still sits in the drop list
        // (sibling predict after excluding placeholder is one slot low).
        const dest = resolveSettleDestination(
          element,
          capturedTabId,
          capturedTarget,
          rect.width,
        )

        // Keep placeholder in the target through settle so siblings stay put.
        if (dest) {
          const currentTx = overlay.style.transform
            ? parseFloat(overlay.style.transform.match(/translate3d\(([^,]+)/)?.[1] || '0')
            : 0
          const currentTy = overlay.style.transform
            ? parseFloat(overlay.style.transform.match(/translate3d\([^,]+,\s*([^,]+)/)?.[1] || '0')
            : 0
          await animateOverlaySettle(overlay, currentTx, currentTy, dest.left, dest.top)
        }

        if (crossList && capturedFromSecondary) {
          // secondary → primary only
          slotSpacer = installDropSlotSpacer(element)
          restoreSourceButtonDOM(element, originalParent, originalNextSibling)
        }

        if (crossList && !capturedFromSecondary) {
          // primary → secondary: only the mirror node moved mid-drag; the host
          // button stayed visible. Hide it before commit so a later pin
          // reconcile does not re-materialize a main-mirror button (dual-list
          // rearrange flash). Do NOT reconcile here: heal would drop
          // `_activeMainMirrorKey` when the active host button is display:none
          // and no remaining host tab has tabBtnActive yet — quiet handoff
          // then sees wasActive=false and leaves main panel empty with no
          // mirror strip switch.
          hideMainTabButton(capturedTabId)
        }

        const ok = await performDrop(
          capturedTabId,
          capturedFromSecondary,
          capturedTarget,
        )
        if (!ok) {
          if (crossList && !capturedFromSecondary) {
            showMainTabButton(capturedTabId)
            // Early hide + pin reconcile may have dropped the mirror button;
            // rebuild strip after unhide so the tab is visible again.
            try {
              const mp = await import('../sidebar/main-tab-pin')
              mp.reconcileMainTabListPin?.()
            } catch {
              /* pin module optional during tests */
            }
          }
          // Same-list or primary→secondary left source mid-drag; put it back.
          // secondary→primary already restored above (no-op if still home).
          restoreSourceButtonDOM(element, originalParent, originalNextSibling)
        }
      } else {
        // Cancel: restore original DOM order, snap overlay home, no commit
        restoreSourceButtonDOM(element, originalParent, originalNextSibling)
        const dest = resolveSettleDestination(element, capturedTabId, null, rect.width)
        if (dest) {
          const currentTx = overlay.style.transform
            ? parseFloat(overlay.style.transform.match(/translate3d\(([^,]+)/)?.[1] || '0')
            : 0
          const currentTy = overlay.style.transform
            ? parseFloat(overlay.style.transform.match(/translate3d\([^,]+,\s*([^,]+)/)?.[1] || '0')
            : 0
          await animateOverlaySettle(overlay, currentTx, currentTy, dest.left, dest.top)
        }
      }
    } finally {
      // Drop spacer only after commit has (or has not) filled the slot —
      // never before, or siblings collapse for a frame under the overlay.
      removeDropSlotSpacer(slotSpacer)
      cancelOverlaySettle(overlay)
      cleanupDragVisuals()
    }
  }

  _drag = {
    phase: 'dragging',
    tabId,
    element,
    fromSecondary,
    overlay,
    overlayInner,
    offsetX,
    offsetY,
    overlayTx: rect.left,
    overlayTy: rect.top,
    overlayWidth: rect.width,
    overlayHeight: rect.height,
    originalParent,
    originalNextSibling,
    sourceIsInCanvasList,
    lastDropTarget: null,
    moveHandler: onMove,
    upHandler: onUp,
  }

  document.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerup', onUp)
  document.addEventListener('pointercancel', onUp)
}

/**
 * Remove pointer listeners + rAF/geometry/body cursor while phase may still
 * be `dragging`. Does **not** clear overlay/element or force idle — used
 * before transitioning to `settling` so a second pointerup cannot re-enter
 * onUp mid-await.
 */
function detachDragPointerListeners(): void {
  if (_drag.phase === 'dragging') {
    document.removeEventListener('pointermove', _drag.moveHandler)
    document.removeEventListener('pointerup', _drag.upHandler)
    document.removeEventListener('pointercancel', _drag.upHandler)
  }
  document.body.style.userSelect = ''
  document.body.style.cursor = ''

  if (_rafId !== null) {
    cancelAnimationFrame(_rafId)
    _rafId = null
  }

  _geometryCache = null
  _geomDirty = false
}

/** Full abort reset: detach listeners then force idle (after visuals cleaned). */
function clearDragState(): void {
  detachDragPointerListeners()
  _drag = { phase: 'idle' }
}

function cleanupDragVisuals(): void {
  // Clear FLIP styles from all buttons
  clearFLIPStyles()

  // Handoff: reveal the real tab under the floating clone *before* removing
  // the overlay. Strip buttons use `transition: all 0.2s ease`, so dropping
  // opacity:0 placeholder without suppressing transition fades 0→1 (looks
  // like disappear-then-fade-in if the overlay is already gone).
  if (_drag.phase === 'dragging' || _drag.phase === 'settling') {
    const el = _drag.element
    el.style.setProperty('transition', 'none', 'important')
    el.classList.remove('canvas-tab-list-dnd-placeholder')
    // Commit the un-hidden, non-transitioning style before overlay removal.
    void el.offsetWidth
    // Restore normal transitions on the next frame (hover color, labels, …).
    requestAnimationFrame(() => {
      el.style.removeProperty('transition')
    })
  }

  // Remove overlay only after the real slot is fully painted (same-list) or
  // commit has already replaced a cross-list spacer. Force one layout so the
  // browser does not composite "overlay gone + still-empty gap" for a frame.
  if (_drag.phase === 'dragging' || _drag.phase === 'settling') {
    const overlay = _drag.overlay
    void document.body.offsetWidth
    overlay.remove()
  }

  // Clear insert indicator
  clearInsertIndicator()

  // Re-enable strip pointer events / host :hover
  if (typeof document !== 'undefined') {
    document.body.classList.remove('canvas-tab-list-dnd-dragging')
  }

  // Reset drag state to idle
  _drag = { phase: 'idle' }
}

/**
 * Build a draft from live state, apply the user's drop action, and commit.
 *
 * Live drawer hit-test indices are among *visible* tabs only. Hidden tabs
 * still live in primaryIds/secondaryIds, so we use reorderWithinVisible /
 * moveTabVisible rather than full-list reorderWithin/moveTab.
 *
 * Returns true when the commit succeeded (or the drop was a no-op with a
 * clean draft). False means caller should restore mid-drag DOM.
 */
async function performDrop(
  tabId: string,
  fromSecondary: boolean,
  target: {
    container: HTMLElement
    index: number
    secondary: boolean
  },
): Promise<boolean> {
  try {
    const { draft, base } = buildDraftAndBase()

    if (fromSecondary !== target.secondary) {
      // ── Cross-drawer move ──
      const targetSide = target.secondary ? 'secondary' : 'primary'
      const updated = moveTabVisible(
        draft,
        tabId,
        targetSide,
        target.index,
      )
      const result = await commitConfigureDraft(updated, base)
      if (!result.ok) {
        dwarn(
          '[tab-list-dnd] cross-drawer commit failed:',
          result.error,
        )
        return false
      }
      // Keep an open Configure modal in sync with the live strip order.
      const m = await import('./configure-modal')
      m.refreshConfigureDraftFromLive()
      return true
    }

    // ── Within-drawer reorder ──
    const listKey = target.secondary ? 'secondaryIds' : 'primaryIds'
    const fullList = draft[listKey]
    if (!fullList.includes(tabId)) {
      dwarn(
        '[tab-list-dnd] tab not found in draft for reorder:',
        tabId,
      )
      return false
    }

    // target.index is the post-removal visible insert index.
    // Mid-drag DOM may already match the drop — then reorderWithinVisible
    // is a no-op. Still commit when the live-aligned draft is dirty vs
    // host base so the first drop syncs host tabOrder without reshuffling.
    const updated = reorderWithinVisible(
      draft,
      listKey,
      tabId,
      target.index,
    )
    if (updated === draft && !isDraftDirty(draft, base)) {
      return true
    }
    const result = await commitConfigureDraft(updated, base)
    if (!result.ok) {
      dwarn(
        '[tab-list-dnd] reorder commit failed:',
        result.error,
      )
      return false
    }
    // Keep an open Configure modal in sync with the live strip order.
    const m = await import('./configure-modal')
    m.refreshConfigureDraftFromLive()
    return true
  } catch (err) {
    dwarn('[tab-list-dnd] drop failed:', err)
    return false
  }
}

// ── Drag-arming installation ──

function installDragOnButton(btn: HTMLElement): void {
  if (_installed.has(btn)) return

  // Skip buttons without a tab id
  const tabId = getButtonTabId(btn)
  if (!tabId) return

  // Settings is host chrome (gear only) — never live-reorder or move.
  // Matches main-mirror click/contextmenu policy (isSettingsButton).
  if (isSettingsButton(btn)) return

  _installed.add(btn)

  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let dragActivated = false
  let armingCancelled = false

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

  const cancelArming = () => {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    cleanupPendingListeners()
  }

  const onPointerDown = (e: PointerEvent) => {
    // Feature off / torn down — handlers may remain on buttons (WeakSet);
    // only start a drag while the module is active.
    if (!_active) return
    // Mobile: live strip DnD is a no-op — use Configure Tabs instead.
    if (!isLiveTabListDndAllowed()) return
    // Only respond to left button
    if (e.button !== 0) return
    // Do not activate if already dragging
    if (_drag.phase !== 'idle') return

    dragActivated = false
    armingCancelled = false

    const startX = e.clientX
    const startY = e.clientY
    // Touch/pen: long-press. Mouse (and empty/unknown desktop): distance.
    const longPress = usesLongPressActivation(e.pointerType)

    if (longPress) {
      longPressTimer = setTimeout(() => {
        longPressTimer = null
        cleanupPendingListeners()
        if (armingCancelled) return
        // Re-check mobile at fire time (viewport may have crossed while held).
        if (!isLiveTabListDndAllowed()) return
        dragActivated = true
        // Finger still near down-point (movement would have cancelled).
        startDrag(btn, e)
      }, LONG_PRESS_MS)
    }

    // Document-level move: distance-activate (mouse) or cancel long-press
    // (touch). Document-level so leaving the button still counts.
    const onMove = (ev: PointerEvent) => {
      if (dragActivated) return // Drag mode handles move itself
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY

      if (longPress) {
        // Scroll / tap jitter: cancel long-press past threshold.
        if (shouldActivateDragFromDistance(dx, dy)) {
          armingCancelled = true
          cancelArming()
        }
        return
      }

      // Mouse path: arm until distance crossed, then lift with *move* event
      // so grab offset matches current pointer (Configure Tabs pattern).
      if (!shouldActivateDragFromDistance(dx, dy)) return
      dragActivated = true
      cleanupPendingListeners()
      if (!isLiveTabListDndAllowed()) return
      startDrag(btn, ev)
    }

    // Cancel arming on up / cancel (click or touch end without lift)
    const onUp = () => {
      cancelArming()
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
 * Returns a teardown when newly activated; `null` if already active.
 */
export function installTabListDnd(): (() => void) | null {
  if (_active) return null
  _active = true

  injectDndStyles()

  // Install on existing buttons
  const existing = document.querySelectorAll<HTMLElement>(
    'button[data-tab-id], .sidebar-ux-main-tab-mirror-btn',
  )
  for (const btn of existing) {
    installDragOnButton(btn)
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
          installDragOnButton(node)
        }
        // Check descendants
        const descendants = node.querySelectorAll<HTMLElement>(
          'button[data-tab-id], .sidebar-ux-main-tab-mirror-btn',
        )
        for (const child of descendants) {
          installDragOnButton(child)
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
 * Tear down tab-list DnD (disconnect observer, clear in-flight drag, styles).
 * Button listeners stay (WeakSet) but no-op while `_active` is false;
 * re-install reactivates them and attaches any buttons added while off.
 */
export function tearDownTabListDnd(): void {
  _active = false
  if (_observer) {
    _observer.disconnect()
    _observer = null
  }
  if (_drag.phase !== 'idle') {
    removeClickSuppressorNow()
    // Cancel any pending rAF / settle
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId)
      _rafId = null
    }
    if (_drag.phase === 'dragging' || _drag.phase === 'settling') {
      cancelOverlaySettle(_drag.overlay)
    }
    if (_drag.phase === 'dragging') {
      restoreSourceButtonDOM(_drag.element, _drag.originalParent, _drag.originalNextSibling)
    }
    cleanupDragVisuals()
    clearDragState()
  }
  if (typeof document !== 'undefined') {
    document.body.classList.remove('canvas-tab-list-dnd-dragging')
    document.getElementById(DND_STYLE_ID)?.remove()
  }
}
