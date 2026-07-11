// parseLayoutBlob validation boundary tests.

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

import { parseLayoutBlob } from '../parse-layout'

assert(parseLayoutBlob(null) === null, 'null → null')
assert(parseLayoutBlob('x') === null, 'string → null')
assert(parseLayoutBlob(42) === null, 'number → null')

{
  const p = parseLayoutBlob({})
  assert(p !== null, 'empty object ok')
  assertEqual(p!.detachedTabs.length, 0, 'empty detached')
}

{
  const p = parseLayoutBlob({
    primary: { open: true, width: 300, tabId: 'chat' },
    secondary: { open: false, width: 400, activeTabId: 't1' },
    detachedTabs: [{ tabId: 't1' }, { tabId: 99 }, 'bad', { tabId: 't2' }],
  })
  assert(p !== null, 'partial ok')
  assertEqual(p!.primary?.open, true, 'primary open')
  assertEqual(p!.primary?.width, 300, 'primary width')
  assertEqual(p!.detachedTabs.length, 2, 'dropped bad entries')
  assertEqual(p!.detachedTabs[0].tabId, 't1', 'first good')
  assertEqual(p!.detachedTabs[1].tabId, 't2', 'second good')
}

{
  const p = parseLayoutBlob({ primary: { width: NaN, open: 'yes' as unknown as boolean } })
  assert(p !== null, 'bad field types ok')
  assert(p!.primary?.width === undefined, 'NaN width dropped')
  assert(p!.primary?.open === undefined, 'non-bool open dropped')
}

console.log(`PASS: ${passed}`)
if (failed) { console.log(`FAILED: ${failed}`); process.exit(1) }
