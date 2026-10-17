import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTE_COLOR,
  isValidNoteColor,
  normalizeNoteColor,
  noteColorToOverlay,
} from './textNoteColors'

describe('textNoteColors', () => {
  it('accepts #RRGGBB', () => {
    expect(isValidNoteColor('#ffd666')).toBe(true)
    expect(isValidNoteColor('red')).toBe(false)
  })

  it('normalizes to uppercase default', () => {
    expect(normalizeNoteColor('#a8e6a1')).toBe('#A8E6A1')
    expect(normalizeNoteColor(null)).toBe(DEFAULT_NOTE_COLOR)
    expect(normalizeNoteColor('bad')).toBe(DEFAULT_NOTE_COLOR)
  })

  it('builds translucent overlay color', () => {
    expect(noteColorToOverlay('#FFD666')).toBe('rgba(255, 214, 102, 0.32)')
  })
})
