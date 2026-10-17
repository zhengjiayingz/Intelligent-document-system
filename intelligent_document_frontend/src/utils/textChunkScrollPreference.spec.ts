import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyScrollPreference,
  loadTextChunkScroll,
  saveTextChunkScroll,
  scrollMetricsFromElement,
  textChunkScrollStorageKey,
} from './textChunkScrollPreference'

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

describe('textChunkScrollPreference', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  it('key includes user and file', () => {
    expect(textChunkScrollStorageKey(9, 3)).toBe('fm_text_chunk_scroll_v1:3:9')
  })

  it('round-trips scrollTop and ratio', () => {
    saveTextChunkScroll(5, { scrollTop: 420, scrollRatio: 0.35 }, 2)
    expect(loadTextChunkScroll(5, 2)).toEqual({ scrollTop: 420, scrollRatio: 0.35 })
  })

  it('rejects invalid json', () => {
    localStorage.setItem(textChunkScrollStorageKey(1, 1), '{')
    expect(loadTextChunkScroll(1, 1)).toBeNull()
  })

  it('scrollMetricsFromElement computes ratio', () => {
    const el = {
      scrollTop: 250,
      scrollHeight: 1000,
      clientHeight: 500,
    } as HTMLElement
    expect(scrollMetricsFromElement(el)).toEqual({ scrollTop: 250, scrollRatio: 0.5 })
  })

  it('applyScrollPreference uses ratio', () => {
    const el = {
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
    } as HTMLElement
    applyScrollPreference(el, { scrollTop: 100, scrollRatio: 0.4 })
    expect(el.scrollTop).toBe(600)
  })
})
