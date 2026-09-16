// Custom assertion harness — see Chronicle testing-conventions.md
// Window-state action tests (os/actions.ts): every action must route
// through dispatch intents (pitfalls §2) and be a no-op when OS mode is
// off. Dispatch is mocked with recording fakes.
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    console.error(`FAIL: ${message} — expected ${expected}, got ${actual}`)
    failed++
  }
}

import { mock } from 'bun:test'

const fake: {
  osMode: boolean
  coreTabsHidden: boolean
  model: any
  findKey: (id: string) => string | null
  resolveMap: Record<string, string>
  dispatches: any[]
  moveCalls: Array<{ liveId: string; activateDest: boolean }>
  drawerCommands: Array<{ side: string; open: boolean }>
  activations: Array<{ side: string; id: string }>
} = {
  osMode: true,
  coreTabsHidden: false,
  model: null,
  findKey: () => null,
  resolveMap: {},
  dispatches: [],
  moveCalls: [],
  drawerCommands: [],
  activations: [],
}

// The drawer command seam is a real leaf (not mocked): install a recording
// handler so the shell-command sides of close/minimize/open are assertable.
import { setDrawerCommandHandler } from '../drawer-command'
setDrawerCommandHandler((side, open) => {
  fake.drawerCommands.push({ side, open })
  return true
})

mock.module('../../recon/dispatch', () => ({
  dispatch: (intent: any) => { fake.dispatches.push(intent); return Promise.resolve() },
  dispatchBatch: (intents: any[]) => { fake.dispatches.push(...intents); return Promise.resolve() },
  dispatchMoveByLiveId: (liveId: string, activateDest: boolean) => {
    fake.moveCalls.push({ liveId, activateDest })
    return Promise.resolve()
  },
  getHost: () => ({
    findKey: (id: string) => fake.findKey(id),
    resolve: (key: string) => fake.resolveMap[key] ?? null,
    activate: (side: string, id: string) => {
      fake.activations.push({ side, id })
      return Promise.resolve('ok')
    },
  }),
  getModel: () => fake.model,
}))
mock.module('../../settings/state', () => ({
  isOsModeEnabled: () => fake.osMode,
  getSettings: () => ({ coreTabsHidden: fake.coreTabsHidden }),
  // panel-motion (imported by actions) reads the drawer location; this suite
  // is about the action layer, so the motion router stays inert.
  isHorizontalStrip: () => false,
  getStripEdge: () => null,
}))

// Module under test — imports AFTER mocks (repo convention).
const {
  closeWindowByLiveId,
  minimizeWindowByLiveId,
  openWindowInDrawerByLiveId,
  toggleWindowByLiveId,
  getDisplayedLiveId,
} = await import('../actions')

function fresh(model: any) {
  fake.dispatches.length = 0
  fake.moveCalls.length = 0
  fake.drawerCommands.length = 0
  fake.activations.length = 0
  fake.osMode = true
  fake.coreTabsHidden = false
  fake.model = model
  fake.resolveMap = {}
}

const KEY = 'builtin:weaver'
const baseModel = () => ({
  primary: [KEY, 'builtin:other'],
  secondary: ['builtin:sec'],
  closed: [],
  hidden: [],
  active: { primary: KEY, secondary: 'builtin:sec' },
  drawers: {
    primary: { open: true, width: 420 },
    secondary: { open: false, width: 420 },
  },
})

// ── closeWindowByLiveId ──
{
  fresh(baseModel())
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await closeWindowByLiveId('weaver:2')
  assertEqual(fake.dispatches.length, 2, 'close of the DISPLAYED window → setClosed + drawer collapse (D17+D7)')
  assertEqual(fake.dispatches[0]?.t, 'setClosed', 'close → setClosed intent')
  assertEqual(fake.dispatches[0]?.closed, true, 'close → closed:true')
  assertEqual(fake.dispatches[0]?.key, KEY, 'close resolves the live id to its key')
  assertEqual(fake.dispatches[1]?.t, 'setDrawer', 'close of displayed → drawer collapses (D7)')
  assertEqual(fake.dispatches[1]?.open, false, 'collapse → open:false')
  assertEqual(fake.drawerCommands.length, 1, 'close of displayed commands the shell chrome')
  assertEqual(fake.drawerCommands[0]?.side, 'primary', 'shell command targets the closed side')
  assertEqual(fake.drawerCommands[0]?.open, false, 'shell command collapses the drawer')
}
{
  // Closing a MINIMIZED window: membership only — no drawer collapse.
  fresh(baseModel())
  fake.model = { ...baseModel(), active: { primary: 'builtin:other', secondary: null } }
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await closeWindowByLiveId('weaver:2')
  assertEqual(fake.dispatches.length, 1, 'close of a minimized window → single setClosed')
  assertEqual(fake.dispatches[0]?.t, 'setClosed', 'minimized close → setClosed only')
  assertEqual(fake.dispatches[0]?.key, KEY, 'minimized close resolves the key')
  assertEqual(fake.drawerCommands.length, 0, 'minimized close leaves the drawer chrome alone (D16)')
}
{
  // Closing a window that lives in the secondary drawer collapses the
  // SECONDARY drawer when it is displayed there.
  fresh(baseModel())
  fake.model = { ...baseModel(), secondary: [KEY], primary: ['builtin:other'], active: { primary: 'builtin:other', secondary: KEY } }
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await closeWindowByLiveId('weaver:2')
  assertEqual(fake.dispatches[0]?.t, 'setClosed', 'secondary-resident close: setClosed')
  assertEqual(fake.dispatches[1]?.side, 'secondary', 'secondary-resident close collapses the SECONDARY drawer')
  assertEqual(fake.drawerCommands[0]?.side, 'secondary', 'shell command is offered the secondary side (real handler declines it)')
}
{
  fresh(baseModel())
  fake.findKey = () => null
  await closeWindowByLiveId('ghost:1')
  assertEqual(fake.dispatches.length, 0, 'close with unresolved key → no dispatch')
}
{
  fresh(baseModel())
  fake.osMode = false
  await closeWindowByLiveId('weaver:2')
  assertEqual(fake.dispatches.length, 0, 'close with OS off → no dispatch (chrome absent)')
}
{
  // Core tab + coreTabsHidden: the close also marks it hidden (Configure
  // reflection), APPENDED after setClosed so D17's active clear is not
  // replaced by a neighbor via applySetHidden.
  const PROFILE = 'builtin:profile'
  fresh({ ...baseModel(), primary: [PROFILE, 'builtin:other'], active: { primary: PROFILE, secondary: null } })
  fake.coreTabsHidden = true
  fake.findKey = (id: string) => (id === 'profile' ? PROFILE : null)
  await closeWindowByLiveId('profile')
  assertEqual(fake.dispatches.length, 3, 'core close → setClosed + setDrawer + setHidden')
  assertEqual(fake.dispatches[0]?.t, 'setClosed', 'core close → setClosed first')
  assertEqual(fake.dispatches[1]?.t, 'setDrawer', 'core close → drawer collapse second')
  assertEqual(fake.dispatches[2]?.t, 'setHidden', 'core close → setHidden appended last')
  assertEqual(fake.dispatches[2]?.hidden, true, 'core close → hidden:true')
}
{
  // Core tab + setting OFF: no hidden reflection (close-only semantics).
  const PROFILE = 'builtin:profile'
  fresh({ ...baseModel(), primary: [PROFILE, 'builtin:other'], active: { primary: PROFILE, secondary: null } })
  fake.coreTabsHidden = false
  fake.findKey = (id: string) => (id === 'profile' ? PROFILE : null)
  await closeWindowByLiveId('profile')
  assertEqual(fake.dispatches.length, 2, 'core close with coreTabsHidden off → no setHidden')
  assert(!fake.dispatches.some((d) => d.t === 'setHidden'), 'no setHidden when the setting is off')
}
{
  // Non-core tab + coreTabsHidden ON: still close-only.
  fresh(baseModel())
  fake.coreTabsHidden = true
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await closeWindowByLiveId('weaver:2')
  assert(!fake.dispatches.some((d) => d.t === 'setHidden'), 'non-core close never adds setHidden')
}
{
  // Core MINIMIZED close (not the displayed window): membership + hidden.
  const PROFILE = 'builtin:profile'
  fresh({ ...baseModel(), primary: [PROFILE, 'builtin:other'], active: { primary: 'builtin:other', secondary: null } })
  fake.coreTabsHidden = true
  fake.findKey = (id: string) => (id === 'profile' ? PROFILE : null)
  await closeWindowByLiveId('profile')
  assertEqual(fake.dispatches.length, 2, 'minimized core close → setClosed + setHidden')
  assertEqual(fake.dispatches[0]?.t, 'setClosed', 'minimized core close → setClosed first')
  assertEqual(fake.dispatches[1]?.t, 'setHidden', 'minimized core close → setHidden last')
}

// ── minimizeWindowByLiveId ──
{
  fresh(baseModel())
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await minimizeWindowByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches.length, 2, 'minimize of the active window → deactivate + collapse (D4+D7)')
  assertEqual(fake.dispatches[0]?.t, 'deactivate', 'minimize → deactivate intent')
  assertEqual(fake.dispatches[0]?.side, 'primary', 'deactivate targets the drawer side')
  assertEqual(fake.dispatches[1]?.t, 'setDrawer', 'minimize collapses the drawer (D7)')
  assertEqual(fake.dispatches[1]?.open, false, 'collapse → open:false')
  assertEqual(fake.drawerCommands.length, 1, 'minimize commands the shell chrome')
  assertEqual(fake.drawerCommands[0]?.open, false, 'shell command collapses on minimize')
}
{
  fresh(baseModel())
  fake.model = { ...baseModel(), active: { primary: 'builtin:other', secondary: null } }
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await minimizeWindowByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches.length, 0, 'minimize of a non-active window is a no-op')
}
{
  fresh(baseModel())
  fake.osMode = false
  await minimizeWindowByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches.length, 0, 'minimize with OS off → no dispatch')
}

// ── openWindowInDrawerByLiveId ──
{
  // Same drawer, closed window → un-close + activate batch.
  fresh({ ...baseModel(), closed: [KEY] })
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'primary')
  assertEqual(fake.moveCalls.length, 0, 'same-drawer open → no move')
  assertEqual(fake.dispatches.length, 2, 'same-drawer open → setClosed + activate')
  assertEqual(fake.dispatches[0]?.t, 'setClosed', 'open: first un-close')
  assertEqual(fake.dispatches[0]?.closed, false, 'open: closed:false')
  assertEqual(fake.dispatches[1]?.t, 'activate', 'open: then activate')
  assertEqual(fake.drawerCommands.length, 0, 'open with the drawer already open → no shell command')
  assertEqual(fake.activations.length, 1, 'primary activation clicks the host content (diffActive is model-derived)')
  assertEqual(fake.activations[0]?.side, 'primary', 'content activation targets the primary side')
  assertEqual(fake.activations[0]?.id, 'weaver:2', 'content activation uses the resolved live id')
}
{
  // D19: closed target drawer auto-opens first.
  fresh(baseModel())
  fake.model = {
    ...baseModel(),
    closed: [KEY],
    drawers: { primary: { open: false, width: 420 }, secondary: { open: false, width: 420 } },
  }
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches[0]?.t, 'setDrawer', 'D19: closed drawer auto-opens first')
  assertEqual(fake.dispatches[0]?.open, true, 'D19: setDrawer open:true')
  assertEqual(fake.dispatches[1]?.t, 'setClosed', 'open after the drawer opens')
  assertEqual(fake.dispatches[2]?.t, 'activate', 'activate last')
  assertEqual(fake.drawerCommands.length, 1, 'D19 commands the shell (primary is shell-owned)')
  assertEqual(fake.drawerCommands[0]?.open, true, 'D19 shell command opens the drawer')
  assertEqual(fake.activations.length, 1, 'D19 open clicks the host content')
  assertEqual(fake.activations[0]?.id, 'weaver:2', 'D19 content activation uses the launched live id')
}
{
  // D13: cross-drawer, active in source → move (no focus during move) + open.
  fresh(baseModel())
  fake.model = {
    ...baseModel(),
    secondary: ['builtin:loom'],
    drawers: { primary: { open: true, width: 420 }, secondary: { open: true, width: 420 } },
  }
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'secondary')
  assertEqual(fake.moveCalls.length, 1, 'D13: cross-drawer move dispatched')
  assertEqual(fake.moveCalls[0]?.activateDest, false, 'D13: move carries no focus (batch owns it)')
  assertEqual(fake.dispatches.length, 2, 'D13: open batch after the move')
  assertEqual(fake.dispatches[0]?.t, 'setClosed', 'un-close first')
  assertEqual(fake.dispatches[1]?.t, 'activate', 'activate in the target drawer')
  assertEqual(fake.activations.length, 1, 'secondary activation clicks its content (tracked active is stale-equal)')
  assertEqual(fake.activations[0]?.side, 'secondary', 'secondary content activation targets the secondary side')
}
{
  // D13 state preservation: minimized in source arrives minimized — move
  // only, no un-close/activate batch.
  fresh(baseModel())
  fake.model = {
    ...baseModel(),
    primary: ['builtin:other'],
    secondary: ['builtin:loom'],
    active: { primary: 'builtin:other', secondary: 'builtin:loom' },
  }
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'secondary')
  assertEqual(fake.moveCalls.length, 1, 'D13: minimized cross-drawer move dispatched')
  assertEqual(fake.moveCalls[0]?.activateDest, false, 'D13: minimized move keeps no focus')
  assertEqual(fake.dispatches.length, 1, 'D13 minimized: only the D19 drawer-open, no open batch')
  assertEqual(fake.dispatches[0]?.t, 'setDrawer', 'D13 minimized: the only dispatch is the drawer-open')
  assertEqual(fake.activations.length, 0, 'D13 minimized arrival does not activate content')
}
{
  // D13 + closed: a closed tab in the other drawer moves and launches fresh.
  fresh(baseModel())
  fake.model = {
    ...baseModel(),
    primary: ['builtin:other'],
    secondary: [],
    active: { primary: 'builtin:other', secondary: null },
    closed: [KEY],
  }
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'secondary')
  assertEqual(fake.moveCalls.length, 1, 'closed cross-drawer: move dispatched')
  assertEqual(fake.dispatches.length, 3, 'closed cross-drawer: D19 open + un-close + activate')
  assertEqual(fake.dispatches[0]?.t, 'setDrawer', 'D19 fires before the open batch')
  assertEqual(fake.dispatches[1]?.t, 'setClosed', 'launch fresh: un-close')
  assertEqual(fake.dispatches[2]?.t, 'activate', 'launch fresh: displayed')
  assertEqual(fake.activations.length, 1, 'secondary launch clicks its content too')
  assertEqual(fake.activations[0]?.side, 'secondary', 'secondary launch activation targets the secondary side')
}
{
  // OS off → nothing.
  fresh(baseModel())
  fake.osMode = false
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches.length, 0, 'open with OS off → no dispatch')
  assertEqual(fake.moveCalls.length, 0, 'open with OS off → no move')
  assertEqual(fake.activations.length, 0, 'open with OS off → no content activation')
}

// ── toggleWindowByLiveId (D4 strip click: model-derived toggle) ──
{
  // Drawer open + this tab displayed → minimize.
  fresh(baseModel())
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await toggleWindowByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches[0]?.t, 'deactivate', 'displayed toggle → minimize (deactivate first)')
}
{
  // Minimized (model active null) → open/restore.
  fresh({
    ...baseModel(),
    active: { primary: null, secondary: 'builtin:sec' },
  })
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await toggleWindowByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches[0]?.t, 'setClosed', 'minimized toggle → open (un-close first)')
  assertEqual(fake.dispatches[1]?.t, 'activate', 'minimized toggle → activate')
  assertEqual(fake.activations.length, 1, 'minimized toggle clicks the content')
}
{
  // Drawer manually closed via the edge toggle (D16) while the model still
  // has the tab displayed → toggle must OPEN, not minimize.
  fresh({
    ...baseModel(),
    drawers: {
      primary: { open: false, width: 420 },
      secondary: { open: false, width: 420 },
    },
  })
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await toggleWindowByLiveId('weaver:2', 'primary')
  assertEqual(
    fake.dispatches.some((d: any) => d.t === 'deactivate'),
    false,
    'closed-drawer toggle does not minimize (model.open false)',
  )
  assertEqual(fake.dispatches[0]?.t, 'setDrawer', 'closed-drawer toggle auto-opens (D19)')
}
{
  // Secondary stale-tracked case: the tracked active survives an OS minimize
  // as reopen memory, so the model predicate must drive the toggle.
  fresh({
    ...baseModel(),
    primary: ['builtin:other'],
    secondary: [KEY],
    active: { primary: 'builtin:other', secondary: null },
  })
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await toggleWindowByLiveId('weaver:2', 'secondary')
  assertEqual(
    fake.dispatches.some((d: any) => d.t === 'activate' && d.side === 'secondary'),
    true,
    'stale-tracked toggle reopens (model predicate, not tracked)',
  )
  assertEqual(fake.activations[0]?.side, 'secondary', 'stale-tracked reopen clicks secondary content')
}
{
  fresh(baseModel())
  fake.osMode = false
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await toggleWindowByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches.length, 0, 'toggle with OS off → no dispatch')
}

// ── openWindowInDrawerByLiveId: hidden targets are un-hidden FIRST ──
// The Start menu lists hidden tabs; activation is hidden-gated in the
// reducer, so the un-hide must precede setClosed/activate or the open chain
// would click host content through with no active model window.
{
  fresh({ ...baseModel(), hidden: [KEY] })
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches[0]?.t, 'setHidden', 'hidden target → un-hide dispatched first')
  assertEqual(fake.dispatches[0]?.hidden, false, 'un-hide → hidden:false')
  assertEqual(fake.dispatches[0]?.key, KEY, 'un-hide targets the resolved key')
  assert(
    fake.dispatches.findIndex((d: any) => d.t === 'activate') > 0,
    'activate follows the un-hide',
  )
}
{
  // Hidden + closed + closed drawer: un-hide → D19 open → un-close/activate.
  fresh({
    ...baseModel(),
    hidden: [KEY],
    closed: [KEY],
    drawers: { primary: { open: false, width: 420 }, secondary: { open: false, width: 420 } },
  })
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'primary')
  const order = fake.dispatches.map((d: any) => d.t)
  assertEqual(order[0], 'setHidden', 'hidden+closed → un-hide first')
  assertEqual(order[1], 'setDrawer', 'then auto-open the closed drawer (D19)')
  assertEqual(order[2], 'setClosed', 'then un-close')
  assertEqual(order[3], 'activate', 'then activate')
}
{
  // Foreign-drawer hidden tab: routing to its OWN side un-hides in place —
  // no cross-drawer move (the Start menu is drawer-agnostic).
  fresh({
    ...baseModel(),
    primary: ['builtin:other'],
    secondary: [KEY],
    hidden: [KEY],
  })
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'secondary')
  assertEqual(fake.moveCalls.length, 0, 'own-drawer routing never moves')
  assertEqual(fake.dispatches[0]?.t, 'setHidden', 'un-hide still first')
}

// ── getDisplayedLiveId (D17 presence + D2/D9 close policy source) ──
{
  fresh(baseModel())
  fake.resolveMap = { [KEY]: 'weaver:2', 'builtin:sec': 'sec:1' }
  assertEqual(getDisplayedLiveId('primary'), 'weaver:2', 'displayed primary resolves the active key to its live id')
  assertEqual(getDisplayedLiveId('secondary'), 'sec:1', 'displayed secondary resolves independently')
}
{
  // OS minimize/close nulls the model active (D17): nothing displayed.
  fresh({ ...baseModel(), active: { primary: null, secondary: null } })
  fake.resolveMap = { [KEY]: 'weaver:2' }
  assertEqual(getDisplayedLiveId('primary'), null, 'null active → nothing displayed')
}
{
  // Unresolvable key (host identity not ready) → nothing displayed.
  fresh(baseModel())
  fake.resolveMap = {}
  assertEqual(getDisplayedLiveId('primary'), null, 'unresolved active key → null')
}

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
