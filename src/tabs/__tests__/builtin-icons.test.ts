// Tests for builtin-icons.ts — the generated Configure Tabs icon map.
//
// Pins the map to the host's current icon set (lucide-react@0.468.0 for 24
// built-ins + @tabler/icons-react@3.41.1 IconUsersGroup for council, path-for-
// path). The map was previously hand-copied from an older lucide set and the
// Configure Tabs rows rendered wrong/malformed glyphs vs the real tab strip.
// Regenerate with `bun scripts/generate-builtin-icons.mjs`.
import { BUILTIN_ICON_SVGS } from '../builtin-icons'
import { BUILTIN_TAB_IDS } from '../configure-catalog'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { console.error('FAIL:', msg); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { console.error(`FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++ }
}

const HOST_WRAPPER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'

// =====================================================================
// Coverage — exactly one icon per built-in catalog id
// =====================================================================
assertEqual(Object.keys(BUILTIN_ICON_SVGS).length, BUILTIN_TAB_IDS.length, 'map key count matches BUILTIN_TAB_IDS')
for (const id of BUILTIN_TAB_IDS) {
  const svg = BUILTIN_ICON_SVGS[id]
  assert(typeof svg === 'string' && svg.length > HOST_WRAPPER.length, `icon present and non-empty: ${id}`)
}

// =====================================================================
// Shape — host wrapper at stroke 1.75, no scriptable content
// =====================================================================
for (const [id, svg] of Object.entries(BUILTIN_ICON_SVGS)) {
  assert(svg.startsWith(HOST_WRAPPER), `${id}: host wrapper + stroke 1.75`)
  assert(svg.endsWith('</svg>'), `${id}: closes svg`)
  assert(!/<script|on[a-z]+\s*=/i.test(svg), `${id}: no script/event-handler attrs`)
}

// =====================================================================
// Current host signatures — these changed when the map was regenerated
// (lucide-react@0.468.0 / tabler 3.41.1). A drift or a bad regeneration
// breaks these before users see disfigured rows again.
// =====================================================================
const CURRENT_SIGNATURES: Array<[string, string]> = [
  ['presets', 'm21.64 3.64'],                        // Wand2 -> wand-sparkles wand body
  ['loom', '<circle cx="12" cy="18" r="3"/>'],       // GitFork bottom node
  ['weaver', 'M12.67 19a2 2 0 0 0 1.416-.588'],      // Feather body
  ['browser', 'M11 21.73'],                          // Package (current cube)
  ['personas', 'M22 5c0 9-4 12-6 12'],               // Drama mask face
  ['lorebook', 'm16 6 4 14'],                        // Library (4 books)
  ['cortex', 'M17.599 6.5a3 3 0 0 0 .399-1.375'],    // Brain half (current)
  ['create', 'M15.707 21.293'],                      // PenTool handle
  ['summary', 'M8 21h12a2 2 0 0 0 2-2v-1'],          // ScrollText (current)
  ['feedback', 'm10 7-3 3 3 3'],                     // MessageSquareReply arrow
  ['worldinfo', 'M12 2a14.5 14.5'],                  // Globe (current)
  ['wallpaper', 'm9 17 6.1-6.1'],                    // Wallpaper frame diagonal
  ['regex', '<rect x="2" y="14" width="8" height="8" rx="2"/>'], // Replace box
  ['theme', '1.996c3.051 0 5.555'],                  // Palette (current)
  ['council', 'M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0'], // tabler IconUsersGroup
]
for (const [id, fragment] of CURRENT_SIGNATURES) {
  assert(BUILTIN_ICON_SVGS[id]?.includes(fragment), `${id}: current host path signature`)
}

// =====================================================================
// Old (pre-regeneration) signatures must be gone — these are the exact
// glyphs that rendered wrong/malformed in the modal.
// =====================================================================
const OLD_SIGNATURES: Array<[string, string]> = [
  ['create bolt', 'M15.5 2H12'],                     // old Canvas create (bolt, not PenTool)
  ['old globe meridians', 'a15.3 15.3'],             // old Globe path (Wallpaper used it)
  ['old loom fork', 'm15 9 3-3'],                    // old hand-copied GitFork
  ['old presets wand', 'M21.5 2.5a.5.5'],            // old malformed wand body
  ['old persona bubble', 'M20 6H4a1 1 0 0 0-1 1v6'], // old message-square-more
  ['old lorebook lines', 'M9 9h6M9 13h6'],           // old book-with-lines
]
for (const [label, fragment] of OLD_SIGNATURES) {
  const hit = Object.entries(BUILTIN_ICON_SVGS).find(([, svg]) => svg.includes(fragment))
  assert(!hit, `old glyph removed (${label})${hit ? ` — still in ${hit[0]}` : ''}`)
}

// =====================================================================
// Summary
// =====================================================================
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}/${passed + failed}`)
