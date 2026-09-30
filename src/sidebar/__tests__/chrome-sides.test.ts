// Pure chrome-side resolution tests (options/start location settings).

import { describe, test, expect } from 'bun:test'
import {
  resolveChromeSides,
  isChromeSideIncluded,
  displayChromeSide,
} from '../chrome-sides'

describe('resolveChromeSides', () => {
  test('null = main drawer only', () => {
    expect(resolveChromeSides(null, 'left', true)).toEqual({
      sides: ['left'], main: true, second: false,
    })
    expect(resolveChromeSides(null, 'right', true)).toEqual({
      sides: ['right'], main: true, second: false,
    })
  })

  test('both = main + second (second only when enabled)', () => {
    expect(resolveChromeSides('both', 'left', true)).toEqual({
      sides: ['left', 'right'], main: true, second: true,
    })
    expect(resolveChromeSides('both', 'right', true)).toEqual({
      sides: ['right', 'left'], main: true, second: true,
    })
    expect(resolveChromeSides('both', 'left', false)).toEqual({
      sides: ['left'], main: true, second: false,
    })
  })

  test('explicit side on the main drawer', () => {
    expect(resolveChromeSides('left', 'left', true)).toEqual({
      sides: ['left'], main: true, second: false,
    })
    expect(resolveChromeSides('right', 'right', true)).toEqual({
      sides: ['right'], main: true, second: false,
    })
  })

  test('explicit side on the second drawer', () => {
    // main right → second sits on the left
    expect(resolveChromeSides('left', 'right', true)).toEqual({
      sides: ['left'], main: false, second: true,
    })
    // main left → second sits on the right
    expect(resolveChromeSides('right', 'left', true)).toEqual({
      sides: ['right'], main: false, second: true,
    })
  })

  test('explicit side with no drawer there falls back to main', () => {
    expect(resolveChromeSides('left', 'right', false)).toEqual({
      sides: ['right'], main: true, second: false,
    })
    expect(resolveChromeSides('right', 'left', false)).toEqual({
      sides: ['left'], main: true, second: false,
    })
  })

  test('result never empty for any combination', () => {
    const values = [null, 'left', 'right', 'both'] as const
    for (const v of values) {
      for (const side of ['left', 'right'] as const) {
        for (const second of [true, false]) {
          expect(resolveChromeSides(v, side, second).sides.length).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('isChromeSideIncluded', () => {
  test('matches resolveChromeSides membership', () => {
    expect(isChromeSideIncluded(null, 'left', 'left', true)).toBe(true)
    expect(isChromeSideIncluded(null, 'right', 'left', true)).toBe(false)
    expect(isChromeSideIncluded('both', 'right', 'left', true)).toBe(true)
    expect(isChromeSideIncluded('both', 'right', 'left', false)).toBe(false)
    expect(isChromeSideIncluded('left', 'left', 'right', true)).toBe(true)
    expect(isChromeSideIncluded('left', 'right', 'right', true)).toBe(false)
  })
})

describe('displayChromeSide', () => {
  test('null displays the main drawer side', () => {
    expect(displayChromeSide(null, 'left')).toBe('left')
    expect(displayChromeSide(null, 'right')).toBe('right')
  })

  test('explicit values display themselves', () => {
    expect(displayChromeSide('both', 'left')).toBe('both')
    expect(displayChromeSide('left', 'right')).toBe('left')
    expect(displayChromeSide('right', 'left')).toBe('right')
  })
})
