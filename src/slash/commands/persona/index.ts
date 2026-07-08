import type { SlashCommandDef } from '../../types'

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
