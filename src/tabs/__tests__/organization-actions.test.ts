import { strict as assert } from 'node:assert'
import { createEmptyModel } from '../../core/model'
import { relocateOrganizationItem, removeOrganizationItem } from '../../core/organization'
import { FakeHost } from '../../host/fake/implementation'
import { bootstrap, flush, getModel, shutdown } from '../../recon/dispatch'
import { commitOrganization } from '../organization-actions'

const keys = ['builtin:profile', 'builtin:regex', 'builtin:lorebook']
shutdown()
const host = new FakeHost(keys.map(key => ({ key, liveId: key.slice(8), location: 'primary' as const, hidden: key === 'builtin:regex', activeInPrimary: key === 'builtin:profile', activeInSecondary: false, hasContentRoot: true, isBuiltin: true })))
bootstrap({ ...createEmptyModel(), primary: keys, hidden: ['builtin:regex'], active: { primary: keys[0], secondary: null }, organization: { version: 1, primary: [
  { type: 'tab', key: keys[0] },
  { type: 'folder', id: 'tools', name: 'Tools', children: [{ key: keys[1] }] },
  { type: 'tab', key: keys[2] },
], secondary: [] } }, host)
await flush()
try {
  // Both gestures are queued before the first transaction completes. The
  // second must use its committed result, rather than an old UI snapshot.
  await Promise.all([
    commitOrganization(org => ({ ...org, primary: [...org.primary.map(item => item.type === 'folder' ? { ...item, name: 'Renamed' } : item), { type: 'divider', id: 'new-section', label: 'Section' }] })),
    commitOrganization(org => relocateOrganizationItem(org, keys[2], 'primary', -1, 'tools')),
  ])
  const model = getModel()!
  const folder = model.organization!.primary.find(item => item.type === 'folder')!
  assert.equal(folder.type, 'folder')
  if (folder.type === 'folder') {
    assert.equal(folder.name, 'Renamed')
    assert.deepEqual(folder.children.map(ref => ref.key), [keys[1], keys[2]])
  }
  assert.ok(model.organization!.primary.some(item => item.type === 'divider' && item.id === 'new-section'))
  assert.ok(model.hidden.includes(keys[1]))

  // A failed gesture must not poison the serial queue or mutate state.
  await assert.rejects(commitOrganization(() => { throw new Error('gesture failed') }), /gesture failed/)
  await commitOrganization(org => removeOrganizationItem(org, 'primary', 'folder:tools'))
  assert.deepEqual(getModel()!.primary, keys)
  assert.ok(getModel()!.organization!.primary.some(item => item.type === 'divider'))
  console.log('PASS: queued organization gestures preserve prior rename, divider, membership and hidden state; failed gestures recover without poisoning the queue.')
} finally {
  shutdown()
}
