// Session dual profile — remembers secondary tab assignments while second
// drawer mode is off, so re-enabling restores them without requiring disk
// persistence. The profile is pure session-level (in-memory only); it does
// not write to the backend or interact with IPC.
//
// Capture runs while secondary tabs are still live (before teardown).
// Restore runs after the secondary sidebar is re-mounted.

import { getTabAssignments } from '../tabs/assignment'
import { getActiveSecondaryTabId } from '../tabs/active-tab'
import { getDrawerTabs } from '../store'
import { showSecondaryTab } from '../tabs/buttons'
import { dwarn } from '../debug/log'

export type SessionDualProfile = {
  detachedTabs: { tabId: string; tabTitle?: string; sidebar: 'secondary' }[]
  activeTabId: string | null
}

let _sessionProfile: SessionDualProfile | null = null

/**
 * Capture current secondary assignments + active tab as a session dual profile.
 * Must be called while secondary tabs are still live (before setSettings
 * triggers teardown). Idempotent — subsequent calls overwrite.
 */
export function captureSessionDualProfileFromLive(): SessionDualProfile {
  const assignments = Array.from(getTabAssignments().entries())
  const secondaryAssignments = assignments.filter(([_, side]) => side === 'secondary')
  const tabs = getDrawerTabs()

  const profile: SessionDualProfile = {
    detachedTabs: secondaryAssignments.map(([tabId]) => {
      const tab = tabs.find(t => t.id === tabId)
      return { tabId, tabTitle: tab?.title || tabId, sidebar: 'secondary' }
    }),
    activeTabId: getActiveSecondaryTabId(),
  }

  _sessionProfile = profile
  return profile
}

export function getSessionDualProfile(): SessionDualProfile | null {
  return _sessionProfile
}

export function setSessionDualProfile(profile: SessionDualProfile): void {
  _sessionProfile = profile
}

export function clearSessionDualProfile(): void {
  _sessionProfile = null
}

/**
 * Restore a session dual profile after the secondary sidebar is re-mounted.
 * Uses the quiet assign path (assignToSecondary with suppressed activation)
 * for each tab. Does NOT interact with disk persistence.
 *
 * Safe to call even when some tabs are already in secondary (idempotent).
 * When tabs facet is ON + profile exists, typically you should skip this
 * call and let applyLayout restore from lastLoaded (which was synced
 * before disable). This path is meant for the tabs-facet-off case.
 */
export async function restoreSessionDualProfile(profile: SessionDualProfile): Promise<void> {
  if (!profile || profile.detachedTabs.length === 0) return

  const sd = await import('../sidebar/secondary-drawer')
  sd.setSuppressAutoActivation(true)

  try {
    for (const dt of profile.detachedTabs) {
      try {
        await sd.assignToSecondary(dt.tabId)
      } catch (err) {
        dwarn(`restoreSessionDualProfile: assignToSecondary("${dt.tabId}") failed:`, err)
      }
    }

    // Set active tab (quiet — no auto-open toggle).
    if (profile.activeTabId) {
      showSecondaryTab(profile.activeTabId)
    }
  } finally {
    sd.setSuppressAutoActivation(false)
  }
}
