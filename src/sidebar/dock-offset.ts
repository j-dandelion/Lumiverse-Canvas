// Dock-panel offset vs pinned tab strips (taskbar mode).
//
// Spindle dock panels (e.g. the LumiScript panel) are edge-anchored
// position:fixed layers (SpindleDockPanel.module.css, z-index 9980) rendered
// INSIDE the app subtree. The Canvas pinned tab strip
// (.sidebar-ux-tab-list-pin-host) is a body-level fixed layer at z-index
// 10000 — always above the entire app subtree — so no z-index manipulation can
// ever make a dock paint over the strip (2026-08-17: the initial "lower the
// strip below the dock" fix failed for exactly this reason).
//
// The intended layout (user expectation): the tab strip stays on the screen
// edge (topmost), and a dock panel on the same edge sits JUST to the inner
// side of it — tab buttons at [0, stripW], dock at [stripW, stripW+dockW]. This
// module applies that by shifting the dock panel's edge anchor inward by the
// strip width (56px) whenever a strip is pinned on the dock's edge. When no
// strip is pinned on that edge the dock stays flush at the screen edge.
//
// The chat-reflow / strip-gutter math reserves the strip width on top of the
// dock inset (the host's App padding already reserves the dock width; the
// strip adds its own 56px), so the shifted dock never overlaps content.
//
// This module deliberately imports only ./styles + ../debug/log so it can be
// called from tab-position, strip-gutter, and chat/reflow without module
// cycles.

import { TAB_LIST_WIDTH_PX } from './styles'
import { dlog } from '../debug/log'

/** Strip width dock panels are shifted by (matches TAB_LIST_WIDTH_PX). */
export const DOCK_EDGE_OFFSET_PX = TAB_LIST_WIDTH_PX

const PIN_HOST_SEL = '.sidebar-ux-tab-list-pin-host'
const SIDE_LEFT_CLASS = 'sidebar-ux-side-left'

/**
 * Read the Spindle dock panel insets from the App's inline CSS variables.
 * These are set by Lumiverse's App.tsx based on the live dock panels per edge
 * (collapsed 36px, expanded panel.size) — 0 for any side with no dock.
 */
export function getDockInsets(): { left: number; right: number } {
  if (typeof document === 'undefined') return { left: 0, right: 0 }
  const appEl = document.querySelector('[data-app-root]') as HTMLElement | null
  if (!appEl) return { left: 0, right: 0 }
  const left = parseFloat(appEl.style.getPropertyValue('--spindle-dock-left')) || 0
  const right = parseFloat(appEl.style.getPropertyValue('--spindle-dock-right')) || 0
  return { left, right }
}

/** Dock-panel nodes identified by a scan (skip re-verification on later scans).
 *  Strong refs are fine — dock panels are few and long-lived; disconnected
 *  nodes are pruned on each full scan. */
const _knownDockNodes = new Set<HTMLElement>()

/** Dock insets from the last scan — a change means the dock layout changed. */
let _lastInsets: { left: number; right: number } | null = null

/** True when a pinned tab strip currently sits on `side` (screen edge). */
function stripPinnedOn(side: 'left' | 'right'): boolean {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    return false
  }
  const hosts = document.querySelectorAll(PIN_HOST_SEL)
  for (const host of Array.from(hosts)) {
    const el = host as HTMLElement
    const s = el.classList.contains(SIDE_LEFT_CLASS) ? 'left' : 'right'
    if (s === side) return true
  }
  return false
}

function readComputedStyle(el: HTMLElement): CSSStyleDeclaration | null {
  try {
    return window.getComputedStyle(el)
  } catch {
    return null
  }
}

/**
 * Find Spindle dock-panel roots: position:fixed, z-index 9980, edge-anchored
 * full-height (top:0 / bottom:0 at left:0 or right:0). Spindle float widgets
 * also use z-index 9980 but are not full-height at a screen edge, so they are
 * excluded by the top/bottom + edge-anchor checks.
 */
function findDockPanels(): HTMLElement[] {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    return []
  }
  const out: HTMLElement[] = []
  // Drop any cached nodes that were removed from the DOM (dock closed/unmounted).
  for (const cached of Array.from(_knownDockNodes)) {
    if (!cached.isConnected) _knownDockNodes.delete(cached)
  }
  const els = document.querySelectorAll('div')
  for (const el of Array.from(els) as HTMLElement[]) {
    if (_knownDockNodes.has(el)) {
      out.push(el)
      continue
    }
    const cs = readComputedStyle(el)
    if (!cs) continue
    if (cs.position !== 'fixed') continue
    if (cs.zIndex !== '9980') continue
    if (cs.top !== '0px' || cs.bottom !== '0px') continue
    // Edge-anchored: the module CSS sets left:0 / right:0, or our own inline
    // offset moved that anchor to 56px. Either way the panel is on an edge.
    if (cs.left !== '0px' && cs.right !== '0px' && !el.style.left && !el.style.right) continue
    _knownDockNodes.add(el)
    out.push(el)
  }
  return out
}

/**
 * Resolve which edge a dock panel is anchored to.
 *
 * The CURRENT edge anchor is the computed 0px side (the module CSS sets
 * `left: 0` or `right: 0`). A previously-applied offset moves that anchor to
 * 56px, so the inline offset only tells us the edge the dock WAS on — which is
 * stale after a mid-session side flip (the same node re-renders with the
 * opposite edge class). Prefer the computed 0px side, then fall back to the
 * offset side, then to the inline offset (test stubs without computed style).
 */
function dockEdgeOf(
  panel: HTMLElement,
  cs: CSSStyleDeclaration | null,
): 'left' | 'right' | null {
  if (cs) {
    if (cs.right === '0px') return 'right'
    if (cs.left === '0px') return 'left'
    // No 0px anchor → an offset is applied (left:56/right:auto or vice versa).
    if (panel.style.left && cs.right === 'auto') return 'left'
    if (panel.style.right && cs.left === 'auto') return 'right'
  }
  if (panel.style.left) return 'left'
  if (panel.style.right) return 'right'
  return null
}

/**
 * Re-apply dock edge offsets from the current pin-strip layout. Safe to call
 * from any trigger (strip pin/unpin, taskbar toggle, side change, dock
 * add/remove/expand/collapse/resize) — recomputes from the live DOM.
 */
export function updateDockOffsets(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  // No dock inset anywhere → no dock panel to offset.
  const dock = getDockInsets()
  if (dock.left === 0 && dock.right === 0) return

  const stripLeft = stripPinnedOn('left')
  const stripRight = stripPinnedOn('right')

  // Full DOM scan only when the dock layout changed (first call, or the
  // --spindle-dock-* insets moved). Otherwise re-apply to known dock nodes.
  const insetsChanged =
    _lastInsets === null ||
    _lastInsets.left !== dock.left ||
    _lastInsets.right !== dock.right
  _lastInsets = { left: dock.left, right: dock.right }
  const panels: HTMLElement[] = insetsChanged
    ? findDockPanels()
    : Array.from(_knownDockNodes)

  for (const panel of panels) {
    const cs = readComputedStyle(panel)
    const edge = dockEdgeOf(panel, cs)
    if (!edge) continue
    const offset = edge === 'left' ? stripLeft : stripRight
    if (offset) {
      if (edge === 'left') {
        if (panel.style.left !== `${DOCK_EDGE_OFFSET_PX}px`) {
          panel.style.left = `${DOCK_EDGE_OFFSET_PX}px`
          dlog('[dock-offset] shifted left dock right of strip', { offset: DOCK_EDGE_OFFSET_PX })
        }
        if (panel.style.right) panel.style.right = ''
      } else {
        if (panel.style.right !== `${DOCK_EDGE_OFFSET_PX}px`) {
          panel.style.right = `${DOCK_EDGE_OFFSET_PX}px`
          dlog('[dock-offset] shifted right dock left of strip', { offset: DOCK_EDGE_OFFSET_PX })
        }
        if (panel.style.left) panel.style.left = ''
      }
    } else if (panel.style.left || panel.style.right) {
      panel.style.left = ''
      panel.style.right = ''
      dlog('[dock-offset] cleared dock edge offset', { edge })
    }
  }
}

/** Test-only: reset module caches so a fresh document scans cleanly. */
export function __resetDockOffsetForTest(): void {
  _knownDockNodes.clear()
  _lastInsets = null
}