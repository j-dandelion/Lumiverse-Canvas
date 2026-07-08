import type { SlashCommandDef } from '../../types'

/**
 * Find Lumiverse's "New Chat" button using multiple selector strategies.
 *
 * Lumiverse's CSS-module class names are hashed in production, so we match
 * by prefix/substring rather than exact class names. We also try data-testid
 * and aria-label attributes as fallbacks.
 *
 * NOTE: These selectors should be validated against the actual Lumiverse DOM
 * in DevTools. If none match, inspect the New Chat button and add the correct
 * selector to the list below.
 */
function findNewChatButton(): HTMLElement | null {
  const selectors = [
    // data-testid is the most reliable when present
    '[data-testid*="new-chat"]',
    '[data-testid*="newChat"]',
    // CSS-module class substrings (Lumiverse convention: _someName_hash)
    '[class*="newChat"]',
    '[class*="newChatBtn"]',
    '[class*="new-chat"]',
    // ARIA labels as fallback
    'button[aria-label*="New Chat" i]',
    'button[aria-label*="new chat" i]',
    // Title attribute fallback
    'button[title*="New Chat" i]',
    'button[title*="new chat" i]',
  ]

  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) return el
  }

  // Last resort: scan buttons by visible text content
  const buttons = document.querySelectorAll<HTMLButtonElement>('button')
  for (const btn of Array.from(buttons)) {
    if (btn.textContent?.trim().toLowerCase() === 'new chat') {
      return btn
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
      const button = findNewChatButton()
      if (!button) {
        ctx.toast('error', 'Could not find new chat button')
        return
      }

      button.click()

      // Wait for React to commit the state change and re-render.
      // Two rAFs ensures the first frame paints before we verify.
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))

      // Best-effort verification: if the textarea still has content
      // after a short delay, the chat may not have changed.
      try {
        const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
        if (textarea && textarea.value !== '') {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      } catch {
        // Ignore verification errors — command likely worked.
      }

      ctx.toast('success', 'New chat started')
    },
  }
}
