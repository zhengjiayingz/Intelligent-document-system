export type NoteCaret = { rowIndex: number; offset: number }

export type MappedRow = {
  text: string
  indentFirstLine: boolean
  isBlank?: boolean
  charSources: number[]
  endSource: number
}

const VIRTUAL_MAX_LINE = 4000

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function chunkMapped(row: MappedRow, indentFirstLine: boolean): MappedRow[] {
  if (row.text.length === 0) {
    return [{ ...row, indentFirstLine: false, isBlank: true }]
  }
  if (row.text.length <= VIRTUAL_MAX_LINE) {
    return [{ ...row, indentFirstLine, isBlank: false }]
  }
  const out: MappedRow[] = []
  for (let i = 0; i < row.text.length; i += VIRTUAL_MAX_LINE) {
    const text = row.text.slice(i, i + VIRTUAL_MAX_LINE)
    const charSources = row.charSources.slice(i, i + VIRTUAL_MAX_LINE)
    const endSource =
      i + VIRTUAL_MAX_LINE >= row.text.length
        ? row.endSource
        : charSources[charSources.length - 1]! + 1
    out.push({
      text,
      charSources,
      endSource,
      indentFirstLine: indentFirstLine && i === 0,
      isBlank: false,
    })
  }
  return out
}

function mapPlain(normalized: string): MappedRow[] {
  const logical: MappedRow[] = []
  let text = ''
  let charSources: number[] = []
  const pushLine = (endSource: number) => {
    logical.push({
      text,
      charSources,
      endSource,
      indentFirstLine: false,
      isBlank: text.length === 0,
    })
    text = ''
    charSources = []
  }
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '\n') pushLine(i)
    else {
      text += normalized[i]
      charSources.push(i)
    }
  }
  if (text.length > 0 || !normalized.endsWith('\n')) {
    if (normalized.length > 0 || logical.length === 0) pushLine(normalized.length)
  }
  if (normalized.length === 0) return []

  const out: MappedRow[] = []
  for (let r = 0; r < logical.length; r++) {
    const line = logical[r]!
    const indent = !line.isBlank && (r === 0 || logical[r - 1]?.isBlank === true)
    out.push(...chunkMapped(line, indent))
  }
  return out
}

function isBlankGap(normalized: string, index: number): number {
  if (normalized[index] !== '\n') return 0
  let i = index + 1
  let sawAnotherNewline = false
  while (i < normalized.length) {
    const ch = normalized[i]!
    if (ch === ' ' || ch === '\t' || ch === '\u3000') {
      i++
      continue
    }
    if (ch === '\n') {
      sawAnotherNewline = true
      i++
      continue
    }
    break
  }
  return sawAnotherNewline ? i - index : 0
}

function collapseBlock(segs: { ch: string; source: number }[]): { ch: string; source: number }[] {
  const lines: { ch: string; source: number }[][] = [[]]
  for (const seg of segs) {
    if (seg.ch === '\n') lines.push([])
    else lines[lines.length - 1]!.push(seg)
  }
  const joined: { ch: string; source: number }[] = []
  for (const line of lines) {
    let end = line.length
    while (end > 0 && /[ \t\u3000]/.test(line[end - 1]!.ch)) end--
    joined.push(...line.slice(0, end))
  }
  let start = 0
  let end = joined.length
  while (start < end && joined[start]!.ch.trim() === '') start++
  while (end > start && joined[end - 1]!.ch.trim() === '') end--
  return joined.slice(start, end)
}

function mapReflow(normalized: string): MappedRow[] {
  if (!normalized.trim()) return []
  const paragraphs: MappedRow[] = []
  let segs: { ch: string; source: number }[] = []
  const flush = () => {
    const kept = collapseBlock(segs)
    segs = []
    if (kept.length === 0) return
    paragraphs.push({
      text: kept.map((seg) => seg.ch).join(''),
      charSources: kept.map((seg) => seg.source),
      endSource: kept[kept.length - 1]!.source + 1,
      indentFirstLine: true,
      isBlank: false,
    })
  }
  for (let i = 0; i < normalized.length; ) {
    const gap = isBlankGap(normalized, i)
    if (gap > 0) {
      flush()
      i += gap
      continue
    }
    segs.push({ ch: normalized[i]!, source: i })
    i++
  }
  flush()
  return paragraphs.flatMap((row) => chunkMapped(row, true))
}

export function buildMappedRows(normalized: string, reflow: boolean): MappedRow[] {
  return reflow ? mapReflow(normalized) : mapPlain(normalized)
}

export function caretToSource(row: MappedRow, offset: number): number {
  if (row.charSources.length === 0) return row.endSource
  if (offset <= 0) return row.charSources[0]!
  if (offset >= row.text.length) return row.endSource
  return row.charSources[offset]!
}

export function noteAnchorFromSelection(
  normalized: string,
  rows: MappedRow[],
  range: { start: NoteCaret; end: NoteCaret },
): { startOffset: number; endOffset: number; quote: string } {
  const startOffset = caretToSource(rows[range.start.rowIndex]!, range.start.offset)
  const endOffset = caretToSource(rows[range.end.rowIndex]!, range.end.offset)
  return {
    startOffset,
    endOffset,
    quote: normalized.slice(startOffset, endOffset),
  }
}

export function sourceRangeToRows(
  rows: MappedRow[],
  startOffset: number,
  endOffset: number,
): { rowIndex: number; from: number; to: number }[] {
  const spans: { rowIndex: number; from: number; to: number }[] = []
  rows.forEach((row, rowIndex) => {
    if (row.isBlank || row.charSources.length === 0) return
    let from = -1
    let to = -1
    row.charSources.forEach((source, index) => {
      if (source >= startOffset && source < endOffset) {
        if (from < 0) from = index
        to = index + 1
      }
    })
    if (from >= 0 && to > from) spans.push({ rowIndex, from, to })
  })
  return spans
}

export function noteStatus(
  normalized: string,
  note: { startOffset: number; endOffset: number; quote: string },
  fullyLoaded: boolean,
): 'ready' | 'pending' | 'stale' {
  if (note.endOffset > normalized.length) return fullyLoaded ? 'stale' : 'pending'
  if (normalized.slice(note.startOffset, note.endOffset) !== note.quote) return 'stale'
  return 'ready'
}

export function pickNoteAtCaret<
  T extends { id: number; startOffset: number; endOffset: number; createdAt: string },
>(notes: T[], sourceOffset: number): T | null {
  const probe = (offset: number) =>
    notes
      .filter((note) => offset >= note.startOffset && offset < note.endOffset)
      .sort((a, b) => {
        const span = a.endOffset - a.startOffset - (b.endOffset - b.startOffset)
        if (span !== 0) return span
        const time = b.createdAt.localeCompare(a.createdAt)
        if (time !== 0) return time
        return b.id - a.id
      })[0] ?? null
  return probe(sourceOffset) ?? probe(sourceOffset - 1)
}
