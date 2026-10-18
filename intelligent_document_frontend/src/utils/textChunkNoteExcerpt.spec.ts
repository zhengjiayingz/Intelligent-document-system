import { describe, expect, it } from 'vitest'
import {
  colorsInNoteExcerpt,
  defaultNoteFileName,
  formatNoteExcerpt,
  normalizeNoteFileName,
  withBlankLineAfterEachLine,
} from './textChunkNoteExcerpt'

const notes = [
  { startOffset: 10, endOffset: 16, quote: 'snarl', content: '咆哮，吼叫', color: '#FFD666' },
  { startOffset: 40, endOffset: 45, quote: 'drown', content: '淹没', color: '#9EC9FF' },
  { startOffset: 20, endOffset: 28, quote: 'belch', content: '   ', color: '#A8E6A1' },
  { startOffset: 80, endOffset: 90, quote: 'heartily', content: '尽情地', color: '#FFD666' },
]

describe('formatNoteExcerpt', () => {
  it('keeps overlapping notes with content, in source order, blank line between', () => {
    expect(formatNoteExcerpt(notes, 0, 50)).toBe('snarl 咆哮，吼叫\n\ndrown 淹没')
  })

  it('returns empty when selection has no annotated content', () => {
    expect(formatNoteExcerpt(notes, 70, 75)).toBe('')
    expect(formatNoteExcerpt(notes, 20, 28)).toBe('')
  })

  it('includes a note that only partly overlaps the selection', () => {
    expect(formatNoteExcerpt(notes, 14, 42)).toBe('snarl 咆哮，吼叫\n\ndrown 淹没')
  })

  it('puts a blank line after every physical line so reflow will not join them', () => {
    const wrapped = [
      {
        startOffset: 0,
        endOffset: 20,
        quote: "She doesn't give a hoot.\n她根本不在乎。",
        content: '不在乎',
        color: '#FFD666',
      },
    ]
    expect(formatNoteExcerpt(wrapped, 0, 20)).toBe(
      "She doesn't give a hoot.\n\n她根本不在乎。\n\n不在乎",
    )
  })

  it('filters by selected colors; empty set yields empty body', () => {
    expect(formatNoteExcerpt(notes, 0, 100, { colors: ['#ffd666'] })).toBe(
      'snarl 咆哮，吼叫\n\nheartily 尽情地',
    )
    expect(formatNoteExcerpt(notes, 0, 100, { colors: ['#9EC9FF'] })).toBe('drown 淹没')
    expect(formatNoteExcerpt(notes, 0, 100, { colors: [] })).toBe('')
  })
})

describe('colorsInNoteExcerpt', () => {
  it('lists colors of exportable notes in preset order', () => {
    expect(colorsInNoteExcerpt(notes, 0, 100)).toEqual(['#FFD666', '#9EC9FF'])
  })
})

describe('withBlankLineAfterEachLine', () => {
  it('inserts a blank line after each content line and is idempotent', () => {
    expect(withBlankLineAfterEachLine('a\nb\n\nc')).toBe('a\n\nb\n\nc')
    expect(withBlankLineAfterEachLine('a\n\nb\n\nc')).toBe('a\n\nb\n\nc')
  })
})

describe('note file name', () => {
  it('defaults beside the source file name', () => {
    expect(defaultNoteFileName('Harry.txt')).toBe('Harry-笔记.txt')
    expect(defaultNoteFileName('notes')).toBe('notes-笔记.txt')
  })

  it('rejects empty or illegal names and appends txt', () => {
    expect(normalizeNoteFileName('  ')).toEqual({ ok: false })
    expect(normalizeNoteFileName('a/b')).toEqual({ ok: false })
    expect(normalizeNoteFileName('vocab')).toEqual({ ok: true, name: 'vocab.txt' })
    expect(normalizeNoteFileName('Vocab.TXT')).toEqual({ ok: true, name: 'Vocab.TXT' })
  })
})
