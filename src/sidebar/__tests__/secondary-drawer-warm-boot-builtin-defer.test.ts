// src/sidebar/__tests__/secondary-drawer-warm-boot-builtin-defer.test.ts
//
// Behavioral test for Option A (plan 2026-07-01_175400 §5.5): the
// LAZY_MOUNT_OK branch in secondary-drawer.ts must:
//   1. Call ensureBuiltInTabActiveInMain(tabId).
//   2. Await at least one requestAnimationFrame before
//      getBuiltInTabRoot(tabId), so the detached React root has time
//      to commit and WorldBookPanel's first useEffect runs with
//      isVisible=true (loadBooks fires).
//   3. Await at least one more requestAnimationFrame before
//      requestTabLocation(tabId, ...), so moveTabTo's
//      pendingActiveTabReset → ViewportDrawer's reset effect doesn't
//      preempt loadBooks.
//
// We extract the LAZY_MOUNT_OK branch body from the live source via
// brace-walking and compile it into a Function with the four external
// dependencies injected. The compiled function's behavior (with stub
// rAFs advancing 16ms each) gives us the timing relationship — a
// regression where one rAF is silently removed would fail this test,
// where it passes the existing textual scan (which only checks
// substrings).

let passed = 0, failed = 0
const ok = (c: unknown, m: string) =>
  c ? passed++ : (failed++, console.error('FAIL:', m))

import { readFileSync } from 'fs'
import { join } from 'path'

async function main(): Promise<void> {
  const secDrawerSrc = readFileSync(
    join(process.cwd(), 'src/sidebar/secondary-drawer.ts'),
    'utf8',
  )

  // --- Step 1: locate the LAZY_MOUNT_OK branch -----------------------
  const lazyIdx = secDrawerSrc.indexOf('branch=LAZY_MOUNT_OK')
  ok(lazyIdx !== -1, 'T-WARM-DEFER-1: LAZY_MOUNT_OK breadcrumb present in source')

  if (lazyIdx === -1) return

  const branchStart = secDrawerSrc.lastIndexOf(
    'if (_secondaryContent && !_root', lazyIdx,
  )
  const branchEnd = secDrawerSrc.indexOf('} else {', lazyIdx)
  ok(
    branchStart !== -1 && branchEnd !== -1 && branchStart < branchEnd,
    'T-WARM-DEFER-2: LAZY_MOUNT_OK branch has a defined body',
  )

  if (branchStart === -1 || branchEnd === -1) return

  // Walk braces from the outer if's `{` to its matching `}`.
  let bodyStart = secDrawerSrc.indexOf('{', branchStart) + 1
  let depth = 1
  let i = bodyStart
  while (i < secDrawerSrc.length && depth > 0) {
    const ch = secDrawerSrc[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    i++
  }
  const bodyEnd = i - 1
  const body = secDrawerSrc.slice(bodyStart, bodyEnd)

  // --- Step 2: rewrite for the test harness -------------------------
  // Inject `_requestTabLocation` / `_getBuiltInTabRoot` (so the test
  // can spy on them), rename `resolvedId` to a parameter name, strip
  // TS-only syntax, and redirect global rAF to an injected stub.
  // Inject `_rAF(cb)` (the same signature as the global
  // `requestAnimationFrame`) so the test can spy on rAF calls. The
  // body uses `await new Promise<void>((r) =>
  // requestAnimationFrame(() => r()))`; we keep the callback shape.
  // Strip TS-only syntax so the body is plain JS (Function() can't
  // parse type annotations). Conservative — only patterns present
  // in this branch.
  const jsBody = body
    .replace(/wSpindleUi\.requestTabLocation\(/g, '_requestTabLocation(')
    .replace(/wSpindleUi\.getBuiltInTabRoot\(/g, '_getBuiltInTabRoot(')
    .replace(/resolvedId/g, '_resolvedId')
    .replace(/as HTMLElement \| undefined/g, '')
    .replace(/as HTMLElement \| null/g, '')
    .replace(/as HTMLElement/g, '')
    .replace(/: HTMLElement \| undefined/g, '')
    .replace(/: HTMLElement/g, '')
    .replace(/: void/g, '')
    .replace(/<void>/g, '')
    .replace(/<HTMLElement[^>]*>/g, '')
    .replace(/:\s*Promise<void>/g, '')
    .replace(/requestAnimationFrame\((\(\)\s*=>\s*r\(\))\)/g, '_rAF($1)')

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    '_resolvedId',
    'tabId',
    'ensureBuiltInTabActiveInMain',
    '_requestTabLocation',
    '_getBuiltInTabRoot',
    'dlog',
    'dwarn',
    '_rAF',
    'return (async () => { try { ' + jsBody + ' } catch(__e) { throw __e } })();',
  )

  // --- Step 3: drive with 16ms rAFs and capture timestamps ----------
  const calls: Array<{ name: string; t: number }> = []
  let virtualT = 0
  const realNow = performance.now.bind(performance)
  performance.now = () => virtualT

  const fakeElement = { tagName: 'DIV', getAttribute: () => 'lorebook' }
  const startT = virtualT

  // Production's ensureBuiltInTabActiveInMain awaits one rAF
  // internally (a real ~16ms), but to us it's an opaque box. We
  // resolve on next microtask.
  const stubEnsure = async () => {
    calls.push({ name: 'ensureBuiltInTabActiveInMain', t: virtualT })
    await Promise.resolve()
  }
  const stubGetRoot = () => {
    calls.push({ name: 'getBuiltInTabRoot', t: virtualT })
    return fakeElement
  }
  const stubRequest = (..._args: unknown[]) => {
    calls.push({ name: 'requestTabLocation', t: virtualT })
  }
  // Inject the rAF used by the production body (post-rewrite). 16ms
  // virtual time per rAF — matches production cadence. Resolves on
  // next microtask so `await _rAF(cb)` continues. We pass the cb
  // through to match the global `requestAnimationFrame(cb)` shape.
  const stubRAF = (cb: (t: number) => void): void => {
    virtualT += 16
    Promise.resolve().then(() => cb(virtualT))
  }

  // Drive the factory. We poll on each microtask to let async
  // continuations complete even when `bun run <file>` would
  // otherwise exit before they resolve.
  let factoryResult: unknown
  const factoryPromise = factory(
    'lorebook',
    'lorebook',
    stubEnsure,
    stubRequest,
    stubGetRoot,
    () => {},
    () => {},
    stubRAF,
  )
  factoryPromise.then((r: unknown) => { factoryResult = r }).catch((e: unknown) => { throw e })
  for (let n = 0; n < 1000; n++) {
    if (factoryResult !== undefined) break
    await new Promise<void>((r) => Promise.resolve().then(() => r()))
  }

  // --- Step 4: assertions -------------------------------------------
  const ensureCall = calls.find(c => c.name === 'ensureBuiltInTabActiveInMain')
  const getRootCall = calls.find(c => c.name === 'getBuiltInTabRoot')
  const requestCall = calls.find(c => c.name === 'requestTabLocation')

  ok(
    ensureCall !== undefined,
    'T-WARM-DEFER-3: ensureBuiltInTabActiveInMain was called',
  )
  ok(
    getRootCall !== undefined,
    'T-WARM-DEFER-3: getBuiltInTabRoot was called',
  )
  ok(
    requestCall !== undefined,
    'T-WARM-DEFER-3: requestTabLocation was called',
  )

  if (ensureCall && getRootCall && requestCall) {
    // Each rAF = 16ms virtual. With two rAFs in the production body
    // (one before getBuiltInTabRoot, one before requestTabLocation),
    // requestTabLocation fires at >= 32ms after start.
    const elapsed = requestCall.t - startT
    ok(
      elapsed >= 32,
      `T-WARM-DEFER-4: requestTabLocation fires >=32ms after helper start (got ${elapsed}ms — must be >= 32ms = 2 rAFs)`,
    )
    // Ordering: ensure < getRoot < request.
    ok(
      ensureCall.t <= getRootCall.t,
      'T-WARM-DEFER-5: ensureBuiltInTabActiveInMain fires before getBuiltInTabRoot',
    )
    ok(
      getRootCall.t <= requestCall.t,
      'T-WARM-DEFER-5: getBuiltInTabRoot fires before requestTabLocation',
    )
    // ensure → getRoot gap must be >= 16ms (one rAF between them).
    ok(
      getRootCall.t - ensureCall.t >= 16,
      `T-WARM-DEFER-6: at least one rAF between ensure and getRoot (got ${getRootCall.t - ensureCall.t}ms)`,
    )
    // getRoot → request gap must be >= 16ms (one rAF between them).
    ok(
      requestCall.t - getRootCall.t >= 16,
      `T-WARM-DEFER-6: at least one rAF between getRoot and request (got ${requestCall.t - getRootCall.t}ms)`,
    )
  }
}

main()
  .then(() => {
    console.log(`secondary-drawer-warm-boot-builtin-defer: ${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
  })
  .catch((err) => {
    console.error('FAIL: T-WARM-DEFER-EXC — LAZY_MOUNT_OK execution threw:', err)
    process.exit(1)
  })
