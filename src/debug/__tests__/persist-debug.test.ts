// Custom assertion harness — see Chronicle testing-conventions.md
let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) { passed++ } else { failed++; console.error('FAIL:', msg) }
}

import {
  summarizeLayout,
  isPersistDebugEnabled,
  refreshPersistDebugFlag,
} from '../persist-debug'
import { DEFAULT_CANVAS_SETTINGS, mergeCanvasSettings } from '../../types'

// --- summarizeLayout ---
const sumNull = summarizeLayout(null)
assert(sumNull.includes('layout=null'), 'summarize null')

const sum = summarizeLayout({
  version: '1.8.0.9',
  primary: { open: true, width: 400 },
  secondary: { open: false, width: 300 },
  detachedTabs: [{ tabId: 'a' }, { tabId: 'b' }],
  hiddenTabIds: ['x'],
  settings: { ...DEFAULT_CANVAS_SETTINGS, debugMode: true },
})
assert(sum.includes('v=1.8.0.9'), 'summarize version')
assert(sum.includes('tabs=2'), 'summarize tabs')
assert(sum.includes('hidden=1'), 'summarize hidden')
assert(sum.includes('allDef=false'), 'summarize non-default settings')
assert(sum.includes('nonDef='), 'summarize nonDef count')

// --- flag off by default in tests (no localStorage key) ---
refreshPersistDebugFlag()
// isPersistDebugEnabled may be true if sidebarUxDebug is set in env; just ensure callable
assert(typeof isPersistDebugEnabled() === 'boolean', 'isPersistDebugEnabled returns boolean')

console.log(`persist-debug tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
