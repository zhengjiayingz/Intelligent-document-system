/** 文本分块预览：记住「流式重排」开关（按用户 + 文件） */

const STORAGE_PREFIX = 'fm_text_chunk_reflow_v1'

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

export function textChunkReflowStorageKey(fileId: number, userId?: number | null): string {
  return `${STORAGE_PREFIX}:${resolveUserId(userId)}:${fileId}`
}

export function loadTextChunkReflow(fileId: number, userId?: number | null): boolean | null {
  if (!(fileId > 0)) return null
  const raw = localStorage.getItem(textChunkReflowStorageKey(fileId, userId))
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  return null
}

export function saveTextChunkReflow(
  fileId: number,
  reflow: boolean,
  userId?: number | null,
): void {
  if (!(fileId > 0)) return
  localStorage.setItem(textChunkReflowStorageKey(fileId, userId), reflow ? '1' : '0')
}
