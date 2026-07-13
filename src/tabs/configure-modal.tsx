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
  baseSnapshotFromDraft,
  createDraft,
  encodeHostTabOrder,
  isDraftDirty,
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
import { getFullCatalog, type CatalogTab } from './configure-catalog'
import { getHostDrawerSettings } from '../dom/host-settings'
import { getMainDrawerSide } from '../store'
import { getTabAssignments } from './assignment'
import { commitConfigureDraft, isConfigureBatchActive, type CommitResult } from './configure-commit'
import { getSettings, setSettings } from '../settings/state'
import { dlog, dwarn } from '../debug/log'

// ── Module state ──

let _modalContainer: HTMLElement | null = null
let _draftRef: ConfigureDraft | null = null
let _baseSnapshotRef: BaseSnapshot | null = null

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

/** Drop-settle duration — keep in sync with CSS on .overlay-settling + live DnD. */
const SETTLE_DURATION_MS = 140
/** Skip settle when already within this many CSS pixels of dest. */
const SETTLE_MIN_DISTANCE_PX = 2

// ── Built-in tab icon SVGs (lucide paths, 18×18, strokeWidth 1.75) ──

const BUILTIN_ICON_SVGS: Record<string, string> = {
  profile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  presets: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2.5a.5.5 0 0 0-.8-.4L15 7l2 2 4.9-5.7a.5.5 0 0 0 .1-.5Z"/><path d="m3 15 3 3"/><path d="M6 12v3h3"/><path d="m15 6-3-3"/><path d="m12 3 3 3-4 4"/><path d="M5 18l-2 2"/></svg>`,
  loom: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="4"/><circle cx="12" cy="6" r="4"/><path d="M12 2v4"/><path d="m15 9 3-3"/><path d="m9 9-3-3"/><path d="M12 14v4"/><path d="m15 15 3 3"/><path d="m9 15-3 3"/></svg>`,
  weaver: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg>`,
  connections: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>`,
  browser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5.08 8.7-5"/><path d="M12 22V12"/></svg>`,
  characters: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  personas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h.01M12 12h.01M18 12h.01"/><path d="M20 6H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6l2 4 2-4h6a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Z"/></svg>`,
  multiplayer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>`,
  lorebook: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2"/><path d="M9 9h6M9 13h6"/></svg>`,
  cortex: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M11.5 10.5h1"/></svg>`,
  databank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>`,
  create: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 2H12l-2.5 5.5L7 11h5l-3 11 7-9h-4l3.5-5.5z"/></svg>`,
  ooc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`,
  prompt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  council: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  summary: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h-5l-5 5v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M9 2v4h6"/><line x1="9" x2="15" y1="11" y2="11"/><line x1="9" x2="15" y1="15" y2="15"/><line x1="9" x2="11" y1="19" y2="19"/></svg>`,
  feedback: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/><path d="M10.5 13.5a3.5 3.5 0 0 0 3 0"/></svg>`,
  worldinfo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  imagegen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  wallpaper: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M12 2a15.3 15.3 0 0 0-4 10 15.3 15.3 0 0 0 4 10"/></svg>`,
  regex: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2z"/><path d="M16 10V6"/><path d="M18 12c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z"/><path d="M10 12H6"/><path d="M12 14l-2 3"/><path d="M12 10l-2-3"/><path d="M4 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`,
  branches: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
  theme: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.6 1.5-1.5 0-.4-.15-.7-.4-1-.25-.3-.6-.5-1-.5-1.2 0-2.1-.9-2.1-2s.9-2 2-2h1.5c1.9 0 3.5-1.6 3.5-3.5 0-1.2-.6-2.3-1.5-3 .4-.3.7-.7.9-1.1.4-.8 1-1.4 1.9-1.4z"/></svg>`,
  spindle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.98.98 0 0 1-.276.837l-1.61 1.611a2.404 2.404 0 0 1-1.705.706 2.404 2.404 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.404 2.404 0 0 1 1.998 12c0-.617.236-1.233.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.98.98 0 0 1 .276-.837l1.61-1.611a2.404 2.404 0 0 1 1.705-.706 2.404 2.404 0 0 1 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.969a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.968 1.02Z"/></svg>`,
}

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
      flex: 1;
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
    .canvas-configure-tabs-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 14px;
      background: color-mix(in srgb, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)) 92%, white 8%);
      touch-action: manipulation;
      user-select: none;
    }
    .canvas-configure-tabs-row.row-locked {
      background: color-mix(in srgb, var(--lumiverse-primary, #4a9eff) 6%, var(--lumiverse-bg-panel, var(--lumiverse-bg, #1a1a2e)));
    }
    .canvas-configure-tabs-row.row-hidden {
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

    /* ── Toggle switch ── */
    .canvas-configure-tabs-toggle {
      position: relative;
      flex-shrink: 0;
      width: 36px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 10px;
      background: var(--lumiverse-border, #555);
      cursor: pointer;
      transition: background var(--lumiverse-transition-fast, 120ms ease);
      touch-action: manipulation;
    }
    .canvas-configure-tabs-toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      transition: transform var(--lumiverse-transition-fast, 120ms ease);
    }
    .canvas-configure-tabs-toggle.toggle-on {
      background: var(--lumiverse-primary, #4a9eff);
    }
    .canvas-configure-tabs-toggle.toggle-on::after {
      transform: translateX(16px);
    }
    .canvas-configure-tabs-toggle:disabled {
      opacity: 0.4;
      cursor: not-allowed;
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

/** Clean up all DnD state. */
function clearDragState(): void {
  cancelOverlaySettle()
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
 * Works for both active and pending (pre-activation) states.
 */
function cancelDrag(): void {
  clearDragState()
}

/**
 * Auto-commit the current draft if dirty.
 *
 * Uses a serial chain (_commitPromise) so concurrent calls always wait
 * for any in-flight auto-commit before proceeding. After the previous
 * commit finishes, the draft is re-checked and committed again if still
 * dirty (e.g. user made another edit during the previous commit).
 * This avoids the "Commit already in progress" error from racing calls.
 */
async function autoCommit(): Promise<void> {
  // Chain behind any in-flight auto-commit.
  const prev = _commitPromise

  // Build a promise for this invocation's work.
  const myWork = (async () => {
    // Wait for previous autoCommit to finish.
    if (prev) { try { await prev } catch { /* ignore */ } }

    if (!_draftRef || !_baseSnapshotRef) return { ok: true as const }
    if (!isDraftDirty(_draftRef, _baseSnapshotRef)) return { ok: true as const }

    const result = await commitConfigureDraft(_draftRef, _baseSnapshotRef)

    if (result.ok) {
      // Rebase baseSnapshot from the committed draft — don't rebuild from
      // host state, which may lag behind (NO-GO path + cross-kind
      // interleaving). Keeping _draftRef preserves the user's reorder.
      _baseSnapshotRef = baseSnapshotFromDraft(_draftRef!)
      if (_draftRef) {
        renderModal(_draftRef, _catalogRef, null, false)
      }
    } else {
      if (_draftRef) {
        renderModal(_draftRef, _catalogRef, result.error, false)
      }
    }
    return result
  })()

  // Store a promise that covers both wait + our work for subsequent callers.
  _commitPromise = myWork.then(r => r as CommitResult).catch(
    () => ({ ok: false as const, error: 'auto-commit failed' }),
  )

  await myWork
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

  // Ref-based latest values for document-level Escape handler
  const committingRef = useRef(committing)
  committingRef.current = committing
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (_dragActive || _dragTabId) {
          cancelDrag()
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

      // Hit-test for drop target
      const target_ = hitTestDropTarget(ev.clientX, ev.clientY)
      if (!target_) return

      const prev = _lastDropTarget
      if (prev && prev.side === target_.side && prev.index === target_.index) return
      _lastDropTarget = target_

      // fromSide always resolved from live draft inside performDragMove
      performDragMove(tabId, target_.side, target_.index)
    }

    const onUp = async (_ev: PointerEvent) => {
      // Stop tracking pointer; keep overlay + placeholder for settle anim.
      detachDragListeners()

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
    const isLocked = tab.hideLocked
    const isCore = tab.kind === 'builtin' && tab.hideLocked
    const description = isLocked ? 'Always visible so you can still reach core app sections.' : (tab.description || '')

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
          <p class="canvas-configure-tabs-subtitle">Drag to reorder sidebar tabs. Toggle to hide optional tabs; core tabs always remain visible.</p>
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
                onClick={() => onToggleSecondDrawer()}
              >
                Enable second drawer
              </span>
              <button
                class={`canvas-configure-tabs-toggle${secondDrawerEnabled ? ' toggle-on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleSecondDrawer()
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
  const catalog = getFullCatalog()
  const hostSettings = getHostDrawerSettings()
  const currentAssignments = new Map(getTabAssignments())
  const drawerSide = (hostSettings?.side as DrawerSide) || getMainDrawerSide()

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

/**
 * Open the Configure Tabs modal.
 * Builds the initial draft from current host state and renders the Preact component.
 */
export function openConfigureTabsModal(): void {
  if (typeof document === 'undefined') return
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

  // Create container and render.
  _modalContainer = document.createElement('div')
  _modalContainer.id = 'canvas-configure-tabs-modal'
  document.body.appendChild(_modalContainer)

  renderModal(draft, catalog, null, false)
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
        const next = swapDrawerSide(_draftRef)
        _draftRef = next
        renderModal(next, catalog, null, false)
        autoCommit()
      }}
      onToggleHide={(tabId, hidden) => {
        if (!_draftRef) return
        const next = setHidden(_draftRef, tabId, hidden)
        _draftRef = next
        renderModal(next, catalog, null, false)
        autoCommit()
      }}
      onToggleSecondDrawer={() => {
        // Delegate to the central mode-toggle API which handles dirty confirm,
        // session profile capture, and feature lifecycle coordination.
        // Lazy-import to avoid circular dependency at module load time.
        void import('../settings/second-drawer-mode').then((m) => {
          m.requestSecondDrawerMode(!getSettings().secondSidebarEnabled)
        }).catch((err) => {
          dwarn('[configure-modal] second-drawer-mode import failed:', err)
        })
      }}
      onCancel={() => {
        closeConfigureTabsModal()
      }}
      onDone={async () => {
        if (!_draftRef || !_baseSnapshotRef) return

        // With auto-commit, edits are already persisted. Flush only if
        // residual dirty (e.g. a commit was still in-flight).
        if (isDraftDirty(_draftRef, _baseSnapshotRef)) {
          renderModal(_draftRef, catalog, null, true)
          const result: CommitResult = await commitConfigureDraft(_draftRef, _baseSnapshotRef)
          if (!result.ok) {
            renderModal(_draftRef, catalog, result.error, false)
            return
          }
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
