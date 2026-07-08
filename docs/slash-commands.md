# Slash Command System

## Overview

Canvas ships a slash-command runtime that intercepts `/command args` in Lumiverse's chat textarea, shows a suggestion popup, and dispatches to registered handlers. Any extension can register commands via `CustomEvent` dispatch.

## Architecture

```
User types "/" in textarea
    ↓
intercept.ts (capture-phase keydown + input handler)
    ↓
parse.ts (pure regex parser → ParsedCommand)
    ↓
suggest.ts (popup UI with command list)
    ↓
intercept.ts (Enter/Tab/click → applySuggestion)
    ↓
intent.ts (stores committed command)
    ↓
dispatch.ts (looks up command, calls handler)
    ↓
Command handler runs with SlashContext
```

## Runtime (`slash/runtime.ts`)

`attachSlashRuntime(ctx)` wires everything:
1. Creates `CommandRegistry`
2. Registers built-in commands (`/help`, `/select`, `/newchat`, `/persona`)
3. Installs capture-phase intercept
4. Mounts toast surface (Preact)
5. Listens for `canvas:slash-register` / `canvas:slash-unregister` CustomEvents
6. Returns teardown function

## Command Registry (`slash/registry.ts`)

```typescript
class CommandRegistry {
  register(command: SlashCommandDef): () => void  // returns cleanup
  lookup(name: string): SlashCommandDef | undefined
  list(): SlashCommandDef[]
  clear(): void
}
```

Re-registration replaces the prior entry (calls cleanup first).

## Command Definition (`slash/types.ts`)

```typescript
interface SlashCommandDef {
  name: string           // 'help', 'select', etc.
  description: string    // shown in /help
  usage?: string         // '/select <range>' — shown in /help
  argsSchema?: { name: string; type: 'string' | 'number' | 'enum'; values?: string[]; optional?: boolean }[]
  handler: (args: Record<string, string>, ctx: SlashContext) => Promise<void> | void
  owner: string          // extension identifier
  category?: 'select' | 'layout' | 'theme' | 'lore' | 'chat' | 'meta'
}

interface SlashContext {
  chatId: string
  setText: (text: string) => void
  toast: (kind: 'info' | 'error' | 'success', text: string) => void
}
```

## Parser (`slash/parse.ts`)

Pure function. Regex: `/^\/(\S+)(?:\s+(.*))?$/`

- Must start with `/` at column 0
- Command name: `[a-z][a-z0-9_-]*`
- Optional whitespace + args
- Returns `ParsedCommand | null`

## Intercept (`slash/intercept.ts`)

Capture-phase handlers on `document`:

### Keydown
- **Escape**: dismiss popup (when visible)
- **ArrowUp/Down**: navigate popup rows
- **Tab**: autocomplete active row's usage into textarea
- **Enter**:
  - Popup visible: autocomplete + set intent
  - Popup hidden + parseable command: dispatch command, clear textarea
- All keys gated on `!e.isComposing` (CJK IME support)

### Input
- Forwards textarea value to `onTextChange` callback
- Skips if `consumeSkipNextTextChange()` returns true (post-autocomplete)
- Reconciles intent with textarea value

### Send Button Click
- Capture-phase on `SELECTOR_SEND_BTN`
- Uses intent (authoritative) over DOM parsing
- Falls back to `parseCommand(ta.value)` if no intent

### IME Composition
- `compositionstart` / `compositionend` handlers set `_isComposing` flag
- Prevents slash popup flicker during CJK input

## Suggest Popup (`slash/suggest.ts`)

Pure DOM popup. No Preact dependency.

- Anchored above/below the textarea
- Re-renders rows on each `showSuggest()` call
- Rows: name + description + owner chip
- Active row highlighted via `data-active` attribute
- ARIA: `role="listbox"`, `role="option"`, `aria-expanded`, `aria-activedescendant`

### Positioning (`slash/positioning.ts`)
- Sits above textarea when room, below otherwise
- Clamps left/right to viewport edges
- Repositions on scroll, resize, visual viewport resize

### Dismiss
- Outside click/tap/right-click dismisses the popup
- Row clicks use `mousedown` preventDefault to keep textarea focused

## Intent System (`slash/intent.ts`)

Stores the "committed" slash command (clicked, Enter'd, Tab'd). Survives React controlled-component reconciliation on mobile.

- `setIntent(parsed, source)` — store intent with timestamp
- `getIntent()` — read (5-min TTL)
- `clearIntent()` — consume (single-shot)
- `reconcileWithTextarea(text)` — clear if textarea moved on

Source types: `'click' | 'enter-popup' | 'enter-direct' | 'tab' | 'setText'`

## DOM Utilities (`slash/dom-utils.ts`)

- `applySuggestion(ta, label)` — write usage + trailing space, fire synthetic input, set cursor
- `setControlledValue(ta, value)` — React-aware value setter (bypasses `_valueTracker`)
- `consumeSkipNextTextChange()` — flag to suppress next onTextChange
- `isValidSlashContext(ta)` — checks `value.startsWith('/')`
- `findCompletionCandidateIndex(matches, text)` — promote active row when user types past command name
- `textareaHasUsage(ta, cmd)` — no-op guard for complete commands
- `resolveActiveIndex(matches, text, lastSticky)` — sticky active-row logic

## Built-in Commands

### `/help` (`slash/builtin-help.ts`)
Lists all registered commands via `registry.list()`.

### `/newchat` (`slash/commands/newchat/`)

Starts a new chat with the currently selected character. Finds Lumiverse's "New Chat" button using a cascade of selector strategies (data-testid, CSS-module class substrings, ARIA labels, title attribute, and visible text content). Shows an error toast if the button cannot be found, or a success toast after clicking.

### `/persona` (`slash/commands/persona/`)

Switches the active persona in the current chat. Takes a persona name as argument (`/persona <name>`). Finds the persona picker container via DOM selectors, then locates the matching persona item by text content (case-insensitive, whitespace-trimmed). Shows an error toast if the picker or persona is not found, or a success toast after switching.

### `/select` (`slash/commands/select/`)

Sub-commands: `/select <range>`, `/select all`, `/select clear`

**Parser** (`parser.ts`): Pure arg parser. Accepts:
- `25-100` — single range
- `25 100` — whitespace separator
- `1,5,10-12,100` — multi-range
- `all` / `clear` — keywords

**Extractor** (`extract.ts`): Reads visual `index_in_chat` from message rows:
1. Primary: scrape `[class*="metaPill"] [class*="metaSegment"]` text
2. Fallback: walk React fiber tree for `message.index_in_chat`

**Selection** (`selection.ts`): REPLACE-by-delta approach:
1. `ensureSelectMode()` — click toolbar toggle (NOT `setMessageSelectMode` — that clears selection)
2. Wait for React to re-render with select mode on
3. For each row: read index, check if selected, click if state needs to flip

## Extension Registration

Other extensions register commands via:

```javascript
window.dispatchEvent(new CustomEvent('canvas:slash-register', {
  detail: {
    command: {
      name: 'summarize',
      description: 'Summarize selected messages',
      owner: 'chronicle',
      handler: async (args, ctx) => { ... },
    },
  },
}))
```

Unregister: `window.dispatchEvent(new CustomEvent('canvas:slash-unregister', { detail: { name: 'summarize' } }))`

## Toast Surface (`slash/toast.tsx`)

Preact-rendered toast notifications.

### Architecture
- `mountToastSurface()` — creates a host div, renders `<ToastSurface />` via Preact, listens for `canvas:slash-toast` CustomEvents
- `unmountToastSurface()` — removes host, clears timers, unlistens

### Toast State
- Module-level `toasts` array and `listeners` Set
- `pushToast(kind, text)` — adds toast, auto-removes after 4s
- `ToastSurface` component — subscribes to `listeners`, renders toast list

### Styling
- Fixed position, bottom-right (`bottom: 16px; right: 16px; z-index: 9980`)
- Three variants: `info` (blue left border), `error` (red), `success` (green)
- Uses `--lumiverse-*` CSS variables for theme consistency
- `pointer-events: none` on container, `auto` on individual toasts

## Microtask Deferral (`slash/microtask.ts`)

`defer(fn)` — defers work to a true task (not microtask) via `MessageChannel` so the browser can paint between keystroke and handler. Falls back to `queueMicrotask`.
