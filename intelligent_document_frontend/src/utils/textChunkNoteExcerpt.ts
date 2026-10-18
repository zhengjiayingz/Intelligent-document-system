/** 把选区内的文本注解摘抄成笔记正文，并校验保存文件名 */

import { normalizeNoteColor, NOTE_COLOR_PRESETS } from '@/utils/textNoteColors'

export type ExcerptNote = {
  startOffset: number
  endOffset: number
  quote: string
  content: string | null
  color?: string | null
}

export type FormatNoteExcerptOptions = {
  /** 仅导出这些高亮色；省略则不过滤颜色；空集合 → 空正文 */
  colors?: ReadonlySet<string> | readonly string[] | null
}

const ILLEGAL_NAME = /[\\/:*?"<>|\u0000-\u001f]/

function overlaps(note: ExcerptNote, start: number, end: number): boolean {
  return note.startOffset < end && note.endOffset > start
}

function isExportable(note: ExcerptNote, start: number, end: number): boolean {
  return overlaps(note, start, end) && (note.content ?? '').trim().length > 0
}

function toColorSet(
  colors: FormatNoteExcerptOptions['colors'],
): Set<string> | null {
  if (colors == null) return null
  const list = colors instanceof Set ? [...colors] : [...colors]
  return new Set(list.map((c) => normalizeNoteColor(c)))
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

/** 选区内可导出注解用到的颜色（预设顺序优先，自定义色按字母序） */
export function colorsInNoteExcerpt(
  notes: ExcerptNote[],
  selectionStart: number,
  selectionEnd: number,
): string[] {
  const start = Math.min(selectionStart, selectionEnd)
  const end = Math.max(selectionStart, selectionEnd)
  const found = new Set<string>()
  for (const note of notes) {
    if (!isExportable(note, start, end)) continue
    found.add(normalizeNoteColor(note.color))
  }
  const ordered: string[] = []
  for (const preset of NOTE_COLOR_PRESETS) {
    const key = normalizeNoteColor(preset)
    if (found.has(key)) {
      ordered.push(key)
      found.delete(key)
    }
  }
  ordered.push(...[...found].sort())
  return ordered
}

/** 相交且注释非空，按原文顺序；每一物理行后都有空行 */
export function formatNoteExcerpt(
  notes: ExcerptNote[],
  selectionStart: number,
  selectionEnd: number,
  options?: FormatNoteExcerptOptions,
): string {
  const start = Math.min(selectionStart, selectionEnd)
  const end = Math.max(selectionStart, selectionEnd)
  const allowed = toColorSet(options?.colors)
  if (allowed && allowed.size === 0) return ''

  const lines = notes
    .filter((note) => {
      if (!isExportable(note, start, end)) return false
      if (!allowed) return true
      return allowed.has(normalizeNoteColor(note.color))
    })
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
