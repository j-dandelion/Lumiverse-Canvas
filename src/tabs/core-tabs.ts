// Core built-in drawer tabs that are hide-locked in the Configure Tabs UI by
// default.
//
// Leaf module on purpose: `os/actions.ts` needs the core-id check without
// importing `configure-catalog` (which pulls the store graph). The unlock is
// the `coreTabsHidden` setting — these ids stay the canonical "core" set; the
// setting only decides whether the Configure eye toggle is enabled for them
// and whether an OS close also marks the tab hidden.

/** Built-in tab ids that cannot be hidden in the Configure Tabs UI. */
export const CORE_HIDE_LOCKED: ReadonlySet<string> = new Set([
  'profile', 'presets', 'loom',
  'characters', 'personas',
  'branches', 'spindle', 'theme', 'lorebook',
])

/** True when the given bare built-in tab id is in the core hide-locked set. */
export function isCoreTabId(id: string): boolean {
  return CORE_HIDE_LOCKED.has(id)
}
