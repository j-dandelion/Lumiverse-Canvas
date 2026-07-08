# /newchat and /persona Slash Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new built-in slash commands to Canvas: `/newchat` to start a new chat with the currently selected character, and `/persona <name>` to switch the active persona in the current chat.

**Architecture:** Canvas-only implementation using DOM interaction with Lumiverse's existing UI elements. Commands follow the same pattern as `/select` — factory functions returning `SlashCommandDef` objects, registered in `runtime.ts`. No modifications to Lumiverse itself.

**Tech Stack:** TypeScript, DOM queries, React-aware waits (requestAnimationFrame), Canvas slash command registry API.

## Global Constraints

- Canvas-only changes (no Lumiverse modifications)
- Built-in commands (not CustomEvent registered)
- Follow existing `/select` command patterns
- Use `ctx.toast()` for all user feedback
- Wait for React re-render after DOM manipulation
- No new settings needed (uses existing `slashCommandsEnabled` toggle)

## File Structure

```
src/slash/commands/
├── newchat/
│   └── index.ts          # makeNewChatCommand() factory
├── persona/
│   └── index.ts          # makePersonaCommand() factory
└── select/
    └── index.ts          # (existing, reference only)

src/slash/runtime.ts      # Register new commands (modify)
```

---

### Task 1: Create /newchat command structure

**Covers:** S1 (newchat behavior)

**Files:**
- Create: `src/slash/commands/newchat/index.ts`
- Test: Manual testing in browser

**Interfaces:**
- Consumes: `SlashCommandDef` from `src/slash/types.ts`
- Produces: `makeNewChatCommand()` factory function

- [ ] **Step 1: Create newchat command file**

```typescript
// src/slash/commands/newchat/index.ts
import type { SlashCommandDef } from '../../types'

export function makeNewChatCommand(): SlashCommandDef {
  return {
    name: 'newchat',
    description: 'Start a new chat with the currently selected character',
    usage: '/newchat',
    owner: 'canvas',
    category: 'chat',
    handler: async (_args, ctx) => {
      // Implementation will go here
      ctx.toast('info', 'New chat command registered (not yet implemented)')
    },
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/slash/commands/newchat/index.ts
git commit -m "feat(slash): add /newchat command skeleton"
```

---

### Task 2: Implement /newchat DOM interaction

**Covers:** S1 (newchat DOM click approach)

**Files:**
- Modify: `src/slash/commands/newchat/index.ts:7-12` (handler implementation)
- Reference: `src/slash/commands/select/selection.ts` (DOM interaction patterns)

**Interfaces:**
- Consumes: DOM utilities from Lumiverse
- Produces: Working `/newchat` command that clicks the new chat button

- [ ] **Step 1: Research Lumiverse's new chat button selectors**

Open browser DevTools in Lumiverse, find the "New Chat" button, note:
- CSS class names
- data-testid attributes
- Button text content
- Parent container structure

Document findings in code comments.

- [ ] **Step 2: Implement DOM click handler**

```typescript
// src/slash/commands/newchat/index.ts
import type { SlashCommandDef } from '../../types'

export function makeNewChatCommand(): SlashCommandDef {
  return {
    name: 'newchat',
    description: 'Start a new chat with the currently selected character',
    usage: '/newchat',
    owner: 'canvas',
    category: 'chat',
    handler: async (_args, ctx) => {
      // Find the new chat button using multiple selector strategies
      const selectors = [
        '[data-testid*="new-chat"]',
        '[class*="newChat"]',
        '[class*="new-chat"]',
        'button[aria-label*="New Chat"]',
        'button[aria-label*="new chat"]',
      ]

      let button: HTMLElement | null = null
      for (const selector of selectors) {
        button = document.querySelector(selector)
        if (button) break
      }

      if (!button) {
        ctx.toast('error', 'Could not find new chat button')
        return
      }

      // Click the button
      button.click()

      // Wait for React re-render
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => requestAnimationFrame(resolve))

      ctx.toast('success', 'New chat started')
    },
  }
}
```

- [ ] **Step 3: Test in browser**

1. Load Canvas extension in Lumiverse
2. Type `/newchat` in chat input
3. Press Enter
4. Verify: New chat starts, success toast appears

- [ ] **Step 4: Add error handling for edge cases**

```typescript
// Add after button.click()
try {
  // Verify chat changed by checking if textarea is cleared
  const textarea = document.querySelector('textarea')
  if (textarea && textarea.value !== '') {
    // Chat may not have changed, wait longer
    await new Promise(resolve => setTimeout(resolve, 500))
  }
} catch {
  // Ignore verification errors, command likely worked
}
```

- [ ] **Step 5: Commit**

```bash
git add src/slash/commands/newchat/index.ts
git commit -m "feat(slash): implement /newchat DOM click handler"
```

---

### Task 3: Create /persona command structure

**Covers:** S2 (persona behavior)

**Files:**
- Create: `src/slash/commands/persona/index.ts`
- Test: Manual testing in browser

**Interfaces:**
- Consumes: `SlashCommandDef` from `src/slash/types.ts`
- Produces: `makePersonaCommand()` factory function

- [ ] **Step 1: Create persona command file**

```typescript
// src/slash/commands/persona/index.ts
import type { SlashCommandDef } from '../../types'

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

      // Implementation will go here
      ctx.toast('info', `Persona command registered for: ${personaName} (not yet implemented)`)
    },
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/slash/commands/persona/index.ts
git commit -m "feat(slash): add /persona command skeleton"
```

---

### Task 4: Implement /persona DOM interaction

**Covers:** S2 (persona DOM interaction approach)

**Files:**
- Modify: `src/slash/commands/persona/index.ts:7-20` (handler implementation)
- Reference: `src/slash/commands/select/selection.ts` (DOM interaction patterns)

**Interfaces:**
- Consumes: DOM utilities from Lumiverse
- Produces: Working `/persona` command that switches personas

- [ ] **Step 1: Research Lumiverse's persona picker selectors**

Open browser DevTools in Lumiverse, find the persona picker area, note:
- Persona list container selector
- Individual persona item selectors
- How persona names are displayed (text content, data attributes)
- How to trigger persona selection (click, button, etc.)

Document findings in code comments.

- [ ] **Step 2: Implement DOM interaction handler**

```typescript
// src/slash/commands/persona/index.ts
import type { SlashCommandDef } from '../../types'

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

      // Find persona picker container
      const containerSelectors = [
        '[data-testid*="persona"]',
        '[class*="persona"]',
        '[class*="Persona"]',
      ]

      let container: HTMLElement | null = null
      for (const selector of containerSelectors) {
        container = document.querySelector(selector)
        if (container) break
      }

      if (!container) {
        ctx.toast('error', 'Could not find persona picker')
        return
      }

      // Find persona items within container
      const personaItems = container.querySelectorAll('[role="option"], [role="menuitem"], li, button')
      let targetPersona: HTMLElement | null = null

      for (const item of personaItems) {
        const text = item.textContent?.toLowerCase().trim()
        if (text === personaName.toLowerCase()) {
          targetPersona = item as HTMLElement
          break
        }
      }

      if (!targetPersona) {
        ctx.toast('error', `Persona not found: ${personaName}`)
        return
      }

      // Click the persona
      targetPersona.click()

      // Wait for React re-render
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => requestAnimationFrame(resolve))

      ctx.toast('success', `Switched to persona: ${personaName}`)
    },
  }
}
```

- [ ] **Step 3: Test in browser**

1. Load Canvas extension in Lumiverse
2. Type `/persona SomePersonaName` in chat input
3. Press Enter
4. Verify: Persona switches, success toast appears

- [ ] **Step 4: Test error cases**

1. Type `/persona` (no argument)
2. Verify: Usage error toast appears
3. Type `/persona NonExistentPersona`
4. Verify: "Persona not found" error toast appears

- [ ] **Step 5: Commit**

```bash
git add src/slash/commands/persona/index.ts
git commit -m "feat(slash): implement /persona DOM interaction handler"
```

---

### Task 5: Register commands in runtime.ts

**Covers:** S1, S2 (command registration)

**Files:**
- Modify: `src/slash/runtime.ts` (add imports and registration)

**Interfaces:**
- Consumes: `makeNewChatCommand()` from Task 1
- Consumes: `makePersonaCommand()` from Task 3
- Produces: Commands available in slash command registry

- [ ] **Step 1: Add imports to runtime.ts**

```typescript
// At top of src/slash/runtime.ts, add:
import { makeNewChatCommand } from './commands/newchat'
import { makePersonaCommand } from './commands/persona'
```

- [ ] **Step 2: Register commands**

```typescript
// In attachSlashRuntime() function, after existing registrations:
registry.register(makeNewChatCommand())
registry.register(makePersonaCommand())
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Test both commands in browser**

1. Type `/help` to see command list
2. Verify: `/newchat` and `/persona` appear in help
3. Test `/newchat` works
4. Test `/persona <name>` works
5. Test `/persona` without argument shows usage

- [ ] **Step 5: Commit**

```bash
git add src/slash/runtime.ts
git commit -m "feat(slash): register /newchat and /persona commands"
```

---

### Task 6: Polish and finalize

**Covers:** S1, S2 (final verification)

**Files:**
- Review: All files created/modified in Tasks 1-5

**Interfaces:**
- No new interfaces
- Produces: Complete, tested implementation

- [ ] **Step 1: Review all code for consistency**

Check:
- Error messages are clear and helpful
- Toast notifications use consistent styling
- DOM selectors are robust with fallbacks
- TypeScript types are correct
- No console.log statements left in code

- [ ] **Step 2: Test edge cases**

1. `/newchat` when new chat button is hidden
2. `/persona` when persona picker is closed
3. `/persona` with case-sensitive names
4. `/persona` with extra whitespace

- [ ] **Step 3: Update documentation (if needed)**

Check if any docs need updating:
- `docs/slash-commands.md` - add new commands
- `AGENTS.md` - update command list

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(slash): complete /newchat and /persona implementation"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** Tasks 1-2 cover /newchat, Tasks 3-4 cover /persona, Task 5 covers registration
- [ ] **Placeholder scan:** No TBD/TODO markers, all steps have concrete code
- [ ] **Type consistency:** SlashCommandDef interface used consistently, ctx.toast() signature matches
- [ ] **DOM selector robustness:** Multiple fallback selectors for each command
- [ ] **Error handling:** All failure cases covered with user-friendly toasts
