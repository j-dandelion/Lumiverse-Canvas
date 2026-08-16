// Phase 0: legacy combined layout migration.
import { migrateLegacyPayload } from '../migration'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) passed++
  else { failed++; console.error('FAIL:', msg) }
}

const legacy = JSON.stringify({
  version: '1.8.0.15',
  primary: { open: true, width: 420, tabId: 'profile:1' },
  secondary: { open: false, width: 360, activeTabId: 'lore:1' },
  tabOrder: ['profile:1', 'lore:1'],
  detachedTabs: [{ tabId: 'lore:1', tabTitle: 'Lore', sidebar: 'secondary' }],
  hiddenTabIds: ['profile:1'],
  settings: { secondSidebarEnabled: true, debugMode: false },
})

const migrated = migrateLegacyPayload(legacy)
assert(!!migrated, '16a: v1 payload migrates')
assert(migrated?.layout.version === 2, '16a: layout gets v2 version')
assert(!('settings' in (migrated?.layout ?? {})), '16a: settings removed from layout')
assert(migrated?.settings.version === 2, '16a: settings gets v2 version')
assert((migrated?.settings.settings as any)?.secondSidebarEnabled === true, '16a: settings preserved')
assert((migrated?.layout.tabOrder as string[])?.join(',') === 'profile:1,lore:1', '16a: order preserved')
assert((migrated?.layout.detachedTabs as any[])?.[0]?.tabId === 'lore:1', '16a: placement preserved')

const missingSettings = migrateLegacyPayload(JSON.stringify({ version: 1, tabOrder: ['a:1'] }))
assert(missingSettings?.settings.settings !== undefined, '16b: missing settings becomes an empty settings object')
assert(Object.keys(missingSettings?.settings.settings as object).length === 0, '16b: missing settings does not invent values')

assert(migrateLegacyPayload('{bad json') === null, '15a: malformed JSON is not migrated')
assert(migrateLegacyPayload(JSON.stringify({ version: 2, primary: {} })) === null, '16c: v2 is not migrated again')
assert(migrateLegacyPayload(JSON.stringify(['not', 'an', 'object'])) === null, '15b: array payload is rejected')

console.log(`persist/migration: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
  process.exit(1)
}
