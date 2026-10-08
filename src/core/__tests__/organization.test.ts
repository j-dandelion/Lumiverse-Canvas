import { test, expect } from 'bun:test'
import { createEmptyModel } from '../model'
import { reduce } from '../reduce'
import { browserVisible, canonicalAddress, folderContaining, importNativeOrganization, normalizeOrganization, organizationFor, projectNativeOrganization, relocateOrganizationItem, removeOrganizationItem, sanitizeOrganization, type Organization } from '../organization'
import { buildModelFromLayout, serializeModelToLayout, serializeModelToSingleLayout, foldLayoutToSingleShape } from '../../persist/layout-model'

const a = 'builtin:profile', b = 'builtin:regex', c = 'builtin:lorebook', ext = 'ext:example/Example'
const base = () => ({ ...createEmptyModel(), primary: [a, b, c], secondary: [ext] })
const grouped = (): Organization => ({ version: 1, primary: [{ type: 'tab', key: a }, { type: 'folder', id: 'tools', name: 'Tools', view: 'grid', children: [{ key: b }, { key: c }] }, { type: 'divider', id: 'break', label: 'Utilities' }], secondary: [{ type: 'tab', key: ext }] })
const model = () => reduce(base(), { t: 'setOrganization', organization: grouped() })
const resolve = (key: string) => key.startsWith('builtin:') ? key.slice(8) : key === ext ? 'spindle:example:tab:example:9' : null
const find = (id: string) => [a, b, c, ext].find(key => key === id || resolve(key) === id) ?? null

test('organization keeps flat ownership and folder membership in agreement', () => {
  const m = model(); expect(m.primary).toEqual([a, b, c]); expect(folderContaining(m, 'primary', b)?.id).toBe('tools')
  expect(m.secondary).toEqual([ext]); expect(m.closed).toEqual([])
})
test('duplicate tabs and container IDs are discarded without allowing nesting', () => {
  const org = sanitizeOrganization({ primary: [{ type: 'folder', id: 'f', name: ' ', children: [{ key: a }, { key: a }, { type: 'folder', id: 'nested' }] }, { type: 'tab', key: a }, { type: 'divider', id: 'f' }], secondary: [{ type: 'tab', key: a }] })
  expect(org.primary).toEqual([{ type: 'folder', id: 'f', name: 'Folder', view: 'list', children: [{ key: a }] }]); expect(org.secondary).toEqual([])
})
test('deleting a folder spills children at its position; deleting a divider changes no tabs', () => {
  const org = removeOrganizationItem(grouped(), 'primary', 'folder:tools')
  expect(org.primary).toEqual([{ type: 'tab', key: a }, { type: 'tab', key: b }, { type: 'tab', key: c }, { type: 'divider', id: 'break', label: 'Utilities' }])
  expect(removeOrganizationItem(org, 'primary', 'divider:break').primary).toHaveLength(3)
})
test('moving a folder carries hidden, closed, and unavailable children', () => {
  const m = { ...model(), hidden: [b], closed: [c] }
  const org = relocateOrganizationItem(organizationFor(m), 'folder:tools', 'secondary')
  const next = reduce(m, { t: 'setOrganization', organization: org })
  expect(next.primary).toEqual([a]); expect(next.secondary).toEqual([ext, b, c]); expect(next.hidden).toEqual([b]); expect(next.closed).toEqual([c])
})
test('moving one child to the other drawer removes old membership', () => {
  const next = reduce(model(), { t: 'move', key: b, to: 'secondary', index: -1, activateDest: false })
  expect(folderContaining(next, 'primary', b)).toBeNull(); expect(organizationFor(next).secondary[organizationFor(next).secondary.length - 1]).toEqual({ type: 'tab', key: b })
})
test('folder and divider drops into a folder are rejected', () => {
  const org = grouped(); expect(relocateOrganizationItem(org, 'divider:break', 'primary', -1, 'tools')).toBe(org)
  expect(relocateOrganizationItem(org, 'folder:tools', 'primary', -1, 'tools')).toBe(org)
})
test('browser selection is independent of remembered leaf and survives host echoes', () => {
  const selected = reduce(model(), { t: 'activate', side: 'primary', key: b })
  const browsing = reduce(selected, { t: 'browseFolder', side: 'primary', id: 'tools' })
  expect(browsing.active.primary).toBeNull(); expect(browsing.rememberedLeaf?.primary).toBe(b)
  expect(reduce(browsing, { t: 'syncActive', primary: b, secondary: null })).toBe(browsing)
  expect(reduce(browsing, { t: 'activate', side: 'primary', key: b }).folderBrowser?.primary).toBeNull()
})
test('repeated browser selection is idempotent and invalid folder IDs do nothing', () => {
  const browsing = reduce(model(), { t: 'browseFolder', side: 'primary', id: 'tools' })
  expect(reduce(browsing, { t: 'browseFolder', side: 'primary', id: 'tools' })).toBe(browsing)
  expect(reduce(browsing, { t: 'browseFolder', side: 'primary', id: 'missing' })).toBe(browsing)
})
test('deleting the selected browser chooses its first available child', () => {
  const browsing = reduce(model(), { t: 'browseFolder', side: 'primary', id: 'tools' })
  const next = reduce(browsing, { t: 'setOrganization', organization: removeOrganizationItem(grouped(), 'primary', 'folder:tools') })
  expect(next.folderBrowser?.primary).toBeNull(); expect(next.active.primary).toBe(b)
})
test('close-generated hiding remains browsable; manual hiding does not', () => {
  const closed = reduce(model(), { t: 'setHidden', key: b, hidden: true, origin: 'close' })
  expect(browserVisible(closed, b)).toBe(true)
  const manual = reduce(closed, { t: 'setHidden', key: b, hidden: true })
  expect(browserVisible(manual, b)).toBe(false); expect(manual.closeHidden).toEqual([])
})
test('native import retains unknown addresses and protects second-drawer ownership', () => {
  const org = importNativeOrganization([{ type: 'folder', id: 'native', name: 'Native', children: ['regex', 'spindle:example:tab:example:9', 'spindle:missing:tab:missing:4'] }, { type: 'divider', id: 'd' }], base(), find)
  const folder = org.primary[0]; expect(folder.type).toBe('folder')
  if (folder.type !== 'folder') throw new Error('expected folder')
  expect(folder.children).toEqual([{ key: b }, { tabId: 'spindle:missing:tab:missing' }]); expect(org.secondary).toEqual([{ type: 'tab', key: ext }])
})
test('projection emits native layout and stable registration-independent addresses', () => {
  const projection = projectNativeOrganization(grouped(), resolve) as any[]
  expect(projection[1].children).toEqual(['regex', 'lorebook']); expect(projection[projection.length - 1].tabId).toBe('spindle:example:tab:example')
  expect(canonicalAddress('feedback')).toBe('council'); expect(canonicalAddress('custom:42')).toBe('custom:42')
})
test('organization, view preference and browser state round-trip through persistence', () => {
  const browsing = reduce(model(), { t: 'browseFolder', side: 'primary', id: 'tools' })
  const restored = buildModelFromLayout(serializeModelToLayout(browsing, resolve, 'test'), find)
  expect(restored.organization).toEqual(browsing.organization); expect(restored.folderBrowser).toEqual(browsing.folderBrowser); expect(restored.active.primary).toBeNull()
})
test('single projection and raw folding keep organization reachable in one drawer', () => {
  const projected = serializeModelToSingleLayout(model(), resolve, 'test')
  expect(projected.organization?.secondary).toEqual([]); expect(projected.organization?.primary[projected.organization.primary.length - 1]).toEqual({ type: 'tab', key: ext })
  const folded = foldLayoutToSingleShape(serializeModelToLayout(model(), resolve, 'test'))
  expect(folded.organization).toEqual(projected.organization); expect(folded.detachedTabs).toEqual([])
})
test('saved unavailable extension membership and ownership survive loading', () => {
  const org = { ...grouped(), secondary: [{ type: 'folder' as const, id: 'unavailable', name: 'Unavailable', children: [{ key: 'ext:gone/Gone' }] }] }
  const loaded = buildModelFromLayout({ organization: org }, () => null)
  expect(loaded.secondary).toContain('ext:gone/Gone'); expect(loaded.organization?.secondary).toEqual(sanitizeOrganization(org).secondary)
})
test('normalization appends new inventory without discarding empty folders or explicit separators', () => {
  const org = normalizeOrganization(base(), { version: 1, primary: [{ type: 'divider', id: 'lead' }, { type: 'folder', id: 'empty', name: 'Empty', children: [] }, { type: 'divider', id: 'tail' }], secondary: [] })
  expect(org.primary.slice(0, 3).map(item => item.type)).toEqual(['divider', 'folder', 'divider']); expect(org.primary.slice(3)).toEqual([a, b, c].map(key => ({ type: 'tab', key })))
})

test('reload clears invalid browser selection and restores the remembered leaf', () => {
  const loaded = buildModelFromLayout({ ...serializeModelToLayout(model(), resolve, 'test'), folderBrowser: { primary: 'removed', secondary: null }, rememberedLeaf: { primary: c, secondary: null } }, find)
  expect(loaded.folderBrowser?.primary).toBeNull(); expect(loaded.active.primary).toBe(c)
})
test('unavailable folder members retain closed and manually hidden state across reload', () => {
  const unavailable = { ...model(), hidden: [ext], closed: [ext], menuHidden: [ext] }
  const loaded = buildModelFromLayout(serializeModelToLayout(unavailable, () => null, 'test'), () => null)
  expect(loaded.hidden).toEqual([ext]); expect(loaded.closed).toEqual([ext]); expect(loaded.menuHidden).toEqual([ext])
})
test('a selected folder follows a cross-drawer move and replaces destination leaf selection', () => {
  const browsing = reduce({ ...model(), active: { primary: b, secondary: ext } }, { t: 'browseFolder', side: 'primary', id: 'tools' })
  const moved = reduce(browsing, { t: 'setOrganization', organization: relocateOrganizationItem(organizationFor(browsing), 'folder:tools', 'secondary') })
  expect(moved.folderBrowser).toEqual({ primary: null, secondary: 'tools' }); expect(moved.active.secondary).toBeNull(); expect(moved.rememberedLeaf?.secondary).toBe(ext); expect(moved.drawers.secondary.open).toBe(true)
})
test('invalid hiding cannot create a close-provenance ghost', () => {
  const m = model(); expect(reduce(m, { t: 'setHidden', key: 'ext:missing/Missing', hidden: true, origin: 'close' })).toBe(m)
})

test('moving an active group never leaves its next child active in the source drawer', () => {
  const m = { ...model(), active: { primary: b, secondary: ext } }
  const moved = reduce(m, { t: 'setOrganization', organization: relocateOrganizationItem(organizationFor(m), 'folder:tools', 'secondary') })
  expect(moved.active.primary).toBe(a); expect(moved.active.secondary).toBe(b)
})

// Adapter contracts use the production migration boundary with a deterministic
// identity inventory; the DOM navigation contract has a separate paired harness.
import { FakeHost } from '../../host/fake/implementation'
import { adoptNativeOrganization } from '../../tabs/native-organization'
import { __setHostSetSettingForTest, clearHostSettingsCache } from '../../dom/host-settings'
import { folderIconSvg, sanitizeCustomIcon } from '../../tabs/folder-icons'
const nativeHost = () => new FakeHost([a, b, c, ext].map(key => ({ key, liveId: resolve(key)!, location: key === ext ? 'secondary' as const : 'primary' as const, hidden: false, activeInPrimary: false, activeInSecondary: false, hasContentRoot: true, isBuiltin: key.startsWith('builtin:') })))

test('verified native edits replace only the active main organization', () => {
  const native = [{ type: 'folder', id: 'edited', name: 'Edited', children: ['lorebook', 'regex', resolve(ext)] }]
  const saved = serializeModelToLayout(model(), resolve, 'test')
  __setHostSetSettingForTest(() => {}, { layout: native, canvasOrganizationProjection: 'previous-projection' })
  const adopted = adoptNativeOrganization(saved, nativeHost())
  const folder = adopted.organization?.primary[0]
  expect(folder?.type).toBe('folder')
  if (folder?.type === 'folder') expect(folder.children).toEqual([{ key: c }, { key: b }])
  expect(adopted.organization?.secondary).toEqual(saved.organization?.secondary)
  __setHostSetSettingForTest(null); clearHostSettingsCache()
})
test('removing all native containers is an edit even when native layout becomes empty', () => {
  const saved = serializeModelToLayout(model(), resolve, 'test')
  __setHostSetSettingForTest(() => {}, { layout: [], tabOrder: ['lorebook', 'regex', 'profile'], canvasOrganizationProjection: 'previous-projection' })
  const adopted = adoptNativeOrganization(saved, nativeHost())
  expect(adopted.organization?.primary).toEqual([c, b, a].map(key => ({ type: 'tab', key })))
  expect(adopted.organization?.secondary).toEqual(saved.organization?.secondary)
  __setHostSetSettingForTest(null); clearHostSettingsCache()
})
test('a Canvas-generated native projection does not overwrite its saved dual layout', () => {
  const native = projectNativeOrganization(grouped(), resolve)
  const saved = serializeModelToLayout(model(), resolve, 'test')
  __setHostSetSettingForTest(() => {}, { layout: native, canvasOrganizationProjection: JSON.stringify(native) })
  const adopted = adoptNativeOrganization(saved, nativeHost())
  expect(adopted.organization).toEqual(saved.organization)
  __setHostSetSettingForTest(null); clearHostSettingsCache()
})
test('custom icons retain safe native attributes without duplicate SVG attributes', () => {
  const custom = sanitizeCustomIcon({ viewBox: '0 0 24 24', attrs: { fill: 'currentColor', stroke: 'none', onload: 'bad()' }, elements: [{ tag: 'script', attrs: {} }, { tag: 'path', attrs: { d: 'M0 0h24v24H0Z', onclick: 'bad()', fill: 'url(https://example.com)' } }] })
  const svg = folderIconSvg({ customIcon: custom })
  expect(svg).toContain('fill="currentColor"'); expect(svg.match(/fill=/g)?.length).toBe(1)
  expect(svg).not.toMatch(/script|onload|onclick|https:/)
})

test('saved native projection is a fallback when the host projection marker is absent', () => {
  const saved = serializeModelToLayout(model(), resolve, 'test')
  __setHostSetSettingForTest(() => {}, { layout: JSON.parse(saved.nativeOrganizationProjection!) })
  const adopted = adoptNativeOrganization(saved, nativeHost())
  expect(adopted.organization).toEqual(saved.organization)
  __setHostSetSettingForTest(null); clearHostSettingsCache()
})

test('native folded second-drawer containers cannot replace or duplicate the protected layout', () => {
  const org: Organization = { ...grouped(), secondary: [{ type: 'folder', id: 'second-folder', name: 'Keep second', children: [{ key: ext }] }, { type: 'divider', id: 'second-divider' }] }
  const m = reduce(base(), { t: 'setOrganization', organization: org })
  const imported = importNativeOrganization([{ type: 'folder', id: 'main-new', name: 'New main', children: ['profile'] }, { type: 'folder', id: 'second-folder', name: 'Native edit', children: [resolve(ext), 'regex', 'spindle:late:tab:late'] }, { type: 'divider', id: 'second-divider' }], m, find)
  expect(imported.secondary).toEqual(sanitizeOrganization(org).secondary)
  expect(imported.primary.some(item => item.type !== 'tab' && item.id === 'second-folder')).toBe(false)
  expect(imported.primary).toContainEqual({ type: 'tab', key: b })
  expect(imported.primary).toContainEqual({ type: 'tab', tabId: 'spindle:late:tab:late' })
})
