// Central toggle API for the second-drawer master switch.
//
// `requestSecondDrawerMode(next)` is the single entry point for both the
// settings panel toggle and the Configure Tabs header toggle. It handles:
//   - Dirty-close confirmation (3-way dialog: Apply/Discard/Cancel)
//   - **Mode layout profiles (2026-08-16, consolidated v2):** each mode
//     keeps its OWN saved layout. The persisted `singleLayout` / `dualLayout`
//     slots are the ONLY mode state — the session-only vanilla baseline and
//     dual session profile are retired (REFACTOR-PLAN v2 §4.6):
//       ON  path: save the single-drawer layout (singleLayout slot — this
//                 IS the durable vanilla baseline), restore the dual layout
//                 (dualLayout slot), or seed from live on first enable.
//       OFF path: save the dual-drawer layout (dualLayout slot), restore
//                 the single layout (singleLayout slot → live host) via
//                 restoreSingleModeLayout (model bootstrap + host restore).
//     Disable/enable are symmetric: *save leaving-mode slot → restore
//     entering-mode slot*. Neither mode's layout is destroyed by switching
//     to the other, and both survive reloads (the owned-model persist path
//     embeds the slots in the layout blob).
//   - First-enable seed: on first transition to dual mode (no prior
//     detached tabs anywhere), seeds from live single-drawer layout so the
//     secondary starts closed/empty (ON path)
//   - Feature lifecycle (setSettings triggers feature.apply)
//   - Refreshing the still-open Configure Tabs modal from live on both
//     the enable and disable paths (modal stays open across mode switches)
//
// Tab-assignment persistence is always-on (built-in). The
// persistTabAssignments setting was removed — dual tab assignments are
// always saved and restored.

import {
  cancelSettingsSave,
  getSettings,
  setSettings,
  persistSettings,
  getLastLoadedLayout,
  getSingleLayoutSlot,
  setSingleLayoutSlot,
  getDualLayoutSlot,
  setDualLayoutSlot,
} from './state'
import {
  cancelLayoutSave,
} from '../persist/layout-load'
import { hasDetachedTabs, seedDualLayoutFromLive } from '../layout/snapshot'
import {
  getHost,
  getModel,
  snapshotOwnedModelLayout,
} from '../recon/dispatch'
import { CANVAS_VERSION } from '../persist/backend-ctx'
import { commitDraftToOwnedModel } from '../tabs/owned-commit'
import {
  buildSingleLayoutFromLiveHost,
  restoreSingleModeLayout,
} from '../layout/mode-profiles'
import { resetSideRemountStateAfterDisable } from '../sidebar/drawer-sync'
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
 * Sequence (symmetric with enable — save leaving-mode slot, restore
 * entering-mode slot; REFACTOR-PLAN v2 §4.6):
 *   1. Save the dualLayout slot from the live owned model (this is what
 *      re-enable restores; survives reloads via buildPersistedBlob).
 *   2. Determine the single-drawer layout: the persisted singleLayout slot
 *      (freshest — captured at enable from the same pre-dual state the
 *      retired vanilla baseline used to capture), else the live host.
 *   3. Flip the setting — feature.apply OFF path tears down the sidebar.
 *   4. restoreSingleModeLayout: bootstrap the owned model from the slot
 *      (reconcile writes host side/order/hidden) + restore the main
 *      drawer open/active. The model always matches the visible mode (no
 *      split brain), and the persisted blob embeds both slots.
 *   5. resetSideRemountStateAfterDisable — clear dual-era side override,
 *      bump remount gen (no applyMainDrawerSideChange).
 *   6. main-mirror rebuild; modal refresh.
 */
async function finishDisable(): Promise<void> {
  // 1. Durable dual layout: snapshot the live owned model BEFORE it is
  //    swapped to the single layout below. This is what re-enable restores.
  //    It survives reloads because the owned-model persist path embeds the
  //    slot in the layout blob (dispatch.ts:buildPersistedBlob).
  const dualSnapshot = snapshotOwnedModelLayout()
  if (dualSnapshot) {
    setDualLayoutSlot(dualSnapshot)
    dlog('[second-drawer-mode] saved dual layout slot:', {
      tabs: dualSnapshot.detachedTabs?.length ?? 0,
    })
  }

  // 2. Determine the single-drawer layout to restore: the persisted
  //    singleLayout slot (freshest), else the live host state (last
  //    resort). The session-only vanilla baseline capture is retired — the
  //    slot IS the durable baseline.
  let singleLayout = getSingleLayoutSlot()
  if (!singleLayout) {
    try {
      singleLayout = buildSingleLayoutFromLiveHost()
      dlog('[second-drawer-mode] single layout built from live host (no slot)')
    } catch (err) {
      // DOM hiccup during the fallback build (headless / host mid-init):
      // degrade to today's behavior — leave the model as-is (still dual
      // underneath) and let the teardown restore the host view.
      dwarn('[second-drawer-mode] single layout fallback build failed:', err)
      singleLayout = null
    }
  }

  // 3. Flip the setting — feature.apply OFF path tears down the sidebar.
  setSettings({ secondSidebarEnabled: false })

  // 4. Restore the single layout into the owned model + host. One routine,
  //    one artifact: bootstrap (model + reconcile-driven host writes) then
  //    the main-drawer restore. The bootstrap's reconcile + persist writes
  //    the single layout — with the dual slot embedded
  //    (dispatch.ts:buildPersistedBlob) — to disk, so neither layout is
  //    lost.
  const host = getHost()
  if (singleLayout && host) {
    try {
      dlog('[second-drawer-mode] restoring single layout into owned model', {
        tabOrder: Array.isArray(singleLayout.tabOrder) ? singleLayout.tabOrder.length : 0,
      })
      const result = await restoreSingleModeLayout(singleLayout, host)
      if (!result.ok) {
        dwarn(`[second-drawer-mode] single-layout restore partial: ${result.reason ?? 'unknown'}`)
      }
    } catch (err) {
      dwarn('[second-drawer-mode] single-layout restore failed:', err)
    }
  }

  // 5. Drop dual-era side override / remount gen so a host side flip while
  //    second is off (or residual override after restore) cannot remount an
  //    empty secondary shell. The restored slot owns side on disable.
  resetSideRemountStateAfterDisable()

  // 6. After the model restore (and even if no slot): main-mirror must
  //    rebuild from host after teardown unhide + any host patch.
  try {
    const mp = await import('../sidebar/main-tab-pin')
    mp.reconcileMainTabListPin()
  } catch (err) {
    dwarn('[second-drawer-mode] reconcileMainTabListPin after disable failed:', err)
  }

  // 7. Modal stays open. After teardown + restore, refresh its draft from
  // the now-restored live state so the user sees a clean (non-dirty)
  // view of the disabled layout.
  try {
    const m = await import('../tabs/configure-modal')
    if (m.isConfigureTabsModalOpen()) {
      m.refreshConfigureDraftFromLive()
    }
  } catch { /* module may not be loaded */ }

  // Diagnostic: post-switch model state — single mode active, model matches
  // the visible mode (no split brain), both slots preserved in the blob.
  const afterModel = getModel()
  dlog('[second-drawer-mode] single mode active', {
    secondSidebarEnabled: false,
    modelPrimary: afterModel?.primary.length ?? 0,
    modelSecondary: afterModel?.secondary.length ?? 0,
    modelSide: afterModel?.side ?? null,
  })
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
 *   3. `finishDisable`: capture session profile, save the dualLayout slot,
 *      merge into lastLoaded + flush + sync, restore the singleLayout slot
 *      into the owned model, setSettings(false). Modal stays open and is
 *      refreshed from live (now-disabled) state.
 *
 * **Enable path** (`next === true`):
 *   1. If already on → return
 *   2. Capture vanilla baseline (idempotent) + save the singleLayout slot
 *   3. **First-enable seed:** if neither lastLoaded nor session profile
 *      nor the dualLayout slot has any detached tabs, this is the first
 *      time dual mode is being enabled. Seed lastLoaded from the current
 *      live single-drawer layout so `feature.apply` sees a clean state
 *      (secondary closed and empty, primary preserved from live). The seed
 *      is written BEFORE setSettings so `secondSidebarFeature.apply` reads
 *      it on mount.
 *   4. setSettings({ secondSidebarEnabled: true }) — feature mount runs
 *   5. Cancel debounced saves, await owned-model restore from the
 *      dualLayout slot (else lastLoaded, else the session profile). After
 *      a first-enable seed, none of these have tabs, so no restore path
 *      runs — the secondary stays closed/empty.
 *   6. If modal is still open, refresh its draft from live so it reflects
 *      the re-enabled layout. The refresh runs AFTER the restore attempt
 *      so dual tabs are visible in the modal.
 *
 * Neither mode's layout is destroyed by switching to the other: the
 * singleLayout / dualLayout profile slots are persisted in the layout blob
 * (dispatch.ts:buildPersistedBlob) and hydrated back at boot, so a mode's
 * layout survives leaving that mode AND a full reload.
 *
 * Tab-assignment persistence is always-on (built-in), so the enable path
 * always uses the facet-ON path (no branch for facet OFF).
 */
export async function requestSecondDrawerMode(next: boolean): Promise<void> {
  if (next) {
    // ── ENABLE ──
    if (getSettings().secondSidebarEnabled) return

    // Diagnostic: the mode switch decision — which persisted layout slot
    // each mode uses. Verifies "Enable second drawer loads the dual layout
    // (and disable loads the single layout)". Single-slot tabs live in
    // tabOrder (all-primary); dual-slot tabs in detachedTabs.
    const switchDualSlot = getDualLayoutSlot()
    const switchSingleSlot = getSingleLayoutSlot()
    dlog('[second-drawer-mode] switching to dual', {
      singleSlotTabs: Array.isArray(switchSingleSlot?.tabOrder)
        ? (switchSingleSlot as { tabOrder: unknown[] }).tabOrder.length
        : 0,
      dualSlotTabs: Array.isArray(switchDualSlot?.detachedTabs)
        ? (switchDualSlot as { detachedTabs: unknown[] }).detachedTabs.length
        : 0,
      modelSecondary: getModel()?.secondary.length ?? 0,
    })

    // Save the single-drawer layout BEFORE any dual UI mount. While the
    // second drawer is off, the owned model IS the single-drawer layout
    // (finishDisable restored it into the model), so serialize it into the
    // singleLayout profile slot — that is what finishDisable restores on the
    // way back. This slot is ALSO the durable vanilla baseline (the
    // session-only baseline capture is retired — REFACTOR-PLAN v2 §4.6).
    // Guard: never overwrite the slot with a dual model (the fallback case
    // where a disable had no single layout to restore left the model dual
    // while the drawer is off).
    const singleSnapshot = snapshotOwnedModelLayout()
    const modelNow = getModel()
    if (singleSnapshot && (!modelNow || modelNow.secondary.length === 0)) {
      setSingleLayoutSlot(singleSnapshot)
      dlog('[second-drawer-mode] saved single layout slot:', {
        primary: singleSnapshot.tabOrder?.length ?? 0,
      })
    }

    // First-enable seed: if no dual tabs exist anywhere (lastLoaded has no
    // detachedTabs AND no persisted dual layout slot), this is the first
    // time dual mode has ever been enabled. Seed lastLoaded from the
    // current live single-drawer layout so feature.apply's mount reads a
    // clean state (secondary closed/empty, primary preserved from live).
    //
    // Must happen BEFORE setSettings so secondSidebarFeature.apply sees the
    // seeded state (not stale pre-dual layout with a ghost secondary).
    const layoutBefore = getLastLoadedLayout()
    const dualSlotBefore = getDualLayoutSlot()
    if (
      !hasDetachedTabs(layoutBefore) &&
      !hasDetachedTabs(dualSlotBefore)
    ) {
      dlog('[second-drawer-mode] first enable — seeding dual layout from live')
      seedDualLayoutFromLive()
    }

    setSettings({ secondSidebarEnabled: true })

    // Restore dual assignments. The persisted dualLayout slot is the
    // freshest saved dual layout (written by finishDisable + by the owned
    // model's persist path while dual is active, and hydrated back at boot).
    // The lastLoaded and session-profile fallbacks are retired — the slot
    // is the only mode state (REFACTOR-PLAN v2 §4.6).
    //
    // After a first-enable seed, the dual slot is empty and lastLoaded has
    // detachedTabs: [], so no restore branch runs — the secondary stays
    // empty/closed.
    //
    // Cancel debounced saves first so the post-setSettings write does not
    // clobber disk with pre-restore live empty tabs.
    cancelSettingsSave()
    cancelLayoutSave()
    const host = getHost()
    const dualSlot = getDualLayoutSlot()
    const restoreSource = [dualSlot]
      .find((l) => l && Array.isArray(l.detachedTabs) && l.detachedTabs.length > 0)
    if (restoreSource && host) {
      dlog('[second-drawer-mode] owned-model restore for re-enable:', {
        tabs: (restoreSource.detachedTabs as unknown[]).length,
        source: 'dual-slot',
      })
      const result = await restoreSingleModeLayout(restoreSource, host)
      if (!result.ok) {
        dwarn(`[second-drawer-mode] dual-layout restore partial: ${result.reason ?? 'unknown'}`)
      }
    }

    // Re-arm the debounced settings save. setSettings above armed it, but the
    // cancelSettingsSave() right after (to keep the mid-restore empty layout
    // out of the snapshot) killed that timer — and layout saves never write
    // settings. Without this re-arm, an enable would only live in memory and
    // revert on the next hard refresh. The restore is awaited above, so the
    // 100ms-debounced fire now snapshots the post-restore live state.
    persistSettings()

    // If the Configure Tabs modal is still open, refresh its draft from
    // the now-enabled live state so it reflects the re-enabled layout.
    // Runs AFTER the restore attempt above so the modal shows the dual
    // tabs (not the pre-restore empty state). Flush any in-flight commits
    // first so refresh does not clobber a mid-flight rebase.
    try {
      const m = await import('../tabs/configure-modal')
      if (m.isConfigureTabsModalOpen()) {
        try {
          await m.flushConfigureCommits()
        } catch { /* best-effort */ }
        m.refreshConfigureDraftFromLive()
      }
    } catch { /* module may not be loaded */ }

    // Diagnostic: post-switch model state — the mode's layout is now the
    // live model, and the next owned-model persist embeds both slots.
    const afterModel = getModel()
    dlog('[second-drawer-mode] dual mode active', {
      secondSidebarEnabled: true,
      modelPrimary: afterModel?.primary.length ?? 0,
      modelSecondary: afterModel?.secondary.length ?? 0,
      modelSide: afterModel?.side ?? null,
    })
  } else {
    // ── DISABLE ──
    if (!getSettings().secondSidebarEnabled) return

    // Diagnostic: switching to single-drawer mode — the dual layout is
    // saved to its slot below, then the single layout slot is restored.
    const switchSingleSlot = getSingleLayoutSlot()
    const switchDualSlot = getDualLayoutSlot()
    dlog('[second-drawer-mode] switching to single', {
      singleSlotTabs: Array.isArray(switchSingleSlot?.tabOrder)
        ? (switchSingleSlot as { tabOrder: unknown[] }).tabOrder.length
        : 0,
      dualSlotTabs: Array.isArray(switchDualSlot?.detachedTabs)
        ? (switchDualSlot as { detachedTabs: unknown[] }).detachedTabs.length
        : 0,
      modelSecondary: getModel()?.secondary.length ?? 0,
    })

    // Drain in-flight Configure auto-commits + global commit queue before
    // dirty check so we do not treat a still-rebasing base as residual dirty,
    // and so Apply does not race "Commit already in progress".
    let userChoice: ModeSwitchChoice | 'clean' = 'clean'
    try {
      const m = await import('../tabs/configure-modal')
      if (m.isConfigureTabsModalOpen()) {
        try {
          await m.flushConfigureCommits()
        } catch (err) {
          dwarn('[second-drawer-mode] flushConfigureCommits failed:', err)
        }
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
      // Apply and switch: commit residual draft, then finishDisable.
      // On commit failure, stay dual so the user can retry (do not tear down).
      try {
        const m = await import('../tabs/configure-modal')
        const draft = m.getConfigureDraftRef()
        const base = m.getConfigureBaseRef()
        if (draft && base) {
          const result = await commitDraftToOwnedModel(draft)
          if (!result.ok) {
            dwarn('[second-drawer-mode] commit failed on mode switch:', result.error)
            return
          }
        }
      } catch (err) {
        dwarn('[second-drawer-mode] error applying draft on mode switch:', err)
        return
      }
    } else if (userChoice === 'discard') {
      // Discard and switch: fall through to finishDisable, which refreshes
      // the still-open modal from the now-disabled live state.
    }

    // userChoice is 'apply' (success), 'discard', or 'clean' — proceed.
    await finishDisable()
  }
}
