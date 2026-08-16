import type { ConfigureDraft } from './configure-model'
import type { Intent } from '../core/intents'
import {
  dispatchBatch,
  getHost,
  getModel,
  captureMainMirrorMoveChrome,
  applyMainMirrorMoveChrome,
  captureSecondaryNeighborForMove,
  applySecondaryNeighborHandoff,
  type MainMirrorMoveChrome,
  type SecondaryMoveChrome,
} from '../recon/dispatch'
import { activeAfterRemoval, sideOfKey, visibleKeys } from '../core/select'
import type { TabKey, Side, ObservedWorld, LayoutModel } from '../core/model'
import type { LiveTabId } from '../host/port'
import { dlog, dwarn } from '../debug/log'

export type OwnedCommitResult = { ok: true } | { ok: false; error: string }
export type ActiveSelection = Record<Side, TabKey | null>

/**
 * Cross-side moves a commit implies: desired side differs from the model's
 * current side. Pure — used to plan the DOM placement pass (the reconciler
 * never places in this environment, see commitDraftToOwnedModel) and the
 * taskbar/drawer chrome handoffs.
 */
export function plannedMovesForCommit(
  model: LayoutModel,
  desiredSide: ReadonlyMap<TabKey, Side>,
): { key: TabKey; to: Side }[] {
  const moves: { key: TabKey; to: Side }[] = []
  for (const [key, side] of desiredSide) {
    const current = sideOfKey(model, key)
    if (current && current !== side) moves.push({ key, to: side })
  }
  return moves
}

/**
 * Commit options.
 *
 * `skipChrome`: the live DnD path captures the taskbar/drawer chrome BEFORE
 * the drop (the mirror neighbor lookup needs the moved host button still
 * visible — onUp hides it before the commit) and applies it after the
 * commit. The commit's own capture would run too late to find the mirror
 * neighbor and would apply the handoffs a second time (double re-assert
 * clicks / double neighbor activation). Configure and mode-switch callers
 * leave this unset and get the internal chrome.
 */
export type OwnedCommitOpts = { skipChrome?: boolean }

/**
 * Convert the existing Configure draft into one owned-model transaction.
 * The draft remains the UI's source while editing; the core model owns the
 * committed state and the host adapter owns every side effect.
 */
export async function commitDraftToOwnedModel(
  draft: ConfigureDraft,
  activeAtGestureStart?: ActiveSelection,
  opts?: OwnedCommitOpts,
): Promise<OwnedCommitResult> {
  const host = getHost()
  if (!host) return { ok: false, error: 'Canvas tab model is not ready.' }

  try {
    const commitBaseModel = getModel()
    // Snapshot the host world before rebase so a later resolution failure
    // can roll back to this exact state (see rollback path below). The
    // rebase at line 29 then reads host.observe() again — it MUST be a
    // fresh call, not the cached snapshot, because the snapshot is the
    // rollback target, not the rebase input.
    const observedBeforeRebase = host.observe()

    // Rebase against the latest host world before translating live ids. This
    // preserves late registrations and host-side reorder changes.
    await dispatchBatch([{ t: 'syncFromHost', observed: host.observe() }])
    const model = getModel()
    if (!model) return { ok: false, error: 'Canvas tab model is not ready.' }
    dlog('[owned-commit] rebased', {
      primary: model.primary,
      secondary: model.secondary,
    })

    const keyFor = (id: string): TabKey | null => host.findKey(id)
    const primary = resolveKeys(draft.primaryIds, keyFor)
    const secondary = resolveKeys(draft.secondaryIds, keyFor)
    const hidden = new Set(resolveKeys([...draft.hiddenIds], keyFor))
    if (primary.length !== draft.primaryIds.length || secondary.length !== draft.secondaryIds.length) {
      // Resolution failure: the rebase already mutated the owned model. Roll
      // it back by re-applying syncFromHost with the pre-rebase snapshot so
      // a transient host race during the open Configure modal cannot
      // corrupt the user's saved layout. Task 11.3 / P2-3.
      dlog('[owned-commit] resolution failed — rolling back rebase', {
        expectedPrimary: draft.primaryIds.length,
        gotPrimary: primary.length,
        expectedSecondary: draft.secondaryIds.length,
        gotSecondary: secondary.length,
      })
      await dispatchBatch([{ t: 'syncFromHost', observed: observedBeforeRebase }])
      return { ok: false, error: 'A tab changed while Configure Tabs was open. Please retry.' }
    }

    const intents: Intent[] = []
    if (draft.drawerSide !== model.side) intents.push({ t: 'swapSides' })

    const desiredSide = new Map<TabKey, Side>()
    for (const key of primary) desiredSide.set(key, 'primary')
    for (const key of secondary) desiredSide.set(key, 'secondary')

    // Move first, without activation. Configure and live DnD intentionally do
    // not select the dropped tab; the reducer handles active handoff.
    for (const [key, side] of desiredSide) {
      const current = sideOfKey(model, key)
      if (current && current !== side) {
        intents.push({
          t: 'move',
          key,
          to: side,
          index: visibleKeys(model, side).length,
          activateDest: false,
        })
      }
    }

    // Reorder against the post-move target. Sequential visible indexes are
    // stable because each item is placed at its final slot.
    // NOTE: the reorder `index` below is a FULL-list index (draft lists
    // include hidden ids) but applyReorder interprets it as a VISIBLE index.
    // When hidden tabs precede a slot, the absolute slot drifts; log the
    // context so any one-slot-low report can be traced to this mismatch.
    dlog('[owned-commit] reorder index context', {
      hiddenCount: hidden.size,
      hiddenKeys: [...hidden],
      primaryCount: primary.length,
      secondaryCount: secondary.length,
      visiblePrimary: model.primary.filter((k) => !hidden.has(k)).length,
      visibleSecondary: model.secondary.filter((k) => !hidden.has(k)).length,
    })
    for (const [side, keys] of [['primary', primary], ['secondary', secondary]] as const) {
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!
        intents.push({ t: 'reorder', key, side, index })
      }
    }

    for (const key of [...model.primary, ...model.secondary]) {
      intents.push({ t: 'setHidden', key, hidden: hidden.has(key) })
    }

    // Activation is part of the same transaction as placement and ordering.
    // Host reconciliation may observe a transient cross-drawer DOM placement;
    // use the owned selection from before that observation and make the
    // resulting selection explicit rather than allowing the host snapshot to
    // choose a default tab.
    if (commitBaseModel) {
      const activeBeforeRebase = activeAtGestureStart ?? activeSelection(observedBeforeRebase)
      for (const source of ['primary', 'secondary'] as const) {
        const active = activeBeforeRebase[source]
        if (!active || hidden.has(active)) continue

        const destination = desiredSide.get(active)
        if (destination === source) {
          intents.push({ t: 'activate', key: active, side: source })
          continue
        }

        if (destination) {
          const replacement = activeAfterRemoval(commitBaseModel, source, active)
          if (replacement && !hidden.has(replacement)) {
            intents.push({ t: 'activate', key: replacement, side: source })
          }
          const destinationActive = activeBeforeRebase[destination]
          if (destinationActive && destinationActive !== active && !hidden.has(destinationActive)) {
            intents.push({ t: 'activate', key: destinationActive, side: destination })
          }
        }
      }
    }

    dlog('[owned-commit] dispatching', {
      intents,
      primary,
      secondary,
    })

    // Planned cross-side moves — the DOM placement pass and the taskbar /
    // drawer chrome handoffs (Configure gets the same treatment as
    // right-click and live DnD). Computed from the pre-rebase model: the
    // rebase only mirrors the facade-derived observed world, so sides do
    // not change.
    const plannedMoves = plannedMovesForCommit(commitBaseModel ?? model, desiredSide)

    // Chrome capture BEFORE placement: the moved tab's host button must
    // still be visible (mirror neighbor lookup skips hidden buttons) and
    // the moved button must still be in the secondary list. Skipped when
    // the caller already captured + applies the chrome itself (live DnD —
    // its pre-hide captures are authoritative and would otherwise double-
    // apply the handoffs).
    const mirrorChrome = new Map<TabKey, MainMirrorMoveChrome>()
    const secondaryChrome = new Map<TabKey, SecondaryMoveChrome>()
    if (!opts?.skipChrome) {
      for (const move of plannedMoves) {
        const liveId = host.resolve(move.key)
        if (!liveId) continue
        if (move.to === 'secondary') {
          mirrorChrome.set(move.key, await captureMainMirrorMoveChrome(liveId, 'secondary'))
        } else {
          secondaryChrome.set(move.key, await captureSecondaryNeighborForMove(liveId))
        }
      }
    }

    await dispatchBatch(intents)
    const committed = getModel()
    dlog('[owned-commit] committed', {
      primary: committed?.primary,
      secondary: committed?.secondary,
    })

    // ── DOM placement (2026-07-31) ─────────────────────────────────────
    // The reconciler's placement step is a no-op in this environment: the
    // observed world's `location` is derived from the model itself (the
    // assignment facade), so obs.location never differs from the model side
    // and host.placeTab never fires. Right-click places via placement-first
    // (assignToSecondary/unassignFromSecondary); live DnD got the same in
    // onUp. Configure was the last surface with NO placement — cross-column
    // drags updated the model but the DOM (buttons, roots, mirror) never
    // followed, so the main window showed no change. This pass completes the
    // DOM side for every committed cross-side move. Quiet: never activate
    // the moved tab in the destination (DnD/Configure contract) and never
    // force-open a closed drawer.
    if (plannedMoves.length > 0 && typeof document !== 'undefined') {
      try {
        const drawer = await import('../sidebar/secondary-drawer')
        drawer.setSuppressAutoActivation(true)
        try {
          for (const move of plannedMoves) {
            const liveId = host.resolve(move.key)
            if (!liveId) continue
            try {
              if (move.to === 'secondary') {
                await drawer.assignToSecondary(liveId, {
                  openOnClosed: false,
                  setActiveWhenReady: false,
                })
              } else {
                await drawer.unassignFromSecondary(liveId)
              }
            } catch (err) {
              dwarn('[owned-commit] placement failed for', move.key, String(err))
            }
          }
        } finally {
          drawer.setSuppressAutoActivation(false)
        }
        // assignToSecondary appends; snap the secondary list to the
        // committed model order so placed tabs land at the draft index
        // immediately (otherwise the order only converges on a later sync).
        const modelAfter = getModel()
        if (modelAfter && modelAfter.secondary.length > 0) {
          const { reorderSecondaryTabButtons, secondaryTabButtonsReady } = await import('../tabs/buttons')
          const ids = modelAfter.secondary
            .map(k => host.resolve(k))
            .filter((id): id is LiveTabId => !!id)
          if (secondaryTabButtonsReady(ids)) reorderSecondaryTabButtons(ids)
        }
      } catch (err) {
        dwarn('[owned-commit] placement pass failed:', err)
      }
    }

    // ── Chrome handoffs (Configure parity) ─────────────────────────────
    // Mirror neighbor handoff / content re-assert for moves-to-secondary;
    // secondary neighbor handoff for moves-to-primary. Same helpers the
    // right-click and DnD paths use. Skipped with skipChrome — the DnD
    // caller applies its own (pre-hide) captures after the commit.
    if (!opts?.skipChrome) {
      for (const move of plannedMoves) {
        const liveId = host.resolve(move.key)
        if (!liveId) continue
        try {
          if (move.to === 'secondary') {
            await applyMainMirrorMoveChrome(
              mirrorChrome.get(move.key) ?? { neighborBtn: null, reassertId: null },
              liveId,
            )
          } else {
            await applySecondaryNeighborHandoff(
              secondaryChrome.get(move.key) ?? { neighborBtn: null },
              liveId,
            )
          }
        } catch (err) {
          dwarn('[owned-commit] chrome handoff failed for', move.key, String(err))
        }
      }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function resolveKeys(ids: readonly string[], resolve: (id: string) => TabKey | null): TabKey[] {
  const keys: TabKey[] = []
  for (const id of ids) {
    const key = resolve(id)
    if (key) keys.push(key)
  }
  return keys
}

function activeSelection(world: ObservedWorld): ActiveSelection {
  return {
    primary: world.tabs.find(tab => tab.location === 'primary' && tab.isActiveInPrimary)?.key ?? null,
    secondary: world.tabs.find(tab => tab.location === 'secondary' && tab.isActiveInSecondary)?.key ?? null,
  }
}
