/** localStorage：按用户 + 文件记录文本分块预览的阅读进度与流式重排 */

const STORAGE_PREFIX = 'fm_text_chunk_progress_v1'

export type TextChunkReadingProgress = {
  reflow: boolean
  /** 视口顶部附近、换行归一化后的原文偏移 */
  sourceOffset: number
}

export function textChunkProgressStorageKey(userId: number, fileId: number): string {
  return `${STORAGE_PREFIX}:${userId}:${fileId}`
}

export function loadTextChunkProgress(
  userId: number,
  fileId: number,
): TextChunkReadingProgress | null {
  const raw = localStorage.getItem(textChunkProgressStorageKey(userId, fileId))
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TextChunkReadingProgress>
    if (typeof parsed.reflow !== 'boolean') return null
    const sourceOffset = Number(parsed.sourceOffset)
    if (!Number.isFinite(sourceOffset) || sourceOffset < 0) return null
    return { reflow: parsed.reflow, sourceOffset: Math.floor(sourceOffset) }
  } catch {
    return null
  }
}

export function saveTextChunkProgress(
  userId: number,
  fileId: number,
  progress: TextChunkReadingProgress,
): void {
  if (!Number.isFinite(progress.sourceOffset) || progress.sourceOffset < 0) return
  localStorage.setItem(
    textChunkProgressStorageKey(userId, fileId),
    JSON.stringify({
      reflow: !!progress.reflow,
      sourceOffset: Math.floor(progress.sourceOffset),
    }),
  )
}

/** 在 mappedRows 中找到覆盖 sourceOffset 的行；找不到则落到最近可用行 */
export function rowIndexForSourceOffset(
  rows: { charSources: number[]; endSource: number; isBlank?: boolean }[],
  sourceOffset: number,
): number {
  if (rows.length === 0) return 0
  let lastContent = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (row.isBlank || row.charSources.length === 0) continue
    lastContent = i
    const start = row.charSources[0]!
    if (sourceOffset < start) return i
    if (sourceOffset < row.endSource) return i
  }
  return lastContent
}
