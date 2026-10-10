import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const modalSource = readFileSync(join(root, 'src/tabs/configure-modal.tsx'), 'utf8')
const organizationSource = readFileSync(join(root, 'src/tabs/configure-organization.tsx'), 'utf8')
const overlayStart = modalSource.indexOf('function createOrganizationDragOverlay')
const overlayEnd = modalSource.indexOf('\nfunction resolveOrganizationSettleDestination', overlayStart)
const overlaySource = modalSource.slice(overlayStart, overlayEnd)

assert(overlayStart >= 0 && overlayEnd > overlayStart, 'organization drag overlay creator is present')
assert.match(overlaySource, /overlay\.classList\.add\('canvas-configure-tabs-overlay-clone'\)/, 'overlay adds its floating class without replacing source layout classes')
assert.match(overlaySource, /overlay\.classList\.remove\('canvas-organization-dragging'\)/, 'visible clone is not hidden with its source placeholder')
assert.doesNotMatch(overlaySource, /overlay\.className\s*=/, 'overlay preserves the source layout classes')
assert.match(organizationSource, /\.canvas-configure-tabs-overlay-clone\.canvas-organization-leaf\s*\{\s*justify-content:flex-start;gap:2px;padding:0 8px;\s*\}/, 'floating tab card preserves its original child spacing')
assert.match(organizationSource, /\.canvas-configure-tabs-overlay-clone\.canvas-organization-divider-row \.canvas-tab-divider\s*\{\s*width:24px;height:1px;margin:0 6px;\s*\}/, 'floating divider remains a horizontal rule despite global strip orientation styles')
assert.match(modalSource, /\.canvas-configure-tabs-row\.row-hidden\s*\{\s*background:\s*var\(--lumiverse-bg,\s*#1a1a2e\);/, 'disabled flat rows use the host background surface')
assert.match(organizationSource, /\.canvas-organization-leaf:has\(\.row-hidden\)\s*\{\s*background:var\(--lumiverse-bg,#1a1a2e\);\s*\}/, 'disabled organization cards use the host background surface')
assert.match(organizationSource, /\.canvas-organization-divider-row\s*\{[^}]*background:var\(--lumiverse-bg,#1a1a2e\);/, 'divider rows use the host background surface')

console.log('PASS: Configure Tabs overlay preserves spacing, divider orientation, and host background surfaces.')
