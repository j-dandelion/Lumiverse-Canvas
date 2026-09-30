/** @jsxImportSource preact */
// Configure Tabs modal — Preact-based UI for reordering and hiding drawer tabs.
//
// Renders as a fixed overlay with a two-column layout. Left/right column
// mapping depends on the main drawer side (leftColumnIsSecondary). Edits
// auto-commit immediately (toggle hide, swap side, drag-end). Cancel closes
// without rollback. Done closes when clean (or flushes residual dirty first).
//
// Styled to match host Lumiverse ConfigureDrawerTabsModal within the
// structural deltas of dual-drawer columns + draft footer.

import { h, render } from 'preact'
import { useEffect, useCallback, useRef } from 'preact/hooks'
import {
  alignDraftToLiveVisibleOrder,
  baseSnapshotFromDraft,
  createDraft,
  encodeHostTabOrder,
  isDraftDirty,
  rebaseBaseIfEpochUnchanged,
  swapDrawerSide,
  moveTab,
  reorderWithin,
  setHidden,
  partitionDisplayLists,
  leftColumnIsSecondary,
  type ConfigureDraft,
  type BaseSnapshot,
  type DrawerSide,
} from './configure-model'
import { getFullCatalog, filterCatalogToLive, type CatalogTab } from './configure-catalog'
import { BUILTIN_ICON_SVGS } from './builtin-icons'
import {
  getCanvasHiddenTabIds,
  mergeHiddenTabIdLists,
} from './canvas-hidden'
import { resolveHiddenTabIdsForDraft } from './hidden-tabs'
import { getHostDrawerSettings } from '../dom/host-settings'
import { getMainDrawerSide } from '../store'
import { getLiveIdAssignments } from './assignment'
import type { OwnedCommitResult as CommitResult } from './owned-commit'
import { commitDraftToOwnedModel } from './owned-commit'
import { getHost, getModel } from '../recon/dispatch'
import type { TabKey } from '../core/model'
import {
  readLivePrimaryTabIds,
  readLiveSecondaryTabIds,
} from './live-tab-order'
import { getSettings, setSettings } from '../settings/state'
import { dlog, dwarn } from '../debug/log'

// ── Module state (SoT: legacy refs — machine extraction is parked / unused) ──
// (A machine-based configure-modal draft was explored and retired — see git history.)

let _modalContainer: HTMLElement | null = null
let _openInProgress = false
let _draftRef: ConfigureDraft | null = null
let _baseSnapshotRef: BaseSnapshot | null = null
/**
 * Bumped whenever open/refresh installs a new live draft+base. Successful
 * auto-commits only rebase base when the epoch is unchanged — so a mid-flight
 * refreshConfigureDraftFromLive cannot be stomped by a stale commit.
 */
let _baseEpoch = 0

// ── Drag state (module-level, no re-render during drag) ──
let _dragTabId: string | null = null
let _dragFromSide: 'primary' | 'secondary' | null = null
let _dragActive = false
let _dragOverlay: HTMLElement | null = null
let _dragOffsetX = 0
let _dragOffsetY = 0
let _dragStartX = 0
let _dragStartY = 0
let _lastDropTarget: { side: 'primary' | 'secondary'; index: number } | null = null
let _flipRects: Map<string, DOMRect> | null = null
let _dragMoveHandler: ((e: PointerEvent) => void) | null = null
let _dragUpHandler: ((e: PointerEvent) => void) | null = null
/** In-flight drop-settle timeout (transitionend fallback). */
let _settleTimer: ReturnType<typeof setTimeout> | null = null
/** True while overlay eases into its drop slot after pointerup. */
let _settling = false
let _commitPromise: Promise<CommitResult> | null = null
/** Draft clone at pointerdown — Esc mid-drag restores this (not mid-settle). */
let _dragDraftSnapshot: ConfigureDraft | null = null
/** Latest pointer coords during drag — auto-scroll frames hit-test with these. */
let _lastPointerX = 0
let _lastPointerY = 0
/** Drag auto-scroll: scrollable container under the pointer + scroll dir. */
let _autoScrollContainer: HTMLElement | null = null
let _autoScrollDir = 0
let _autoScrollRaf: number | null = null

/** Drop-settle duration — keep in sync with CSS on .overlay-settling + live DnD. */
const SETTLE_DURATION_MS = 140
/** Skip settle when already within this many CSS pixels of dest. */
const SETTLE_MIN_DISTANCE_PX = 2
/** Auto-scroll: pointer must be within this many px of a container edge. */
const AUTOSCROLL_EDGE_PX = 56
/** Auto-scroll: max px scrolled per rAF frame (scales with edge depth). */
const AUTOSCROLL_SPEED_PX = 14

// ── Style injection (force-refresh on each modal open) ──

const MODAL_STYLE_ID = 'canvas-configure-tabs-styles'

function injectModalStyles(): void {
  if (typeof document === 'undefined') return
  // Remove old style node to force refresh on redeploy
  const existing = document.getElementById(MODAL_STYLE_ID)
  if (existing) existing.remove()

  const style = document.createElement('style')
  style.id = MODAL_STYLE_ID
  style.textContent = `
    /* ── Overlay (host ModalShell backdrop) ── */
    .canvas-configure-tabs-overlay {
      position: fixed;
      inset: 0;
      bottom: calc(0px - var(--ios-viewport-offset, 0px));
      z-index: 12000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      width: var(--app-scaled-viewport-width, calc(100vw / var(--lumiverse-ui-scale, 1)));
      height: var(--app-scaled-viewport-height, calc(100vh / var(--lumiverse-ui-scale, 1)));
      background: var(--lumiverse-modal-backdrop, rgba(0, 0, 0, 0.6));
      animation: canvasConfigureFadeIn 150ms ease-out;
    }
    [data-glass] .canvas-configure-tabs-overlay {
      backdrop-filter: blur(var(--lcs-glass-soft-blur, 6px));
    }
    @keyframes canvasConfigureFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ── Dialog (host ModalShell.modal) ── */
    .canvas-configure-tabs-dialog {
      position: relative;
      display: flex;
      flex-direction: column;
      width: min(720px, calc(100vw - 32px));
      max-height: 85vh;
      background: var(--lumiverse-gradient-modal, var(--lumiverse-bg, #1a1a2e));
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: var(--lumiverse-radius-xl, 16px);
      box-shadow: var(--lumiverse-shadow-md, 0 8px 24px rgba(0, 0, 0, 0.4)),
        0 0 40px var(--lumiverse-primary-020, rgba(74, 158, 255, 0.12));
      color: var(--lumiverse-text, #eee);
      font-family: var(--lumiverse-font-family, sans-serif);
      animation: canvasConfigureDialogEnter 200ms cubic-bezier(0.4, 0, 0.2, 1) both;
      overflow: hidden;
    }
    [data-glass] .canvas-configure-tabs-dialog {
      box-shadow: var(--lumiverse-shadow-xl, 0 20px 60px rgba(0, 0, 0, 0.5));
    }
    @keyframes canvasConfigureDialogEnter {
      from { opacity: 0; transform: scale(0.95) translateY(10px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    /* ── Close X (absolute, host CloseButton style) ── */
    .canvas-configure-tabs-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--lumiverse-text-muted, #888);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .canvas-configure-tabs-close:hover {
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
      color: var(--lumiverse-text, #eee);
    }
    .canvas-configure-tabs-close svg {
      width: 16px;
      height: 16px;
    }

    /* ── Header (host .header: column layout) ── */
    .canvas-configure-tabs-header {
      display: flex;
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
      padding: 16px 20px 12px 20px;
      border-bottom: 1px solid var(--lumiverse-border, #333);
      flex-shrink: 0;
    }
    .canvas-configure-tabs-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
    }
    .canvas-configure-tabs-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .canvas-configure-tabs-header h2 {
      margin: 0;
      font-size: calc(16px * var(--lumiverse-font-scale, 1));
      font-weight: 700;
      color: var(--lumiverse-text, #eee);
      letter-spacing: -0.01em;
    }
    .canvas-configure-tabs-subtitle {
      margin: 4px 0 0;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.45;
      color: var(--lumiverse-text-dim, #888);
    }
    .canvas-configure-tabs-swap-btn {
      flex-shrink: 0;
      padding: 5px 12px;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 6px;
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
      color: var(--lumiverse-text, #eee);
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .canvas-configure-tabs-swap-btn:hover {
      background: var(--lumiverse-fill-strong, rgba(255,255,255,0.12));
    }

    /* ── Second-drawer enable toggle (compact label + switch) ── */
    .canvas-configure-tabs-second-drawer-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .canvas-configure-tabs-second-drawer-toggle-label {
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-dim, #888);
      white-space: nowrap;
      user-select: none;
      cursor: pointer;
    }
    .canvas-configure-tabs-second-drawer-toggle-label:hover {
      color: var(--lumiverse-text, #eee);
    }

    /* ── Body (host .body: flex column with gap, overflow-y auto) ── */
    .canvas-configure-tabs-body {
      display: flex;
      flex-direction: row;
      gap: 7px;
      flex: 1 1 auto;
      min-height: 0;
      padding: 12px 20px 20px;
      max-height: min(70vh, 760px);
      overflow-y: auto;
    }

    /* ── Column = one host .section ── */
    .canvas-configure-tabs-column {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      width: 50%;
    }

    /* ── Section header (host .sectionHeader: column gap 4px) ── */
    .canvas-configure-tabs-section-header {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .canvas-configure-tabs-section-title {
      margin: 0;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--lumiverse-text-secondary, #aaa);
    }
    .canvas-configure-tabs-section-desc {
      margin: 0;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.45;
      color: var(--lumiverse-text-dim, #888);
    }

    /* ── Tab list (host .list: gap 8px, no extra padding) ── */
    .canvas-configure-tabs-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      /* Keep cards clear of the scrollbar track (not underlay). */
      scrollbar-gutter: stable;
      padding-right: 10px;
    }

    /* ── Drag overlay clone (follows pointer) ── */
    .canvas-configure-tabs-overlay-clone {
      position: fixed;
      z-index: 13000;
      pointer-events: none;
      margin: 0;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 14px;
      background: color-mix(in srgb, var(--lumiverse-primary, #4a9eff) 8%, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)));
      box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.45),
        0 0 0 1px var(--lumiverse-primary-040, var(--lumiverse-primary, #4a9eff));
      color: var(--lumiverse-text, #eee);
      font-family: var(--lumiverse-font-family, sans-serif);
      opacity: 1;
      will-change: left, top;
      cursor: grabbing;
    }
    /* Drop settle: floating clone eases into its destination row slot (matches live tab-list DnD). */
    .canvas-configure-tabs-overlay-clone.canvas-configure-tabs-overlay-settling {
      transition:
        left ${SETTLE_DURATION_MS}ms cubic-bezier(0.25, 1, 0.5, 1),
        top ${SETTLE_DURATION_MS}ms cubic-bezier(0.25, 1, 0.5, 1),
        box-shadow ${SETTLE_DURATION_MS}ms ease,
        opacity ${SETTLE_DURATION_MS}ms ease !important;
      box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.35);
      cursor: default;
    }

    /* ── Row card (host .row) ── */
    /* Non-core (hideable) tabs use host hover surface; core keeps .row-locked tint. */
    .canvas-configure-tabs-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 14px;
      background: var(--lumiverse-bg-hover, var(--lumiverse-bg, #1a1a2e));
      touch-action: manipulation;
      user-select: none;
    }
    .canvas-configure-tabs-row.row-locked {
      background: color-mix(in srgb, var(--lumiverse-primary, #4a9eff) 6%, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)));
    }
    /* Hidden (disabled) tabs: no card fill — blend into the dialog so the
       row reads as absent; dimming keeps the disabled cue. Core rows are
       never hidden, so .row-locked keeps its tinted background. */
    .canvas-configure-tabs-row.row-hidden {
      background: transparent;
      opacity: 0.6;
    }
    /* Invisible slot holder while the floating clone is the visible row
       (matches live tab-list DnD placeholder). Overlay uses its own className
       so cloneNode + class replace never inherits opacity:0. */
    .canvas-configure-tabs-row.row-dragging {
      opacity: 0 !important;
    }

    /* ── Drag handle (host GripVertical style) ── */
    .canvas-configure-tabs-drag-handle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 22px;
      height: 28px;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--lumiverse-text-dim, #888);
      border-radius: 6px;
      cursor: grab;
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
    }
    .canvas-configure-tabs-drag-handle:hover {
      color: var(--lumiverse-text, #eee);
      background: var(--lumiverse-primary-015, rgba(74, 158, 255, 0.15));
    }
    .canvas-configure-tabs-drag-handle:active {
      cursor: grabbing;
    }
    .canvas-configure-tabs-drag-handle svg {
      width: 16px;
      height: 16px;
    }

    /* ── Icon wrap (host .iconWrap) ── */
    .canvas-configure-tabs-icon-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      flex-shrink: 0;
      border-radius: 8px;
      background: var(--lumiverse-primary-015, rgba(74, 158, 255, 0.15));
      color: var(--lumiverse-primary, #4a9eff);
      overflow: hidden;
    }
    .canvas-configure-tabs-icon-wrap svg {
      width: 16px;
      height: 16px;
    }
    .canvas-configure-tabs-icon-wrap img {
      width: 16px;
      height: 16px;
      object-fit: contain;
    }

    /* ── Row info (host .rowInfo: icon + copy) ── */
    .canvas-configure-tabs-row-info {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
      flex: 1 1 auto;
    }

    /* ── Copy block ── */
    .canvas-configure-tabs-copy {
      min-width: 0;
    }
    .canvas-configure-tabs-row-title-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .canvas-configure-tabs-row-title {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      color: var(--lumiverse-text, #eee);
    }
    .canvas-configure-tabs-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--lumiverse-primary-015, rgba(74, 158, 255, 0.15));
      color: var(--lumiverse-primary, #4a9eff);
      font-size: calc(10px * var(--lumiverse-font-scale, 1));
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .canvas-configure-tabs-badge-muted {
      background: color-mix(in srgb, var(--lumiverse-text-dim, #888) 18%, transparent);
      color: var(--lumiverse-text-secondary, #aaa);
    }
    .canvas-configure-tabs-row-description {
      margin: 2px 0 0;
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      line-height: 1.45;
      color: var(--lumiverse-text-dim, #888);
    }

    /* ── Toggle switch (unified Canvas switch spec — shared with the
       settings panel: 36×20 border-box track, 14px knob inset 2px, 16px
       travel; knob colors off = text, on = primary-contrast) ── */
    .canvas-configure-tabs-toggle {
      position: relative;
      flex-shrink: 0;
      box-sizing: border-box;
      width: 36px;
      height: 20px;
      padding: 0;
      border: 1px solid var(--lumiverse-border, #555);
      border-radius: 999px;
      background: var(--lumiverse-fill-strong, rgba(0, 0, 0, 0.3));
      cursor: pointer;
      transition: background var(--lumiverse-transition-fast, 150ms ease),
        border-color var(--lumiverse-transition-fast, 150ms ease);
      touch-action: manipulation;
    }
    .canvas-configure-tabs-toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--lumiverse-text);
      transition: transform var(--lumiverse-transition-fast, 150ms ease),
        background var(--lumiverse-transition-fast, 150ms ease);
      transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .canvas-configure-tabs-toggle.toggle-on {
      background: var(--lumiverse-primary, #4a9eff);
      border-color: var(--lumiverse-primary, #4a9eff);
    }
    .canvas-configure-tabs-toggle.toggle-on::after {
      transform: translateX(16px);
      background: var(--lumiverse-primary-contrast, #fff);
    }
    .canvas-configure-tabs-toggle:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    @media (prefers-reduced-motion: reduce) {
      .canvas-configure-tabs-toggle,
      .canvas-configure-tabs-toggle::after { transition: none; }
    }

    /* ── Empty column hint ── */
    .canvas-configure-tabs-empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--lumiverse-text-muted, #666);
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
    }

    /* ── Footer ── */
    .canvas-configure-tabs-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 20px;
      border-top: 1px solid var(--lumiverse-border, #333);
      flex-shrink: 0;
    }
    .canvas-configure-tabs-footer-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .canvas-configure-tabs-footer-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* ── Body — single column (second drawer disabled) ── */
    .canvas-configure-tabs-body--single .canvas-configure-tabs-column {
      width: 100%;
    }
    .canvas-configure-tabs-btn {
      padding: 6px 16px;
      border-radius: 8px;
      border: 1px solid var(--lumiverse-border, #333);
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
      color: var(--lumiverse-text, #eee);
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-family: inherit;
      cursor: pointer;
    }
    .canvas-configure-tabs-btn:hover {
      background: var(--lumiverse-fill-strong, rgba(255,255,255,0.12));
    }
    .canvas-configure-tabs-btn-primary {
      background: var(--lumiverse-primary, #4a9eff);
      border-color: var(--lumiverse-primary, #4a9eff);
      color: white;
    }
    .canvas-configure-tabs-btn-primary:hover {
      opacity: 0.9;
    }
    .canvas-configure-tabs-btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .canvas-configure-tabs-error {
      padding: 6px 20px;
      color: var(--lumiverse-error, #e54545);
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      text-align: right;
    }

    /* ── Responsive: stack columns when narrow ── */
    @media (max-width: 720px) {
      .canvas-configure-tabs-body {
        flex-direction: column;
        /* Bigger gap between the stacked drawer columns. */
        gap: 24px;
        max-height: min(90vh, 800px);
      }
      .canvas-configure-tabs-column {
        width: 100%;
      }
    }
    @media (max-width: 640px) {
      .canvas-configure-tabs-dialog {
        width: min(100vw - 16px, 720px);
      }
      .canvas-configure-tabs-header-row {
        flex-wrap: wrap;
      }
      .canvas-configure-tabs-header {
        padding-left: 12px;
        padding-right: 12px;
        padding-top: 14px;
        padding-bottom: 10px;
      }
      .canvas-configure-tabs-body {
        padding-left: 12px;
        padding-right: 12px;
        padding-top: 12px;
        padding-bottom: 14px;
      }
      .canvas-configure-tabs-row {
        align-items: flex-start;
      }
      /* Footer wraps so Cancel/Done never clip on narrow screens. */
      .canvas-configure-tabs-footer {
        flex-wrap: wrap;
        row-gap: 8px;
        padding-left: 12px;
        padding-right: 12px;
      }
    }
    @media (max-width: 480px) {
      .canvas-configure-tabs-overlay {
        padding: 10px;
      }
    }
  `
  document.head.appendChild(style)
}

// ── Pointer DnD functions ──

type ColumnSide = 'primary' | 'secondary'

/** Stop pointer listeners without removing the overlay (for settle anim). */
function detachDragListeners(): void {
  if (_dragMoveHandler) {
    document.removeEventListener('pointermove', _dragMoveHandler)
    _dragMoveHandler = null
  }
  if (_dragUpHandler) {
    document.removeEventListener('pointerup', _dragUpHandler)
    document.removeEventListener('pointercancel', _dragUpHandler)
    _dragUpHandler = null
  }
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

function cancelOverlaySettle(): void {
  if (_settleTimer !== null) {
    clearTimeout(_settleTimer)
    _settleTimer = null
  }
  if (_dragOverlay) {
    _dragOverlay.classList.remove('canvas-configure-tabs-overlay-settling')
  }
  _settling = false
}

/**
 * Destination top-left for the floating overlay on release.
 * Mid-drag re-render already placed the placeholder row in its final slot.
 */
function resolveConfigureSettleDestination(tabId: string | null): { left: number; top: number } | null {
  if (!tabId) return null
  for (const el of document.querySelectorAll('.canvas-configure-tabs-row')) {
    if (el.getAttribute('data-tab-id') === tabId) {
      const r = (el as HTMLElement).getBoundingClientRect()
      return { left: r.left, top: r.top }
    }
  }
  return null
}

/**
 * Animate the floating overlay into its drop slot (same timing as live DnD).
 * Uses left/top (configure overlay position model), not translate3d.
 */
function animateOverlaySettle(destLeft: number, destTop: number): Promise<void> {
  const overlay = _dragOverlay
  if (!overlay) return Promise.resolve()

  const curLeft = parseFloat(overlay.style.left) || 0
  const curTop = parseFloat(overlay.style.top) || 0
  const dx = destLeft - curLeft
  const dy = destTop - curTop
  if (Math.hypot(dx, dy) < SETTLE_MIN_DISTANCE_PX) {
    overlay.style.left = `${destLeft}px`
    overlay.style.top = `${destTop}px`
    return Promise.resolve()
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
      resolve()
    }
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== overlay) return
      // left and top both transition; complete on either once.
      if (e.propertyName && e.propertyName !== 'left' && e.propertyName !== 'top') return
      finish()
    }

    _settling = true
    overlay.addEventListener('transitionend', onEnd)
    overlay.classList.add('canvas-configure-tabs-overlay-settling')
    // Ensure the settling class applies before changing position.
    void overlay.offsetWidth
    overlay.style.left = `${destLeft}px`
    overlay.style.top = `${destTop}px`
    _settleTimer = setTimeout(finish, SETTLE_DURATION_MS + 40)
  })
}

function cloneConfigureDraft(d: ConfigureDraft): ConfigureDraft {
  return {
    drawerSide: d.drawerSide,
    primaryIds: [...d.primaryIds],
    secondaryIds: [...d.secondaryIds],
    builtinOrder: [...d.builtinOrder],
    extensionOrder: [...d.extensionOrder],
    hiddenIds: new Set(d.hiddenIds),
  }
}

/** Clean up all DnD state. */
function clearDragState(): void {
  cancelOverlaySettle()
  stopAutoScroll()
  if (_dragOverlay) {
    _dragOverlay.remove()
    _dragOverlay = null
  }
  if (_dragTabId) {
    for (const r of document.querySelectorAll('.canvas-configure-tabs-row')) {
      if (r.getAttribute('data-tab-id') === _dragTabId) {
        r.classList.remove('row-dragging')
        ;(r as HTMLElement).style.transform = ''
        ;(r as HTMLElement).style.transition = ''
      }
    }
  }
  detachDragListeners()
  _dragActive = false
  _lastDropTarget = null
  _flipRects = null
  _dragTabId = null
  _dragFromSide = null
  _dragDraftSnapshot = null
  _settling = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

// ── Drag auto-scroll ──
//
// Dragging near the top/bottom edge of a scrollable list (or the stacked
// body on mobile) scrolls it so rows below the current viewport stay
// reachable. Runs on rAF so scrolling continues even without pointermoves;
// each frame re-runs the drop-target hit-test so the placeholder follows
// the scroll.

/**
 * Scrollable containers that can participate in drag auto-scroll
 * (columns' lists first — innermost — and the body when it scrolls).
 */
function getAutoScrollCandidates(): HTMLElement[] {
  const candidates: HTMLElement[] = []
  for (const el of document.querySelectorAll(
    '.canvas-configure-tabs-list, .canvas-configure-tabs-body',
  )) {
    const node = el as HTMLElement
    if (node.scrollHeight > node.clientHeight + 1) candidates.push(node)
  }
  return candidates
}

/**
 * Scroll direction + speed for a pointer position against a container.
 * +1 scrolls down (pointer near bottom edge), -1 up, 0 idle. Speed scales
 * with how deep the pointer is inside the edge zone (min 1px/frame).
 */
function autoScrollForPoint(
  container: HTMLElement,
  x: number,
  y: number,
): { dir: number; speed: number } {
  const rect = container.getBoundingClientRect()
  if (x < rect.left || x > rect.right) return { dir: 0, speed: 0 }
  if (y < rect.top - AUTOSCROLL_EDGE_PX || y > rect.bottom + AUTOSCROLL_EDGE_PX) {
    return { dir: 0, speed: 0 }
  }
  if (y < rect.top + AUTOSCROLL_EDGE_PX) {
    const depth = (rect.top + AUTOSCROLL_EDGE_PX - y) / AUTOSCROLL_EDGE_PX
    return { dir: -1, speed: Math.max(1, Math.round(AUTOSCROLL_SPEED_PX * depth)) }
  }
  if (y > rect.bottom - AUTOSCROLL_EDGE_PX) {
    const depth = (y - (rect.bottom - AUTOSCROLL_EDGE_PX)) / AUTOSCROLL_EDGE_PX
    return { dir: 1, speed: Math.max(1, Math.round(AUTOSCROLL_SPEED_PX * depth)) }
  }
  return { dir: 0, speed: 0 }
}

/** Cancel any active drag auto-scroll (idempotent). */
function stopAutoScroll(): void {
  if (_autoScrollRaf !== null) {
    cancelAnimationFrame(_autoScrollRaf)
    _autoScrollRaf = null
  }
  _autoScrollContainer = null
  _autoScrollDir = 0
}

/**
 * Re-evaluate auto-scroll from the latest pointer position. Picks the
 * innermost scrollable container under the pointer and starts/stops the
 * rAF loop based on edge proximity.
 */
function updateAutoScroll(x: number, y: number): void {
  if (!_dragActive || _settling) {
    stopAutoScroll()
    return
  }

  // Deepest scrollable container under the pointer wins (list over body).
  let chosen: HTMLElement | null = null
  let chosenDepth = -1
  for (const candidate of getAutoScrollCandidates()) {
    const rect = candidate.getBoundingClientRect()
    if (x < rect.left || x > rect.right) continue
    if (y < rect.top - AUTOSCROLL_EDGE_PX || y > rect.bottom + AUTOSCROLL_EDGE_PX) continue
    let depth = 0
    let parent: HTMLElement | null = candidate.parentElement
    while (parent) {
      if (
        parent.classList.contains('canvas-configure-tabs-list') ||
        parent.classList.contains('canvas-configure-tabs-body')
      ) {
        depth++
      }
      parent = parent.parentElement
    }
    if (depth > chosenDepth) {
      chosen = candidate
      chosenDepth = depth
    }
  }

  if (!chosen) {
    stopAutoScroll()
    return
  }
  const { dir } = autoScrollForPoint(chosen, x, y)
  if (dir === 0) {
    stopAutoScroll()
    return
  }
  if (_autoScrollContainer !== chosen || _autoScrollDir !== dir) {
    _autoScrollContainer = chosen
    _autoScrollDir = dir
  }
  if (_autoScrollRaf === null) {
    _autoScrollRaf = requestAnimationFrame(autoScrollFrame)
  }
}

/** One drag auto-scroll frame: scroll, re-hit-test, re-evaluate edges. */
function autoScrollFrame(): void {
  _autoScrollRaf = null
  if (!_dragActive || _settling || !_autoScrollContainer || _autoScrollDir === 0) return

  const container = _autoScrollContainer
  const { dir, speed } = autoScrollForPoint(container, _lastPointerX, _lastPointerY)
  if (dir === 0) {
    stopAutoScroll()
    return
  }
  container.scrollTop += dir * speed
  // The list scrolled under the pointer — re-run the hit-test so the drop
  // placeholder follows the scroll.
  runHitTestAndReorder(_lastPointerX, _lastPointerY)
  // Re-evaluate edges (pointer is now relatively further from the edge) and
  // schedule the next frame when still in the zone.
  updateAutoScroll(_lastPointerX, _lastPointerY)
}

/**
 * Hit-test the drop target at pointer coords and live-place if it changed.
 * Shared by pointermove and the auto-scroll frame.
 */
function runHitTestAndReorder(x: number, y: number): void {
  if (!_dragTabId || _settling) return
  const target_ = hitTestDropTarget(x, y)
  if (!target_) return
  const prev = _lastDropTarget
  if (prev && prev.side === target_.side && prev.index === target_.index) return
  _lastDropTarget = target_
  performDragMove(_dragTabId, target_.side, target_.index)
}

/**
 * Snapshot row bounding rects keyed by data-tab-id for FLIP animation.
 */
function snapshotFLIPRects(): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  for (const el of document.querySelectorAll('.canvas-configure-tabs-row')) {
    const id = el.getAttribute('data-tab-id')
    if (id) rects.set(id, el.getBoundingClientRect())
  }
  return rects
}

/**
 * Apply FLIP transforms after a reorder render.
 * Invert (no transition) → next frame play to identity with 200ms ease.
 * Do not re-measure after invert — that cancels the animation.
 */
function applyFLIP(prevRects: Map<string, DOMRect>, excludeTabId: string | null): void {
  const animated: HTMLElement[] = []
  const rows = document.querySelectorAll('.canvas-configure-tabs-row')
  for (const el of rows) {
    const id = el.getAttribute('data-tab-id')
    if (!id || id === excludeTabId || !prevRects.has(id)) continue
    const prev = prevRects.get(id)!
    const curr = el.getBoundingClientRect()
    const deltaY = prev.top - curr.top
    if (Math.abs(deltaY) <= 0.5) continue
    const node = el as HTMLElement
    node.style.transition = 'none'
    node.style.transform = `translateY(${deltaY}px)`
    animated.push(node)
  }
  if (animated.length === 0) return
  // Force layout so the invert sticks before we animate
  void document.body.offsetHeight
  requestAnimationFrame(() => {
    for (const node of animated) {
      node.style.transition = 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)'
      node.style.transform = ''
    }
    setTimeout(() => {
      for (const node of animated) {
        node.style.transition = ''
      }
    }, 220)
  })
}

/**
 * Create a fixed-position overlay clone of the source row for dragging.
 */
function createDragOverlay(sourceRow: HTMLElement): HTMLElement {
  const overlay = sourceRow.cloneNode(true) as HTMLElement
  overlay.className = 'canvas-configure-tabs-overlay-clone'
  const rect = sourceRow.getBoundingClientRect()
  overlay.style.width = rect.width + 'px'
  overlay.style.height = rect.height + 'px'
  overlay.style.left = rect.left + 'px'
  overlay.style.top = rect.top + 'px'
  // Remove interactive elements from clone
  const toggle = overlay.querySelector('.canvas-configure-tabs-toggle')
  if (toggle) (toggle as HTMLElement).style.pointerEvents = 'none'
  document.body.appendChild(overlay)
  return overlay
}

/**
 * Hit-test pointer against lists. Index is the insert position **after the
 * dragged tab is removed** (exclude dragged row from midpoint math).
 */
function hitTestDropTarget(x: number, y: number): { side: 'primary' | 'secondary'; index: number } | null {
  const lists = document.querySelectorAll('.canvas-configure-tabs-list')
  for (const list of lists) {
    const listRect = list.getBoundingClientRect()
    // Expand vertical hit slightly so empty/near-edge drops still work
    if (x < listRect.left || x > listRect.right) continue
    if (y < listRect.top - 8 || y > listRect.bottom + 8) continue
    const side = (list as HTMLElement).getAttribute('data-side') as 'primary' | 'secondary' | null
    if (!side) continue

    const rows = Array.from(list.querySelectorAll('.canvas-configure-tabs-row')).filter(
      (r) => r.getAttribute('data-tab-id') !== _dragTabId,
    ) as HTMLElement[]

    if (rows.length === 0) return { side, index: 0 }

    for (let i = 0; i < rows.length; i++) {
      const rowRect = rows[i].getBoundingClientRect()
      const mid = rowRect.top + rowRect.height / 2
      if (y < mid) return { side, index: i }
    }
    return { side, index: rows.length }
  }
  return null
}

/**
 * Live-place tabId at toSide/toIndex. Always resolves current side from draft
 * (not stale pointer-down side). FLIP animates siblings after re-render.
 */
function performDragMove(tabId: string, toSide: 'primary' | 'secondary', toIndex: number): void {
  if (!_draftRef) return

  const fromSide: ColumnSide = _draftRef.primaryIds.includes(tabId) ? 'primary' : 'secondary'
  const fromIds = fromSide === 'primary' ? _draftRef.primaryIds : _draftRef.secondaryIds
  const fromIdx = fromIds.indexOf(tabId)
  if (fromIdx === -1) return
  // Same slot (toIndex is post-removal insert index)
  if (fromSide === toSide && toIndex === fromIdx) return

  const prevRects = snapshotFLIPRects()

  if (fromSide === toSide) {
    const spatialSide: DrawerSide = leftColumnIsSecondary(_draftRef.drawerSide)
      ? (fromSide === 'primary' ? 'right' : 'left')
      : (fromSide === 'primary' ? 'left' : 'right')
    // toIndex is post-removal insert index — pass through without ±1 hacks
    _draftRef = reorderWithin(_draftRef, spatialSide, fromIdx, toIndex)
  } else {
    _draftRef = moveTab(_draftRef, tabId, toSide, toIndex)
  }

  _dragFromSide = toSide
  renderModal(_draftRef, _catalogRef, null, false)
  applyFLIP(prevRects, tabId)

  // Re-apply placeholder after re-render
  for (const r of document.querySelectorAll('.canvas-configure-tabs-row')) {
    if (r.getAttribute('data-tab-id') === tabId) {
      r.classList.add('row-dragging')
      break
    }
  }
}

/**
 * Cancel an active drag: remove overlay, placeholder, listeners.
 * When `revertDraft` is true (Esc mid-drag before release), restore the
 * draft captured at pointerdown so residual dirty does not stick.
 * After pointerup (settle), draft placement is intentional — do not revert.
 */
function cancelDrag(opts?: { revertDraft?: boolean }): void {
  const revert = opts?.revertDraft === true && !_settling && _dragDraftSnapshot
  if (revert && _dragDraftSnapshot) {
    _draftRef = cloneConfigureDraft(_dragDraftSnapshot)
  }
  clearDragState()
  if (revert && _draftRef) {
    renderModal(_draftRef, _catalogRef, null, false)
  }
}

/**
 * Auto-commit the current draft if dirty.
 *
 * Uses a serial chain (_commitPromise) so concurrent calls always wait
 * for any in-flight auto-commit before proceeding. After the previous
 * commit finishes, the draft is re-checked and committed again if still
 * dirty (e.g. user made another edit during the previous commit).
 * The owned dispatcher serializes with live DnD.
 */
async function autoCommit(): Promise<CommitResult> {
  // Chain behind any in-flight auto-commit.
  const prev = _commitPromise

  // Build a promise for this invocation's work.
  const myWork = (async () => {
    // Wait for previous autoCommit to finish.
    if (prev) { try { await prev } catch { /* ignore */ } }

    if (!_draftRef || !_baseSnapshotRef) return { ok: true as const }
    if (!isDraftDirty(_draftRef, _baseSnapshotRef)) return { ok: true as const }

    // Capture draft + base + epoch at commit decision time. Base must be
    // captured here (not re-read after await) so a concurrent successful
    // rebase does not feed a stale sideChanged comparison into a mid-flight
    // commit — and so we always pass the baseline that made us dirty.
    const draftToCommit = _draftRef
    const baseToCommit = _baseSnapshotRef
    const epochAtStart = _baseEpoch
    const result = await commitDraftToOwnedModel(draftToCommit)

    if (result.ok) {
      // Always advance base to what was committed when epoch is unchanged,
      // even if the user swapped/edited again (_draftRef !== draftToCommit).
      // Skipping that rebase is the rapid-swap cancel-out bug: second commit
      // sees draft===base and no-ops while live drawers already match A.
      // Epoch advanced means open/refresh already installed a fresh baseline.
      const rebased = rebaseBaseIfEpochUnchanged(
        draftToCommit,
        epochAtStart,
        _baseEpoch,
      )
      if (rebased) {
        _baseSnapshotRef = rebased
      }
      // Only re-render from this draft when it is still the live ref —
      // otherwise a newer draft already owns the UI.
      if (_draftRef === draftToCommit) {
        renderModal(draftToCommit, _catalogRef, null, false)
      }
    } else if (!result.superseded) {
      // `superseded` (H1 mode-switch barrier): dropped on purpose — no error
      // banner; the switch's terminal refresh rebuilds draft+base from live.
      if (_draftRef === draftToCommit) {
        renderModal(draftToCommit, _catalogRef, result.error, false)
      }
    }
    return result
  })()

  // Store a promise that covers both wait + our work for subsequent callers.
  _commitPromise = myWork.then(r => r as CommitResult).catch(
    () => ({ ok: false as const, error: 'auto-commit failed' }),
  )

  return await myWork
}

/**
 * Mode-switch Apply (deep-review H1): commit the current draft through the
 * SAME serial chain as autoCommit so it cannot race a concurrent edit commit
 * (a direct commitDraftToOwnedModel call here used to bypass `_commitPromise`).
 * Returns the commit result so the mode-switch guard can cancel on failure.
 */
export async function commitConfigureDraftSerial(): Promise<CommitResult> {
  return autoCommit()
}

/**
 * Drain modal auto-commit chain + global configure commit queue.
 * Used by mode-switch before dirty check / Apply so residual in-flight
 * edits finish and base can rebase.
 */
export async function flushConfigureCommits(): Promise<void> {
  await autoCommit()
  // One more autoCommit pass: if a live-DnD commit changed host state while
  // we waited, re-check dirty. Usually a no-op.
  await autoCommit()
}



// Mobile viewport check local to this module (no sidebar/mobile-exclusion
// import — that module pulls the whole shell graph).
function _isMobileViewportForConfigure(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 600px)').matches
    )
  } catch {
    return false
  }
}

// ── Catalog ref for module-level re-renders ──

let _catalogRef: CatalogTab[] = []

// ── Component ──

interface ModalProps {
  draft: ConfigureDraft
  catalog: CatalogTab[]
  primaryTabs: CatalogTab[]
  secondaryTabs: CatalogTab[]
  commitError: string | null
  committing: boolean
  secondDrawerEnabled: boolean
  onSwapSide: () => void
  onToggleHide: (tabId: string, hidden: boolean) => void
  onToggleSecondDrawer: () => void
  onCancel: () => void
  onDone: () => void
}

function ConfigureTabsModalInner(props: ModalProps) {
  const {
    draft, catalog, primaryTabs, secondaryTabs,
    commitError, committing,
    secondDrawerEnabled,
    onSwapSide, onToggleHide, onToggleSecondDrawer,
    onCancel, onDone,
  } = props

  const leftIsSecondaryVal = leftColumnIsSecondary(draft.drawerSide)

  // OS mode on a mobile viewport forces single-drawer mode (see
  // os/os-mode.syncOsMobileDrawerMode): lock the footer toggle so the user
  // cannot flip the invariant off from this surface.
  const osMobileSingle =
    !!getSettings().osMode && _isMobileViewportForConfigure()

  // Ref-based latest values for document-level Escape handler
  const committingRef = useRef(committing)
  committingRef.current = committing
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (_dragActive || _dragTabId) {
          // Mid-drag (before release): revert draft. During settle after
          // release, keep placement — release already means commit intent.
          cancelDrag({ revertDraft: !_settling })
          return
        }
        if (!committingRef.current) cancelRef.current()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // ── Pointer drag handler (handle-only; fires from onPointerDown) ──

  const handlePointerDown = useCallback((e: PointerEvent, tabId: string, side: ColumnSide) => {
    // Only handle from the drag handle element
    const target = e.currentTarget as HTMLElement
    if (!target.classList.contains('canvas-configure-tabs-drag-handle')) return
    // Ignore new presses while a prior drop is settling
    if (_settling) return

    // Prevent text selection and default drag behavior
    e.preventDefault()

    _dragTabId = tabId
    _dragFromSide = side
    _dragActive = false
    _dragStartX = e.clientX
    _dragStartY = e.clientY
    _lastDropTarget = null
    // Snapshot for Esc cancel before any performDragMove mutates draft.
    _dragDraftSnapshot = _draftRef ? cloneConfigureDraft(_draftRef) : null

    // Define move handler
    const onMove = (ev: PointerEvent) => {
      if (_settling) return
      const dx = ev.clientX - _dragStartX
      const dy = ev.clientY - _dragStartY
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (!_dragActive) {
        if (dist < 4) return
        _dragActive = true
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'

        const sourceRow = target.closest('.canvas-configure-tabs-row') as HTMLElement | null
        if (sourceRow) {
          const rowRect = sourceRow.getBoundingClientRect()
          _dragOffsetX = ev.clientX - rowRect.left
          _dragOffsetY = ev.clientY - rowRect.top
          sourceRow.classList.add('row-dragging')
          _dragOverlay = createDragOverlay(sourceRow)
        }
      }

      if (_dragOverlay) {
        _dragOverlay.style.left = `${ev.clientX - _dragOffsetX}px`
        _dragOverlay.style.top = `${ev.clientY - _dragOffsetY}px`
      }

      // Track the pointer for auto-scroll frames, then hit-test for a drop
      // target (fromSide always resolved from live draft inside performDragMove).
      _lastPointerX = ev.clientX
      _lastPointerY = ev.clientY
      updateAutoScroll(ev.clientX, ev.clientY)
      runHitTestAndReorder(ev.clientX, ev.clientY)
    }

    const onUp = async (_ev: PointerEvent) => {
      // Stop tracking pointer + auto-scroll; keep overlay + placeholder for
      // settle anim.
      detachDragListeners()
      stopAutoScroll()
      // Release = keep placement; drop Esc-revert snapshot.
      _dragDraftSnapshot = null

      try {
        if (_dragActive && _dragOverlay && _dragTabId) {
          const dest = resolveConfigureSettleDestination(_dragTabId)
          if (dest) {
            await animateOverlaySettle(dest.left, dest.top)
          }
        }
      } finally {
        clearDragState()
        void autoCommit()
      }
    }

    _dragMoveHandler = onMove
    _dragUpHandler = onUp
    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }, [])

  // ── Render helpers ──

  /** Get the icon markup for a tab row. */
  const renderIcon = (tab: CatalogTab): h.JSX.Element => {
    // Built-in: use SVG icon map
    if (tab.kind === 'builtin') {
      const svg = BUILTIN_ICON_SVGS[tab.id]
      if (svg) {
        return <span class="canvas-configure-tabs-icon-wrap" dangerouslySetInnerHTML={{ __html: svg }} />
      }
    }
    // Extension: prefer iconSvg, then iconUrl
    if (tab.kind === 'extension' && tab.iconSvg) {
      return <span class="canvas-configure-tabs-icon-wrap" dangerouslySetInnerHTML={{ __html: tab.iconSvg }} />
    }
    if (tab.kind === 'extension' && tab.iconUrl) {
      return (
        <span class="canvas-configure-tabs-icon-wrap">
          <img src={tab.iconUrl} alt="" />
        </span>
      )
    }
    // Fallback: monogram
    return (
      <span class="canvas-configure-tabs-icon-wrap" style="font-size:15px;font-weight:600;">
        {tab.title.charAt(0)}
      </span>
    )
  }

  /** Render a single tab row. */
  const renderTabRow = (tab: CatalogTab, index: number, side: ColumnSide) => {
    const isHidden = draft.hiddenIds.has(tab.id)
    // Core tabs unlock for hiding while `coreTabsHidden` is on (OS mode forces
    // it on): closing a window marks it hidden, so the eye must be usable.
    const coreUnlocked = !!getSettings().coreTabsHidden
    const isLocked = tab.hideLocked && !coreUnlocked
    const isCore = tab.kind === 'builtin' && tab.hideLocked
    // Core tabs show their real descriptions too; the locked state is
    // conveyed by the Core badge, the disabled toggle, and its tooltip.
    const description = tab.description || ''

    return (
      <div
        class={`canvas-configure-tabs-row${isHidden ? ' row-hidden' : ''}${isLocked ? ' row-locked' : ''}`}
        data-tab-id={tab.id}
        data-row-index={index}
        key={tab.id}
      >
        {/* Drag handle — ONLY this fires pointer drag events */}
        <span
          class="canvas-configure-tabs-drag-handle"
          title="Drag to reorder"
          onPointerDown={(e) => handlePointerDown(e, tab.id, side)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="5" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="9" cy="19" r="1.5" />
            <circle cx="15" cy="5" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="15" cy="19" r="1.5" />
          </svg>
        </span>

        {/* Row info: icon (inside) + copy */}
        <div class="canvas-configure-tabs-row-info">
          {renderIcon(tab)}
          <div class="canvas-configure-tabs-copy">
            <div class="canvas-configure-tabs-row-title-wrap">
              <span class="canvas-configure-tabs-row-title">{tab.title}</span>
              {isCore && <span class="canvas-configure-tabs-badge">Core</span>}
              {tab.kind === 'extension' && (
                <span class="canvas-configure-tabs-badge canvas-configure-tabs-badge-muted">Extension</span>
              )}
            </div>
            {description && (
              <p class="canvas-configure-tabs-row-description">{description}</p>
            )}
          </div>
        </div>

        {/* Toggle switch (checked = visible = !hidden) */}
        <button
          class={`canvas-configure-tabs-toggle${!isHidden ? ' toggle-on' : ''}`}
          disabled={isLocked}
          title={isLocked ? 'Cannot hide this tab' : (isHidden ? 'Show tab' : 'Hide tab')}
          onClick={(e) => {
            e.stopPropagation()
            onToggleHide(tab.id, !isHidden)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>
    )
  }

  // Section descriptions — host-like tone
  const primaryDesc = leftIsSecondaryVal
    ? 'Tabs shown in the right sidebar drawer.'
    : 'Tabs shown in the left sidebar drawer.'

  const secondaryDesc = leftIsSecondaryVal
    ? 'Tabs shown in the left sidebar drawer.'
    : 'Tabs shown in the right sidebar drawer.'

  const renderColumnHeader = (title: string, desc: string) => (
    <div class="canvas-configure-tabs-section-header">
      <h3 class="canvas-configure-tabs-section-title">{title}</h3>
      <p class="canvas-configure-tabs-section-desc">{desc}</p>
    </div>
  )

  const renderColumn = (tabs: CatalogTab[], side: ColumnSide, sectionHeader: h.JSX.Element) => (
    <div class="canvas-configure-tabs-column">
      {sectionHeader}
      <div
        class="canvas-configure-tabs-list"
        data-side={side}
      >
        {tabs.length === 0 ? (
          <div class="canvas-configure-tabs-empty">No tabs assigned</div>
        ) : (
          tabs.map((tab, i) => renderTabRow(tab, i, side))
        )}
      </div>
    </div>
  )

  // Column order depends on drawer side.
  const leftColumn = renderColumn(
    leftIsSecondaryVal ? secondaryTabs : primaryTabs,
    leftIsSecondaryVal ? 'secondary' : 'primary',
    renderColumnHeader(
      leftIsSecondaryVal ? 'Second Drawer Tabs' : 'Main Drawer Tabs',
      leftIsSecondaryVal ? secondaryDesc : primaryDesc,
    ),
  )
  const rightColumn = renderColumn(
    leftIsSecondaryVal ? primaryTabs : secondaryTabs,
    leftIsSecondaryVal ? 'primary' : 'secondary',
    renderColumnHeader(
      leftIsSecondaryVal ? 'Main Drawer Tabs' : 'Second Drawer Tabs',
      leftIsSecondaryVal ? primaryDesc : secondaryDesc,
    ),
  )

  return (
    <div
      class="canvas-configure-tabs-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div class="canvas-configure-tabs-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header (host column layout); close sits in the title row so it
            vertically centers with h2 + Swap drawers (not absolute top-right). */}
        <div class="canvas-configure-tabs-header">
          <div class="canvas-configure-tabs-header-row">
            <h2>Configure Tabs</h2>
            <div class="canvas-configure-tabs-header-actions">
              <button
                class="canvas-configure-tabs-close"
                type="button"
                title="Close"
                onClick={() => onCancel()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <p class="canvas-configure-tabs-subtitle">{getSettings().coreTabsHidden
            ? 'Drag to reorder sidebar tabs. Toggle to hide tabs; closing a core tab in OS mode hides it here too.'
            : 'Drag to reorder sidebar tabs. Toggle to hide optional tabs; core tabs always remain visible.'}</p>
        </div>

        {/* Body: two columns when second drawer is enabled, one column otherwise */}
        {secondDrawerEnabled ? (
          <div class="canvas-configure-tabs-body">
            {leftColumn}
            {rightColumn}
          </div>
        ) : (
          <div class="canvas-configure-tabs-body canvas-configure-tabs-body--single">
            {renderColumn(
              primaryTabs,
              'primary',
              renderColumnHeader('Drawer Tabs', 'Tabs in the sidebar drawer.'),
            )}
          </div>
        )}

        {/* Error */}
        {commitError && (
          <div class="canvas-configure-tabs-error">{commitError}</div>
        )}

        {/* Footer */}
        <div class="canvas-configure-tabs-footer">
          <div class="canvas-configure-tabs-footer-left">
            <div class="canvas-configure-tabs-second-drawer-toggle">
              <span
                class="canvas-configure-tabs-second-drawer-toggle-label"
                title={osMobileSingle ? 'OS mode uses single-drawer mode on mobile — disable OS mode first.' : undefined}
                onClick={() => { if (!osMobileSingle) onToggleSecondDrawer() }}
              >
                Second drawer
              </span>
              <button
                class={`canvas-configure-tabs-toggle${secondDrawerEnabled ? ' toggle-on' : ''}`}
                disabled={osMobileSingle}
                title={osMobileSingle ? 'OS mode uses single-drawer mode on mobile — disable OS mode first.' : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!osMobileSingle) onToggleSecondDrawer()
                }}
              />
            </div>
            {secondDrawerEnabled && (
              <button class="canvas-configure-tabs-swap-btn" onClick={onSwapSide}>
                Swap drawer locations
              </button>
            )}
          </div>
          <div class="canvas-configure-tabs-footer-right">
            <button
              class="canvas-configure-tabs-btn"
              onClick={onCancel}
              disabled={committing}
            >
              Cancel
            </button>
            <button
              class="canvas-configure-tabs-btn canvas-configure-tabs-btn-primary"
              onClick={onDone}
              disabled={committing}
            >
              {committing ? 'Applying\u2026' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal controller ──

/**
 * Build a fresh ConfigureDraft + BaseSnapshot from current host state.
 * Single source of truth for the initial-draft logic; reused by both
 * openConfigureTabsModal and refreshConfigureDraftFromLive.
 */
function buildLiveDraftAndBase(): {
  draft: ConfigureDraft
  base: BaseSnapshot
  catalog: CatalogTab[]
} {
  const catalog = filterCatalogToLive(
    getFullCatalog(),
    getHost(),
    new Set(getLiveIdAssignments().keys()),
  )
  const hostSettings = getHostDrawerSettings()
  // LiveId-keyed projection of the model — the base facade is TabKey-keyed
  // but catalog/draft ids are liveIds; against the TabKey facade every
  // lookup missed and the secondary column rendered empty.
  const currentAssignments = new Map(getLiveIdAssignments())
  // The cached host-settings side wins only when present — on NO-GO it is
  // never stamped (host-settings.ts drops `side` from the cache), so the
  // modal falls back to the REAL DOM side and shows where the drawers
  // actually are (the Lumiverse "Drawer side" setting and Canvas "Swap
  // drawer locations" write the same host field).
  const hostSide = hostSettings?.side as DrawerSide | undefined
  const drawerSide = hostSide || getMainDrawerSide()
  const sideSource = hostSide ? 'host-settings' : 'dom'

  // ── S2 model source ─────────────────────────────────────────────────
  // Order + hidden come from the OWNED MODEL, not host tabOrder (the host
  // settings patch is gone — model is the single source). Draft ids stay
  // liveIds: resolve each model TabKey via host.resolve (suffix-drift
  // fallback is inside the resolver). Keys that cannot resolve are
  // dropped, matching the commit path's resolution semantics.
  const model = getModel()
  const host = getHost()
  if (model && host) {
    const resolveId = (key: TabKey): string | null => host.resolve(key)
    const toIds = (keys: readonly TabKey[]): string[] => {
      const out: string[] = []
      for (const key of keys) {
        const id = resolveId(key)
        if (id) out.push(id)
      }
      return out
    }
    const modelPrimaryIds = toIds(model.primary)
    const modelSecondaryIds = toIds(model.secondary)
    const modelHiddenIds = toIds(model.hidden)

    const draftFromModel = createDraft({
      catalog,
      tabOrder: [...modelPrimaryIds, ...modelSecondaryIds],
      hiddenTabIds: modelHiddenIds,
      drawerSide,
      assignments: currentAssignments,
    })
    // Align both sides to the live strips — post-S2 the strips are model
    // renderings (mirror strip + secondary strip), so this is a no-op in
    // steady state and only protects mid-transition DOM.
    const draft = alignDraftToLiveVisibleOrder(
      draftFromModel,
      readLivePrimaryTabIds(),
      readLiveSecondaryTabIds(),
    )
    const base = baseSnapshotFromDraft(draft)
    dlog('[configure-modal] draft from model', {
      side: draft.drawerSide,
      sideSource,
      primary: draft.primaryIds.length,
      secondary: draft.secondaryIds.length,
      hidden: draft.hiddenIds.size,
      unresolved: model.primary.length + model.secondary.length - modelPrimaryIds.length - modelSecondaryIds.length,
    })
    return { draft, base, catalog }
  }

  // ── Legacy fallback (no owned model yet — pre-bootstrap float) ──────
  // Host tabOrder can lag behind live strips (e.g. mid-drag commits, first
  // open after strip-only reorders). Align both sides so the modal matches
  // what the user sees in the drawers.
  // Merge host + Canvas-owned hide (host DB often never got Configure hides);
  // heal extension :N drift so toggles match live catalog after refresh.
  const healedHidden = resolveHiddenTabIdsForDraft(
    mergeHiddenTabIdLists(hostSettings?.hiddenTabIds, getCanvasHiddenTabIds()),
    catalog.map((t) => t.id),
  )

  const draftFromHost = createDraft({
    catalog,
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: healedHidden,
    drawerSide,
    assignments: currentAssignments,
  })
  const draft = alignDraftToLiveVisibleOrder(
    draftFromHost,
    readLivePrimaryTabIds(),
    readLiveSecondaryTabIds(),
  )

  // Base from the aligned draft so open/refresh is clean (not spuriously
  // dirty vs host tabOrder that disagrees with the live strips).
  const base = baseSnapshotFromDraft(draft)

  // Debug diagnostic: one summary line per build so the Configure Tabs
  // draft can be verified against the live app + the owned model at a
  // glance (drawer side + per-drawer tab counts + hidden count + which
  // side source won). Every open / refresh goes through here.
  dlog('[configure-modal] draft from live', {
    side: draft.drawerSide,
    sideSource,
    primary: draft.primaryIds.length,
    secondary: draft.secondaryIds.length,
    hidden: draft.hiddenIds.size,
    secondDrawerEnabled: getSettings().secondSidebarEnabled,
  })

  return { draft, base, catalog }
}

/**
 * Open the Configure Tabs modal.
 * Builds the initial draft from current host state and renders the Preact component.
 */
export async function openConfigureTabsModal(): Promise<void> {
  if (typeof document === 'undefined') return
  if (_openInProgress) return
  _openInProgress = true
  try {
    if (getSettings().unhideVanillaTabs) {
      try {
        const { ensureVanillaTabsUnhiddenBeforeConfigure } = await import('./unhide-vanilla')
        await ensureVanillaTabsUnhiddenBeforeConfigure()
      } catch (err) {
        dlog('[configure-modal] waiting for Lumiverse tabs before open failed', String(err))
      }
    }

    if (_modalContainer) {
      _modalContainer.style.display = 'flex'
      return
    }

    injectModalStyles()

    // Lock body scroll like host ModalShell
    document.body.style.overflow = 'hidden'

    const { draft, base, catalog } = buildLiveDraftAndBase()
    _draftRef = draft
    _baseSnapshotRef = base
    _baseEpoch++
    dlog('[configure-modal] open (draft built from live)')

    // Create container and render.
    _modalContainer = document.createElement('div')
    _modalContainer.id = 'canvas-configure-tabs-modal'
    document.body.appendChild(_modalContainer)

    renderModal(draft, catalog, null, false)
  } finally {
    _openInProgress = false
  }
}

/**
 * Re-read the current host state and rebuild the modal's draft + base snapshot
 * in place. No-op when the modal is not currently mounted. Intended for
 * callers that change drawer/host state while the modal is open (e.g. toggling
 * second-drawer mode from the new footer toggle while the user is editing).
 * The dirty-check baseline is reset, so any unsaved edits in the modal are
 * discarded — call sites are expected to prompt the user beforehand.
 */
export function refreshConfigureDraftFromLive(): void {
  if (!_modalContainer) return
  const { draft, base, catalog } = buildLiveDraftAndBase()
  _draftRef = draft
  _baseSnapshotRef = base
  _baseEpoch++
  dlog('[configure-modal] refresh from live (draft rebuilt)')
  renderModal(draft, catalog, null, false)
}

/**
 * Close the Configure Tabs modal.
 * With auto-commit, all edits are already persisted, so there is no need
 * for a discard confirm. Just unmounts immediately.
 */
export function closeConfigureTabsModal(_opts?: { force?: boolean }): boolean {
  if (!_modalContainer) return true
  unmountModal()
  return true
}

/**
 * Return the current ConfigureDraft reference (null if modal is not open).
 * Used by second-drawer-mode.ts to check dirty state for mode-switch dialog.
 */
export function getConfigureDraftRef(): import('./configure-model').ConfigureDraft | null {
  return _draftRef
}

/**
 * Return the current BaseSnapshot reference (null if modal is not open).
 * Used by second-drawer-mode.ts to check dirty state for mode-switch dialog.
 */
export function getConfigureBaseRef(): import('./configure-model').BaseSnapshot | null {
  return _baseSnapshotRef
}

/**
 * Force-unmount the Configure Tabs modal without any dirty check or prompt.
 * Used by the mode-switch "Discard and switch" path.
 */
export function forceUnmountConfigureTabsModal(): void {
  unmountModal()
}

/** True when the modal is currently open. */
export function isConfigureTabsModalOpen(): boolean {
  return _modalContainer !== null && _modalContainer.isConnected
}

// ── Internal: render / re-render / unmount ──

function renderModal(
  draft: ConfigureDraft,
  catalog: CatalogTab[],
  commitError: string | null,
  committing: boolean,
): void {
  _catalogRef = catalog
  if (!_modalContainer) return

  const { primary, secondary } = partitionDisplayLists(draft, catalog)

  render(
    <ConfigureTabsModalInner
      draft={draft}
      catalog={catalog}
      primaryTabs={primary}
      secondaryTabs={secondary}
      commitError={commitError}
      committing={committing}
      secondDrawerEnabled={getSettings().secondSidebarEnabled}
      onSwapSide={() => {
        if (!_draftRef) return
        const before = _draftRef.drawerSide
        const next = swapDrawerSide(_draftRef)
        _draftRef = next
        // Diagnostic: the swap is equivalent to toggling Lumiverse's own
        // "Drawer side" setting — both write drawerSettings.side (Canvas via
        // host.setSide → settings API/bridge). Log draft + model sides so the
        // equivalence and the visual column flip are verifiable.
        dlog('[configure-modal] swap drawer locations', {
          draftSideBefore: before,
          draftSideAfter: next.drawerSide,
          modelSide: getModel()?.side ?? null,
          visibleSide: getMainDrawerSide(),
        })
        renderModal(next, catalog, null, false)
        autoCommit()
      }}
      onToggleHide={(tabId, hidden) => {
        if (!_draftRef) return
        const next = setHidden(_draftRef, tabId, hidden, !!getSettings().coreTabsHidden)
        _draftRef = next
        renderModal(next, catalog, null, false)
        autoCommit()
      }}
      onToggleSecondDrawer={() => {
        // Delegate to the central mode-toggle API which handles dirty confirm,
        // session profile capture, and feature lifecycle coordination.
        // Lazy-import to avoid circular dependency at module load time.
        const target = !getSettings().secondSidebarEnabled
        dlog('[configure-modal] enable second drawer toggle', {
          target,
          current: getSettings().secondSidebarEnabled,
        })
        void import('../settings/second-drawer-mode').then((m) => {
          m.requestSecondDrawerMode(target)
        }).catch((err) => {
          dwarn('[configure-modal] second-drawer-mode import failed:', err)
        })
      }}
      onCancel={() => {
        closeConfigureTabsModal()
      }}
      onDone={async () => {
        if (!_draftRef || !_baseSnapshotRef) return

        // Drain in-flight auto-commits / live-DnD / mode commits first so we
        // never race the batch mutex or show "already in progress".
        renderModal(_draftRef, catalog, null, true)
        try {
          await flushConfigureCommits()
        } catch (err) {
          dwarn('[configure-modal] Done flush failed:', err)
        }

        if (!_draftRef || !_baseSnapshotRef) return

        // Residual dirty after flush (failed prior commit, external race).
        if (isDraftDirty(_draftRef, _baseSnapshotRef)) {
          const result: CommitResult = await commitDraftToOwnedModel(_draftRef)
          if (!result.ok) {
            // `superseded` (H1 barrier): a mode switch owns the model and
            // will refresh the draft from live — stay open, show no error.
            if (!result.superseded) {
              renderModal(_draftRef, catalog, result.error, false)
            }
            return
          }
          _baseSnapshotRef = baseSnapshotFromDraft(_draftRef)
        }

        unmountModal()
      }}
    />,
    _modalContainer,
  )
}

function unmountModal(): void {
  if (!_modalContainer) return
  render(null, _modalContainer)
  _modalContainer.remove()
  _modalContainer = null
  _draftRef = null
  _baseSnapshotRef = null
  clearDragState()
  // Restore body scroll
  document.body.style.overflow = ''
}
