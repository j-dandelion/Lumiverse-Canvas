// Corrupt-file move-aside helper.
//
// When `backend.ts` encounters an unparseable `layout.json` (or
// `settings.json`) it must preserve the original bytes for forensic
// recovery, not silently overwrite them with defaults. The convention
// is: rename the file to `<filename>.corrupt-<timestamp>.json`.
//
// Phase 0 exit criterion (plan §0.4) required a test that this rename
// actually happens, the original file no longer exists at its old key,
// and the bytes are preserved verbatim. This module is the testable seam
// the runtime calls into; the runtime's `spindle.storage.move` is
// injected via the Storage interface so unit tests can use an
// in-memory fake.

export interface Storage {
  read(key: string): Promise<string | null>
  write(key: string, contents: string): Promise<void>
  move(fromKey: string, toKey: string): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * Build the `.corrupt-<timestamp>.json` destination key.
 *
 * Examples:
 *   buildCorruptKey('layout.json', 1700000000000)
 *     === 'layout.corrupt-1700000000000.json'
 *   buildCorruptKey('weird/path/foo.json', 42)
 *     === 'weird/path/foo.corrupt-42.json'
 *
 * The function is exported for testing the timestamp pattern only; the
 * runtime callers do not invoke it directly.
 */
export function buildCorruptKey(key: string, ts: number): string {
  return key.replace(/\.json$/, `.corrupt-${ts}.json`)
}

/**
 * Move `key` aside to a `.corrupt-<ts>.json` neighbour. Returns the new
 * key on success, or null if the move failed.
 *
 * The timestamp is captured once on entry so the function is total even
 * if the storage layer is slow. The runtime caller logs the failure
 * and returns its error result; tests assert the happy path here.
 */
export async function moveCorruptFile(
  storage: Storage,
  key: string,
  now: () => number = Date.now,
): Promise<string | null> {
  const ts = now()
  const corruptKey = buildCorruptKey(key, ts)
  try {
    await storage.move(key, corruptKey)
    return corruptKey
  } catch {
    return null
  }
}
