import { describe, expect, it } from 'vitest'
import {
  buildMappedRows,
  caretToSource,
  normalizeNewlines,
  noteAnchorFromSelection,
  noteStatus,
  pickNoteAtCaret,
  sourceRangeToRows,
} from './textNoteAnchor'

describe('textNoteAnchor', () => {
  it('normalizeNewlines 把 CRLF 和 CR 收成 LF', () => {
    expect(normalizeNewlines('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('不重排时，跨行选区的 quote 含中间换行', () => {
    const normalized = 'hello\nworld'
    const rows = buildMappedRows(normalized, false)
    const anchor = noteAnchorFromSelection(normalized, rows, {
      start: { rowIndex: 0, offset: 1 },
      end: { rowIndex: 1, offset: 3 },
    })
    expect(anchor).toEqual({
      startOffset: 1,
      endOffset: 9,
      quote: 'ello\nwor',
    })
  })

  it('流式重排合并段内换行，但 quote 仍是原文切片', () => {
    const normalized = 'hello\nworld\n\nnext'
    const rows = buildMappedRows(normalized, true)
    expect(rows.map((row) => row.text)).toEqual(['helloworld', 'next'])
    const anchor = noteAnchorFromSelection(normalized, rows, {
      start: { rowIndex: 0, offset: 0 },
      end: { rowIndex: 0, offset: 10 },
    })
    expect(anchor.quote).toBe('hello\nworld')
    expect(anchor.startOffset).toBe(0)
    expect(anchor.endOffset).toBe(11)
  })

  it('原文偏移映射回当前显示行', () => {
    const normalized = 'hello\nworld\n\nnext'
    const rows = buildMappedRows(normalized, true)
    expect(sourceRangeToRows(rows, 0, 11)).toEqual([{ rowIndex: 0, from: 0, to: 10 }])
  })

  it('未加载到的注释是 pending，切片不符是 stale', () => {
    expect(noteStatus('hello', { startOffset: 0, endOffset: 5, quote: 'hello' }, false)).toBe(
      'ready',
    )
    expect(noteStatus('hel', { startOffset: 0, endOffset: 5, quote: 'hello' }, false)).toBe(
      'pending',
    )
    expect(noteStatus('hel', { startOffset: 0, endOffset: 5, quote: 'hello' }, true)).toBe('stale')
    expect(noteStatus('hello', { startOffset: 0, endOffset: 5, quote: 'hellp' }, true)).toBe(
      'stale',
    )
  })

  it('重叠时取更短的一条，一样短则取较新的', () => {
    const notes = [
      { id: 1, startOffset: 0, endOffset: 10, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, startOffset: 2, endOffset: 5, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 3, startOffset: 2, endOffset: 5, createdAt: '2026-01-03T00:00:00.000Z' },
    ]
    expect(pickNoteAtCaret(notes, 3)?.id).toBe(3)
    expect(pickNoteAtCaret(notes, 8)?.id).toBe(1)
  })

  it('caretToSource 在行尾落到 endSource', () => {
    const rows = buildMappedRows('ab\ncd', false)
    expect(caretToSource(rows[0]!, 2)).toBe(2)
    expect(caretToSource(rows[1]!, 0)).toBe(3)
  })

  it('流式重排的段首尾按 String.trim 去掉不间断空格', () => {
    const wrapped = buildMappedRows('\u00A0hello\u00A0', true)
    expect(wrapped[0]!.text).toBe('hello')
    expect(wrapped[0]!.charSources).toEqual([1, 2, 3, 4, 5])
    expect(wrapped[0]!.endSource).toBe(6)

    expect(buildMappedRows('hello\n\n\u00A0world', true).map((row) => row.text)).toEqual([
      'hello',
      'world',
    ])
    expect(buildMappedRows('hello\n\n\u00A0\n\nworld', true).map((row) => row.text)).toEqual([
      'hello',
      'world',
    ])
  })
})
