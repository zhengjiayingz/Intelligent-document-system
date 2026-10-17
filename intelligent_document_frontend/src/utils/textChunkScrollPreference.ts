/** 文本分块预览：记住滚动位置（按用户 + 文件） */

const STORAGE_PREFIX = 'fm_text_chunk_scroll_v1'

export type TextChunkScrollPreference = {
  /** 上次关闭时的 scrollTop */
  scrollTop: number
  /** scrollTop / maxScroll，布局变化时用比例恢复 */
  scrollRatio: number
}

function resolveUserId(userId?: number | null): number {
  if (typeof userId === 'number' && userId > 0) return userId
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return 0
    const id = Number((JSON.parse(raw) as { id?: unknown })?.id)
    return Number.isFinite(id) && id > 0 ? id : 0
  } catch {
    return 0
  }
}

export function textChunkScrollStorageKey(fileId: number, userId?: number | null): string {
  return `${STORAGE_PREFIX}:${resolveUserId(userId)}:${fileId}`
}

export function loadTextChunkScroll(
  fileId: number,
  userId?: number | null,
): TextChunkScrollPreference | null {
  if (!(fileId > 0)) return null
  const raw = localStorage.getItem(textChunkScrollStorageKey(fileId, userId))
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TextChunkScrollPreference>
    const scrollTop = Number(parsed.scrollTop)
    const scrollRatio = Number(parsed.scrollRatio)
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return null
    if (!Number.isFinite(scrollRatio) || scrollRatio < 0) return null
    return {
      scrollTop: Math.floor(scrollTop),
      scrollRatio: Math.min(1, Math.max(0, scrollRatio)),
    }
  } catch {
    return null
  }
}

export function saveTextChunkScroll(
  fileId: number,
  pref: TextChunkScrollPreference,
  userId?: number | null,
): void {
  if (!(fileId > 0)) return
  if (!Number.isFinite(pref.scrollTop) || pref.scrollTop < 0) return
  if (!Number.isFinite(pref.scrollRatio) || pref.scrollRatio < 0) return
  localStorage.setItem(
    textChunkScrollStorageKey(fileId, userId),
    JSON.stringify({
      scrollTop: Math.floor(pref.scrollTop),
      scrollRatio: Math.min(1, Math.max(0, pref.scrollRatio)),
    }),
  )
}

export function scrollMetricsFromElement(el: HTMLElement): TextChunkScrollPreference {
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  const scrollTop = Math.max(0, el.scrollTop)
  return {
    scrollTop: Math.floor(scrollTop),
    scrollRatio: max > 0 ? Math.min(1, scrollTop / max) : 0,
  }
}

export function applyScrollPreference(el: HTMLElement, pref: TextChunkScrollPreference): void {
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  if (max <= 0) return
  const byRatio = Math.round(pref.scrollRatio * max)
  // 优先比例（重排后行高会变）；绝对值作上限钳制
  el.scrollTop = Math.min(max, Math.max(0, byRatio || pref.scrollTop))
}
