/** 把选区内的文本注解摘抄成笔记正文，并校验保存文件名 */

export type ExcerptNote = {
  startOffset: number
  endOffset: number
  quote: string
  content: string | null
}

const ILLEGAL_NAME = /[\\/:*?"<>|\u0000-\u001f]/

function overlaps(note: ExcerptNote, start: number, end: number): boolean {
  return note.startOffset < end && note.endOffset > start
}

/**
 * 每个非空行后面都跟一个空行。
 * 流式重排会合并段内的单个换行，没有空行时相邻两行会显示成一行。
 */
export function withBlankLineAfterEachLine(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n\n')
}

function splitLines(value: string): string[] {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function entryLines(note: ExcerptNote): string[] {
  const quoteLines = splitLines(note.quote)
  const contentLines = splitLines(note.content ?? '')
  if (quoteLines.length <= 1 && contentLines.length <= 1) {
    const line = `${quoteLines[0] ?? ''} ${contentLines[0] ?? ''}`.trim()
    return line ? [line] : []
  }
  return [...quoteLines, ...contentLines]
}

/** 相交且注释非空，按原文顺序；每一物理行后都有空行 */
export function formatNoteExcerpt(
  notes: ExcerptNote[],
  selectionStart: number,
  selectionEnd: number,
): string {
  const start = Math.min(selectionStart, selectionEnd)
  const end = Math.max(selectionStart, selectionEnd)
  const lines = notes
    .filter((note) => overlaps(note, start, end) && (note.content ?? '').trim().length > 0)
    .slice()
    .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset)
    .flatMap(entryLines)
  return lines.join('\n\n')
}

export function defaultNoteFileName(sourceFileName: string): string {
  const trimmed = sourceFileName.trim()
  const base = trimmed.replace(/\.[^.]+$/, '') || '笔记'
  return `${base}-笔记.txt`
}

export function normalizeNoteFileName(
  raw: string,
): { ok: true; name: string } | { ok: false } {
  let name = raw.trim()
  if (!name || ILLEGAL_NAME.test(name) || name === '.' || name === '..') return { ok: false }
  if (!name.toLowerCase().endsWith('.txt')) name += '.txt'
  if (name === '.txt' || ILLEGAL_NAME.test(name)) return { ok: false }
  return { ok: true, name }
}
