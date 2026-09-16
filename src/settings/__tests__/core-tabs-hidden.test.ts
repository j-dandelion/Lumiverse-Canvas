// coreTabsHidden + osForcedSingleDrawer settings semantics (six-concerns #3/#6):
// defaults, OS-mode force/restore, bookkeeping validation, legacy blobs.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.error('FAIL:', msg)
  }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) passed++
  else {
    failed++
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

import { getSettings, hydrateSettings, setSettings } from '../state'
import { mergeCanvasSettings } from '../../types'

// ── Defaults ──
{
  hydrateSettings(null)
  assertEqual(getSettings().coreTabsHidden, false, 'coreTabsHidden defaults to false')
  assertEqual(getSettings().osForcedSingleDrawer, false, 'osForcedSingleDrawer defaults to false')
}

// ── OS mode forces coreTabsHidden in normalize/merge ──
{
  const merged = mergeCanvasSettings({ osMode: true })
  assertEqual(merged.coreTabsHidden, true, 'osMode:true forces coreTabsHidden on')
  const explicitOff = mergeCanvasSettings({ osMode: true, coreTabsHidden: false })
  assertEqual(explicitOff.coreTabsHidden, true, 'the force wins over an explicit false')
  const off = mergeCanvasSettings({ osMode: false, coreTabsHidden: false })
  assertEqual(off.coreTabsHidden, false, 'OS off leaves the user value alone')
}

// ── Snapshot on enable, restore on disable ──
{
  hydrateSettings({ osMode: false, coreTabsHidden: true })
  setSettings({ osMode: true })
  assertEqual(getSettings().coreTabsHidden, true, 'enable keeps it on (forced)')
  assertEqual(
    getSettings().osChromePrefs?.coreTabsHidden,
    true,
    'enable snapshots the pre-OS value into osChromePrefs',
  )
  setSettings({ osMode: false })
  assertEqual(getSettings().coreTabsHidden, true, 'disable restores the user value (was on)')
}
{
  hydrateSettings({ osMode: false, coreTabsHidden: false })
  setSettings({ osMode: true })
  assertEqual(getSettings().coreTabsHidden, true, 'enable forces it on')
  setSettings({ osMode: false })
  assertEqual(getSettings().coreTabsHidden, false, 'disable restores the user value (was off)')
}

// ── Legacy osChromePrefs blob (no coreTabsHidden member) ──
{
  hydrateSettings({
    osMode: true,
    osChromePrefs: { taskbarMode: true, moveControlsToOuterEdge: true },
  })
  assertEqual(getSettings().coreTabsHidden, true, 'legacy blob still forces coreTabsHidden')
  assertEqual(
    getSettings().osChromePrefs?.coreTabsHidden,
    undefined,
    'legacy osChromePrefs stays valid (optional member)',
  )
  setSettings({ osMode: false })
  assertEqual(getSettings().coreTabsHidden, false, 'legacy disable restores the default false')
}

// ── osChromePrefs shape validation ──
{
  const bad = mergeCanvasSettings({
    osMode: false,
    // @ts-expect-error corrupt disk value
    osChromePrefs: { taskbarMode: true, moveControlsToOuterEdge: true, coreTabsHidden: 'yes' },
  })
  assertEqual(bad.osChromePrefs, null, 'non-boolean coreTabsHidden drops the prefs blob')
}

// ── osForcedSingleDrawer coercion ──
{
  const coerced = mergeCanvasSettings({
    // @ts-expect-error corrupt disk value
    osForcedSingleDrawer: 'true',
  })
  assertEqual(coerced.osForcedSingleDrawer, false, 'non-boolean osForcedSingleDrawer coerces to false')
}

if (failed > 0) {
  console.error(`FAILED: ${failed}`)
  process.exitCode = 1
}
console.log(`PASS: ${passed}`)
