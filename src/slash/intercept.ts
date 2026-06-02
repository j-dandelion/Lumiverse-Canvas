// Capture-phase keydown + send-button click intercept.
// Exported: installIntercept(ctx, callbacks: InterceptCallbacks): () => void
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { ParsedCommand } from './parse'

export interface InterceptCallbacks {
  onParsed: (parsed: ParsedCommand, textarea: HTMLTextAreaElement) => void
  onTextChange: (text: string) => void
}

export function installIntercept(
  ctx: SpindleFrontendContext,
  callbacks: InterceptCallbacks,
): () => void {
  // Implementation: Tasks 2.4
  return () => {}
}
