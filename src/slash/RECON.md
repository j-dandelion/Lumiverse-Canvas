# Slash Runtime — Recon (2026-06-02)

## Suggest popup: visuals + keyboard nav (v1.1.x follow-up)

**Status:** implemented. Replaces the v1.1.0 plain-DOM `Object.assign(el.style, {...})` with an injected style block tied to the canonical `--lumiverse-*` variable set, and adds keyboard navigation that the v1.1.0 popup lacked.

### Style block (`canvas_ext/src/slash/suggest.ts`)

`injectSuggestStyles()` is idempotent (mirrors `injectDrawerTabStyles` in `canvas_ext/src/frontend.ts:246-303`) — creates `<style id="canvas-slash-suggest-styles">` in `<head>` exactly once. The block uses only variables guaranteed by `~/Lumiverse/frontend/src/theme/variables.css:1-148`:

| Property | Variable |
|---|---|
| `background` | `var(--lumiverse-bg-elevated)` |
| `border` | `var(--lumiverse-border)` |
| `border-radius` | `var(--lumiverse-radius-md)` |
| `box-shadow` | `var(--lumiverse-shadow-md)` |
| `color` | `var(--lumiverse-text)` |
| `font-family` | `var(--lumiverse-font-family)` |
| `font-size` | `calc(13px * var(--lumiverse-font-scale, 1))` |
| `max-height` | `min(240px, calc(35vh / var(--lumiverse-ui-scale, 1)))` |
| row hover background | `var(--lumiverse-fill-subtle)` |
| **active** row background | `var(--lumiverse-primary-020)` |
| `z-index` | `10005` (above Lumiverse modals at 10001-10003) |

No hex literals, no `--lumiverse-bg-surface` (undefined — was a v1.1.0 typo), no `--lumiverse-font` (typo — corrected to `--lumiverse-font-family`).

**Active row treatment** mirrors `~/Lumiverse/frontend/src/components/modals/CommandPalette.module.css:163-165` (the Ctrl+K command menu): primary-tinted background fill via `--lumiverse-primary-020`, with a fade-in keyframe animation (`canvas-slash-suggest-fade`, 160ms cubic-bezier).

### SuggestController API (new in `suggest.ts`)

```ts
export interface SuggestController {
  setActiveIndex(i: number): void
  getActiveIndex(): number
  getActiveCommand(): SlashCommandDef | null
  scrollActiveIntoView(): void
  isVisible(): boolean
}

export function showSuggest(
  textarea: HTMLTextAreaElement,
  options: SlashCommandDef[],   // CHANGED from string[] in v1.1.0
): SuggestController
```

The controller is held in module scope; `getSuggestController()` and `isSuggestVisible()` expose it to `intercept.ts`. `hideSuggest()` clears it. `mouseenter` on each row syncs the index so keyboard and mouse stay in lockstep (mirrors `~/Lumiverse/frontend/src/components/modals/CommandPalette.tsx:142-189`).

### Keyboard nav (`canvas_ext/src/slash/intercept.ts`)

The capture-phase `keydownHandler` now handles, in addition to `Enter`:

| Key | Action | Notes |
|---|---|---|
| `Enter` | Dispatch | Active row wins over parsed name (when popup is visible) |
| `Tab` | Autocomplete | Writes active command's `usage ?? '/' + name` to the textarea; does NOT dispatch |
| `ArrowDown` | Active row +1 | Clamped; no wrap |
| `ArrowUp` | Active row -1 | Clamped; no wrap |
| `Escape` | Dismiss popup | Does NOT clear the textarea |

All five keys are gated on `!e.isComposing` (except `Escape`, which the IME may also use to cancel composition). When the popup is hidden, `ArrowUp`/`ArrowDown`/`Tab` fall through to the textarea's native behavior — cursor movement and focus-shifting are preserved.

The Tab handler sets a module-level `_skipNextTextChange` flag before dispatching the synthetic `input` event, so the input handler suppresses the runtime's re-show for the freshly-completed command. Without this, committing `/se` → `/select ` would re-open the popup with the full command list.

### ARIA (`canvas_ext/src/slash/suggest.ts`)

The textarea is tagged with `role="combobox"`, `aria-autocomplete="list"`, `aria-haspopup="listbox"`, `aria-controls="canvas-slash-suggest"` once via `applyTextareaAriaBaseline()` (idempotent). Per-show, `aria-expanded` and `aria-activedescendant` (set to `canvas-slash-opt-${i}` for the active row) are updated by `updateActiveDom()`. The container has `role="listbox"`; each row has `role="option"`, `aria-selected="true|false"`, `data-active="true|false"`, and a stable `id`.

Mirrors `~/Lumiverse/frontend/src/components/dream-weaver/components/chat/Composer.tsx:141-209` — Lumiverse's own slash-suggest ARIA shape.

### Toast z-index drop (`canvas_ext/src/slash/toast.tsx`)

`z-index: 10000` → `9980`. Toasts now sit in the floating-UI tier (alongside Lumiverse's `ExpressionDisplay` at 9970), below the suggest popup (10005) and below all Lumiverse modals (10001+). A 4-second toast can no longer occlude the user's active input. Audited: Chronicle's UI does not anchor against the toast surface; no other consumer.

---

## Bulk-hide/delete API

- **Path (hide):** `POST /api/v1/chats/{chatId}/messages/bulk-hide`
- **Path (delete):** `POST /api/v1/chats/{chatId}/messages/bulk-delete`
- **Body (hide):** `{ message_ids: string[], hidden: boolean }` (snake_case required)
- **Body (delete):** `{ message_ids: string[] }` (snake_case required)
- **Response (hide):** `{ success: true, updated: number, messages: Message[] }`
- **Response (delete):** `{ success: true, deleted: number }`
- **Chunking:** **YES — 500 messages max per batch.** Backend throws `Error("Maximum 500 messages per batch")` (verified at `~/Lumiverse/src/services/chats.service.ts:1703` for hide and `:1757` for delete). The route translates this to `400` with the same error message. Bridge code in v1.2.0 must chunk the array into batches of ≤500.
- **Validation:** Both routes return `400` for missing/empty `message_ids`, hide additionally requires `hidden` to be a boolean. `404` if chat not found.
- **Status:** Informational only — v1.1.0 ships only `/select <range>`, `/select all`, `/select clear`. Bulk-hide/delete deferred to v1.2.0 (see plan Task 3.3).

### Source citations
- Frontend client: `~/Lumiverse/frontend/src/api/chats.ts:169-181` (`bulkHide` and `bulkDelete` methods)
- Backend route: `~/Lumiverse/src/routes/chats.routes.ts:593-613` (hide), `:615-632` (delete)
- Backend service: `~/Lumiverse/src/services/chats.service.ts:1703` (hide chunk limit), `:1757` (delete chunk limit)

---

## Canvas backend message channel

- **Status: DEPENDENCY REMOVED.** Slash runtime is entirely frontend. See plan Task 0.1 Step 2. No `spindle.onFrontendMessage` traffic on the slash path. `/select` works entirely from the DOM + direct HTTP API calls with same-origin cookies.

---

## Textarea clearing

- **Pattern:** `rAF + dispatchEvent('input', { bubbles: true })` on the controlled-component textarea
- **Status:** inherited from Chronicle (not independently verified in this session). The rAF + dispatchEvent('input', { bubbles: true }) pattern is documented in Chronicle skill pitfalls #5 and used by Chronicle's `/select` working code at `~/chronicle_ext/src/select-range.ts`. Chronicle's implementation has been battle-tested in production. Plan to independently verify in Lumiverse DevTools during Phase 2 Task 2.4 smoke testing — if the pattern fails there, Phase 2 catches it before any other module depends on it.

---

## Dispatch tick

- **Chosen:** `MessageChannel.postMessage` (with `queueMicrotask` fallback if `MessageChannel` is unavailable)
- **Status:** verified. `typeof MessageChannel === 'function'` returns `true` in Node.js (verified 2026-06-02 during Phase 0). All modern browsers (Chrome, Firefox, Safari) support `MessageChannel.postMessage` — this is part of the HTML spec since 2015. The `queueMicrotask` fallback in `microtask.ts` is defensive only.

---

## Active chat/user id source

### chatId

- **Source:** Spindle context API — `ctx.getActiveChat()?.chatId`
- **Path:** `~/faded_theme_ext/node_modules/lumiverse-spindle-types/src/dom.ts:627` — `SpindleFrontendContext.getActiveChat(): { chatId: string | null; characterId: string | null }`
- **Type:** `string | null` — must handle the null case (no active chat, mid-navigation, etc.)
- **Fallback:** Chronicle's `select-range.ts:534-541` uses the same API with a URL pattern fallback: `window.location.pathname.match(/\/chat\/([^/]+)/)`. Recommend adopting the same fallback for robustness.
- **Confidence:** **high** — this is the canonical Spindle API, documented in the type definitions, and used by Chronicle's existing `/select` code path.

### userId

**userId:** Dropped from `SlashContext` in v1.1.0 per user decision. No source on `SpindleFrontendContext`; no v1.1.0 command needs it. Same-origin cookies handle auth in v1.2.0's bulk-hide/delete bridge. Re-add to `SlashContext` if a future command requires it.

### Cross-checks performed

- `grep "chatId\|userId\|activeChat\|currentUser" ~/canvas_ext/src/` — **no matches in canvas_ext**. The slash runtime will be the first to need this.
- `grep "getActiveChat" ~/chronicle_ext/src/select-range.ts` — confirms Chronicle uses `ctx.getActiveChat?.()` with URL fallback (`/chat/:chatId`).
- `grep "currentUser" ~/Lumiverse/frontend/src/` — `currentUser` is a React Context variable inside `UserManagement.tsx`, NOT exposed to extensions.
- `grep "data-chat-id\|data-user-id" ~/Lumiverse/frontend/src/` — only `data-chat-id` exists, on `<ChatHeads>` circles in the chat heads overlay (not the active chat itself). Not useful for the slash runtime.

---

## Surprises / things the plan didn't account for

1. **`SlashContext.userId` is unsourced → resolved by dropping it.** Plan Task 1.5 declared it required; no `userId` accessor exists on `SpindleFrontendContext`. **Resolution (2026-06-02):** user decided to drop `userId` from `SlashContext` entirely in v1.1.0. No v1.1.0 command needs it; v1.2.0's bulk-hide/delete bridge uses same-origin cookies for auth. See "userId" subsection above.
2. **Bulk API has a 500-message chunk limit.** Plan's `bridge.ts` stub (Task 3.3, line 1837) chunks with a safety cap of 50 iterations of 100/page for the *list* API but doesn't address the *bulk* API's 500-per-batch ceiling. Bridge code in v1.2.0 must chunk the bulk POST in 500-message slices. Informational for v1.1.0; flagged for v1.2.0.
3. **Chronicle already has the working pattern.** `~/chronicle_ext/src/select-range.ts:532-542` resolves `chatId` via `ctx.getActiveChat()?.chatId` with a URL fallback. The plan's `runtime.ts` (Task 2.6, line 1228) should mirror this — the function is `getActiveChatId()` not `getActiveChatId()`. Plan's stub is correct, but the implementation should lift the pattern verbatim (with attribution) rather than reinvent.
4. **No `data-chat-id` on the active chat surface.** The only `data-chat-id` attributes in the Lumiverse frontend are on chat-head overlays (`ChatHeads.tsx:486`). The active chat is identified by URL path or by the Zustand store, not by a DOM data attribute. This eliminates the "DOM scrape" option from Step 4.5's candidate list.
