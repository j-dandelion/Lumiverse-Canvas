// Custom assertion harness — see Chronicle testing-conventions.md
//
// The secondary drawer's Start lives in a `.sidebar-ux-tab-list-bottom` dock
// (same chrome as the main drawer's Settings dock). The dock must stay the
// LAST child of the tab list: tab writers route end-of-order inserts through
// appendSecondaryTabNode, which inserts BEFORE the dock instead of past the
// divider. Regressed here: the 2026-09-15 live round showed a plain
// appendChild would render new tabs BELOW the Start divider.
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) { passed++ }
  else { failed++; console.error(`FAIL: ${msg} — expected ${String(expected)}, got ${String(actual)}`) }
}

import {
  appendSecondaryTabNode,
  getSecondaryStartDock,
  SECONDARY_START_DOCK_CLASS,
} from '../secondary-start-dock'

type FakeNode = { name: string; className: string }

type FakeList = {
  children: FakeNode[]
  querySelector(sel: string): FakeNode | null
  insertBefore(node: FakeNode, ref: FakeNode): void
  appendChild(node: FakeNode): void
}

function makeList(...children: FakeNode[]): FakeList {
  const list: FakeList = {
    children: [...children],
    querySelector(sel: string) {
      if (sel === `:scope > .${SECONDARY_START_DOCK_CLASS}`) {
        return list.children.find((c) => c.className.split(' ').includes(SECONDARY_START_DOCK_CLASS)) ?? null
      }
      return null
    },
    insertBefore(node: FakeNode, ref: FakeNode) {
      list.children = list.children.filter((c) => c !== node)
      const idx = list.children.indexOf(ref)
      list.children.splice(idx === -1 ? list.children.length : idx, 0, node)
    },
    appendChild(node: FakeNode) {
      list.children = list.children.filter((c) => c !== node)
      list.children.push(node)
    },
  }
  return list
}

const dock: FakeNode = { name: 'start-dock', className: `sidebar-ux-tab-list-bottom ${SECONDARY_START_DOCK_CLASS}` }
const tabA: FakeNode = { name: 'a', className: '' }
const tabB: FakeNode = { name: 'b', className: '' }

// 1. No dock → plain append (main-mirror sections / legacy lists).
{
  const list = makeList(tabA)
  const tabC: FakeNode = { name: 'c', className: '' }
  appendSecondaryTabNode(list as unknown as HTMLElement, tabC as unknown as HTMLElement)
  assertEqual(list.children.map((c) => c.name).join(','), 'a,c',
    'no dock: appended at the end')
}

// 2. Dock present → the new tab lands BEFORE it; the dock stays last.
{
  const list = makeList(tabA, tabB, dock)
  const tabC: FakeNode = { name: 'c', className: '' }
  appendSecondaryTabNode(list as unknown as HTMLElement, tabC as unknown as HTMLElement)
  assertEqual(list.children.map((c) => c.name).join(','), 'a,b,c,start-dock',
    'dock stays last: tab inserted before the divider')
}

// 3. A node that drifted after the dock is moved back before it.
{
  const list = makeList(tabA, dock, tabB)
  appendSecondaryTabNode(list as unknown as HTMLElement, tabB as unknown as HTMLElement)
  assertEqual(list.children.map((c) => c.name).join(','), 'a,b,start-dock',
    'drifted node moved before the dock')
}

// 4. Dock resolution is direct-child only (no nested false positive).
{
  const list = makeList(tabA)
  assertEqual(getSecondaryStartDock(list as unknown as HTMLElement), null,
    'no dock child → null')
  const withDock = makeList(tabA, dock)
  assertEqual(
    getSecondaryStartDock(withDock as unknown as HTMLElement),
    dock as unknown as HTMLElement,
    'dock child resolved',
  )
}

if (failed > 0) { console.error(`FAILED: ${failed}`); process.exitCode = 1 }
console.log(`PASS: ${passed}`)
