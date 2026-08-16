// Shared backend context + Canvas version constant.
//
// Centralizes the BackendCtx singleton and the build-stamped
// CANVAS_VERSION so other modules can reach the backend or
// log version-mismatch warnings without depending on
// layout/persist.ts (which has been split into per-concern files).

export interface BackendCtx {
  sendToBackend(msg: { type: string; [key: string]: unknown }): void
  onBackendMessage(handler: (payload: unknown) => void): () => void
}

let _backendCtx: BackendCtx | null = null

export function getBackendCtx(): BackendCtx | null { return _backendCtx }
export function setBackendCtx(ctx: BackendCtx | null): void { _backendCtx = ctx }

// Stub value — build.sh injects the real version from package.json via
// sed before bundling.
export const CANVAS_VERSION = ''
