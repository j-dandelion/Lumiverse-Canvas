// Regression (2026-07-31): the openSecondarySidebar re-assignment loop fed
// facade TabKeys ('builtin:loom') to assignToSecondary, which resolves
// liveIds — every restored secondary tab failed with "not found in
// DrawerObserver or store" and the second drawer came back empty after a
// reload even though layout.json had persisted the placements.
import { test, expect } from 'bun:test'
import { liveIdForFacadeKey } from '../secondary'

const tabs = [
  { tabId: 'loom', extensionId: '', title: 'Loom' },
  { tabId: 'spindle', extensionId: 'spindle', title: 'Extensions' },
  { tabId: 'foo-bar-0', extensionId: 'foo', title: 'Bar' },
]

test('builtin facade key resolves to the bare liveId', () => {
  expect(liveIdForFacadeKey('builtin:loom', tabs)).toBe('loom')
})

test('extension facade key resolves via extensionId + title', () => {
  expect(liveIdForFacadeKey('ext:foo/Bar', tabs)).toBe('foo-bar-0')
})

test('unknown facade key resolves to null (skip gracefully)', () => {
  // Builtins resolve structurally (the bare id is the liveId; absence is
  // handled by assignToSecondary's store fallback), extensions need a live
  // tab match, and anything else is not a facade key at all.
  expect(liveIdForFacadeKey('builtin:ghost', tabs)).toBe('ghost')
  expect(liveIdForFacadeKey('ext:foo/Missing', tabs)).toBeNull()
  expect(liveIdForFacadeKey('garbage', tabs)).toBeNull()
})
