import type { SlashCommandDef } from '../../types'
import { filterPrefix } from '../../arg-completions'

const CACHE_TTL_MS = 60_000

interface PersonaCache {
  chatId: string
  names: string[]
  fetchedAt: number
}

let _cache: PersonaCache | null = null
let _warming = false

/**
 * Strip avatar-initial concat from popover button text.
 * "JJaime" → "Jaime" (first char equals first char of remainder, ci).
 * "Alice" stays "Alice" (A !== l).
 */
export function extractPersonaLabel(text: string): string {
  const t = text.trim()
  if (!t) return ''
  if (t.length > 1 && t[0]!.toLowerCase() === t[1]!.toLowerCase()) {
    return t.slice(1).trim()
  }
  return t
}

function cacheValid(chatId: string): boolean {
  return (
    _cache !== null &&
    _cache.chatId === chatId &&
    Date.now() - _cache.fetchedAt < CACHE_TTL_MS
  )
}

function getCachedNames(chatId: string): string[] {
  if (cacheValid(chatId)) return _cache!.names
  return []
}

/**
 * One-shot invisible popover scrape: open the persona picker, capture
 * button labels as they appear (hide-before-paint via MutationObserver),
 * then dismiss. Fires `canvas:slash-completions-changed` when names land
 * so the slash runtime can refresh the suggest popup.
 */
export function warmPersonaCache(chatId: string): void {
  if (_warming) return
  if (cacheValid(chatId)) return

  const personaButton = findPersonaButton()
  if (!personaButton) return

  _warming = true
  const stop = capturePersonaPopoverNames((names) => {
    _cache = { chatId, names, fetchedAt: Date.now() }
    _warming = false
    window.dispatchEvent(new CustomEvent('canvas:slash-completions-changed'))
  })

  // Start observer before click so we catch the popover before paint.
  personaButton.click()

  // Safety: if nothing appeared, clear warming so a later keystroke can retry.
  // Do NOT cache an empty miss for the full TTL — that would block completions
  // for 60s when the popover was merely slow. A short backoff is enough to
  // avoid hammering the picker every keystroke.
  setTimeout(() => {
    if (_warming) {
      _warming = false
      stop()
      if (!cacheValid(chatId)) {
        _cache = { chatId, names: [], fetchedAt: Date.now() - CACHE_TTL_MS + 1_500 }
      }
    }
  }, 500)
}

/** Test helper: reset module cache (not used in production). */
export function _resetPersonaCacheForTests(): void {
  _cache = null
  _warming = false
}

function findPersonaButton(): HTMLElement | null {
  const allButtons = document.querySelectorAll<HTMLButtonElement>('button')
  for (const btn of Array.from(allButtons)) {
    const title = btn.getAttribute('title') || ''
    const titleLower = title.toLowerCase()
    if (
      (titleLower.includes('switch persona') || titleLower.includes('send as persona')) &&
      !titleLower.startsWith('personas')
    ) {
      return btn
    }
  }
  return null
}

/**
 * Watch for a new popover to appear in the DOM (React render) and hide it
 * the instant it's added — before the browser paints. MutationObserver
 * callbacks fire synchronously after DOM mutations but before paint, so
 * `display: none` here means the popover is never visible.
 *
 * Only targets non-Canvas popovers (skips elements with data-canvas-slash).
 */
function hidePopoversAsTheyAppear(): () => void {
  let resolved = false
  const observer = new MutationObserver((mutations) => {
    if (resolved) return
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.getAttribute('data-canvas-slash')) continue
        if (node.matches?.('[class*="popover"]')) {
          node.style.display = 'none'
          resolved = true
          observer.disconnect()
          return
        }
        // Check children too (popover might be nested in a wrapper)
        const child = node.querySelector?.<HTMLElement>('[class*="popover"]:not([data-canvas-slash])')
        if (child) {
          child.style.display = 'none'
          resolved = true
          observer.disconnect()
          return
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  // Safety: disconnect after 500ms if nothing appeared
  setTimeout(() => { if (!resolved) observer.disconnect() }, 500)
  return () => { resolved = true; observer.disconnect() }
}

/**
 * Like hidePopoversAsTheyAppear, but scrapes persona button labels from
 * the popover before hiding it, then tries Escape to close the menu.
 */
function capturePersonaPopoverNames(onNames: (names: string[]) => void): () => void {
  let resolved = false
  const observer = new MutationObserver((mutations) => {
    if (resolved) return
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.getAttribute('data-canvas-slash')) continue

        let popover: HTMLElement | null = null
        if (node.matches?.('[class*="popover"]')) {
          popover = node
        } else {
          popover =
            node.querySelector?.<HTMLElement>('[class*="popover"]:not([data-canvas-slash])') ??
            null
        }
        if (!popover) continue

        const names: string[] = []
        const buttons = popover.querySelectorAll('button')
        for (const btn of Array.from(buttons)) {
          const raw = (btn.textContent ?? '').trim()
          if (!raw) continue
          const lower = raw.toLowerCase()
          // Exclude utility rows in the persona menu.
          if (
            lower.includes('clear') ||
            lower.includes('manage') ||
            lower.includes('select')
          ) {
            continue
          }
          const label = extractPersonaLabel(raw)
          if (label && !names.some((n) => n.toLowerCase() === label.toLowerCase())) {
            names.push(label)
          }
        }

        popover.style.display = 'none'
        resolved = true
        observer.disconnect()
        onNames(names)
        // Best-effort dismiss so the picker doesn't stay "open" invisibly.
        try {
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
          )
        } catch {
          // jsdom / limited environments may lack KeyboardEvent
        }
        return
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  setTimeout(() => {
    if (!resolved) observer.disconnect()
  }, 500)
  return () => {
    resolved = true
    observer.disconnect()
  }
}

async function findPersonaItemByName(name: string): Promise<HTMLElement | null> {
  const lower = name.toLowerCase()

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => requestAnimationFrame(r))

    const buttons = document.querySelectorAll<HTMLButtonElement>('button')
    for (const btn of Array.from(buttons)) {
      const text = btn.textContent?.trim().toLowerCase() || ''

      // Direct match
      if (text === lower) {
        return btn
      }

      // Match with avatar initial prefix (e.g., "JJaime" for "Jaime")
      // The pattern is: first char is the avatar initial, rest is the name
      if (text.length > 1 && text.substring(1) === lower) {
        return btn
      }

      // Match with avatar prefix + title (e.g., "JJaimeLannister" for "Jaime")
      if (text.length > 1 && text.substring(1).startsWith(lower)) {
        // Exclude non-persona buttons
        const withoutPrefix = text.substring(1)
        if (!withoutPrefix.includes('clear') && !withoutPrefix.includes('manage') && !withoutPrefix.includes('select')) {
          return btn
        }
      }
    }
  }

  return null
}

export function makePersonaCommand(): SlashCommandDef {
  return {
    name: 'persona',
    description: 'Switch the active persona in the current chat (Example: /persona Bob)',
    usage: '/persona',
    owner: 'canvas',
    category: 'chat',
    getArgCompletions: (prefix, ctx) => {
      // Sync API: return cache only; warm async so the next keystroke /
      // completions-changed event can populate the popup without flicker.
      warmPersonaCache(ctx.chatId)
      return filterPrefix(getCachedNames(ctx.chatId), prefix)
    },
    handler: async (args, ctx) => {
      const personaName = args._raw?.trim()

      if (!personaName) {
        ctx.toast('error', 'Usage: /persona <name>')
        ctx.setText('')
        return
      }

      // Clear the command from textarea immediately to avoid flicker
      ctx.setText('')

      const personaButton = findPersonaButton()
      if (!personaButton) {
        ctx.toast('error', 'Could not find persona button')
        return
      }

      // Start watching for the popover BEFORE clicking — the observer fires
      // synchronously on DOM mutations (before paint), so display:none takes
      // effect before the popover is ever visible.
      hidePopoversAsTheyAppear()
      personaButton.click()

      const target = await findPersonaItemByName(personaName)
      if (!target) {
        ctx.toast('error', `Persona not found: ${personaName}`)
        return
      }

      target.click()

      await new Promise((r) => requestAnimationFrame(r))
      await new Promise((r) => requestAnimationFrame(r))

      ctx.toast('success', `Switched to persona: ${personaName}`)
    },
  }
}
