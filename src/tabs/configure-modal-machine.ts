/**
 * State machine for Configure Tabs modal.
 *
 * Encapsulates the modal lifecycle, drag-and-drop state, and auto-commit
 * coordination. The machine owns the draft and base snapshot; the UI
 * component reads state and dispatches events.
 */

import type { ConfigureDraft, BaseSnapshot, DrawerSide } from './configure-model'
import type { CatalogTab } from './configure-catalog'
import type { CommitResult } from './configure-commit'

// ── State types ──

export type ModalPhase =
  | 'closed'
  | 'open'
  | 'dirty'
  | 'dragging'
  | 'settling'
  | 'committing'

export interface DragState {
  tabId: string
  fromSide: 'primary' | 'secondary'
  active: boolean
  overlay: HTMLElement | null
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  lastDropTarget: { side: 'primary' | 'secondary'; index: number } | null
  flipRects: Map<string, DOMRect> | null
  draftSnapshot: ConfigureDraft | null
}

export interface ModalMachineState {
  phase: ModalPhase
  draft: ConfigureDraft | null
  base: BaseSnapshot | null
  catalog: CatalogTab[]
  baseEpoch: number
  drag: DragState | null
  commitInFlight: Promise<CommitResult> | null
  commitError: string | null
}

// ── Event types ──

export type ModalEvent =
  | { type: 'OPEN'; draft: ConfigureDraft; base: BaseSnapshot; catalog: CatalogTab[] }
  | { type: 'CLOSE' }
  | { type: 'EDIT'; nextDraft: ConfigureDraft }
  | { type: 'AUTO_COMMIT_START'; promise: Promise<CommitResult>; draft: ConfigureDraft; base: BaseSnapshot; epoch: number }
  | { type: 'AUTO_COMMIT_OK'; draft: ConfigureDraft; base: BaseSnapshot }
  | { type: 'AUTO_COMMIT_FAIL'; error: string }
  | { type: 'DRAG_START'; tabId: string; side: 'primary' | 'secondary'; startX: number; startY: number; draftSnapshot: ConfigureDraft }
  | { type: 'DRAG_ACTIVATE'; overlay: HTMLElement; offsetX: number; offsetY: number }
  | { type: 'DRAG_MOVE'; dropTarget: { side: 'primary' | 'secondary'; index: number } | null }
  | { type: 'DROP' }
  | { type: 'SETTLE_COMPLETE' }
  | { type: 'DRAG_CANCEL'; revertDraft: boolean }

// ── Transition function ──

export function modalTransition(
  state: ModalMachineState,
  event: ModalEvent,
): ModalMachineState {
  switch (event.type) {
    case 'OPEN':
      return {
        ...state,
        phase: 'open',
        draft: event.draft,
        base: event.base,
        catalog: event.catalog,
        baseEpoch: state.baseEpoch + 1,
        drag: null,
        commitInFlight: null,
        commitError: null,
      }

    case 'CLOSE':
      return {
        ...state,
        phase: 'closed',
        draft: null,
        base: null,
        catalog: [],
        drag: null,
        commitInFlight: null,
        commitError: null,
      }

    case 'EDIT':
      return {
        ...state,
        phase: 'dirty',
        draft: event.nextDraft,
      }

    case 'AUTO_COMMIT_START':
      return {
        ...state,
        phase: 'committing',
        commitInFlight: event.promise,
        commitError: null,
      }

    case 'AUTO_COMMIT_OK':
      return {
        ...state,
        phase: 'open',
        draft: event.draft,
        base: event.base,
        commitInFlight: null,
        commitError: null,
      }

    case 'AUTO_COMMIT_FAIL':
      return {
        ...state,
        phase: 'dirty',
        commitInFlight: null,
        commitError: event.error,
      }

    case 'DRAG_START':
      return {
        ...state,
        phase: 'dragging',
        drag: {
          tabId: event.tabId,
          fromSide: event.side,
          active: false,
          overlay: null,
          startX: event.startX,
          startY: event.startY,
          offsetX: 0,
          offsetY: 0,
          lastDropTarget: null,
          flipRects: null,
          draftSnapshot: event.draftSnapshot,
        },
      }

    case 'DRAG_ACTIVATE':
      if (!state.drag) return state
      return {
        ...state,
        drag: {
          ...state.drag,
          active: true,
          overlay: event.overlay,
          offsetX: event.offsetX,
          offsetY: event.offsetY,
        },
      }

    case 'DRAG_MOVE':
      if (!state.drag) return state
      return {
        ...state,
        drag: {
          ...state.drag,
          lastDropTarget: event.dropTarget,
        },
      }

    case 'DROP':
      if (!state.drag) return state
      return {
        ...state,
        phase: 'settling',
      }

    case 'SETTLE_COMPLETE':
      return {
        ...state,
        phase: 'dirty',
        drag: null,
      }

    case 'DRAG_CANCEL':
      if (!state.drag) return state
      return {
        ...state,
        phase: state.phase === 'dragging' ? 'dirty' : state.phase,
        drag: null,
      }

    default:
      return state
  }
}

// ── Initial state ──

export const INITIAL_MODAL_STATE: ModalMachineState = {
  phase: 'closed',
  draft: null,
  base: null,
  catalog: [],
  baseEpoch: 0,
  drag: null,
  commitInFlight: null,
  commitError: null,
}
