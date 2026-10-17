import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_CHUNK_FONT_SIZE,
  MAX_TEXT_CHUNK_FONT_SIZE,
  MIN_TEXT_CHUNK_FONT_SIZE,
  clampTextChunkFontSize,
  loadTextChunkFontSize,
  saveTextChunkFontSize,
  textChunkFontSizeStorageKey,
} from './textChunkFontSizePreference'

function installMemoryLocalStorage() {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value)
      },
      removeItem: (key: string) => {
        map.delete(key)
      },
      clear: () => {
        map.clear()
      },
    },
  })
}

describe('textChunkFontSizePreference', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  it('key includes user and file', () => {
    expect(textChunkFontSizeStorageKey(9, 3)).toBe('fm_text_chunk_font_size_v1:3:9')
  })

  it('clamps and steps to even sizes', () => {
    expect(clampTextChunkFontSize(13)).toBe(14)
    expect(clampTextChunkFontSize(11)).toBe(MIN_TEXT_CHUNK_FONT_SIZE)
    expect(clampTextChunkFontSize(40)).toBe(MAX_TEXT_CHUNK_FONT_SIZE)
    expect(clampTextChunkFontSize(Number.NaN)).toBe(DEFAULT_TEXT_CHUNK_FONT_SIZE)
  })

  it('round-trips font size', () => {
    saveTextChunkFontSize(5, 18, 2)
    expect(loadTextChunkFontSize(5, 2)).toBe(18)
  })

  it('rejects invalid storage', () => {
    localStorage.setItem(textChunkFontSizeStorageKey(1, 1), 'abc')
    expect(loadTextChunkFontSize(1, 1)).toBeNull()
  })
})
