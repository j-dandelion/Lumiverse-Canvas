// Drag-and-drop tab reorder on live drawer tabs.
//
// Long-press (~300ms) on any tab button lifts it into a floating overlay
// clone. While dragging, hit-test finds the drop target (within or across
// drawers). On pointerup, builds a ConfigureDraft from current state,
// applies the reorder/move, and commits via the configure pipeline
// (commitConfigureDraft) — same backend as the Configure Tabs modal.
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
import { isSettingsButton } from './buttons'
import { getMainSidebar } from '../dom/lumiverse'
import { dwarn } from '../debug/log'

// ── Module-level drag state ──

let _isDragging = false
let _dragTabId: string | null = null
/** The source button element (dimmed during drag). */
let _dragElement: HTMLElement | null = null
/** Whether the source is from the secondary drawer. */
let _dragFromSecondary = false
/** Floating clone that follows the pointer (wrapper div, not the button clone). */
let _dragOverlay: HTMLElement | null = null
/** The button clone inside the overlay wrapper. */
let _dragOverlayInner: HTMLElement | null = null
let _dragOffsetX = 0
let _dragOffsetY = 0
let _lastDropTarget: { container: HTMLElement; index: number; secondary: boolean } | null = null
/** Insert indicator element (insert-before-highlight). */
let _insertIndicatorEl: HTMLElement | null = null

let _moveHandler: ((e: PointerEvent) => void) | null = null
let _upHandler: ((e: PointerEvent) => void) | null = null

/**
 * Capture-phase click suppressors — kill the browser's synthetic click after
 * pointerup so the tab does not activate / toggle-close.
 *
 * Important: removal is deferred until AFTER pointerup (setTimeout 0), not at
 * install time. An early setTimeout(0) at drag start removed the listener
 * before the user ever released — regression: every drop activated the tab.
 */
let _clickSuppressor: ((e: Event) => void) | null = null
let _clickSuppressorEl: HTMLElement | null = null
let _docClickSuppressor: ((e: Event) => void) | null = null
let _clickSuppressorTimer: ReturnType<typeof setTimeout> | null = null

// ── rAF-coalesced drag-frame state ──

let _rafId: number | null = null
let _pendingPointerX = 0
let _pendingPointerY = 0
let _overlayTx = 0
let _overlayTy = 0
/** Floating clone size at lift (for tab-center hit-test without layout thrash). */
let _overlayWidth = 0
let _overlayHeight = 0
/** Source button's original DOM position for cancel-restore. */
let _originalParent: HTMLElement | null = null
let _originalNextSibling: HTMLElement | null = null
/** True when the source button is in a Canvas-owned list (mid-drag reorder eligible). */
let _sourceIsInCanvasList = false

// ── Geometry cache (rebuilt each rAF, invalidated on DOM reorder) ──

interface ContainerCache {
  containers: { el: HTMLElement; secondary: boolean }[]
}
let _geometryCache: ContainerCache | null = null
/** True after a DOM reorder — next rAF must rebuild cache. */
let _geomDirty = false

// ── Long-press state per button ──

/** Buttons that already have long-press handlers installed. */
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
      opacity: 1;
      will-change: transform;
      cursor: grabbing;
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

    /* ── Source button while being dragged — same dim as .row-dragging ── */
    .canvas-tab-list-dnd-placeholder {
      opacity: 0.35 !important;
    }

    /* ── Drop-insert indicator: a subtle primary underline at the top of the
         target button where the tab will be inserted. ── */
    .canvas-tab-list-dnd-insert-before {
      box-shadow: inset 0 2px 0 0 var(--lumiverse-primary, #4a9eff) !important;
    }

    /* ── FLIP animation on Canvas-owned list buttons during mid-drag reorder ── */
    .canvas-tab-list-dnd-flipping {
      transition: transform 200ms cubic-bezier(0.25, 1, 0.5, 1) !important;
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

/**
 * data-tab-id order of displayed (not display:none) tab buttons in a list.
 * Skips Settings chrome.
 */
function readVisibleTabIdsFromList(list: HTMLElement | null): string[] {
  if (!list) return []
  const out: string[] = []
  for (const el of Array.from(
    list.querySelectorAll('button[data-tab-id]'),
  ) as HTMLElement[]) {
    if (isSettingsButton(el)) continue
    // Hidden tabs keep display:none via applyHiddenTabIds*; omit so
    // alignIdsToLiveVisibleOrder can park them via hiddenIds slots.
    if (el.style?.display === 'none') continue
    const id = el.getAttribute('data-tab-id') || ''
    if (id) out.push(id)
  }
  return out
}

/** Live primary strip: main-mirror main section (taskbar DnD) or host tabList. */
function readLivePrimaryTabIds(): string[] {
  const mirrorMain = document.querySelector(
    '.sidebar-ux-main-tab-list-mirror .sidebar-ux-tab-list-main',
  ) as HTMLElement | null
  if (mirrorMain) return readVisibleTabIdsFromList(mirrorMain)

  const sidebar = getMainSidebar()
  if (!sidebar) return []
  const tabList =
    (sidebar.querySelector(
      '[class*="tabListWrap"] > [class*="tabList"]',
    ) as HTMLElement | null) ||
    (sidebar.querySelector('[class*="tabList"]') as HTMLElement | null)
  return readVisibleTabIdsFromList(tabList)
}

function readLiveSecondaryTabIds(): string[] {
  return readVisibleTabIdsFromList(getSecondaryTabList())
}

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
 * True when the floating tab overlaps a drop container (with a small
 * vertical pad so empty/near-edge lists still accept the tab).
 */
export function overlayOverlapsContainer(
  overlay: { left: number; top: number; right: number; bottom: number },
  container: { left: number; top: number; right: number; bottom: number },
  padY = 8,
): boolean {
  const overlapsX = overlay.right > container.left && overlay.left < container.right
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
      _dragTabId,
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
): boolean {
  if (!sourceTabId) return false
  if (!isReorderableContainer(container)) return false

  // Prefer the live drag element so cross-list moves work even when the
  // source is not yet a child of the target container.
  const sourceBtn =
    _dragElement && _dragElement.getAttribute('data-tab-id') === sourceTabId
      ? _dragElement
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
function restoreSourceButtonDOM(): void {
  if (!_dragElement || !_originalParent) return

  // If the source is already in its original parent at the right position, skip
  const parent = _dragElement.parentNode
  if (parent === _originalParent) {
    if (_originalNextSibling) {
      if (_dragElement.nextElementSibling === _originalNextSibling) return
      _originalParent.insertBefore(_dragElement, _originalNextSibling)
    } else {
      // Was last child
      if (_dragElement.nextElementSibling === null &&
          _dragElement.parentNode === _originalParent) return
      _originalParent.insertBefore(_dragElement, null)
    }
  } else {
    // Moved to a different container — move back
    if (_originalNextSibling && _originalNextSibling.parentNode === _originalParent) {
      _originalParent.insertBefore(_dragElement, _originalNextSibling)
    } else {
      // Original next sibling may have been removed; append instead
      _originalParent.appendChild(_dragElement)
    }
  }
}

// ── Drag implementation ──

function createDragOverlay(sourceBtn: HTMLElement): HTMLElement {
  // Create wrapper div with overlay chrome
  const wrapper = document.createElement('div')
  wrapper.className = 'canvas-tab-list-dnd-overlay-clone'

  // Clone the source button preserving all original classes
  const clone = sourceBtn.cloneNode(true) as HTMLElement
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

  _dragOverlayInner = clone
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

    if (!_isDragging) return

    // Rebuild geometry cache if dirty (after reorder) or on first use
    if (_geomDirty || !_geometryCache) {
      _geometryCache = { containers: getDropContainers() }
      _geomDirty = false
    }

    // Hit-test from floating tab geometry (center + bounds), not raw pointer.
    // Overlay may lag one pointermove if only rAF runs; use latest _overlayTx/Ty
    // which onMove updates synchronously before scheduleDragFrame.
    const geom = dragHitGeometry(
      _overlayTx,
      _overlayTy,
      _overlayWidth || 48,
      _overlayHeight || 48,
    )
    const target = hitTestDropTarget(geom)

    const prev = _lastDropTarget
    const sameTarget = prev && target &&
      prev.container === target.container &&
      prev.index === target.index &&
      prev.secondary === target.secondary

    if (!target) {
      // Remove indicator but keep _lastDropTarget if we were over a valid target
      // (so adding/removing indicator is a no-op when we briefly leave)
      if (prev) {
        clearInsertIndicator()
        _lastDropTarget = null
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

      if (isReorderable && _sourceIsInCanvasList) {
        // Snapshot source parent + target (and prev target) so siblings on
        // both lists animate when crossing secondary ↔ mirror / main ↔ bottom.
        const prevRects = new Map<string, DOMRect>()
        const flipContainers: HTMLElement[] = []
        const sourceParent = _dragElement?.parentElement
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
          _dragTabId,
        )

        if (didReorder) {
          applyFLIP(prevRects, _dragTabId, flipContainers)
          _geomDirty = true
        }
      } else if (prevReorderable && !isReorderable && prev) {
        // Leaving a reorderable surface — restore source DOM
        restoreSourceButtonDOM()
        clearFLIPStyles()
        _geomDirty = true
      }

      _lastDropTarget = target
      setInsertIndicator(target)
    }
  })
}

function startDrag(btn: HTMLElement, pointerEvent: PointerEvent): void {
  const tabId = getButtonTabId(btn)
  if (!tabId) return

  // Determine source side
  _dragFromSecondary = isSecondaryButton(btn)
  _dragTabId = tabId
  _dragElement = btn
  _isDragging = true

  // Save original DOM position for cancel-restore
  _originalParent = btn.parentElement
  _originalNextSibling = btn.nextElementSibling as HTMLElement | null
  // Mirror section or secondary list — gates mid-drag DOM reorder.
  _sourceIsInCanvasList = getReorderParent(btn) != null

  // Calculate overlay offset from pointer
  const rect = btn.getBoundingClientRect()
  _dragOffsetX = pointerEvent.clientX - rect.left
  _dragOffsetY = pointerEvent.clientY - rect.top

  // Initialize overlay transform (matches the initial translate3d in createDragOverlay)
  _overlayTx = rect.left
  _overlayTy = rect.top
  _overlayWidth = rect.width
  _overlayHeight = rect.height

  // Dim the source
  btn.classList.add('canvas-tab-list-dnd-placeholder')

  // Create overlay
  _dragOverlay = createDragOverlay(btn)

  // Initialize geometry cache
  _geometryCache = { containers: getDropContainers() }
  _geomDirty = false

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

  // Suppress post-drag synthetic click (source + document capture).
  // Stay installed until pointerup schedules deferred removal — NOT a
  // setTimeout at install time (that cleared the listener mid-drag).
  installClickSuppressor(btn)

  // Pointer move — updates overlay transform IMMEDIATELY (cheap compositor work)
  // and defers hit-test/reorder to rAF.
  const onMove = (ev: PointerEvent) => {
    if (!_dragOverlay) return

    // Update overlay position via translate3d immediately (no layout thrash)
    _overlayTx = ev.clientX - _dragOffsetX
    _overlayTy = ev.clientY - _dragOffsetY
    _dragOverlay.style.transform = `translate3d(${_overlayTx}px, ${_overlayTy}px, 0)`

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
    const capturedTabId = _dragTabId
    const capturedFromSecondary = _dragFromSecondary
    const capturedTarget = _lastDropTarget

    document.removeEventListener('contextmenu', suppressCtx, true)

    // Keep click suppressors through this task so the browser's
    // compatibility click (after pointerup returns / at await yield)
    // is still blocked; remove on next macrotask.
    scheduleClickSuppressorRemoval()

    // Cancel any pending rAF
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId)
      _rafId = null
    }

    clearDragState()

    if (capturedTarget && capturedTabId) {
      // Same-list: keep mid-drag DOM through successful commit so primary/
      // mirror do not flash pre-drag order (commit re-applies draft order).
      // Cross-list: mid-drag parks the wrong node type (mirror btn in
      // secondary, or secondary btn in mirror). Restore first so
      // addSecondaryTabButton / removeSecondary see clean lists; commit
      // owns create/remove/reorder.
      const crossList = capturedFromSecondary !== capturedTarget.secondary
      if (crossList) {
        restoreSourceButtonDOM()
      }
      const ok = await performDrop(
        capturedTabId,
        capturedFromSecondary,
        capturedTarget,
      )
      if (!ok && !crossList) {
        restoreSourceButtonDOM()
      }
    } else {
      // Cancel: restore original DOM order, no commit
      restoreSourceButtonDOM()
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

  // Clean up rAF
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId)
    _rafId = null
  }

  // Clear geometry cache
  _geometryCache = null
  _geomDirty = false
}

function cleanupDragVisuals(): void {
  // Clear FLIP styles from all buttons
  clearFLIPStyles()

  // Remove overlay
  if (_dragOverlay) {
    _dragOverlay.remove()
    _dragOverlay = null
  }
  _dragOverlayInner = null
  _overlayWidth = 0
  _overlayHeight = 0
  _overlayTx = 0
  _overlayTy = 0

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
  _originalParent = null
  _originalNextSibling = null
  _sourceIsInCanvasList = false
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
    return true
  } catch (err) {
    dwarn('[tab-list-dnd] drop failed:', err)
    return false
  }
}

// ── Long-press installation ──

function installLongPressOnButton(btn: HTMLElement): void {
  if (_installed.has(btn)) return

  // Skip buttons without a tab id
  const tabId = getButtonTabId(btn)
  if (!tabId) return

  // Settings is host chrome (gear only) — never live-reorder or move.
  // Matches main-mirror click/contextmenu policy (isSettingsButton).
  if (isSettingsButton(btn)) return

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
    // Feature off / torn down — handlers may remain on buttons (WeakSet);
    // only start a drag while the module is active.
    if (!_active) return
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
  if (_isDragging) {
    removeClickSuppressorNow()
    // Cancel any pending rAF
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId)
      _rafId = null
    }
    restoreSourceButtonDOM()
    cleanupDragVisuals()
    clearDragState()
  }
  if (typeof document !== 'undefined') {
    document.getElementById(DND_STYLE_ID)?.remove()
  }
}
