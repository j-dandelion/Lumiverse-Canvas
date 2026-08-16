// Layout snapshot — read-only view of live drawer state for persistence.
//
// This is a façade over the owned model + DOM. It is consumed by:
//   - settings/second-drawer-mode.ts (build the boot seed)
//   - sidebar/styles.ts (live width sampling during paint)
//   - layout/vanilla-baseline.ts (legacy baseline fixtures)
//   - persist/layout-model.ts (round-trip test fixtures)
//
// All read functions here are pure: they read DOM/CSS variables and
// the model, never write. The owned model is the source of truth for
// placement, order, hidden state, active state, and drawer metadata;
// this file only reads those views.

import { getMainDrawerWidth } from '../dom/lumiverse'
import { isSecondarySidebarOpen, SECONDARY_WIDTH_VAR } from '../sidebar/secondary'
import {
  CANVAS_MAIN_ACTIVE_CLASS,
  CANVAS_MAIN_OPEN_CLASS,
  MAIN_MIRROR_WIDTH_VAR,
} from '../sidebar/styles'
import { getLiveIdAssignments, getLiveIdAssignmentEntries } from '../tabs/assignment'
import { getActiveSecondaryTabId } from '../tabs/active-tab'
import { getCanvasHiddenTabIds } from '../tabs/canvas-hidden'
import { getHostDrawerSettings } from '../dom/host-settings'
import { getSettings, getLastLoadedLayout, setLastLoadedLayout } from '../settings/state'
import { getDrawerTabs } from '../store'
import { CANVAS_VERSION } from '../persist/backend-ctx'

function isCanvasMainModeDom(): boolean {
  try {
    return typeof document !== 'undefined'
      && document.documentElement.classList.contains(CANVAS_MAIN_ACTIVE_CLASS)
  } catch {
    return false
  }
}

function readPrimaryOpen(): boolean {
  if (isCanvasMainModeDom()) {
    return document.documentElement.classList.contains(CANVAS_MAIN_OPEN_CLASS)
  }
  return false
}

let _lastKnownPrimaryWidth: number | null = null

function readPrimaryWidth(): number {
  if (isCanvasMainModeDom()) {
    const fromVar = parseFloat(
      document.documentElement.style.getPropertyValue(MAIN_MIRROR_WIDTH_VAR),
    )
    if (isFinite(fromVar) && fromVar > 0) {
      _lastKnownPrimaryWidth = fromVar
      return fromVar
    }
    if (_lastKnownPrimaryWidth != null && _lastKnownPrimaryWidth > 0) {
      return _lastKnownPrimaryWidth
    }
    return 420
  }
  const hostW = getMainDrawerWidth()
  if (hostW > 0) {
    _lastKnownPrimaryWidth = hostW
    return hostW
  }
  if (_lastKnownPrimaryWidth != null && _lastKnownPrimaryWidth > 0) {
    return _lastKnownPrimaryWidth
  }
  return 420
}

function readSecondaryWidth(): number {
  if (typeof document === 'undefined') return 420
  return parseFloat(document.documentElement.style.getPropertyValue(SECONDARY_WIDTH_VAR)) || 420
}

export function snapshotLayout(): any {
  // KEYED ENTRY WRITE (REFACTOR-PLAN v2 §4.4): detachedTabs carries BOTH
  // namespaces — `tabId` = current live id (placement/address), `tabTitle`
  // = the model TabKey (authoritative for restore, tagging-state-
  // independent). Older writers put the human title in tabTitle, which
  // silently broke restore after the tagger re-keyed; the resolver accepts
  // all forms, so writers must now emit the canonical key.
  const assignments = getLiveIdAssignmentEntries()
  const secondaryAssignments = assignments.filter((a) => a.side === 'secondary')
  const drawerTabs = getDrawerTabs()
  return {
    version: CANVAS_VERSION,
    primary: {
      open: readPrimaryOpen(),
      width: readPrimaryWidth(),
      tabId: null,
    },
    secondary: {
      open: isSecondarySidebarOpen(),
      width: readSecondaryWidth(),
      activeTabId: getActiveSecondaryTabId(),
    },
    detachedTabs: secondaryAssignments
      .map(({ key, liveId }) => {
        const tab = drawerTabs.find(t => t.id === liveId)
        return { tabId: liveId, tabTitle: key, sidebar: 'secondary' }
      }),
    tabOrder: getHostDrawerSettings()?.tabOrder ?? [],
    hiddenTabIds: getCanvasHiddenTabIds(),
  }
}

export function hasDetachedTabs(
  layoutOrProfile: { detachedTabs?: unknown } | null | undefined,
): boolean {
  if (!layoutOrProfile) return false
  return Array.isArray(layoutOrProfile.detachedTabs) && layoutOrProfile.detachedTabs.length > 0
}

export function seedDualLayoutFromLive(): void {
  const live = snapshotLayout()
  const primaryWidth = (live.primary?.width > 0) ? live.primary.width : 420
  const seed = {
    version: live.version,
    primary: {
      open: live.primary?.open ?? false,
      width: primaryWidth,
      tabId: live.primary?.tabId ?? null,
    },
    secondary: {
      open: false,
      width: primaryWidth,
      activeTabId: null,
    },
    detachedTabs: [],
    hiddenTabIds: Array.isArray(live.hiddenTabIds) ? live.hiddenTabIds : getCanvasHiddenTabIds(),
  }
  setLastLoadedLayout(seed)
}

export function isAnyLayoutPersistenceEnabled(): boolean {
  return true
}

export function isPersistenceEnabled(): boolean {
  return true
}

export function isOpenStatePersistenceEnabled(): boolean {
  return !!getSettings().persistDrawerOpenState
}

export function isWidthPersistenceEnabled(): boolean {
  return !!getSettings().persistDrawerWidth
}

export function buildPersistedLayout(): ReturnType<typeof snapshotLayout> {
  const live = snapshotLayout()
  const last = getLastLoadedLayout()
  const base = {
    primary: last?.primary ?? { open: false, width: 420 },
    secondary: last?.secondary ?? { open: false, width: 420 },
    detachedTabs: last?.detachedTabs ?? [],
    hiddenTabIds: Array.isArray(last?.hiddenTabIds) ? last.hiddenTabIds : [],
  }
  const s = getSettings()
  const tabsLive = s.secondSidebarEnabled
  return {
    version: live.version,
    primary: {
      open: s.persistDrawerOpenState ? live.primary.open : (base.primary.open ?? false),
      width: s.persistDrawerWidth ? live.primary.width : (base.primary.width ?? 420),
      tabId: s.persistDrawerOpenState
        ? live.primary.tabId
        : ((base.primary as { tabId?: string | null }).tabId ?? null),
    },
    secondary: {
      open: s.persistDrawerOpenState ? live.secondary.open : (base.secondary.open ?? false),
      width: s.persistDrawerWidth ? live.secondary.width : (base.secondary.width ?? 420),
      activeTabId: tabsLive
        ? live.secondary.activeTabId
        : (base.secondary as { activeTabId?: string | null }).activeTabId,
    },
    detachedTabs: tabsLive ? live.detachedTabs : (base.detachedTabs ?? []),
    hiddenTabIds: Array.isArray(live.hiddenTabIds) ? live.hiddenTabIds : (base.hiddenTabIds ?? []),
    tabOrder: Array.isArray(live.tabOrder) ? live.tabOrder : [],
  }
}
