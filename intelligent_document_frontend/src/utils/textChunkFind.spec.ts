import { describe, expect, it } from 'vitest'
import {
  findContiguousMatches,
  findMatchIndexAtOrAfter,
  findMatchIndexAtOrBefore,
} from '@utils/textChunkFind'

describe('textChunkFind', () => {
  it('finds contiguous case-insensitive matches', () => {
    expect(findContiguousMatches('Hello HELLO heLLo', 'hello')).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
      { start: 12, end: 17 },
    ])
  })

  it('requires contiguous substring (no gap)', () => {
    expect(findContiguousMatches('a b', 'ab')).toEqual([])
    expect(findContiguousMatches('ab', 'ab')).toEqual([{ start: 0, end: 2 }])
  })

  it('returns empty for empty needle', () => {
    expect(findContiguousMatches('abc', '')).toEqual([])
    expect(findContiguousMatches('abc', '   ')).toEqual([])
  })

  it('supports overlapping starts like browser find', () => {
    expect(findContiguousMatches('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 1, end: 3 },
      { start: 2, end: 4 },
    ])
  })

  it('findMatchIndexAtOrAfter wraps', () => {
    // "xx ab xx ab xx" → starts at 3 and 9
    const matches = findContiguousMatches('xx ab xx ab xx', 'ab')
    expect(matches).toEqual([
      { start: 3, end: 5 },
      { start: 9, end: 11 },
    ])
    expect(findMatchIndexAtOrAfter(matches, 0)).toBe(0)
    expect(findMatchIndexAtOrAfter(matches, 3)).toBe(0)
    expect(findMatchIndexAtOrAfter(matches, 4)).toBe(1)
    expect(findMatchIndexAtOrAfter(matches, 10)).toBe(0)
  })

  it('findMatchIndexAtOrBefore wraps', () => {
    const matches = findContiguousMatches('xx ab xx ab xx', 'ab')
    expect(findMatchIndexAtOrBefore(matches, 0)).toBe(1)
    expect(findMatchIndexAtOrBefore(matches, 3)).toBe(1)
    expect(findMatchIndexAtOrBefore(matches, 4)).toBe(0)
    expect(findMatchIndexAtOrBefore(matches, 10)).toBe(1)
  })
})
