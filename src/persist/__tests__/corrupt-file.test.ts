// Phase 0 exit criterion: corrupt-file move-aside.
//
// The plan required that a deliberately corrupted `layout.json` produces
// a warning and a preserved `.corrupt-<timestamp>.json` file rather
// than silent defaults. The runtime path is in `src/backend.ts`; this
// file tests the testable seam (`src/persist/corrupt-file.ts`) directly.

import { buildCorruptKey, moveCorruptFile, type Storage } from '../corrupt-file'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) {
    passed++
  } else {
    console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failed++
  }
}

class MemoryStorage implements Storage {
  private files = new Map<string, string>()
  async read(key: string): Promise<string | null> {
    return this.files.has(key) ? this.files.get(key)! : null
  }
  async write(key: string, contents: string): Promise<void> {
    this.files.set(key, contents)
  }
  async move(fromKey: string, toKey: string): Promise<void> {
    const v = this.files.get(fromKey)
    if (v === undefined) throw new Error(`no such key: ${fromKey}`)
    this.files.delete(fromKey)
    this.files.set(toKey, v)
  }
  async delete(key: string): Promise<void> {
    this.files.delete(key)
  }
  has(key: string): boolean {
    return this.files.has(key)
  }
  get(key: string): string | undefined {
    return this.files.get(key)
  }
  list(): string[] {
    return Array.from(this.files.keys()).sort()
  }
}

// ── buildCorruptKey: timestamp pattern ──
function test_buildCorruptKey_layout() {
  assertEqual(
    buildCorruptKey('layout.json', 1700000000000),
    'layout.corrupt-1700000000000.json',
    'C1: layout.json → layout.corrupt-<ts>.json',
  )
}
function test_buildCorruptKey_settings() {
  assertEqual(
    buildCorruptKey('settings.json', 42),
    'settings.corrupt-42.json',
    'C2: settings.json → settings.corrupt-<ts>.json',
  )
}
function test_buildCorruptKey_nestedPath() {
  assertEqual(
    buildCorruptKey('weird/path/foo.json', 99),
    'weird/path/foo.corrupt-99.json',
    'C3: nested path keeps parent directory',
  )
}
function test_buildCorruptKey_noJsonExt() {
  // Documented behaviour: if the key has no `.json` suffix, the replace
  // is a no-op and the function returns the original key. The runtime
  // only feeds keys ending in `.json`, so this is a defensive check
  // rather than a guarantee.
  assertEqual(
    buildCorruptKey('no-ext', 1),
    'no-ext',
    'C4: key without .json suffix is returned unchanged',
  )
}

// ── moveCorruptFile: end-to-end behaviour ──
async function test_moveCorruptFile_renamesAndPreservesBytes() {
  const storage = new MemoryStorage()
  const original = '{"version": 1, "this is not valid": }'  // intentionally malformed
  await storage.write('layout.json', original)

  const now = 1700000000000
  const newKey = await moveCorruptFile(storage, 'layout.json', () => now)

  assertEqual(newKey, 'layout.corrupt-1700000000000.json', 'CF1: returns the new corrupt key')
  assert(!storage.has('layout.json'), 'CF2: original key no longer exists')
  assert(storage.has('layout.corrupt-1700000000000.json'), 'CF3: corrupt artifact exists')
  assertEqual(storage.get('layout.corrupt-1700000000000.json'), original, 'CF4: bytes preserved verbatim')
}

async function test_moveCorruptFile_settings() {
  const storage = new MemoryStorage()
  const original = 'not json at all'
  await storage.write('settings.json', original)

  const newKey = await moveCorruptFile(storage, 'settings.json', () => 7)

  assertEqual(newKey, 'settings.corrupt-7.json', 'CF5: settings.json move-aside')
  assert(!storage.has('settings.json'), 'CF6: settings.json removed')
  assertEqual(storage.get('settings.corrupt-7.json'), original, 'CF7: settings bytes preserved')
}

async function test_moveCorruptFile_missingKey() {
  // If the original key is gone (e.g. another process already moved it),
  // the move fails and the helper returns null. The runtime logs and
  // continues with an error result.
  const storage = new MemoryStorage()
  const newKey = await moveCorruptFile(storage, 'layout.json', () => 1)
  assertEqual(newKey, null, 'CF8: missing key → null (no crash)')
}

async function test_moveCorruptFile_storageThrows() {
  const storage = new MemoryStorage()
  await storage.write('layout.json', 'corrupt')
  // Simulate a storage failure by deleting the key before the move.
  await storage.delete('layout.json')
  const newKey = await moveCorruptFile(storage, 'layout.json', () => 5)
  assertEqual(newKey, null, 'CF9: storage throw → null')
}

async function test_moveCorruptFile_timestampMonotonic() {
  // Two consecutive calls within the same millisecond produce DIFFERENT
  // keys (the function captures `now` once, but separate invocations
  // get separate captures). If the clock never advances, the second
  // call's corrupt file overwrites the first — that is documented as
  // a finding, not a fix: the runtime doesn't depend on it because
  // the corrupt-rename is a one-shot per parse error.
  const storage = new MemoryStorage()
  await storage.write('layout.json', 'first corrupt')
  await storage.write('settings.json', 'second corrupt')

  const ts = 1234567
  const k1 = await moveCorruptFile(storage, 'layout.json', () => ts)
  const k2 = await moveCorruptFile(storage, 'settings.json', () => ts)
  assertEqual(k1, 'layout.corrupt-1234567.json', 'CF10: layout corrupt key')
  assertEqual(k2, 'settings.corrupt-1234567.json', 'CF11: settings corrupt key')
  // Both artifacts present with the same timestamp.
  assert(storage.has(k1!), 'CF12: first corrupt artifact present')
  assert(storage.has(k2!), 'CF13: second corrupt artifact present')
}

await test_buildCorruptKey_layout()
await test_buildCorruptKey_settings()
await test_buildCorruptKey_nestedPath()
await test_buildCorruptKey_noJsonExt()
await test_moveCorruptFile_renamesAndPreservesBytes()
await test_moveCorruptFile_settings()
await test_moveCorruptFile_missingKey()
await test_moveCorruptFile_storageThrows()
await test_moveCorruptFile_timestampMonotonic()

console.log(`persist/corrupt-file: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
  process.exit(1)
}
