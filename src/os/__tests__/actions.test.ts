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
  model: any
  findKey: (id: string) => string | null
  dispatches: any[]
  moveCalls: Array<{ liveId: string; activateDest: boolean }>
} = {
  osMode: true,
  model: null,
  findKey: () => null,
  dispatches: [],
  moveCalls: [],
}

mock.module('../../recon/dispatch', () => ({
  dispatch: (intent: any) => { fake.dispatches.push(intent); return Promise.resolve() },
  dispatchBatch: (intents: any[]) => { fake.dispatches.push(...intents); return Promise.resolve() },
  dispatchMoveByLiveId: (liveId: string, activateDest: boolean) => {
    fake.moveCalls.push({ liveId, activateDest })
    return Promise.resolve()
  },
  getHost: () => ({ findKey: (id: string) => fake.findKey(id) }),
  getModel: () => fake.model,
}))
mock.module('../../settings/state', () => ({
  isOsModeEnabled: () => fake.osMode,
}))

// Module under test — imports AFTER mocks (repo convention).
const { closeWindowByLiveId, minimizeWindowByLiveId, openWindowInDrawerByLiveId } = await import('../actions')

function fresh(model: any) {
  fake.dispatches.length = 0
  fake.moveCalls.length = 0
  fake.osMode = true
  fake.model = model
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
}
{
  // OS off → nothing.
  fresh(baseModel())
  fake.osMode = false
  fake.findKey = (id: string) => (id === 'weaver:2' ? KEY : null)
  await openWindowInDrawerByLiveId('weaver:2', 'primary')
  assertEqual(fake.dispatches.length, 0, 'open with OS off → no dispatch')
  assertEqual(fake.moveCalls.length, 0, 'open with OS off → no move')
}

console.log('---')
if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
