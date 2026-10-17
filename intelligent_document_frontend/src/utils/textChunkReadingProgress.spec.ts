import { describe, expect, it, beforeEach } from 'vitest'
import {
  loadTextChunkProgress,
  rowIndexForSourceOffset,
  saveTextChunkProgress,
  textChunkProgressStorageKey,
} from './textChunkReadingProgress'

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

describe('textChunkReadingProgress', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  it('round-trips reflow and sourceOffset', () => {
    saveTextChunkProgress(1, 9, { reflow: false, sourceOffset: 120 })
    expect(loadTextChunkProgress(1, 9)).toEqual({ reflow: false, sourceOffset: 120 })
    expect(localStorage.getItem(textChunkProgressStorageKey(1, 9))).toContain('"reflow":false')
  })

  it('rejects corrupt payload', () => {
    localStorage.setItem(textChunkProgressStorageKey(1, 9), '{bad')
    expect(loadTextChunkProgress(1, 9)).toBeNull()
  })

  it('maps source offset to row index', () => {
    const rows = [
      { charSources: [0, 1, 2], endSource: 3 },
      { charSources: [], endSource: 4, isBlank: true },
      { charSources: [4, 5], endSource: 6 },
    ]
    expect(rowIndexForSourceOffset(rows, 1)).toBe(0)
    expect(rowIndexForSourceOffset(rows, 4)).toBe(2)
    expect(rowIndexForSourceOffset(rows, 100)).toBe(2)
  })
})
