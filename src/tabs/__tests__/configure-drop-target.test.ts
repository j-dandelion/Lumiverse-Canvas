import { strict as assert } from 'node:assert'
import { insertionIndexFromMidpoints } from '../configure-drop-target'

const rows = [
  { top: 10, height: 40 },
  { top: 70, height: 40 },
  { top: 130, height: 40 },
]

assert.equal(insertionIndexFromMidpoints(rows, 20), 0, 'before the first midpoint inserts at the start')
assert.equal(insertionIndexFromMidpoints(rows, 30), 1, 'the midpoint belongs to the following slot')
assert.equal(insertionIndexFromMidpoints(rows, 60), 1, 'a gap between rows maps to their shared insertion slot')
assert.equal(insertionIndexFromMidpoints(rows, 90), 2, 'a row midpoint maps after that row')
assert.equal(insertionIndexFromMidpoints(rows, 200), 3, 'below the final row appends')
assert.equal(insertionIndexFromMidpoints([], 20), 0, 'an empty list inserts at zero')

console.log('PASS: Configure Tabs drag insertion uses stable sibling midpoints, including row gaps.')
