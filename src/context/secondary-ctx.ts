// CanvasSecondaryCtx: a SpindleFrontendContext mirror for re-executing
// extension bundles in the secondary drawer. Routes UI calls to Canvas's
// secondary state instead of Lumiverse's host state.
//
// This is the context object passed to extension setup() when the extension
// is re-executed in the secondary drawer. The primary difference from the
// real ctx is that registerDrawerTab is intercepted to create Canvas-owned
// DOM elements (root + button) in the secondary drawer, bypassing the
// host's tab list entirely.

import type {
  SpindleFrontendContext,
  SpindleDrawerTabHandle,
  SpindleDrawerTabOptions,
  SpindleDOMHelper,
  SpindleUIEventsHelper,
  SpindleComponentsHelper,
  SpindleFrontendProcessRegistry,
} from 'lumiverse-spindle-types'
import { getSecondaryWrapper, PUZZLE_ICON_SVG } from '../sidebar/secondary'
import { showSecondaryTab, deriveShortName } from '../tabs/buttons'
import { isShowTabLabels } from '../sidebar/drawer-sync'
import { setTabAssignment, getTabAssignments } from '../tabs/assignment'
import { showAssignmentMenu } from '../tabs/tab-context-menu'

// Test seam for isShowTabLabels — allows tests to override the real implementation
let _isShowTabLabelsOverride: (() => boolean) | null = null
export function __setIsShowTabLabelsForTest(fn: (() => boolean) | null): void {
  _isShowTabLabelsOverride = fn
}

export interface SecondaryTabHandle {
  handle: SpindleDrawerTabHandle
  extensionId: string
  activate(): void
}

/**
 * A SpindleFrontendContext-shaped object for re-executing extension bundles
 * in the secondary drawer. Most of the surface is pass-through; the key
 * interception is registerDrawerTab which creates Canvas-owned tab DOM
 * (a content root and a sidebar button) rather than delegating to the host.
 */
export interface CanvasSecondaryCtx {
  /** DOM scoped to the secondary wrapper — pass-through from primary ctx. */
  dom: SpindleDOMHelper
  /** UI — registerDrawerTab routes to Canvas-owned secondary tab list. */
  ui: {
    events: SpindleUIEventsHelper
    mount: SpindleFrontendContext['ui']['mount']
    registerDrawerTab(options: SpindleDrawerTabOptions): SpindleDrawerTabHandle
    createFloatWidget: SpindleFrontendContext['ui']['createFloatWidget']
    requestDockPanel: SpindleFrontendContext['ui']['requestDockPanel']
    mountApp: SpindleFrontendContext['ui']['mountApp']
    registerInputBarAction: SpindleFrontendContext['ui']['registerInputBarAction']
    showContextMenu: SpindleFrontendContext['ui']['showContextMenu']
    showModal: SpindleFrontendContext['ui']['showModal']
    showConfirm: SpindleFrontendContext['ui']['showConfirm']
  }
  /** Canvas-internal event bus. */
  events: SpindleFrontendContext['events']
  /** Shared WebSocket — pass through. */
  sendToBackend: SpindleFrontendContext['sendToBackend']
  onBackendMessage: SpindleFrontendContext['onBackendMessage']
  /** Uploads — pass through. */
  uploads: SpindleFrontendContext['uploads']
  /** Messages — pass through. */
  messages: SpindleFrontendContext['messages']
  /** Processes — pass through. */
  processes: SpindleFrontendProcessRegistry
  /** Components — pass through. */
  components: SpindleComponentsHelper
  /** Permissions — pass through. */
  permissions: SpindleFrontendContext['permissions']
  /** Active chat — pass through. */
  getActiveChat: SpindleFrontendContext['getActiveChat']
  /** Characters — pass through. */
  characters: SpindleFrontendContext['characters']
  /** Chats — pass through. */
  chats: SpindleFrontendContext['chats']
  /** Manifest — pass through. */
  manifest: SpindleFrontendContext['manifest']
  /** Which extension this ctx is for. */
  extensionId: string
}

// ── Internal state ─────────────────────────────────────────────────────────

/**
 * Canvas-owned secondary tab entries. Keyed by `${extensionId}::${options.id}`
 * (the composite key ensures uniqueness across extensions).
 *
 * Each entry holds:
 * - `handle` — the SpindleDrawerTabHandle returned to the extension
 * - `root` — the content div mounted in `.sidebar-ux-panel-content`
 * - `button` — the tab button mounted in `.sidebar-ux-tab-list`
 * - `activateHandlers` — callbacks fired when this tab is activated
 * - `extensionId` — the owning extension's UUID
 * - `optionsId` — the options.id from registerDrawerTab
 */
interface SecondaryEntry {
  handle: SpindleDrawerTabHandle
  root: HTMLElement
  button: HTMLButtonElement
  activateHandlers: Set<() => void>
  extensionId: string
  optionsId: string
}

const _secondaryEntries: Map<string, SecondaryEntry> = new Map()

// Backward-compat map for clearSecondaryTabs — keyed by tabId (options.id).
let _secondaryTabs: Map<string, SpindleDrawerTabHandle> = new Map()

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a no-op SpindleDrawerTabHandle for when the secondary wrapper
 * hasn't been mounted yet. The handle's root is detached from the DOM
 * and its destroy() removes it.
 */
function makeNoOpHandle(tabId: string, root: HTMLElement): SpindleDrawerTabHandle {
  return {
    root,
    tabId,
    activate() { /* no-op */ },
    destroy() { root.remove() },
    setTitle() { /* no-op */ },
    setShortName() { /* no-op */ },
    setBadge() { /* no-op */ },
    onActivate() { return () => {} },
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a CanvasSecondaryCtx that mirrors the primary SpindleFrontendContext
 * but intercepts registerDrawerTab to create Canvas-owned DOM elements
 * (a content root in `.sidebar-ux-panel-content` and a tab button in
 * `.sidebar-ux-tab-list`) instead of delegating to the host's tab list.
 *
 * Design rationale:
 * - The host's tab list is managed by Lumiverse's ViewportDrawer; we
 *   cannot add arbitrary tabs there. Instead, Canvas owns its own
 *   secondary tab list that sits inside the secondary wrapper.
 * - Each extension's setup() calls ctx.ui.registerDrawerTab(options),
 *   which creates the root div and button as a side-effect.
 * - The activate() function handles visibility toggling (showing this
 *   root, hiding others) and fires registered activate handlers.
 * - Idempotency: duplicate (extensionId, options.id) pairs return the
 *   existing handle.
 * - Auto-activate: the first tab registered is automatically activated
 *   so the secondary drawer is never empty.
 *
 * @param primaryCtx - the real SpindleFrontendContext from the host
 * @param extensionId - the extension being re-executed
 * @param targetBackend - optional {sendToBackend, onBackendMessage} from the
 *                        target extension's context (obtained via
 *                        window.spindle.ui.getExtensionBackend). When
 *                        provided, the re-executed extension's backend
 *                        messages are routed to the target extension's
 *                        worker. When null, falls back to primaryCtx
 *                        (canvas_ext's context) — messages will be
 *                        misrouted to canvas_ext's worker.
 * @param onActivate - callback when a secondary tab is activated (routes to
 *                     SecondaryDrawer.activateSecondaryTab)
 */
export function buildCanvasSecondaryCtx(
  primaryCtx: SpindleFrontendContext,
  extensionId: string,
  targetBackend?: {
    sendToBackend: (payload: unknown) => void
    onBackendMessage: (handler: (payload: unknown) => void) => () => void
  } | null,
  onActivate?: (tabId: string) => void
): CanvasSecondaryCtx {
  // Route backend messages through the target extension's bus when
  // available. The target's sendToBackend closes over the target's
  // extensionId, so WS messages are tagged with the correct ID and
  // reach the target's worker. The target's onBackendMessage registers
  // handlers on the target's backendHandlers Set, so responses from
  // the target's worker fire the re-executed extension's handlers.
  // Fallback to primaryCtx (canvas_ext) when target is not loaded —
  // messages will be misrouted but the wrapper stays functional.
  const sendToBackend = targetBackend
    ? targetBackend.sendToBackend
    : primaryCtx.sendToBackend.bind(primaryCtx)
  const onBackendMessage = targetBackend
    ? targetBackend.onBackendMessage
    : primaryCtx.onBackendMessage.bind(primaryCtx)

  return {
    extensionId,
    dom: primaryCtx.dom,
    ui: {
      events: primaryCtx.ui.events,
      mount: primaryCtx.ui.mount.bind(primaryCtx.ui),
      registerDrawerTab: (options: SpindleDrawerTabOptions): SpindleDrawerTabHandle => {
        const compositeKey = `${extensionId}::${options.id}`

        // Register the tab as belonging to the secondary sidebar so
        // getTabSidebar() returns 'secondary' and the context menu shows
        // the correct action (Move to main drawer).
        setTabAssignment(options.id, 'secondary')

        // Idempotency — return the existing handle if already registered.
        const existing = _secondaryEntries.get(compositeKey)
        if (existing) {
          // Re-activate on re-registration: when a tab is moved into the
          // secondary drawer (e.g. via requestTabLocation), the extension's
          // setup() runs again and re-calls registerDrawerTab. The wrapper
          // should make the moved-in tab active. Re-using the existing
          // handle.activate() runs the same cascade as a click.
          existing.handle.activate()
          return existing.handle
        }

        // If the secondary wrapper isn't mounted yet, return a no-op handle.
        const wrapper = getSecondaryWrapper()
        if (!wrapper) {
          const detachedRoot = document.createElement('div')
          return makeNoOpHandle(options.id, detachedRoot)
        }

        // ── Create Canvas-owned content root ──────────────────────────
        // NOTE: do NOT set data-canvas-active on creation. Only the first
        // tab (auto-activated below) gets it via activateFn(). New tabs
        // added later are hidden by the CSS rule
        // `[data-canvas-moved]:not([data-canvas-active]) { display: none }`
        // until the user clicks them.
        //
        // data-canvas-secondary marks this as a wrapper-owned root so the
        // OLD showSecondaryTab movedRoots loop in tabs/buttons.ts can skip
        // it (the loop iterates all [data-canvas-moved] and removes
        // data-canvas-active from non-matching ones; without this marker
        // it would hide the wrapper's tab when called with a composite
        // Lumiverse id).
        const root = document.createElement('div')
        root.setAttribute('data-canvas-moved', options.id)
        root.setAttribute('data-canvas-secondary', '')
        root.style.cssText = 'width: 100%; height: 100%; box-sizing: border-box; display: flex; flex-direction: column;'

        const panelContent = wrapper.querySelector('.sidebar-ux-panel-content')
        if (panelContent) panelContent.appendChild(root)

        // ── Create Canvas-owned tab button ────────────────────────────
        const showLabels = _isShowTabLabelsOverride ? _isShowTabLabelsOverride() : isShowTabLabels()
        const btn = document.createElement('button')
        btn.setAttribute('data-tab-id', options.id)
        btn.setAttribute('title', options.title)
        btn.classList.add('sidebar-ux-tab-secondary-canvas')
        btn.style.cssText = `
          width: 100%;
          height: ${showLabels ? '56px' : '48px'};
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
          border-radius: 8px;
          background: transparent;
          border: none;
          color: var(--lumiverse-text-muted);
          cursor: pointer;
          transition: all 0.2s ease;
        `

        // Icon span
        const iconWrap = document.createElement('span')
        iconWrap.style.cssText = 'display: flex; align-items: center; justify-content: center; flex-shrink: 0;'
        if (options.iconSvg) {
          iconWrap.innerHTML = options.iconSvg
        } else if (options.iconUrl) {
          const img = document.createElement('img')
          img.src = options.iconUrl
          img.alt = ''
          img.width = 20
          img.height = 20
          img.style.borderRadius = '2px'
          iconWrap.appendChild(img)
        } else {
          iconWrap.innerHTML = PUZZLE_ICON_SVG
        }
        btn.appendChild(iconWrap)

        // Label span
        const labelSpan = document.createElement('span')
        labelSpan.className = 'sidebar-ux-tab-label'
        labelSpan.textContent = deriveShortName(options.title, options.shortName)
        labelSpan.style.cssText = `
          font-size: calc(9px * var(--lumiverse-font-scale, 1));
          font-weight: 500;
          line-height: 1;
          color: var(--lumiverse-text-dim);
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 48px;
          opacity: ${showLabels ? '1' : '0'};
          height: ${showLabels ? 'auto' : '0'};
          margin-top: ${showLabels ? '1px' : '0'};
          transition: opacity 0.2s ease, height 0.2s ease, margin 0.2s ease;
        `
        btn.appendChild(labelSpan)

        // ── Activate handlers ─────────────────────────────────────────
        const activateHandlers = new Set<() => void>()

        /**
         * Activate this tab: show this root, hide all other Canvas-owned
         * roots; mark this button active (class + inline style), demote
         * all other Canvas-owned buttons. Update the panel header to
         * reflect the active tab's title. Fire activate handlers and
         * call onActivate callback.
         *
         * The active visual is now driven by CSS in src/sidebar/styles.ts
         * via .sidebar-ux-tab-active — matches Lumiverse's .tabBtnActive
         * (ViewportDrawer.module.css:227-237). The activateFn toggles
         * the class and clears inline overrides so CSS takes over.
         */
        const activateFn = () => {
          // Toggle Canvas-owned roots
          if (panelContent) {
            const allRoots = panelContent.querySelectorAll('[data-canvas-moved]') as NodeListOf<HTMLElement>
            for (const r of allRoots) {
              if (r === root) {
                r.setAttribute('data-canvas-active', '')
              } else {
                r.removeAttribute('data-canvas-active')
              }
            }
          }

          // Toggle Canvas-owned buttons — class toggle drives the visual.
          // CSS in src/sidebar/styles.ts handles active state via
          // .sidebar-ux-tab-active (matches Lumiverse's .tabBtnActive).
          const tabList = wrapper.querySelector('.sidebar-ux-tab-list')
          if (tabList) {
            const allBtns = tabList.querySelectorAll('.sidebar-ux-tab-secondary-canvas') as NodeListOf<HTMLButtonElement>
            for (const b of allBtns) {
              const isActive = b === btn
              b.classList.toggle('sidebar-ux-tab-active', isActive)
              if (isActive) {
                // CSS drives the active visual; clear inline overrides.
                b.style.color = ''
                b.style.background = ''
                b.style.boxShadow = ''
                b.style.borderRadius = ''
                const label = b.querySelector('.sidebar-ux-tab-label') as HTMLElement
                if (label) {
                  label.style.color = ''
                }
              } else {
                b.style.color = ''
                b.style.background = ''
                b.style.boxShadow = ''
                b.style.borderRadius = ''
                const label = b.querySelector('.sidebar-ux-tab-label') as HTMLElement
                if (label) {
                  label.style.color = ''
                }
              }
            }

            // MIRROR OF BUG 2 FIX (buttons.ts:401-409): wrapper activation must
            // demote built-in tab buttons. Built-in buttons have data-tab-id but
            // lack .sidebar-ux-tab-secondary-canvas. Without this, when both a
            // wrapper tab and a built-in tab exist in the secondary drawer and
            // the user activates the wrapper, the built-in button keeps its
            // sidebar-ux-tab-active class and inline active styles.
            const builtInBtns = tabList.querySelectorAll(
              'button[data-tab-id]:not(.sidebar-ux-tab-secondary-canvas)',
            ) as NodeListOf<HTMLElement>
            for (const b of builtInBtns) {
              b.classList.remove('sidebar-ux-tab-active')
              b.style.color = ''
              b.style.background = ''
              b.style.boxShadow = ''
              b.style.borderRadius = ''
              const label = b.querySelector('.sidebar-ux-tab-label') as HTMLElement
              if (label) {
                label.style.color = ''
              }
            }
          }

          // Update the panel header title to the active tab's title.
          // The OLD showSecondaryTab does this at buttons.ts:353-357, but
          // it's filtered out for the wrapper's tabs (the loop iterates
          // movedRoots, which excludes the wrapper's data-canvas-secondary
          // roots), so the wrapper must update the header itself.
          const title = wrapper.querySelector('.sidebar-ux-panel-title')
          if (title) {
            const headerTitle = options.headerTitle || options.title
            title.textContent = headerTitle
          }

          // Fire registered activate handlers
          for (const h of activateHandlers) {
            try { h() } catch { /* best-effort */ }
          }

          onActivate?.(options.id)
        }

        // Wire click → activateFn
        btn.addEventListener('click', activateFn)

        // Hover handlers — mirror the OLD addSecondaryTabButton in tabs/buttons.ts:245-268.
        // Guard with the active class so hover never overwrites the !important
        // active background set by activateFn at lines 338-340.
        btn.addEventListener('mouseenter', () => {
          if (!btn.classList.contains('sidebar-ux-tab-active')) {
            btn.style.background = 'var(--lumiverse-primary-015)'
          }
        })
        btn.addEventListener('mouseleave', () => {
          if (!btn.classList.contains('sidebar-ux-tab-active')) {
            btn.style.background = ''
          }
        })

        // Suppress browser context menu on wrapper buttons. The OLD
        // addSecondaryTabButton at tabs/buttons.ts:273-276 also shows an
        // assignment menu; wiring that for the wrapper is deferred.
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          e.stopPropagation()
          showAssignmentMenu(e.clientX, e.clientY, options.id, options.title, btn)
        })

        // Append button to tab list
        const tabList = wrapper.querySelector('.sidebar-ux-tab-list')
        if (tabList) tabList.appendChild(btn)

        // ── Build the handle ──────────────────────────────────────────
        const handle: SpindleDrawerTabHandle = {
          root,
          tabId: options.id,
          activate: activateFn,
          setTitle(t: string) {
            btn.setAttribute('title', t)
          },
          setShortName(n: string) {
            labelSpan.textContent = n
          },
          setBadge(text: string | null) {
            const existing = btn.querySelector('.sidebar-ux-tab-badge')
            if (text) {
              if (existing) {
                existing.textContent = text
              } else {
                const badge = document.createElement('span')
                badge.className = 'sidebar-ux-tab-badge'
                badge.textContent = text
                btn.appendChild(badge)
              }
            } else if (existing) {
              existing.remove()
            }
          },
          destroy() {
            btn.remove()
            root.remove()
            _secondaryEntries.delete(compositeKey)
            _secondaryTabs.delete(options.id)
            activateHandlers.clear()
          },
          onActivate(h: () => void): () => void {
            activateHandlers.add(h)
            return () => { activateHandlers.delete(h) }
          },
        }

        // ── Track the entry ───────────────────────────────────────────
        const entry: SecondaryEntry = {
          handle,
          root,
          button: btn,
          activateHandlers,
          extensionId,
          optionsId: options.id,
        }
        _secondaryEntries.set(compositeKey, entry)
        _secondaryTabs.set(options.id, handle)

        // ── Auto-activate new tab ─────────────────────────────────────
        // Always activate the newly-added tab so it shows up immediately,
        // matching the built-in behavior where showSecondaryTab() runs right
        // after the move. Without this, a second extension added to a drawer
        // that already has a built-in would stay invisible (CSS hide rule
        // [data-canvas-moved]:not([data-canvas-active]) applies) until the
        // user manually clicks it. activateFn toggles data-canvas-active on
        // ALL [data-canvas-moved] roots, correctly demoting any previously
        // active tab (built-in or extension).
        activateFn()

        return handle
      },
      createFloatWidget: primaryCtx.ui.createFloatWidget.bind(primaryCtx.ui),
      requestDockPanel: primaryCtx.ui.requestDockPanel.bind(primaryCtx.ui),
      mountApp: primaryCtx.ui.mountApp.bind(primaryCtx.ui),
      registerInputBarAction: primaryCtx.ui.registerInputBarAction.bind(primaryCtx.ui),
      showContextMenu: primaryCtx.ui.showContextMenu.bind(primaryCtx.ui),
      showModal: primaryCtx.ui.showModal.bind(primaryCtx.ui),
      showConfirm: primaryCtx.ui.showConfirm.bind(primaryCtx.ui),
    },
    events: {
      on: primaryCtx.events.on.bind(primaryCtx.events),
      emit: primaryCtx.events.emit.bind(primaryCtx.events),
    },
    sendToBackend: sendToBackend as SpindleFrontendContext['sendToBackend'],
    onBackendMessage: onBackendMessage as SpindleFrontendContext['onBackendMessage'],
    uploads: primaryCtx.uploads,
    messages: primaryCtx.messages,
    processes: primaryCtx.processes,
    components: primaryCtx.components,
    permissions: primaryCtx.permissions,
    getActiveChat: primaryCtx.getActiveChat.bind(primaryCtx),
    characters: primaryCtx.characters,
    chats: primaryCtx.chats,
    manifest: primaryCtx.manifest,
  }
}

/**
 * Clear secondary tab handles. Calls destroy() on each matching handle.
 * Called during teardown of re-executed extensions.
 *
 * @param extensionId - If provided, only destroys entries belonging to this
 *   extension. If omitted, destroys ALL entries (full teardown).
 *
 * Source of truth is `_secondaryEntries` (composite key
 * `${extensionId}::${options.id}`) — not `_secondaryTabs`, which is
 * keyed by `options.id` alone and silently overwrites entries when
 * two extensions register tabs with the same id. Iterating
 * `_secondaryTabs` would leak DOM elements from the extension whose
 * handle got overwritten.
 */
export function clearSecondaryTabs(extensionId?: string): void {
  // Snapshot to array so destroy()'s map mutations don't skip entries
  const entries = Array.from(_secondaryEntries.values())
  for (const entry of entries) {
    if (extensionId && entry.extensionId !== extensionId) continue
    try { entry.handle.destroy() } catch { /* best-effort */ }
  }

  // Only clear the maps entirely when tearing down ALL extensions.
  // Individual destroy() already removes matching entries from both maps.
  if (!extensionId) {
    _secondaryTabs.clear()
    _secondaryEntries.clear()
  }
}
