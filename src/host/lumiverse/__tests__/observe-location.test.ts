// Regression: LumiverseHost.observe() must resolve a live tab's side via its
// TabKey, not its liveId.
//
// Since Task 10.6, the assignment facade (tabs/assignment.ts) is derived from
// the owned model and keyed by TabKey ('builtin:wallpaper', 'ext:foo:bar').
// buildHostEntry used to look the facade up by the live tab's id
// ('wallpaper'), which always missed -> every DOM-placed secondary tab was
// observed as 'primary' -> applySyncFromHost reverted the move on the next
// host-sync and the second drawer never stuck (2026-07-31 rClick regression).
import { test, expect } from 'bun:test'
import { entryLocationFor } from '../implementation'

const wallTab = { id: 'wallpaper', extensionId: 'unknown', title: 'Wallpaper' }

test('entryLocationFor: secondary when the TabKey is assigned to secondary', () => {
  const assignments = new Map([['builtin:wallpaper', 'secondary']])
  expect(entryLocationFor(wallTab, assignments)).toBe('secondary')
})

test('entryLocationFor: primary when the TabKey is assigned to primary', () => {
  const assignments = new Map([['builtin:wallpaper', 'primary']])
  expect(entryLocationFor(wallTab, assignments)).toBe('primary')
})

test('entryLocationFor: primary when the TabKey is absent', () => {
  expect(entryLocationFor(wallTab, new Map())).toBe('primary')
})

test('entryLocationFor: a liveId-keyed entry does NOT match (facade is TabKey-keyed)', () => {
  // This is the pre-fix bug shape: keying by the liveId ('wallpaper') could
  // never resolve the TabKey-keyed facade, so the tab fell back to primary.
  const liveIdKeyed = new Map([['wallpaper', 'secondary']])
  expect(entryLocationFor(wallTab, liveIdKeyed)).toBe('primary')
})

test('entryLocationFor: extension tabs resolve via extensionKey', () => {
  const extTab = { id: 'foo-bar', extensionId: 'foo', title: 'Bar' }
  const assignments = new Map([['ext:foo/Bar', 'secondary']])
  expect(entryLocationFor(extTab, assignments)).toBe('secondary')
})
