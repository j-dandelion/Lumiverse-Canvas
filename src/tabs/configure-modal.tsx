/** @jsxImportSource preact */
// Configure Tabs modal — Preact-based UI for reordering and hiding drawer tabs.
//
// Renders as a fixed overlay with a two-column layout. Left/right column
// mapping depends on the main drawer side (leftColumnIsSecondary). All
// mutations operate on a draft ConfigureDraft until "Done" is clicked,
// at which point commitConfigureDraft is called.

import { h, render } from 'preact'
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import {
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
  type TabSide,
} from './configure-model'
import { getFullCatalog, type CatalogTab } from './configure-catalog'
import { getHostDrawerSettings, isHostDrawerSettingsWritable } from '../dom/host-settings'
import { getMainDrawerSide } from '../store'
import { getTabAssignments } from './assignment'
import { commitConfigureDraft, type CommitResult } from './configure-commit'
import { isConfigureBatchActive } from './configure-commit'
import { dlog, dwarn } from '../debug/log'

// ── Module state ──

let _modalContainer: HTMLElement | null = null
let _draftRef: ConfigureDraft | null = null
let _baseSnapshotRef: BaseSnapshot | null = null

// ── Style injection ──

const MODAL_STYLE_ID = 'canvas-configure-tabs-styles'

function injectModalStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(MODAL_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = MODAL_STYLE_ID
  style.textContent = `
    .canvas-configure-tabs-overlay {
      position: fixed;
      inset: 0;
      z-index: 12000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
      animation: canvasConfigureFadeIn 150ms ease-out;
    }
    @keyframes canvasConfigureFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .canvas-configure-tabs-dialog {
      display: flex;
      flex-direction: column;
      width: min(90vw, 720px);
      max-height: min(90vh, 600px);
      background: var(--lumiverse-bg, #1a1a2e);
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 12px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
      color: var(--lumiverse-text, #eee);
      font-family: var(--lumiverse-font-family, sans-serif);
      animation: canvasConfigureSlideIn 150ms ease-out;
    }
    @keyframes canvasConfigureSlideIn {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .canvas-configure-tabs-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--lumiverse-border, #333);
    }
    .canvas-configure-tabs-header h2 {
      margin: 0;
      font-size: calc(16px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
    }
    .canvas-configure-tabs-swap-btn {
      padding: 6px 14px;
      border: 1px solid var(--lumiverse-border, #333);
      border-radius: 6px;
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
      color: var(--lumiverse-text, #eee);
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      font-family: inherit;
      cursor: pointer;
      transition: background 120ms ease;
    }
    .canvas-configure-tabs-swap-btn:hover {
      background: var(--lumiverse-fill-strong, rgba(255,255,255,0.12));
    }
    .canvas-configure-tabs-body {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .canvas-configure-tabs-column {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      width: 50%;
    }
    .canvas-configure-tabs-column + .canvas-configure-tabs-column {
      border-left: 1px solid var(--lumiverse-border, #333);
    }
    .canvas-configure-tabs-column-header {
      padding: 10px 16px;
      font-size: calc(11px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--lumiverse-text-muted, #888);
      border-bottom: 1px solid var(--lumiverse-border, #333);
    }
    .canvas-configure-tabs-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .canvas-configure-tabs-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      margin: 1px 6px;
      border-radius: 6px;
      background: transparent;
      transition: background 80ms ease;
      cursor: grab;
      user-select: none;
    }
    .canvas-configure-tabs-row:hover {
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
    }
    .canvas-configure-tabs-row.dragging {
      opacity: 0.4;
    }
    .canvas-configure-tabs-row.drag-over {
      border-top: 2px solid var(--lumiverse-primary, #4a9eff);
    }
    .canvas-configure-tabs-row.hidden-row {
      opacity: 0.45;
    }
    .canvas-configure-tabs-drag-handle {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      opacity: 0.35;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .canvas-configure-tabs-drag-handle svg {
      width: 14px;
      height: 14px;
    }
    .canvas-configure-tabs-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
    }
    .canvas-configure-tabs-title .kind-tag {
      font-size: calc(9.5px * var(--lumiverse-font-scale, 1));
      color: var(--lumiverse-text-muted, #888);
      margin-left: 6px;
    }
    .canvas-configure-tabs-hide-toggle {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      border: 1px solid var(--lumiverse-border, #333);
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      color: var(--lumiverse-text-muted, #888);
      transition: background 120ms ease, border-color 120ms ease;
    }
    .canvas-configure-tabs-hide-toggle:hover:not(:disabled) {
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
    }
    .canvas-configure-tabs-hide-toggle.hidden {
      background: var(--lumiverse-danger-015, rgba(229,69,69,0.15));
      border-color: var(--lumiverse-error, #e54545);
      color: var(--lumiverse-error, #e54545);
    }
    .canvas-configure-tabs-hide-toggle:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    .canvas-configure-tabs-empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--lumiverse-text-muted, #666);
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
    }
    .canvas-configure-tabs-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 20px;
      border-top: 1px solid var(--lumiverse-border, #333);
    }
    .canvas-configure-tabs-btn {
      padding: 8px 20px;
      border-radius: 8px;
      border: 1px solid var(--lumiverse-border, #333);
      background: var(--lumiverse-fill, rgba(255,255,255,0.06));
      color: var(--lumiverse-text, #eee);
      font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
      font-family: inherit;
      cursor: pointer;
      transition: background 120ms ease;
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
      padding: 8px 20px;
      color: var(--lumiverse-error, #e54545);
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      text-align: right;
    }
  `
  document.head.appendChild(style)
}

// ── Drag-and-drop helpers ──

// We store drag state in module vars rather than component state to avoid
// re-render overhead during drag.
let _dragTabId: string | null = null
let _dragFromSide: 'primary' | 'secondary' | null = null

// ── Component ──

type ColumnSide = 'primary' | 'secondary'

interface ModalProps {
  draft: ConfigureDraft
  catalog: CatalogTab[]
  primaryTabs: CatalogTab[]
  secondaryTabs: CatalogTab[]
  commitError: string | null
  committing: boolean
  onSwapSide: () => void
  onToggleHide: (tabId: string, hidden: boolean) => void
  onDrop: (tabId: string, fromSide: ColumnSide, toSide: ColumnSide, toIndex: number) => void
  onReorder: (side: DrawerSide, fromIndex: number, toIndex: number) => void
  onCancel: () => void
  onDone: () => void
}

function ConfigureTabsModalInner(props: ModalProps) {
  const {
    draft, catalog, primaryTabs, secondaryTabs,
    commitError, committing,
    onSwapSide, onToggleHide, onDrop, onReorder,
    onCancel, onDone,
  } = props

  const leftIsSecondaryVal = leftColumnIsSecondary(draft.drawerSide)

  // Drag state refs (no re-render on drag events).
  const dragOverIndexRef = useRef<number>(-1)
  const dragOverSideRef = useRef<ColumnSide | null>(null)

  // ── Drag handlers ──

  const handleDragStart = useCallback((e: DragEvent, tabId: string, side: ColumnSide) => {
    _dragTabId = tabId
    _dragFromSide = side
    e.dataTransfer?.setData('text/plain', tabId)
    e.dataTransfer!.effectAllowed = 'move'
    // Set a custom drag image (optional)
    const target = e.currentTarget as HTMLElement
    target.classList.add('dragging')
  }, [])

  const handleDragEnd = useCallback((e: DragEvent) => {
    _dragTabId = null
    _dragFromSide = null
    dragOverIndexRef.current = -1
    dragOverSideRef.current = null
    const target = e.currentTarget as HTMLElement
    target.classList.remove('dragging')
    // Remove all drag-over indicators.
    document.querySelectorAll('.canvas-configure-tabs-row.drag-over').forEach((el) => {
      el.classList.remove('drag-over')
    })
  }, [])

  const handleDragOver = useCallback((e: DragEvent, index: number, side: ColumnSide) => {
    e.preventDefault()
    if (!e.dataTransfer) return
    e.dataTransfer.dropEffect = 'move'
    // Visual indicator.
    const target = e.currentTarget as HTMLElement
    if (dragOverIndexRef.current !== index || dragOverSideRef.current !== side) {
      document.querySelectorAll('.canvas-configure-tabs-row.drag-over').forEach((el) => {
        el.classList.remove('drag-over')
      })
      target.classList.add('drag-over')
      dragOverIndexRef.current = index
      dragOverSideRef.current = side
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    const target = e.currentTarget as HTMLElement
    target.classList.remove('drag-over')
    if (dragOverIndexRef.current !== -1) {
      // Clear only if this was the last target.
    }
  }, [])

  const handleDrop = useCallback((e: DragEvent, toIndex: number, toSide: ColumnSide) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.classList.remove('drag-over')

    const draggedTabId = _dragTabId
    const fromSide = _dragFromSide

    if (!draggedTabId || !fromSide) return

    if (fromSide === toSide) {
      // Reorder within the same column.
      const list = fromSide === 'primary' ? draft.primaryIds : draft.secondaryIds
      const fromIdx = list.indexOf(draggedTabId)
      if (fromIdx === -1) return
      // Map column side to DrawerSide for reorderWithin.
      // Column 'primary' = spatial right when drawerSide=right, spatial left when drawerSide=left.
      const spatialSide: DrawerSide = leftIsSecondaryVal
        ? (fromSide === 'primary' ? 'right' : 'left')
        : (fromSide === 'primary' ? 'left' : 'right')
      onReorder(spatialSide, fromIdx, toIndex)
    } else {
      // Move to the other column.
      // Determine where to insert: before the element at toIndex.
      // If the drop is on an existing row, insert at that row's index.
      // If dropped on the list container (not a row), append.
      onDrop(draggedTabId, fromSide, toSide, toIndex)
    }

    _dragTabId = null
    _dragFromSide = null
    dragOverIndexRef.current = -1
    dragOverSideRef.current = null
  }, [draft, leftIsSecondaryVal, onReorder, onDrop])

  // ── Render helpers ──

  /** Render a single tab row. */
  const renderTabRow = (tab: CatalogTab, index: number, side: ColumnSide) => {
    const isHidden = draft.hiddenIds.has(tab.id)
    return (
      <div
        class={`canvas-configure-tabs-row${isHidden ? ' hidden-row' : ''}`}
        draggable={true}
        onDragStart={(e) => handleDragStart(e, tab.id, side)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOver(e, index, side)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, index, side)}
        key={tab.id}
      >
        {/* Drag handle */}
        <span class="canvas-configure-tabs-drag-handle" title="Drag to reorder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="5" r="1.5" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="5" r="1.5" fill="currentColor" stroke="none"/>
            <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/>
            <circle cx="9" cy="19" r="1.5" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="19" r="1.5" fill="currentColor" stroke="none"/>
          </svg>
        </span>

        {/* Title */}
        <span class="canvas-configure-tabs-title">
          {tab.title}
          {tab.kind === 'extension' && tab.extensionId && (
            <span class="kind-tag">({tab.extensionId})</span>
          )}
        </span>

        {/* Hide toggle */}
        <button
          class={`canvas-configure-tabs-hide-toggle${isHidden ? ' hidden' : ''}`}
          disabled={tab.hideLocked}
          title={tab.hideLocked ? 'Cannot hide this tab' : (isHidden ? 'Show tab' : 'Hide tab')}
          onClick={(e) => {
            e.stopPropagation()
            onToggleHide(tab.id, !isHidden)
          }}
        >
          {isHidden ? '✓' : '○'}
        </button>
      </div>
    )
  }

  const primaryList = (
    <div class="canvas-configure-tabs-list"
      onDragOver={(e) => {
        // Allow dropping on the empty list area.
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        // Drop on the container (append to end).
        handleDrop(e, primaryTabs.length, 'primary')
      }}
    >
      {primaryTabs.length === 0 ? (
        <div class="canvas-configure-tabs-empty">No tabs assigned</div>
      ) : (
        primaryTabs.map((tab, i) => renderTabRow(tab, i, 'primary'))
      )}
    </div>
  )

  const secondaryList = (
    <div class="canvas-configure-tabs-list"
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        handleDrop(e, secondaryTabs.length, 'secondary')
      }}
    >
      {secondaryTabs.length === 0 ? (
        <div class="canvas-configure-tabs-empty">No tabs assigned</div>
      ) : (
        secondaryTabs.map((tab, i) => renderTabRow(tab, i, 'secondary'))
      )}
    </div>
  )

  // Column order depends on drawer side.
  const leftColumn = leftIsSecondaryVal ? secondaryList : primaryList
  const rightColumn = leftIsSecondaryVal ? primaryList : secondaryList
  const leftLabel = leftIsSecondaryVal ? 'Second Drawer Tabs' : 'Main Drawer Tabs'
  const rightLabel = leftIsSecondaryVal ? 'Main Drawer Tabs' : 'Second Drawer Tabs'

  return (
    <div
      class="canvas-configure-tabs-overlay"
      onClick={(e) => {
        // Only close when clicking the overlay itself.
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !committing) onCancel()
      }}
    >
      <div class="canvas-configure-tabs-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div class="canvas-configure-tabs-header">
          <h2>Configure Tabs</h2>
          <button class="canvas-configure-tabs-swap-btn" onClick={onSwapSide}>
            Swap drawers
          </button>
        </div>

        {/* Body: two columns */}
        <div class="canvas-configure-tabs-body">
          <div class="canvas-configure-tabs-column">
            <div class="canvas-configure-tabs-column-header">{leftLabel}</div>
            {leftColumn}
          </div>
          <div class="canvas-configure-tabs-column">
            <div class="canvas-configure-tabs-column-header">{rightLabel}</div>
            {rightColumn}
          </div>
        </div>

        {/* Error */}
        {commitError && (
          <div class="canvas-configure-tabs-error">{commitError}</div>
        )}

        {/* Footer */}
        <div class="canvas-configure-tabs-footer">
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
            {committing ? 'Applying…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal controller ──

/**
 * Open the Configure Tabs modal.
 * Builds the initial draft from current host state and renders the Preact component.
 */
export function openConfigureTabsModal(): void {
  if (typeof document === 'undefined') return
  if (_modalContainer) {
    // Already open — bring to front.
    _modalContainer.style.display = 'flex'
    return
  }

  injectModalStyles()

  // Build initial draft.
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

  _draftRef = draft

  // Build base snapshot for dirty check.
  _baseSnapshotRef = {
    tabOrder: hostSettings?.tabOrder || [],
    hiddenTabIds: hostSettings?.hiddenTabIds || [],
    drawerSide,
    assignments: new Map(currentAssignments),
  }

  // Create container and render.
  _modalContainer = document.createElement('div')
  _modalContainer.id = 'canvas-configure-tabs-modal'
  document.body.appendChild(_modalContainer)

  renderModal(draft, catalog, null, false)
}

/**
 * Close the Configure Tabs modal.
 * If dirty, returns false and caller should handle confirmation.
 */
export function closeConfigureTabsModal(): boolean {
  if (!_modalContainer) return true

  // Check dirty state.
  if (_draftRef && _baseSnapshotRef) {
    if (isDraftDirty(_draftRef, _baseSnapshotRef)) {
      // Attempt to confirm via a simple confirm dialog.
      if (typeof window !== 'undefined' && !window.confirm('Discard changes?')) {
        return false
      }
    }
  }

  unmountModal()
  return true
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
      onSwapSide={() => {
        if (!_draftRef) return
        const next = swapDrawerSide(_draftRef)
        _draftRef = next
        renderModal(next, catalog, null, false)
      }}
      onToggleHide={(tabId, hidden) => {
        if (!_draftRef) return
        const next = setHidden(_draftRef, tabId, hidden)
        _draftRef = next
        renderModal(next, catalog, null, false)
      }}
      onDrop={(tabId, fromSide, toSide, toIndex) => {
        if (!_draftRef) return
        const next = moveTab(_draftRef, tabId, toSide, toIndex)
        _draftRef = next
        renderModal(next, catalog, null, false)
      }}
      onReorder={(side, fromIndex, toIndex) => {
        if (!_draftRef) return
        const next = reorderWithin(_draftRef, side, fromIndex, toIndex)
        _draftRef = next
        renderModal(next, catalog, null, false)
      }}
      onCancel={() => {
        closeConfigureTabsModal()
      }}
      onDone={async () => {
        if (!_draftRef || !_baseSnapshotRef) return
        // Show committing state.
        renderModal(_draftRef, catalog, null, true)

        const result: CommitResult = await commitConfigureDraft(_draftRef, _baseSnapshotRef)
        if (result.ok) {
          dlog('[configure-modal] commit successful')
          unmountModal()
        } else {
          dlog('[configure-modal] commit failed:', result.error)
          renderModal(_draftRef, catalog, result.error, false)
        }
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
}
