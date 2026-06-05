// The Spindle loader's entry point is exported from src/setup.ts. Re-export
// here so the bundle's entry (dist/frontend.js, built from src/frontend.ts)
// keeps the same surface the manifest references.
export { setup } from './setup'
