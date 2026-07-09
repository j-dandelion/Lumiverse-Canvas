// Canvas — `/select` slash command handler (v1.1.0).
//
// v1.1.0 scope: /select <range>, /select all, /select clear.
// Hide/unhide/delete are deferred to v1.2.0 (see plan Task 3.3).
//
// Design decisions (locked in):
//   1. /select <range> is REPLACE by default. The user typed a specific
//      range — they want that range, not "additions to whatever was selected."
//      We achieve this by calling `clearSelection()` first when the
//      selection is non-empty, then dispatching fresh clicks.
//   2. Visual `index_in_chat` (NOT array position). The extract module
//      scrapes the rendered number with a fiber fallback.
//   3. For loaded messages: toolbar-toggle select mode + bubble-phase
//      click dispatch. `selection.ts` handles both. Unloaded indices
//      surface in `missingIndices` and are toasted.
//
// Module composition:
//   - parser.ts:   pure arg parsing → SelectArgs
//   - extract.ts:  pure DOM scrape → number | null
//   - selection.ts: state mutation → SelectionResult
//   - index.ts:    this file — orchestrates the three for SlashContext.

import type { SlashCommandDef, SlashContext } from '../../types'
import { filterPrefix } from '../../arg-completions'
import { parseSelectArgs } from './parser'
import { readIndexInChat } from './extract'
import {
  selectByVisualIndices,
  clearSelection,
  isSelectModeActive,
  type SelectionResult,
} from './selection'

const SELECTOR_MESSAGE_ROW = '[data-component="BubbleMessage"]'

const SELECT_ARG_KEYWORDS = ['all', 'clear']

export function makeSelectCommands(): SlashCommandDef[] {
  return [
    {
      name: 'select',
      description: 'Select a range of messages (Example: /select 15-30)',
      usage: '/select',
      owner: 'canvas',
      category: 'select',
      getArgCompletions: (prefix) => filterPrefix(SELECT_ARG_KEYWORDS, prefix),
      handler: async (args, ctx) => {
        const raw = args._raw ?? ''
        const parsed = parseSelectArgs(raw)

        if (!parsed) {
          ctx.toast('error', 'Usage: /select <range>')
          return
        }

        if (parsed.kind === 'error') {
          ctx.toast('error', `Invalid /select args: ${parsed.reason}`)
          return
        }

        switch (parsed.kind) {
          case 'all':
            return handleAll(ctx)

          case 'clear':
            return handleClear(ctx)

          case 'range':
            return handleRange(ctx, parsed.indices)
        }
      },
    },
    {
      name: 'select-all',
      description: 'Select all loaded messages',
      usage: '/select all',
      owner: 'canvas',
      category: 'select',
      handler: async (_args, ctx) => handleAll(ctx),
    },
    {
      name: 'select-clear',
      description: 'Clear the current selection',
      usage: '/select clear',
      owner: 'canvas',
      category: 'select',
      handler: async (_args, ctx) => handleClear(ctx),
    },
  ]
}

async function handleAll(ctx: SlashContext): Promise<void> {
  const indices = new Set<number>()
  const rows = document.querySelectorAll<HTMLElement>(SELECTOR_MESSAGE_ROW)
  for (const row of Array.from(rows)) {
    const idx = readIndexInChat(row)
    if (idx !== null) indices.add(idx)
  }
  if (indices.size === 0) {
    ctx.toast('info', 'No loaded messages to select')
    return
  }
  // selectByVisualIndices uses REPLACE-by-delta: it leaves select mode
  // on and clicks only the rows whose state needs to change. No need
  // to clearSelection() first.
  const result = await selectByVisualIndices(indices)
  toastResult(ctx, result, 'Selected all loaded messages')
}

function handleClear(ctx: SlashContext): void {
  // Use the toolbar toggle pattern — don't call setMessageSelectMode directly.
  if (!isSelectModeActive()) {
    ctx.toast('info', 'No active selection to clear')
    return
  }
  clearSelection()
  ctx.toast('info', 'Selection cleared')
}

async function handleRange(ctx: SlashContext, indices: Set<number>): Promise<void> {
  if (indices.size === 0) {
    ctx.toast('error', 'Empty range')
    return
  }
  // REPLACE-by-delta: selectByVisualIndices leaves select mode on
  // and clicks only the rows whose state needs to change. No need
  // to clearSelection() first.
  const result = await selectByVisualIndices(indices)
  toastResult(ctx, result, null)
}

function toastResult(
  ctx: SlashContext,
  result: SelectionResult,
  fallback: string | null,
): void {
  const { matched, missingIndices, unreadable } = result
  if (matched === 0) {
    if (missingIndices.length > 0) {
      ctx.toast(
        'info',
        `None of the ${missingIndices.length} requested messages are loaded.`,
      )
    } else if (unreadable > 0) {
      ctx.toast('error', `Could not read an index from ${unreadable} row(s)`)
    } else {
      ctx.toast('info', fallback ?? 'No selection performed')
    }
    return
  }
  if (missingIndices.length > 0) {
    ctx.toast(
      'info',
      `Selected ${matched} messages. ${missingIndices.length} out of range.`,
    )
  } else {
    ctx.toast('success', fallback ?? `Selected ${matched} messages`)
  }
}
