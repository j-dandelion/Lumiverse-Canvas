import type { SlashCommandDef } from '../../types'

/**
 * Find the "tools" button in Lumiverse's chat input area.
 * The tools button has a wrench icon and opens a popover with "New Chat" option.
 */
function findToolsButton(): HTMLElement | null {
  // The tools button has title attribute with "tools" text and contains a wrench icon
  const selectors = [
    'button[title*="tools" i]',
    'button[title*="Tools" i]',
    // CSS-module class substrings for action buttons
    'button[class*="actionBtn"]',
    // Fallback: look for buttons with wrench icon
    'button svg',
  ]

  for (const selector of selectors) {
    const buttons = document.querySelectorAll<HTMLElement>(selector)
    for (const el of buttons) {
      const btn = el.closest('button') || el
      if (btn instanceof HTMLElement) {
        const title = btn.getAttribute('title')?.toLowerCase() || ''
        const text = btn.textContent?.toLowerCase() || ''
        if (title.includes('tools') || text.includes('tools')) {
          return btn
        }
      }
    }
  }

  // Last resort: scan all buttons for tools-related content
  const allButtons = document.querySelectorAll<HTMLButtonElement>('button')
  for (const btn of Array.from(allButtons)) {
    const title = btn.getAttribute('title')?.toLowerCase() || ''
    const text = btn.textContent?.toLowerCase() || ''
    if (title.includes('tools') || text.includes('tools')) {
      return btn
    }
  }

  return null
}

/**
 * Find the "New Chat" button inside the tools popover.
 * The button has text content matching "new chat" (localized).
 */
function findNewChatButtonInPopover(): HTMLElement | null {
  // Look for buttons with "new chat" text in the popover
  const buttons = document.querySelectorAll<HTMLButtonElement>('button')
  for (const btn of Array.from(buttons)) {
    const text = btn.textContent?.trim().toLowerCase() || ''
    if (text.includes('new chat') || text.includes('newchat')) {
      // Verify it's inside a popover (has popRowBtn class or similar)
      const parent = btn.closest('[class*="popover"]') || btn.closest('[class*="popRow"]')
      if (parent) {
        return btn
      }
    }
  }

  // Fallback: look for buttons with FilePlus icon (used in New Chat button)
  const svgButtons = document.querySelectorAll<HTMLButtonElement>('button svg')
  for (const svg of Array.from(svgButtons)) {
    const btn = svg.closest('button')
    if (btn instanceof HTMLElement) {
      const text = btn.textContent?.trim().toLowerCase() || ''
      if (text.includes('new chat') || text.includes('newchat')) {
        return btn
      }
    }
  }

  return null
}

export function makeNewChatCommand(): SlashCommandDef {
  return {
    name: 'newchat',
    description: 'Start a new chat with the currently selected character',
    usage: '/newchat',
    owner: 'canvas',
    category: 'chat',
    handler: async (_args, ctx) => {
      // Clear the command from textarea immediately to avoid flicker
      ctx.setText('')

      // Step 1: Find and click the tools button to open the popover
      const toolsButton = findToolsButton()
      if (!toolsButton) {
        ctx.toast('error', 'Could not find tools button')
        return
      }

      toolsButton.click()

      // Step 2: Wait for the popover to appear
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))

      // Step 3: Find and click the "New Chat" button in the popover
      const newChatButton = findNewChatButtonInPopover()
      if (!newChatButton) {
        ctx.toast('error', 'Could not find New Chat button in popover')
        return
      }

      newChatButton.click()

      // Step 4: Wait for React to commit the state change and re-render
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))

      ctx.toast('success', 'New chat started')
    },
  }
}
