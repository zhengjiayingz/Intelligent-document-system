import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadTextChunkReflow,
  saveTextChunkReflow,
  textChunkReflowStorageKey,
} from './textChunkReflowPreference'

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

describe('textChunkReflowPreference', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  it('saves and loads reflow by user and file', () => {
    saveTextChunkReflow(9, false, 1)
    expect(loadTextChunkReflow(9, 1)).toBe(false)
    expect(localStorage.getItem(textChunkReflowStorageKey(9, 1))).toBe('0')
    saveTextChunkReflow(9, true, 1)
    expect(loadTextChunkReflow(9, 1)).toBe(true)
  })

  it('reads user id from localStorage when omitted', () => {
    localStorage.setItem('user', JSON.stringify({ id: 3 }))
    saveTextChunkReflow(12, false)
    expect(loadTextChunkReflow(12)).toBe(false)
    expect(localStorage.getItem(textChunkReflowStorageKey(12, 3))).toBe('0')
  })
})
