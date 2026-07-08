import type { SlashCommandDef } from '../../types'

/**
 * DOM selectors for the persona picker area.
 *
 * Lumiverse's persona picker renders as a list of selectable items
 * (typically buttons or role="option" elements) inside a container.
 * The exact selectors depend on the Lumiverse version. We try a
 * cascade of common patterns and use the first that matches.
 */
const CONTAINER_SELECTORS = [
  '[data-testid*="persona"]',
  '[class*="persona"]',
  '[class*="Persona"]',
  '[data-component*="persona" i]',
  '[data-component*="Persona"]',
]

/** Child selectors to find individual persona items within a container. */
const ITEM_SELECTORS = [
  '[role="option"]',
  '[role="menuitem"]',
  '[role="radio"]',
  'button',
  'li',
]

function findPersonaContainer(): HTMLElement | null {
  for (const sel of CONTAINER_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel)
    if (el) return el
  }
  return null
}

function findPersonaItem(
  container: HTMLElement,
  name: string,
): HTMLElement | null {
  const lower = name.toLowerCase()
  for (const sel of ITEM_SELECTORS) {
    for (const item of container.querySelectorAll<HTMLElement>(sel)) {
      const text = item.textContent?.toLowerCase().trim()
      if (text === lower) return item
    }
  }
  return null
}

export function makePersonaCommand(): SlashCommandDef {
  return {
    name: 'persona',
    description: 'Switch the active persona in the current chat',
    usage: '/persona <name>',
    owner: 'canvas',
    category: 'chat',
    handler: async (args, ctx) => {
      const personaName = args._raw?.trim()

      if (!personaName) {
        ctx.toast('error', 'Usage: /persona <name>')
        return
      }

      const container = findPersonaContainer()
      if (!container) {
        ctx.toast('error', 'Could not find persona picker')
        return
      }

      const target = findPersonaItem(container, personaName)
      if (!target) {
        ctx.toast('error', `Persona not found: ${personaName}`)
        return
      }

      target.click()

      // Wait for React to re-render after persona selection.
      // Two rAFs ensures the commit is flushed before we proceed.
      await new Promise((r) => requestAnimationFrame(r))
      await new Promise((r) => requestAnimationFrame(r))

      ctx.toast('success', `Switched to persona: ${personaName}`)
    },
  }
}
