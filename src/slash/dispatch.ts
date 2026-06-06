import type { ParsedCommand } from './parse'
import type { CommandRegistry } from './registry'
import type { SlashContext } from './types'
import { defer } from './microtask'
import { dwarn } from '../debug/log'

export async function dispatchCommand(
  parsed: ParsedCommand,
  ctx: SlashContext,
  registry: CommandRegistry,
): Promise<void> {
  const cmd = registry.lookup(parsed.name)
  if (!cmd) {
    ctx.toast('error', `Unknown command: /${parsed.name}. Try /help.`)
    return
  }

  // Per-command arg parsing is the handler's job. We pass the raw args string
  // and let the handler split it. The SlashContext.setText can be used to
  // re-write the textarea if the command was a no-op.
  const args = parseSimpleArgs(parsed.args)

  try {
    await defer(() => cmd.handler(args, ctx))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ctx.toast('error', `/${cmd.name} failed: ${msg}`)
    dwarn(`${cmd.name} failed:`, e)
  }
}

// Naive arg parser: splits on whitespace, supports "quoted strings" as one arg.
// More sophisticated parsing is the handler's responsibility.
function parseSimpleArgs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  // For now, return the whole raw string under a key the handler can use.
  // Per-command schemas can replace this in Phase 3.
  out._raw = raw
  return out
}
