import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const dragSource = readFileSync(join(root, 'src/tabs/organization-drag.ts'), 'utf8')
const folderStyles = readFileSync(join(root, 'src/tabs/folder-ui.ts'), 'utf8')

assert.doesNotMatch(dragSource, /indicateTarget|dropIndicator|canvas-folder-drop|canvas-organization-insert-(?:before|after)/, 'live organization dragging has no target indicator')
assert.doesNotMatch(folderStyles, /canvas-(?:organization-drop-indicator|folder-drop|organization-insert-(?:before|after))/, 'organization styles define no drop indicators')
assert.match(dragSource, /function calculateTarget\(/, 'drop target calculation remains active')
assert.match(dragSource, /parkSource\(drag, target\)/, 'mid-drag tab positioning remains active')
assert.match(dragSource, /relocateOrganizationItem\(organization, session\.id, target\.side, target\.index, target\.folder\)/, 'drop still commits the selected destination')

console.log('PASS: organization dragging provides no drop indicators and preserves destination/reorder behavior.')
