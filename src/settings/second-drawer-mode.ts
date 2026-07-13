// Central toggle API for the second-drawer master switch.
//
// `requestSecondDrawerMode(next)` is the single entry point for both the
// settings panel toggle and the Configure Tabs header toggle. It handles:
//   - Dirty-close confirmation (3-way dialog: Apply/Discard/Cancel)
//   - Session dual profile capture before teardown (OFF path)
//   - Merging dual into lastLoaded (OFF path; tab-assignment persistence
//     is always-on, so this always runs)
//   - Restoring dual layout on re-enable (ON path)
//   - Feature lifecycle (setSettings triggers feature.apply)
//   - Refreshing the still-open Configure Tabs modal from live on both
//     the enable and disable paths (modal stays open across mode switches)
//
// Tab-assignment persistence is always-on (built-in). The
// persistTabAssignments setting was removed — dual tab assignments are
// always merged into lastLoaded on disable and always restored on enable.

import {
  cancelSettingsSave,
  getSettings,
  setSettings,
  getLastLoadedLayout,
  setLastLoadedLayout,
} from './state'
import {
  applyLayout,
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
import {
  captureVanillaBaseline,
  getVanillaBaseline,
  clearVanillaBaseline,
  restoreVanillaBaseline,
} from '../layout/vanilla-baseline'
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
 *
 * Sequence:
 *   1. Capture session dual profile (existing).
 *   2. Merge dual into lastLoaded + flush + sync freeze base (always;
 *      tab-assignment persistence is always-on so the merge always runs).
 *   3. Flip the setting — feature.apply OFF path tears down the
 *      secondary sidebar (existing).
 *   4. **Vanilla baseline restore** — patch host drawerSettings +
 *      restore main open/active. Done AFTER teardown so the host
 *      tabs are back in main-drawer before we click the restored
 *      primary tab. The "baseline wins" rule means any Configure
 *      Apply / host edit / etc. that changed the host during the
 *      dual session is overwritten with the captured pre-dual state.
 *   5. Modal stays open; refresh its draft from the now-restored
 *      live state (existing).
 *   6. Clear the baseline only on successful restore so the next
 *      enable cycle captures a fresh snapshot of the (now restored)
 *      single-drawer state. On failure (NO-GO / partial), retain
 *      the baseline for retry.
 */
async function finishDisable(): Promise<void> {
  // 1. Capture session profile while assignments are still live.
  const profile = captureSessionDualProfileFromLive()
  dlog('[second-drawer-mode] captured session dual profile:', {
    tabs: profile.detachedTabs.length,
    active: profile.activeTabId,
  })

  // 2. Always merge dual into lastLoaded before setSettings(false) so the
  //    dual layout is preserved on disk (not clobbered with empty after
  //    teardown). Tab-assignment persistence is always-on (built-in).
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
  // before the OFF path writes a (frozen) version. isAnyLayoutPersistenceEnabled
  // is always true (tabs always-on), so the flush will proceed.
  flushPendingSaves()
  // Sync freeze base so buildPersistedLayout reads from the merged
  // lastLoaded for the disabled-facet freeze path.
  // Defensive: in headless test environments, snapshotLayout may not
  // have document. The merge above already wrote to lastLoaded, so
  // the freeze base is correct even without the sync.
  try { syncLastLoadedFromPersistedLayout() } catch { /* safe to skip */ }

  // 3. Flip the setting — feature.apply OFF path tears down the sidebar.
  //    buildPersistedLayout now freezes lastLoaded dual (not live empty).
  setSettings({ secondSidebarEnabled: false })

  // 4. Restore the vanilla baseline (host settings + main open/active).
  //    Idempotent: no-op if no baseline was captured (single→dual never
  //    happened this session). On NO-GO or partial failure, retain the
  //    baseline so the next attempt (or next disable cycle) can retry.
  const baseline = getVanillaBaseline()
  if (baseline) {
    const result = await restoreVanillaBaseline(baseline)
    if (result.ok) {
      dlog('[second-drawer-mode] vanilla baseline restored; clearing')
      clearVanillaBaseline()
    } else {
      dwarn(
        '[second-drawer-mode] vanilla baseline restore did not complete cleanly; ' +
        'baseline retained for retry. reason=' + result.reason +
        (result.reason === 'partial' ? ` details=${result.details}` : ''),
      )
    }
  }

  // 4b. After baseline restore (and even if no baseline): main-mirror must
  //     rebuild from host after teardown unhide + any host patch.
  try {
    const mp = await import('../sidebar/main-tab-pin')
    mp.reconcileMainTabListPin()
  } catch (err) {
    dwarn('[second-drawer-mode] reconcileMainTabListPin after disable failed:', err)
  }

  // 5. Modal stays open. After teardown + restore, refresh its draft from
  //    the now-restored live state so the user sees a clean (non-dirty)
  //    view of the disabled layout.
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
 *   3. `finishDisable`: capture session profile, merge into lastLoaded +
 *      flush + sync, setSettings(false). Modal stays open and is
 *      refreshed from live (now-disabled) state.
 *
 * **Enable path** (`next === true`):
 *   1. If already on → return
 *   2. Capture vanilla baseline (idempotent)
 *   3. setSettings({ secondSidebarEnabled: true }) — feature mount runs
 *   4. Cancel debounced saves, await applyLayout from lastLoaded (which
 *      was synced with the session profile before disable). Fall back to
 *      session profile if lastLoaded has no tabs.
 *   5. If modal is still open, refresh its draft from live so it reflects
 *      the re-enabled layout. The refresh runs AFTER the restore attempt
 *      so dual tabs are visible in the modal.
 *
 * Tab-assignment persistence is always-on (built-in), so the enable path
 * always uses the facet-ON path (no branch for facet OFF).
 */
export async function requestSecondDrawerMode(next: boolean): Promise<void> {
  if (next) {
    // ── ENABLE ──
    if (getSettings().secondSidebarEnabled) return

    // Capture the vanilla baseline BEFORE setSettings({ secondSidebarEnabled: true })
    // and BEFORE any dual UI mount can mutate host settings. captureVanillaBaseline
    // is idempotent — repeated enable calls (without a successful disable in
    // between) do not overwrite the existing baseline. The plan's "baseline wins"
    // rule relies on the baseline being the original pre-dual state, unchanged
    // by Configure Apply / host edits during the dual session.
    const capture = captureVanillaBaseline()
    dlog('[second-drawer-mode] vanilla baseline capture:', {
      captured: capture.captured,
      side: capture.baseline.host.side,
      mainOpen: capture.baseline.mainOpen,
    })

    setSettings({ secondSidebarEnabled: true })

    // Restore dual assignments. Tab-assignment persistence is always-on,
    // so we always use the facet-ON path: lastLoaded was merged with the
    // session profile in finishDisable; applyLayout restores from it.
    // Fall back to the session profile if lastLoaded has no tabs.
    //
    // Cancel debounced saves first so the post-setSettings write does not
    // clobber disk with pre-restore live empty tabs.
    const profile = getSessionDualProfile()
    cancelSettingsSave()
    cancelLayoutSave()
    const layout = getLastLoadedLayout()
    if (layout && Array.isArray(layout.detachedTabs) && layout.detachedTabs.length > 0) {
      dlog('[second-drawer-mode] applyLayout(lastLoaded) for re-enable:', {
        tabs: layout.detachedTabs.length,
      })
      try {
        await applyLayout(layout)
      } catch (err) {
        dwarn('[second-drawer-mode] applyLayout on re-enable failed:', err)
      }
    } else if (profile && profile.detachedTabs.length > 0) {
      // Defensive fallback: lastLoaded has no tabs but session profile does.
      dlog('[second-drawer-mode] re-enable falling back to session dual profile:', {
        tabs: profile.detachedTabs.length,
        active: profile.activeTabId,
      })
      try {
        await restoreSessionDualProfile(profile)
      } catch (err) {
        dwarn('[second-drawer-mode] restoreSessionDualProfile fallback failed:', err)
      }
    }

    // If the Configure Tabs modal is still open, refresh its draft from
    // the now-enabled live state so it reflects the re-enabled layout.
    // Runs AFTER the restore attempt above so the modal shows the dual
    // tabs (not the pre-restore empty state).
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
