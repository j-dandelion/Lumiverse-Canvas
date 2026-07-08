import type { SlashCommandDef } from '../../types'

function log(msg: string): void {
  console.log(`[Canvas:persona] ${msg}`)
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

async function findPersonaItemByName(name: string): Promise<HTMLElement | null> {
  const lower = name.toLowerCase()
  log(`Looking for persona: "${name}"`)

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => requestAnimationFrame(r))

    const buttons = document.querySelectorAll<HTMLButtonElement>('button')
    for (const btn of Array.from(buttons)) {
      const text = btn.textContent?.trim().toLowerCase() || ''

      // Direct match
      if (text === lower) {
        log(`Found exact match at iteration ${i}`)
        return btn
      }

      // Match with avatar initial prefix (e.g., "JJaime" for "Jaime")
      // The pattern is: first char is the avatar initial, rest is the name
      if (text.length > 1 && text.substring(1) === lower) {
        log(`Found with avatar prefix at iteration ${i}: "${text}"`)
        return btn
      }

      // Match with avatar prefix + title (e.g., "JJaimeLannister" for "Jaime")
      if (text.length > 1 && text.substring(1).startsWith(lower)) {
        // Exclude non-persona buttons
        const withoutPrefix = text.substring(1)
        if (!withoutPrefix.includes('clear') && !withoutPrefix.includes('manage') && !withoutPrefix.includes('select')) {
          log(`Found with avatar prefix + extra at iteration ${i}: "${text}"`)
          return btn
        }
      }
    }
  }

  log(`No persona matching "${name}" found after 100 iterations`)
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
      log(`Handler called with: "${personaName}"`)

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

      log(`Clicking persona button`)
      personaButton.click()

      const target = await findPersonaItemByName(personaName)
      if (!target) {
        ctx.toast('error', `Persona not found: ${personaName}`)
        return
      }

      log(`Clicking persona item`)
      target.click()

      await new Promise((r) => requestAnimationFrame(r))
      await new Promise((r) => requestAnimationFrame(r))

      ctx.toast('success', `Switched to persona: ${personaName}`)
    },
  }
}
