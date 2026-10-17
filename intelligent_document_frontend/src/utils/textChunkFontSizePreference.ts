/** 文本分块预览：记住正文字号（按用户 + 文件） */

const STORAGE_PREFIX = 'fm_text_chunk_font_size_v1'

export const DEFAULT_TEXT_CHUNK_FONT_SIZE = 14
export const MIN_TEXT_CHUNK_FONT_SIZE = 12
export const MAX_TEXT_CHUNK_FONT_SIZE = 28
export const TEXT_CHUNK_FONT_SIZE_STEP = 2

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

export function textChunkFontSizeStorageKey(fileId: number, userId?: number | null): string {
  return `${STORAGE_PREFIX}:${resolveUserId(userId)}:${fileId}`
}

export function clampTextChunkFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TEXT_CHUNK_FONT_SIZE
  const stepped = Math.round(size / TEXT_CHUNK_FONT_SIZE_STEP) * TEXT_CHUNK_FONT_SIZE_STEP
  return Math.min(MAX_TEXT_CHUNK_FONT_SIZE, Math.max(MIN_TEXT_CHUNK_FONT_SIZE, stepped))
}

export function loadTextChunkFontSize(fileId: number, userId?: number | null): number | null {
  if (!(fileId > 0)) return null
  const raw = localStorage.getItem(textChunkFontSizeStorageKey(fileId, userId))
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return clampTextChunkFontSize(n)
}

export function saveTextChunkFontSize(
  fileId: number,
  size: number,
  userId?: number | null,
): void {
  if (!(fileId > 0)) return
  localStorage.setItem(
    textChunkFontSizeStorageKey(fileId, userId),
    String(clampTextChunkFontSize(size)),
  )
}
