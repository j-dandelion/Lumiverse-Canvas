// Central toggle API for the second-drawer master switch.
//
// `requestSecondDrawerMode(next)` is the single entry point for both the
// settings panel toggle and the Configure Tabs header toggle. It handles:
//   - Dirty-close confirmation (3-way dialog: Apply/Discard/Cancel)
//   - Session dual profile capture before teardown (OFF path)
//   - Merging dual into lastLoaded when persistTabAssignments is ON (OFF path)
//   - Restoring session dual profile on re-enable (ON path)
//   - Feature lifecycle (setSettings triggers feature.apply)
//   - Refreshing the still-open Configure Tabs modal from live on both
//     the enable and disable paths (modal stays open across mode switches)

import { getSettings, setSettings, getLastLoadedLayout, setLastLoadedLayout } from './state'
import {
  flushPendingSaves,
  syncLastLoadedFromPersistedLayout,
  cancelLayoutSave,
} from '../layout/persist'
import {
  captureSessionDualProfileFromLive,
  getSessionDualProfile,
  clearSessionDualProfile,
  restoreSessionDualProfile,
} from '../layout/dual-session-profile'
import { injectStyles } from '../debug/styles'
import { dlog, dwarn } from '../debug/log'

// ── Mode-switch dialog ──

const HOST_ID = 'canvas-mode-switch-dialog'
const STYLE_ID = 'canvas-mode-switch-dialog-styles'
let _dialogHost: HTMLElement | null = null
let _dialogKeydown: ((e: KeyboardEvent) => void) | null = null

export type ModeSwitchChoice = 'apply' | 'discard' | 'cancel'

function injectDialogStyles(): void {
  injectStyles(STYLE_ID, `
    #${HOST_ID} {
      position: fixed;
      inset: 0;
      /* Above Configure Tabs overlay (12000) and drag clone (13000). */
      z-index: 14000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      box-sizing: border-box;
      font-family: var(--lumiverse-font-family, sans-serif);
      animation: canvas-mode-switch-fade 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    #${HOST_ID} .canvas-mode-switch-backdrop {
      position: absolute;
      inset: 0;
      background: color-mix(in srgb, var(--lumiverse-fill-heavy, rgba(0,0,0,0.45)) 85%, transparent);
    }
    #${HOST_ID} .canvas-mode-switch-card {
      position: relative;
      z-index: 1;
      width: min(380px, 100%);
      background: var(--lumiverse-bg-elevated, var(--lumiverse-bg-deep, #1a1a1a));
      border: 1px solid var(--lumiverse-border);
      border-radius: var(--lumiverse-radius-md, 12px);
      box-shadow: var(--lumiverse-shadow-md, 0 12px 32px rgba(0,0,0,0.5));
      padding: 16px;
      box-sizing: border-box;
      animation: canvas-mode-switch-in 120ms ease-out;
    }
    #${HOST_ID} .canvas-mode-switch-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    #${HOST_ID} .canvas-mode-switch-title {
      margin: 0;
      font-size: calc(15px * var(--lumiverse-font-scale, 1));
      font-weight: 600;
      line-height: 1.3;
      color: var(--lumiverse-text);
    }
    #${HOST_ID} .canvas-mode-switch-desc {
      margin: 0 0 14px;
      font-size: calc(12px * var(--lumiverse-font-scale, 1));
      line-height: 1.4;
      color: var(--lumiverse-text-muted);
    }
    #${HOST_ID} .canvas-mode-switch-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${HOST_ID} .canvas-mode-switch-option {
      display: block;
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border: 1px solid var(--lumiverse-border);
      border-radius: 8px;
      background: var(--lumiverse-bg-050, transparent);
      color: var(--lumiverse-text);
      cursor: pointer;
      font-family: inherit;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    #${HOST_ID} .canvas-mode-switch-option:hover:not(:disabled) {
      background: var(--lumiverse-primary-020, rgba(66,165,245,0.12));
      border-color: var(--lumiverse-primary, #42a5f5);
    }
    #${HOST_ID} .canvas-mode-switch-option:disabled {
      opacity: 0.55;
      cursor: default;
    }
    #${HOST_ID} .canvas-mode-switch-option-label {
      font-size: calc(13px * var(--lumiverse-font-scale, 1));
      font-weight: 500;
      line-height: 1.3;
      color: var(--lumiverse-text);
    }
    #${HOST_ID} .canvas-mode-switch-option-hint {
      margin-top: 2px;
      font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
      line-height: 1.35;
      color: var(--lumiverse-text-muted);
    }
    @keyframes canvas-mode-switch-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes canvas-mode-switch-in {
      from { opacity: 0; transform: scale(0.92); }
      to { opacity: 1; transform: scale(1); }
    }
  `)
}

function makeOptionButton(label: string, hint: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'canvas-mode-switch-option'
  const labelEl = document.createElement('div')
  labelEl.className = 'canvas-mode-switch-option-label'
  labelEl.textContent = label
  const hintEl = document.createElement('div')
  hintEl.className = 'canvas-mode-switch-option-hint'
  hintEl.textContent = hint
  btn.appendChild(labelEl)
  btn.appendChild(hintEl)
  return btn
}

function cleanupDialogListeners(): void {
  if (_dialogKeydown) {
    document.removeEventListener('keydown', _dialogKeydown)
    _dialogKeydown = null
  }
}

function hideModeSwitchDialog(): void {
  cleanupDialogListeners()
  if (_dialogHost) {
    _dialogHost.remove()
    _dialogHost = null
  }
}

/**
 * Show the 3-way mode-switch dialog: Apply and switch / Discard and switch / Cancel.
 * Returns a Promise that resolves with the user's choice.
 */
function showModeSwitchDialog(): Promise<ModeSwitchChoice> {
  return new Promise((resolve) => {
    injectDialogStyles()

    const host = document.createElement('div')
    host.id = HOST_ID
    host.setAttribute('role', 'dialog')
    host.setAttribute('aria-modal', 'true')

    const backdrop = document.createElement('div')
    backdrop.className = 'canvas-mode-switch-backdrop'
    backdrop.addEventListener('click', () => {
      resolve('cancel')
      hideModeSwitchDialog()
    })

    const card = document.createElement('div')
    card.className = 'canvas-mode-switch-card'
    card.addEventListener('click', (e) => e.stopPropagation())

    const header = document.createElement('div')
    header.className = 'canvas-mode-switch-header'

    const title = document.createElement('h3')
    title.className = 'canvas-mode-switch-title'
    title.textContent = 'Unsaved configure changes'

    header.appendChild(title)

    const desc = document.createElement('p')
    desc.className = 'canvas-mode-switch-desc'
    desc.textContent = 'You have unsaved changes in the Configure Tabs dialog. Choose what to do before disabling the second drawer.'

    const options = document.createElement('div')
    options.className = 'canvas-mode-switch-options'

    const applyBtn = makeOptionButton(
      'Apply and switch',
      'Save current tab arrangement, then disable the second drawer.',
    )
    const discardBtn = makeOptionButton(
      'Discard and switch',
      'Discard unsaved changes, then disable the second drawer.',
    )
    const cancelBtn = makeOptionButton(
      'Cancel',
      'Stay in Configure Tabs without disabling the second drawer.',
    )

    const setBusy = (busy: boolean) => {
      applyBtn.disabled = busy
      discardBtn.disabled = busy
      cancelBtn.disabled = busy
    }

    applyBtn.addEventListener('click', () => {
      if (applyBtn.disabled) return
      setBusy(true)
      resolve('apply')
      hideModeSwitchDialog()
    })
    discardBtn.addEventListener('click', () => {
      if (discardBtn.disabled) return
      setBusy(true)
      resolve('discard')
      hideModeSwitchDialog()
    })
    cancelBtn.addEventListener('click', () => {
      resolve('cancel')
      hideModeSwitchDialog()
    })

    options.appendChild(applyBtn)
    options.appendChild(discardBtn)
    options.appendChild(cancelBtn)

    card.appendChild(header)
    card.appendChild(desc)
    card.appendChild(options)
    host.appendChild(backdrop)
    host.appendChild(card)

    _dialogKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (applyBtn.disabled) return
      e.preventDefault()
      e.stopPropagation()
      resolve('cancel')
      hideModeSwitchDialog()
    }
    document.addEventListener('keydown', _dialogKeydown)

    document.body.appendChild(host)
    _dialogHost = host
    cancelBtn.focus()
  })
}

// ── Shared disable path ──

/**
 * Run after the user has confirmed disable (or modal was clean).
 * Captures session profile, optionally merges into lastLoaded, flushes,
 * flips the setting, then refreshes any still-open Configure Tabs modal
 * from live so it reflects the now-disabled layout.
 */
async function finishDisable(): Promise<void> {
  // 1. Capture session profile while assignments are still live.
  const profile = captureSessionDualProfileFromLive()
  dlog('[second-drawer-mode] captured session dual profile:', {
    tabs: profile.detachedTabs.length,
    active: profile.activeTabId,
  })

  // 2. If persistTabAssignments is ON, merge dual into lastLoaded before
  //    setSettings(false) so the dual layout is preserved on disk (not
  //    clobbered with empty after teardown).
  if (getSettings().persistTabAssignments) {
    const last = getLastLoadedLayout()
    if (last) {
      const merged = { ...last }
      merged.detachedTabs = profile.detachedTabs
      if (merged.secondary) {
        merged.secondary = { ...merged.secondary, activeTabId: profile.activeTabId }
      } else {
        merged.secondary = { activeTabId: profile.activeTabId, open: false, width: 420 }
      }
      setLastLoadedLayout(merged)
    } else {
      // No prior lastLoaded — create a minimal one from profile.
      setLastLoadedLayout({
        detachedTabs: profile.detachedTabs,
        secondary: { activeTabId: profile.activeTabId, open: false, width: 420 },
        primary: { open: false, width: 420, tabId: null },
      })
    }
    // Flush any pending debounced save so the merged dual lands on disk
    // before the OFF path writes a (frozen) version. We flush while
    // isAnyLayoutPersistenceEnabled is still true — the setSettings(false)
    // below cancels debounce, but we need the write ahead of it.
    flushPendingSaves()
    // Sync freeze base so buildPersistedLayout reads from the merged
    // lastLoaded for the disabled-facet freeze path.
    syncLastLoadedFromPersistedLayout()
  }

  // 3. Flip the setting — feature.apply OFF path tears down the sidebar.
  //    buildPersistedLayout now freezes lastLoaded dual (not live empty).
  setSettings({ secondSidebarEnabled: false })

  // 4. Modal stays open. After teardown, refresh its draft from the now-disabled
  //    live state so the user sees a clean (non-dirty) view of the disabled layout.
  try {
    const m = await import('../tabs/configure-modal')
    if (m.isConfigureTabsModalOpen()) {
      m.refreshConfigureDraftFromLive()
    }
  } catch { /* module may not be loaded */ }
}

// ── Public API ──

/**
 * Toggle the second drawer on or off. The single entry point for both the
 * settings panel toggle and the Configure Tabs header toggle.
 *
 * **Disable path** (`next === false`):
 *   1. If already off → return
 *   2. If Configure modal open with dirty draft → 3-way dialog
 *      (Apply and switch / Discard and switch / Cancel)
 *   3. `finishDisable`: capture session profile, optionally merge into
 *      lastLoaded + flush, setSettings(false). Modal stays open and is
 *      refreshed from live (now-disabled) state.
 *
 * **Enable path** (`next === true`):
 *   1. If already on → return
 *   2. setSettings({ secondSidebarEnabled: true }) — feature mount runs
 *   3. If session profile has tabs and tabs facet OFF → restore from profile
 *   4. If tabs facet ON → applyLayout already handled restore from lastLoaded
 *      (which was synced before disable)
 *   5. If modal is still open, refresh its draft from live so it reflects
 *      the re-enabled layout.
 */
export async function requestSecondDrawerMode(next: boolean): Promise<void> {
  if (next) {
    // ── ENABLE ──
    if (getSettings().secondSidebarEnabled) return

    setSettings({ secondSidebarEnabled: true })

    // Restore session dual profile if non-empty and tabs facet is off
    // (tabs facet ON: applyLayout already restored from lastLoaded, which
    // was synced with the session profile before disable).
    const profile = getSessionDualProfile()
    if (profile && profile.detachedTabs.length > 0 && !getSettings().persistTabAssignments) {
      dlog('[second-drawer-mode] restoring session dual profile:', {
        tabs: profile.detachedTabs.length,
        active: profile.activeTabId,
      })
      await restoreSessionDualProfile(profile)
    }

    // If the Configure Tabs modal is still open, refresh its draft from
    // the now-enabled live state so it reflects the re-enabled layout.
    try {
      const m = await import('../tabs/configure-modal')
      if (m.isConfigureTabsModalOpen()) {
        m.refreshConfigureDraftFromLive()
      }
    } catch { /* module may not be loaded */ }
  } else {
    // ── DISABLE ──
    if (!getSettings().secondSidebarEnabled) return

    // Check if Configure Tabs modal is open with a dirty draft.
    let userChoice: ModeSwitchChoice | 'clean' = 'clean'
    try {
      const m = await import('../tabs/configure-modal')
      if (m.isConfigureTabsModalOpen()) {
        const draft = m.getConfigureDraftRef()
        const base = m.getConfigureBaseRef()
        if (draft && base) {
          const { isDraftDirty } = await import('../tabs/configure-model')
          if (isDraftDirty(draft, base)) {
            userChoice = await showModeSwitchDialog()
          }
        }
      }
    } catch (err) {
      dwarn('[second-drawer-mode] error checking modal state:', err)
    }

    if (userChoice === 'cancel') return

    if (userChoice === 'apply') {
      // Apply and switch: commit draft, then finishDisable.
      try {
        const m = await import('../tabs/configure-modal')
        const draft = m.getConfigureDraftRef()
        const base = m.getConfigureBaseRef()
        if (draft && base) {
          const { commitConfigureDraft } = await import('../tabs/configure-commit')
          const result = await commitConfigureDraft(draft, base)
          if (!result.ok) {
            dwarn('[second-drawer-mode] commit failed on mode switch:', result.error)
            // Fall through to finishDisable anyway — the partial commit is
            // still better than leaving the drawer on.
          }
        }
      } catch (err) {
        dwarn('[second-drawer-mode] error applying draft on mode switch:', err)
      }
    } else if (userChoice === 'discard') {
      // Discard and switch: fall through to finishDisable, which refreshes
      // the still-open modal from the now-disabled live state.
    }

    // userChoice is 'apply', 'discard', or 'clean' — all proceed to finishDisable.
    await finishDisable()
  }
}
