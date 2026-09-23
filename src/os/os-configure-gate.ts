// L13 (2026-09-23): the settings panel's Configure dirty guard only runs when
// `willRestore` is true (shape-only entry/exit slot check). OS enable/disable
// used to refresh (discard) the open Configure draft unconditionally — silent
// data loss when willRestore was false and no dialog was shown. The panel
// records its willRestore decision here immediately before flipping `osMode`;
// the OS run reads and clears it around the modal-refresh tail.
//
// Leaf module (no imports) so panel.ts can static-import it without pulling
// the os-mode graph (panel tests mock features/registry for that reason).

let _osConfigureWillRestore: boolean | null = null

/** Panel: record whether the A7 dirty guard's willRestore gate fired. */
export function setOsConfigureWillRestore(value: boolean | null): void {
  _osConfigureWillRestore = value
}

/**
 * OS run: take the panel's willRestore decision (null = not from the panel /
 * already consumed — treat as true to keep the prior refresh-always behavior
 * for non-panel callers). Cleared on read so a later run cannot reuse it.
 */
export function takeOsConfigureWillRestore(): boolean | null {
  const value = _osConfigureWillRestore
  _osConfigureWillRestore = null
  return value
}
