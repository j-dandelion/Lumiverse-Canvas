// The Spindle loader's entry point is exported from src/setup.ts. Re-export
// here so the bundle's entry (dist/frontend.js, built from src/frontend.ts)
// keeps the same surface the manifest references.
//
// installBootDiag() runs at module evaluation — BEFORE the loader invokes
// setup() — so a synchronous throw inside setup is captured by the
// window 'error' listener even if nothing else logs.
import { installBootDiag } from './debug/boot-diag'

installBootDiag()

export { setup } from './setup'
