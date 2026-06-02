# Slash Runtime — Recon (2026-06-02)

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
