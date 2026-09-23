// Custom assertion harness — see Chronicle testing-conventions.md
// Pure-derivation tests for os/start-menu.ts: entry derivation (both drawers,
// hidden + closed included, alphabetical by title, per-entry side, state
// glyphs, dedupe, unresolvable skip) + glyph mapping.
let passed = 0
let failed = 0
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}
function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL: ${message}`)
    failed++
  }
}

import {
  builtinBaseId,
  deriveStartMenuEntries,
  entryMonogram,
  extractButtonIcon,
  hideStartMenu,
  openStartMenu,
  resolveEntryIcon,
  STATE_LABEL,
  STATE_MARK_SVG,
  STATE_VERB,
} from '../start-menu'
import { BUILTIN_ICON_SVGS } from '../../tabs/builtin-icons'
import { PUZZLE_ICON_SVG } from '../../sidebar/secondary'

const KEY_A = 'builtin:a'
const KEY_B = 'builtin:b'
const KEY_C = 'ext:x/c'
const KEY_HIDDEN = 'builtin:hidden'
const KEY_GONE = 'ext:x/gone'

const liveIds = new Map<string, string>([
  [KEY_A, 'a:2'],
  [KEY_B, 'b:2'],
  [KEY_C, 'c:2'],
  [KEY_HIDDEN, 'h:2'],
])
// Deliberately NOT in alphabetical order — the derivation must sort.
const storeTabs = [
  { id: 'h:2', title: 'Hidden' },
  { id: 'c:2', title: 'Gamma' },
  { id: 'a:2', title: 'Alpha', iconSvg: '<svg/>' },
  { id: 'b:2', title: 'Beta' },
]

// getDrawerTabs is consumed inside deriveStartMenuEntries — bun:test mock.
import { mock } from 'bun:test'
mock.module('../../store', () => ({
  getDrawerTabs: () => storeTabs,
  // Other store exports are not referenced by start-menu's derive path.
  getMainDrawerSide: () => 'right',
  callHostStoreAction: () => {},
}))
// The dismissal-lifecycle block below opens the REAL menu via openStartMenu;
// the recon host/model and the stylesheet injector are the only heavy edges
// the open path needs — stub them so the DOM shim stays minimal.
mock.module('../../recon/dispatch', () => ({
  getModel: () => makeModel(),
  getHost: () => ({ resolve: (key: string) => liveIds.get(key) ?? null }),
  // Run-scoped persist override (adversarial F2 — os-mode static import).
  setPersistOsOverride: () => {},
}))
mock.module('../start-menu-styles', () => ({
  injectStartMenuStyles: () => {},
  START_MENU_STYLE_ID: 'canvas-os-start-menu-styles',
}))

function makeModel() {
  return {
    primary: [KEY_A, KEY_B],
    secondary: [KEY_C, KEY_HIDDEN],
    hidden: [KEY_HIDDEN],
    closed: [KEY_B],
    active: { primary: KEY_A, secondary: null as string | null },
  }
}

const resolve = (key: string) => liveIds.get(key) ?? null

// ── deriveStartMenuEntries: both drawers, hidden included, alphabetical ──
{
  const entries = deriveStartMenuEntries(makeModel(), resolve)
  assertEqual(entries.length, 4, 'both drawers listed, hidden included, unresolvable skipped')
  assertEqual(
    entries.map((e) => e.title).join(','),
    'Alpha,Beta,Gamma,Hidden',
    'alphabetized by title (not strip order)',
  )
  assertEqual(entries[0]?.liveId, 'a:2', 'alpha entry first')
  assertEqual(entries[0]?.side, 'primary', 'entry carries its own drawer (primary)')
  assertEqual(entries[0]?.state, 'open', 'active tab → open')
  assertEqual(entries[1]?.state, 'closed', 'closed-set membership → closed')
  assertEqual(entries[2]?.side, 'secondary', 'secondary entry carries secondary')
  assertEqual(entries[2]?.state, 'minimized', 'inactive in-drawer → minimized')
  assertEqual(entries[3]?.liveId, 'h:2', 'hidden tab is listed (recovery path)')
  assertEqual(entries[3]?.side, 'secondary', 'hidden tab keeps its drawer')
  assertEqual(entries[3]?.state, 'closed', 'hidden non-active tab → closed (no strip button, no ○)')
  assertEqual(entries[0]?.iconSvg, '<svg/>', 'icon from the store')
  assertEqual(entries[0]?.title, 'Alpha', 'title from the store')
}

// ── hidden presents like closed; a visible inactive tab stays minimized ──
{
  // Same model minus the OS closure: the eye-hidden tab must still show as
  // closed (it has no strip button), while a plain inactive tab keeps the
  // minimized ○.
  const entries = deriveStartMenuEntries({ ...makeModel(), closed: [] }, resolve)
  assertEqual(
    entries.find((e) => e.liveId === 'h:2')?.state,
    'closed',
    'eye-hidden tab → closed state (no mark)',
  )
  assertEqual(
    entries.find((e) => e.liveId === 'b:2')?.state,
    'minimized',
    'visible inactive tab → minimized (mark)',
  )
  const both = deriveStartMenuEntries({ ...makeModel(), closed: [KEY_HIDDEN] }, resolve)
  assertEqual(
    both.find((e) => e.liveId === 'h:2')?.state,
    'closed',
    'hidden + OS-closed → closed',
  )
}

// ── case-insensitive collation, stable on ties ──
{
  const mixed = [
    { id: 'g:2', title: 'gamma' },
    { id: 'b:2', title: 'Beta' },
    { id: 'a:2', title: 'alpha' },
  ]
  const mixedResolve = (key: string) =>
    key === KEY_A ? 'a:2' : key === KEY_B ? 'b:2' : key === KEY_C ? 'g:2' : null
  const saved = storeTabs.slice()
  storeTabs.length = 0
  storeTabs.push(...mixed)
  const entries = deriveStartMenuEntries(makeModel(), mixedResolve)
  assertEqual(
    entries.map((e) => e.title).join(','),
    'alpha,Beta,gamma',
    'case-insensitive alphabetical order',
  )
  storeTabs.length = 0
  storeTabs.push(...saved)
}

// ── unresolvable keys are skipped (cannot open this session) ──
{
  const entries = deriveStartMenuEntries(
    { ...makeModel(), primary: [KEY_A, KEY_GONE] },
    resolve,
  )
  assertEqual(entries.length, 3, 'unresolvable key skipped')
  assertEqual(entries[0]?.liveId, 'a:2', 'resolvable entry kept')
}

// ── dedupe: a key listed on both sides appears once ──
{
  const entries = deriveStartMenuEntries(
    { ...makeModel(), secondary: [KEY_A, KEY_C] },
    resolve,
  )
  assertEqual(
    entries.filter((e) => e.liveId === 'a:2').length,
    1,
    'duplicate key deduped by resolved liveId',
  )
}

// ── empty inventory → empty entries (menu shows the empty-state row) ──
{
  const empty = deriveStartMenuEntries(
    { ...makeModel(), primary: [], secondary: [] },
    resolve,
  )
  assertEqual(empty.length, 0, 'no tabs → no entries')
}

// ── State contract (user direction 2026-09-15: ● open / ○ minimized / none closed) ──
assertEqual(
  Object.keys(STATE_LABEL).sort().join(','),
  'closed,minimized,open',
  'labels cover exactly the three states',
)
assertEqual(STATE_VERB.open, 'Focus', 'open verb')
assertEqual(STATE_VERB.minimized, 'Restore', 'minimized verb')
assertEqual(STATE_VERB.closed, 'Launch', 'closed verb')
assert(
  STATE_MARK_SVG.open.includes('fill="currentColor"') &&
    STATE_MARK_SVG.open.includes('r="4"'),
  'open mark is a filled dot',
)
assert(
  STATE_MARK_SVG.minimized.includes('stroke="currentColor"') &&
    !STATE_MARK_SVG.minimized.includes('fill="currentColor"'),
  'minimized mark is a hollow circle',
)
assertEqual(STATE_MARK_SVG.closed, '', 'closed has no mark at all')

// ── Icon resolution (plan §3.5) ──
assertEqual(builtinBaseId('profile:2'), 'profile', 'builtin suffix stripped')
assertEqual(builtinBaseId('ext:foo'), 'ext:foo', 'extension address passes through')
assertEqual(builtinBaseId('ext:foo:2'), 'ext:foo', 'numeric suffix drift stripped')
assertEqual(entryMonogram('alpha'), 'A', 'monogram uppercases')
assertEqual(entryMonogram('  '), '?', 'empty title guarded')
assertEqual(entryMonogram('🧵 loom'), '🧵', 'non-ascii first code point')

const stubSvg = (outerHTML: string, classes: string[] = []) =>
  ({ outerHTML, classList: { contains: (c: string) => classes.includes(c) } }) as unknown as Element
const stubRoot = (opts: { svg?: Element; img?: string }) =>
  ({
    querySelector: (sel: string) =>
      sel === 'svg'
        ? opts.svg ?? null
        : sel === 'img' && opts.img
          ? { getAttribute: (attr: string) => (attr === 'src' ? opts.img : null) }
          : null,
  }) as unknown as HTMLElement

assertEqual(
  extractButtonIcon(stubRoot({ svg: stubSvg('<svg data-x="1"></svg>') })).svg,
  '<svg data-x="1"></svg>',
  'live button svg cloned',
)
assertEqual(
  extractButtonIcon(
    stubRoot({ svg: stubSvg('<svg class="lucide lucide-puzzle"></svg>', ['lucide-puzzle']) }),
  ).svg,
  undefined,
  'host puzzle placeholder is a miss',
)
assertEqual(
  extractButtonIcon(
    stubRoot({
      svg: stubSvg(PUZZLE_ICON_SVG.replace(/<path([^>]*)\/>/, '<path$1></path>'), [
        'canvas-puzzle',
      ]),
    }),
  ).svg,
  undefined,
  'canvas puzzle placeholder is a miss (structural marker class, parsed serialization)',
)
assertEqual(
  extractButtonIcon(stubRoot({ svg: stubSvg(PUZZLE_ICON_SVG) })).svg,
  PUZZLE_ICON_SVG,
  'raw puzzle markup without the marker class is not sniffed by outerHTML',
)
assertEqual(
  extractButtonIcon(stubRoot({ img: 'https://x/i.png' })).url,
  'https://x/i.png',
  'live button img url cloned',
)
assertEqual(extractButtonIcon(undefined).svg, undefined, 'missing root is a miss')
assertEqual(
  resolveEntryIcon({ iconSvg: '<svg id="s"/>' }, 'ext:foo').svg,
  '<svg id="s"/>',
  'store svg used when the live button yields nothing',
)
assertEqual(
  resolveEntryIcon(undefined, 'profile').svg,
  BUILTIN_ICON_SVGS.profile,
  'builtin map fallback',
)
assertEqual(
  resolveEntryIcon({}, 'profile:2').svg,
  BUILTIN_ICON_SVGS.profile,
  'builtin suffix resolves through the map',
)
assertEqual(
  resolveEntryIcon({}, 'ext:unknown').svg,
  undefined,
  'unknown extension falls through to the monogram',
)

// ── Resize dismissal lifecycle (M9): window + visualViewport listeners ──────
// The REAL openStartMenu runs against a hand-rolled DOM + listener recorders
// (repo convention, no jsdom): a window/visualViewport resize must dismiss
// the menu immediately through the SAME `_unsubDocListeners` teardown that
// outside-click/Escape use — removal exactly once, no leaks across cycles.

class FakeEl {
  tagName: string
  id = ''
  type = ''
  textContent = ''
  innerHTML = ''
  style: Record<string, string> = {}
  children: FakeEl[] = []
  parentElement: FakeEl | null = null
  isConnected = false
  removed = false
  animateCalls = 0
  private _classes = new Set<string>()
  private _attrs = new Map<string, string>()

  constructor(tag: string) { this.tagName = tag.toUpperCase() }

  get className() { return [...this._classes].join(' ') }
  set className(v: string) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)) }

  classList = {
    add: (...cs: string[]) => { for (const c of cs) this._classes.add(c) },
    remove: (...cs: string[]) => { for (const c of cs) this._classes.delete(c) },
    contains: (c: string) => this._classes.has(c),
  }

  setAttribute(k: string, v: string) { this._attrs.set(k, v) }
  getAttribute(k: string) { return this._attrs.get(k) ?? null }
  toggleAttribute(k: string, force?: boolean) {
    const on = force === undefined ? !this._attrs.has(k) : force
    if (on) this._attrs.set(k, '')
    else this._attrs.delete(k)
    return on
  }
  appendChild(child: FakeEl) {
    child.parentElement = this
    child.isConnected = true
    this.children.push(child)
    return child
  }
  append(...kids: FakeEl[]) { for (const k of kids) this.appendChild(k) }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this)
    }
    this.parentElement = null
    this.isConnected = false
    this.removed = true
  }
  contains(el: unknown): boolean {
    return el === this || this.children.some((c) => c.contains(el))
  }
  addEventListener() { /* element-level listeners are not under test */ }
  removeEventListener() { /* element-level listeners are not under test */ }
  focus() { /* no-op */ }
  querySelector(): FakeEl | null { return null }
  querySelectorAll(): FakeEl[] { return [] }
  getBoundingClientRect() {
    return { left: 16, top: 600, width: 120, height: 40, right: 136, bottom: 640 }
  }
  animate() {
    this.animateCalls++
    return {
      onfinish: null as (() => void) | null,
      oncancel: null as (() => void) | null,
      cancel() { /* no-op */ },
    }
  }
}

type ListenerFn = (ev: unknown) => void
interface ListenerCall { type: string; fn: ListenerFn }
function makeRecorder() {
  const adds: ListenerCall[] = []
  const removes: ListenerCall[] = []
  return {
    adds,
    removes,
    addEventListener: (type: string, fn: ListenerFn) => { adds.push({ type, fn }) },
    removeEventListener: (type: string, fn: ListenerFn) => { removes.push({ type, fn }) },
  }
}
type Recorder = ReturnType<typeof makeRecorder>
function activeCount(rec: Recorder, type: string): number {
  const dead = new Set(rec.removes.filter((c) => c.type === type).map((c) => c.fn))
  return rec.adds.filter((c) => c.type === type && !dead.has(c.fn)).length
}
function fire(rec: Recorder, type: string): void {
  const dead = new Set(rec.removes.filter((c) => c.type === type).map((c) => c.fn))
  for (const c of rec.adds.filter((c) => c.type === type && !dead.has(c.fn))) c.fn({})
}
function lastAdd(rec: Recorder, type: string): ListenerFn | undefined {
  return [...rec.adds].reverse().find((c) => c.type === type)?.fn
}

const winRec = makeRecorder()
const docRec = makeRecorder()
const vvRec = makeRecorder()
const fakeBody = new FakeEl('body')
const fakeDoc = {
  body: fakeBody,
  head: new FakeEl('head'),
  documentElement: new FakeEl('html'),
  activeElement: null,
  createElement: (tag: string) => new FakeEl(tag),
  getElementById: () => null,
  querySelectorAll: () => [] as FakeEl[],
  addEventListener: docRec.addEventListener,
  removeEventListener: docRec.removeEventListener,
}
;(globalThis as any).window = {
  addEventListener: winRec.addEventListener,
  removeEventListener: winRec.removeEventListener,
  innerWidth: 1024,
  innerHeight: 768,
  visualViewport: {
    addEventListener: vvRec.addEventListener,
    removeEventListener: vvRec.removeEventListener,
  },
}
;(globalThis as any).document = fakeDoc
;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => { cb(0); return 1 }
;(globalThis as any).cancelAnimationFrame = () => { /* no-op */ }

function openFreshMenu(): { menu: FakeEl; button: FakeEl } {
  const button = new FakeEl('button')
  button.isConnected = true
  openStartMenu('primary', button as unknown as HTMLElement)
  const menu = fakeBody.children[fakeBody.children.length - 1] as FakeEl
  return { menu, button }
}

// ── (1) window resize ⇒ immediate hide + listener removed ──
{
  assertEqual(activeCount(winRec, 'resize'), 0, 'M9: no window resize listener before open')
  const { menu } = openFreshMenu()
  assertEqual(activeCount(winRec, 'resize'), 1, 'M9: open registers one window resize dismissal')
  assertEqual(activeCount(docRec, 'mousedown'), 1, 'M9: outside-click dismissal still registered on open')
  assertEqual(menu.animateCalls, 1, 'M9: the open animation ran (fake WAAPI)')
  fire(winRec, 'resize')
  assert(menu.removed, 'M9: window resize hides the menu')
  assert(!fakeBody.children.includes(menu), 'M9: the dismissed menu left the DOM')
  assertEqual(menu.animateCalls, 1, 'M9: resize dismissal is immediate (no close animation)')
  assertEqual(activeCount(winRec, 'resize'), 0, 'M9: window resize listener removed on dismiss')
  assertEqual(activeCount(docRec, 'mousedown'), 0, 'M9: mousedown listener removed by the same teardown')
  assertEqual(activeCount(docRec, 'keydown'), 0, 'M9: keydown listener removed by the same teardown')
  assertEqual(activeCount(vvRec, 'resize'), 0, 'M9: visualViewport listener removed by the same teardown')
  // Idempotent: a stale handler fire after teardown is a no-op, not a double remove.
  lastAdd(winRec, 'resize')!({})
  assertEqual(
    winRec.removes.filter((c) => c.type === 'resize').length,
    1,
    'M9: dismissal removes the resize listener exactly once',
  )
}

// ── (2) visualViewport resize ⇒ immediate hide + listener removed ──
{
  const { menu } = openFreshMenu()
  assertEqual(activeCount(vvRec, 'resize'), 1, 'M9: open registers one visualViewport resize dismissal')
  fire(vvRec, 'resize')
  assert(menu.removed, 'M9: visualViewport resize hides the menu')
  assertEqual(menu.animateCalls, 1, 'M9: visualViewport dismissal is immediate (no close animation)')
  assertEqual(activeCount(vvRec, 'resize'), 0, 'M9: visualViewport listener removed on dismiss')
  assertEqual(activeCount(winRec, 'resize'), 0, 'M9: window listener removed by the same teardown')
}

// ── (3) open → close → open ⇒ exactly one active dismissal set ──
{
  const { menu: first } = openFreshMenu()
  hideStartMenu({ immediate: true })
  assert(first.removed, 'M9: close removes the first menu')
  assertEqual(activeCount(winRec, 'resize'), 0, 'M9: close removes the window resize listener')
  assertEqual(activeCount(vvRec, 'resize'), 0, 'M9: close removes the visualViewport resize listener')
  const addsBeforeReopen = winRec.adds.filter((c) => c.type === 'resize').length
  const { menu: second } = openFreshMenu()
  assertEqual(activeCount(winRec, 'resize'), 1, 'M9: reopen registers exactly one window resize listener')
  assertEqual(activeCount(vvRec, 'resize'), 1, 'M9: reopen registers exactly one visualViewport listener')
  assertEqual(activeCount(docRec, 'mousedown'), 1, 'M9: reopen registers exactly one mousedown listener')
  assertEqual(activeCount(docRec, 'keydown'), 1, 'M9: reopen registers exactly one keydown listener')
  assertEqual(
    winRec.adds.filter((c) => c.type === 'resize').length,
    addsBeforeReopen + 1,
    'M9: exactly one window resize add per open cycle (no re-registration leak)',
  )
  fire(winRec, 'resize')
  assert(second.removed, 'M9: the second menu still dismisses on resize')
  assertEqual(activeCount(winRec, 'resize'), 0, 'M9: the second menu teardown clears its listeners')
}

// ── (4) Tab dismisses WITHOUT preventDefault (L5; APG menu pattern) ─────────
// The document keydown handler must treat Tab as a dismissal: the menu closes
// and the browser's default Tab then moves focus out naturally. No
// preventDefault — focus must not stay trapped in the menu, or a later Enter
// can activate the background element under the overlay.
{
  const { menu } = openFreshMenu()
  assertEqual(activeCount(docRec, 'keydown'), 1, 'L5: open registers the keydown handler')
  // The close is animated by default; the harness's fake WAAPI never settles
  // its onfinish, so drop animate() to take hideStartMenu's instant path and
  // observe the removal synchronously.
  ;(menu as unknown as { animate?: unknown }).animate = undefined
  let prevented = false
  lastAdd(docRec, 'keydown')!({ key: 'Tab', preventDefault: () => { prevented = true } })
  assert(!prevented, 'L5: Tab must NOT preventDefault (browser moves focus on)')
  assert(menu.removed, 'L5: Tab hides the menu')
  assert(!fakeBody.children.includes(menu), 'L5: the Tab-dismissed menu left the DOM')
  assertEqual(activeCount(docRec, 'keydown'), 0, 'L5: Tab dismissal tears down the keydown handler')
  assertEqual(activeCount(docRec, 'mousedown'), 0, 'L5: outside-click dismissal removed by the same teardown')
}

// ── (5) Control: ArrowDown navigates; Escape closes + preventDefaults ───────
{
  const { menu } = openFreshMenu()
  const list = menu.children[2] as FakeEl
  const items = list.children.filter((c) => c.tagName === 'BUTTON')
  assertEqual(items.length, 4, 'L5 control: one menuitem per derived entry')
  menu.querySelectorAll = () => items
  ;(fakeDoc as any).activeElement = items[0]
  let focused: unknown = null
  items[1]!.focus = () => { focused = items[1]; (fakeDoc as any).activeElement = items[1] }
  let prevented = false
  lastAdd(docRec, 'keydown')!({ key: 'ArrowDown', preventDefault: () => { prevented = true } })
  assert(prevented, 'L5 control: ArrowDown still preventDefaults')
  assertEqual(focused, items[1], 'L5 control: ArrowDown still moves focus to the next item')

  ;(menu as unknown as { animate?: unknown }).animate = undefined
  let escPrevented = false
  lastAdd(docRec, 'keydown')!({ key: 'Escape', preventDefault: () => { escPrevented = true } })
  assert(escPrevented, 'L5 control: Escape still preventDefaults')
  assert(menu.removed, 'L5 control: Escape still closes the menu')
  assertEqual(activeCount(docRec, 'keydown'), 0, 'L5 control: Escape teardown intact')
}

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
