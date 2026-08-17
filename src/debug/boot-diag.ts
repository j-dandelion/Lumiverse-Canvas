// Boot diagnostics for Canvas.
//
// Purpose: when "Canvas fails to load on hard refresh" the console is the
// only evidence. This module records an UNCONDITIONAL boot timeline (not
// gated on debugMode — that setting hydrates too late to help) into:
//   1. the console ([Canvas-boot] entries)
//   2. a ring buffer persisted to localStorage['canvas.bootDiag.v1']
//      (survives navigation, so a hard refresh that kills the page still
//      leaves the previous timeline readable)
//   3. window.__canvasDiag.dump() — returns the whole timeline as JSON for
//      copy/paste into an issue
//
// It also installs window 'error' / 'unhandledrejection' capture as early as
// possible (module top of frontend.ts, i.e. before setup() is invoked), so a
// synchronous throw inside setup() is recorded even when nothing else logs.
//
// The stall watchdog arms at setup start: if setup has not reached a terminal
// step within the window, it dumps the timeline loudly — this catches the
// "promise never resolves" failure class (e.g. a backend IPC request dropped
// while the transport was not ready).

const KEY = 'canvas.bootDiag.v1'
const MAX_ENTRIES = 60
const WATCHDOG_MS = 20_000

interface DiagEntry {
  t: number // performance.now() at capture
  tag: string
  msg?: string
  kind: 'step' | 'error' | 'warn' | 'stall'
}

const timeline: DiagEntry[] = []
const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

function push(entry: DiagEntry): void {
  timeline.push(entry)
  if (timeline.length > MAX_ENTRIES) timeline.splice(0, timeline.length - MAX_ENTRIES)
  try {
    safeStorage()?.setItem(KEY, JSON.stringify(timeline.slice(-MAX_ENTRIES)))
  } catch {
    // storage full / unavailable — timeline still lives in memory
  }
}

/** Mark a boot milestone. Always logs (console.info) so the timeline is
 * readable even with debugMode off. */
export function bootStep(tag: string, msg?: string): void {
  const entry: DiagEntry = { t: performance.now() - startedAt, tag, msg, kind: 'step' }
  push(entry)
  // eslint-disable-next-line no-console
  console.info(`[Canvas-boot] +${entry.t.toFixed(0)}ms ${tag}${msg ? ` — ${msg}` : ''}`)
}

/** Record a boot failure (errors that would otherwise be swallowed). */
export function bootError(tag: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  push({ t: performance.now() - startedAt, tag, msg: detail, kind: 'error' })
  // eslint-disable-next-line no-console
  console.error(`[Canvas-boot] FAIL ${tag}`, err)
}

/** Record a warning without failing the boot. */
export function bootWarn(tag: string, msg?: string): void {
  push({ t: performance.now() - startedAt, tag, msg, kind: 'warn' })
  // eslint-disable-next-line no-console
  console.warn(`[Canvas-boot] WARN ${tag}${msg ? ` — ${msg}` : ''}`)
}

/** Arm the stall watchdog. Call once at setup start; call the returned
 * cancel when setup reaches a terminal step. */
export function armBootWatchdog(onStall: () => void): () => void {
  const timer = setTimeout(() => {
    onStall()
    push({ t: performance.now() - startedAt, tag: 'watchdog', msg: 'boot did not reach a terminal step in time', kind: 'stall' })
    // eslint-disable-next-line no-console
    console.error(`[Canvas-boot] STALL — setup did not finish within ${WATCHDOG_MS}ms. Timeline:\n` + dump())
  }, WATCHDOG_MS)
  if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
    ;(timer as unknown as { unref: () => void }).unref()
  }
  let cancelled = false
  return () => {
    if (cancelled) return
    cancelled = true
    clearTimeout(timer)
  }
}

/** Serialize the full timeline for copy/paste. */
export function dump(): string {
  return JSON.stringify(
    {
      at: new Date().toISOString(),
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      entries: timeline,
    },
    null,
    2,
  )
}

/** Install global error capture. Call at module top of frontend.ts. */
export function installBootDiag(): void {
  try {
    // eslint-disable-next-line no-console
    console.info('[Canvas-boot] diagnostics armed', { at: new Date().toISOString() })
    window.addEventListener('error', (event) => {
      push({
        t: performance.now() - startedAt,
        tag: 'window.error',
        msg: event.message + (event.filename ? ` @ ${event.filename}:${event.lineno}` : ''),
        kind: 'error',
      })
    })
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason
      const detail = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
      push({ t: performance.now() - startedAt, tag: 'unhandledrejection', msg: detail, kind: 'error' })
    })
    ;(window as unknown as Record<string, unknown>).__canvasDiag = {
      dump,
      timeline,
      storageKey: KEY,
    }
  } catch {
    // window unavailable (test env) — in-memory timeline still works
  }
}
