import { onUnmounted, ref, type Ref } from 'vue'

export type VirtualTextRow = {
  text: string
  isBlank?: boolean
}

type CaretPoint = {
  rowIndex: number
  offset: number
}

export type VirtualTextSelectionRange = {
  start: CaretPoint
  end: CaretPoint
}

const MIN_SELECTION_LEN = 2
const MAX_SELECTION_LEN = 8000
const HIGHLIGHT_NAME = 'vlist-sel'
const NOTES_HIGHLIGHT_NAME = 'vlist-notes'
const NEAREST_ROW_MAX_GAP_PX = 80

export type VirtualTextClick = {
  rowIndex: number
  offset: number
  x: number
  y: number
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch)
}

/** 光标落在单词内部或右边界时，返回该词在行内的 [start, end) */
export function wordRangeAtOffset(text: string, offset: number): { start: number; end: number } | null {
  if (!text) return null

  const probes = [offset, offset - 1]
  for (const probe of probes) {
    const charIndex = probe >= text.length ? text.length - 1 : probe
    const range = wordContaining(text, charIndex)
    if (range) return range
  }
  return null
}

function wordContaining(text: string, charIndex: number): { start: number; end: number } | null {
  if (charIndex < 0 || charIndex >= text.length) return null

  const Segmenter = Intl.Segmenter
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter('zh-CN', { granularity: 'word' })
    for (const seg of segmenter.segment(text)) {
      const end = seg.index + seg.segment.length
      if (charIndex < seg.index || charIndex >= end) continue
      if (!seg.isWordLike) return null
      return { start: seg.index, end }
    }
    return null
  }

  if (!isWordChar(text[charIndex]!)) return null
  let start = charIndex
  let end = charIndex + 1
  while (start > 0 && isWordChar(text[start - 1]!)) start -= 1
  while (end < text.length && isWordChar(text[end]!)) end += 1
  return { start, end }
}

function caretFromPoint(clientX: number, clientY: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
  }

  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(clientX, clientY)
    if (range) return { node: range.startContainer, offset: range.startOffset }
  }

  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(clientX, clientY)
    if (pos) return { node: pos.offsetNode, offset: pos.offset }
  }

  return null
}

function getRowIndex(rowEl: HTMLElement): number | null {
  const raw = rowEl.dataset.index
  if (raw == null || raw === '') return null
  const idx = Number(raw)
  return Number.isFinite(idx) ? idx : null
}

function getRowTextNode(rowEl: HTMLElement): Text | null {
  if (rowEl.firstChild?.nodeType === Node.TEXT_NODE) {
    return rowEl.firstChild as Text
  }
  return null
}

function caretOffsetInRow(rowEl: HTMLElement, clientX: number, clientY: number): number {
  const caret = caretFromPoint(clientX, clientY)
  if (!caret || !rowEl.contains(caret.node)) return 0

  const range = document.createRange()
  range.selectNodeContents(rowEl)
  try {
    range.setEnd(caret.node, caret.offset)
    return range.toString().length
  } catch {
    return 0
  }
}

function compareCaret(a: CaretPoint, b: CaretPoint): number {
  if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex
  return a.offset - b.offset
}

/** 锚点固定为 pointerdown 位置；仅 focus 移动，避免末行左拖时误改首行起点 */
function rangeFromAnchorFocus(anchor: CaretPoint, focus: CaretPoint): VirtualTextSelectionRange {
  if (compareCaret(focus, anchor) >= 0) {
    return { start: { ...anchor }, end: { ...focus } }
  }
  return { start: { ...focus }, end: { ...anchor } }
}

function clampFocusToAnchor(anchor: CaretPoint, focus: CaretPoint): CaretPoint {
  if (compareCaret(focus, anchor) < 0) {
    return { ...anchor }
  }
  return focus
}

function extractTextFromRows(
  rows: VirtualTextRow[],
  start: CaretPoint,
  end: CaretPoint,
): string {
  const parts: string[] = []
  for (let i = start.rowIndex; i <= end.rowIndex; i++) {
    const row = rows[i]
    if (!row || row.isBlank) continue
    const from = i === start.rowIndex ? start.offset : 0
    const to = i === end.rowIndex ? end.offset : row.text.length
    if (from < to) parts.push(row.text.slice(from, to))
  }
  return parts.join('\n')
}

function clearNativeSelection() {
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed) sel.removeAllRanges()
}

function supportsCssHighlight(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

function buildRowSubrange(
  root: HTMLElement,
  rowIndex: number,
  from: number,
  to: number,
): Range | null {
  const rowEl = root.querySelector<HTMLElement>(`[data-index="${rowIndex}"]`)
  const textNode = rowEl ? getRowTextNode(rowEl) : null
  if (!rowEl || !textNode || from >= to) return null

  const startOffset = Math.max(0, Math.min(from, textNode.length))
  const endOffset = Math.max(startOffset, Math.min(to, textNode.length))
  if (startOffset >= endOffset) return null

  const range = document.createRange()
  try {
    range.setStart(textNode, startOffset)
    range.setEnd(textNode, endOffset)
    return range
  } catch {
    return null
  }
}

function buildSelectionRanges(
  root: HTMLElement,
  rows: VirtualTextRow[],
  range: VirtualTextSelectionRange,
): Range[] {
  const { start, end } = range
  const ranges: Range[] = []

  for (let i = start.rowIndex; i <= end.rowIndex; i++) {
    const row = rows[i]
    if (!row || row.isBlank) continue
    const from = i === start.rowIndex ? start.offset : 0
    const to = i === end.rowIndex ? end.offset : row.text.length
    const sub = buildRowSubrange(root, i, from, to)
    if (sub) ranges.push(sub)
  }

  return ranges
}

/**
 * 虚拟列表多行划词：每行 absolute 定位时浏览器原生选区无法跨行延伸，
 * 用 pointer 锚点 + CSS Highlight / 覆盖层保证连续高亮，文本 DOM 保持稳定。
 * 双击则选中光标所在单词（中英文按词切分），不进入拖拽划词。
 */
export function useVirtualTextSelection(
  scrollRef: Ref<HTMLElement | null | undefined>,
  rowsRef: Ref<VirtualTextRow[]>,
) {
  const selectedText = ref('')
  const selectionRange = ref<VirtualTextSelectionRange | null>(null)
  const lastClick = ref<VirtualTextClick | null>(null)
  let noteRanges: VirtualTextSelectionRange[] = []
  let isPointerDown = false
  let anchor: CaretPoint | null = null
  let lastValidFocus: CaretPoint | null = null
  let overlayEl: HTMLElement | null = null
  /** pointerdown 里 preventDefault 会让浏览器不再累计 detail，双击要自己记 */
  const DBLCLICK_MS = 500
  const DBLCLICK_SLOP_PX = 8
  let lastClickAt = 0
  let lastClickX = 0
  let lastClickY = 0
  let downX = 0
  let downY = 0
  let pointerMoved = false

  function getRoot(): HTMLElement | null {
    return scrollRef.value ?? null
  }

  function getInnerRoot(): HTMLElement | null {
    return getRoot()?.querySelector<HTMLElement>('.vlist-inner') ?? null
  }

  function ensureOverlay(): HTMLElement | null {
    const inner = getInnerRoot()
    if (!inner) return null

    if (!overlayEl || overlayEl.parentElement !== inner) {
      overlayEl?.remove()
      overlayEl = document.createElement('div')
      overlayEl.className = 'vlist-selection-overlay'
      inner.appendChild(overlayEl)
    }

    return overlayEl
  }

  function clearVisualHighlight() {
    if (supportsCssHighlight()) {
      CSS.highlights.delete(HIGHLIGHT_NAME)
    }
    overlayEl?.replaceChildren()
  }

  function applyStoredNoteHighlights() {
    if (!supportsCssHighlight()) return
    if (noteRanges.length === 0) {
      CSS.highlights.delete(NOTES_HIGHLIGHT_NAME)
      return
    }
    const root = getRoot()
    if (!root) return
    const ranges: Range[] = []
    for (const range of noteRanges) {
      ranges.push(...buildSelectionRanges(root, rowsRef.value, range))
    }
    if (ranges.length === 0) return
    CSS.highlights.set(NOTES_HIGHLIGHT_NAME, new Highlight(...ranges))
  }

  function setNoteHighlights(ranges: VirtualTextSelectionRange[]) {
    noteRanges = ranges
    applyStoredNoteHighlights()
  }

  function measureSelectionRect(): DOMRect | null {
    const root = getRoot()
    const range = selectionRange.value
    if (!root || !range) return null
    const ranges = buildSelectionRanges(root, rowsRef.value, range)
    for (const item of ranges) {
      const rect = item.getBoundingClientRect()
      if (rect.width > 0 || rect.height > 0) return rect
    }
    return null
  }

  function renderOverlayRects(ranges: Range[]) {
    const overlay = ensureOverlay()
    const scrollEl = getRoot()
    if (!overlay || !scrollEl) return

    overlay.replaceChildren()
    const scrollRect = scrollEl.getBoundingClientRect()

    for (const range of ranges) {
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 0 || rect.height <= 0) continue
        const box = document.createElement('div')
        box.className = 'vlist-selection-overlay__rect'
        box.style.top = `${rect.top - scrollRect.top + scrollEl.scrollTop}px`
        box.style.left = `${rect.left - scrollRect.left + scrollEl.scrollLeft}px`
        box.style.width = `${rect.width}px`
        box.style.height = `${rect.height}px`
        overlay.appendChild(box)
      }
    }
  }

  function applyVisualHighlight(range: VirtualTextSelectionRange | null) {
    const root = getRoot()
    if (!root || !range) {
      clearVisualHighlight()
      return
    }

    const ranges = buildSelectionRanges(root, rowsRef.value, range)
    if (ranges.length === 0) {
      clearVisualHighlight()
      return
    }

    if (supportsCssHighlight()) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
      overlayEl?.replaceChildren()
      return
    }

    renderOverlayRects(ranges)
  }

  function commitSelection(focus: CaretPoint) {
    if (!anchor) return

    const clamped = clampFocusToAnchor(anchor, focus)
    const { start, end } = rangeFromAnchorFocus(anchor, clamped)
    const text = extractTextFromRows(rowsRef.value, start, end)
      .replace(/\u00a0/g, ' ')
      .trim()

    if (!text || text.length < MIN_SELECTION_LEN) {
      selectionRange.value = null
      selectedText.value = ''
      clearVisualHighlight()
      return
    }

    selectionRange.value = { start, end }
    selectedText.value = text.length > MAX_SELECTION_LEN ? text.slice(0, MAX_SELECTION_LEN) : text
    applyVisualHighlight({ start, end })
    clearNativeSelection()
  }

  function selectWordAt(rowIndex: number, offset: number) {
    const rowText = rowsRef.value[rowIndex]?.text ?? ''
    const bounds = wordRangeAtOffset(rowText, offset)

    isPointerDown = false
    anchor = null
    lastValidFocus = null

    if (!bounds) {
      selectionRange.value = null
      selectedText.value = ''
      clearVisualHighlight()
      return
    }

    const start = { rowIndex, offset: bounds.start }
    const end = { rowIndex, offset: bounds.end }
    const text = rowText.slice(bounds.start, bounds.end).replace(/\u00a0/g, ' ')
    if (!text) {
      selectionRange.value = null
      selectedText.value = ''
      clearVisualHighlight()
      return
    }

    selectionRange.value = { start, end }
    selectedText.value = text.length > MAX_SELECTION_LEN ? text.slice(0, MAX_SELECTION_LEN) : text
    applyVisualHighlight({ start, end })
    clearNativeSelection()
  }

  function findRowAtClientY(root: HTMLElement, clientY: number): HTMLElement | null {
    let best: { row: HTMLElement; index: number } | null = null

    for (const row of root.querySelectorAll<HTMLElement>('.vlist-row:not(.vlist-row--blank)')) {
      const rect = row.getBoundingClientRect()
      if (clientY < rect.top - 2 || clientY > rect.bottom + 2) continue

      const index = getRowIndex(row)
      if (index == null) continue

      if (!best || index > best.index) {
        best = { row, index }
      }
    }

    return best?.row ?? null
  }

  function offsetInRowAtX(
    rowEl: HTMLElement,
    rowIndex: number,
    clientX: number,
    clientY: number,
  ): number {
    const rowText = rowsRef.value[rowIndex]?.text ?? ''
    const rect = rowEl.getBoundingClientRect()

    if (clientX <= rect.left + 4) return 0
    if (clientX >= rect.right - 4) return rowText.length

    return Math.max(0, Math.min(caretOffsetInRow(rowEl, clientX, clientY), rowText.length))
  }

  function resolveCaretPointDirect(clientX: number, clientY: number): CaretPoint | null {
    const root = getRoot()
    if (!root) return null

    const row =
      findRowAtClientY(root, clientY) ??
      (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>(
        '.vlist-row',
      ) ??
      null

    if (!row || !root.contains(row) || row.classList.contains('vlist-row--blank')) {
      return null
    }

    const rowIndex = getRowIndex(row)
    if (rowIndex == null) return null

    return {
      rowIndex,
      offset: offsetInRowAtX(row, rowIndex, clientX, clientY),
    }
  }

  function stabilizeFocus(focus: CaretPoint, clientX: number, clientY: number): CaretPoint {
    if (!anchor || !lastValidFocus) return focus

    const root = getRoot()
    if (!root) return focus

    if (focus.rowIndex >= lastValidFocus.rowIndex) return focus

    const rowAtY = findRowAtClientY(root, clientY)
    const rowAtYIndex = rowAtY ? getRowIndex(rowAtY) : null
    if (rowAtYIndex == null) return focus

    if (rowAtYIndex >= lastValidFocus.rowIndex) {
      return {
        rowIndex: rowAtYIndex,
        offset: offsetInRowAtX(rowAtY!, rowAtYIndex, clientX, clientY),
      }
    }

    if (rowAtYIndex > anchor.rowIndex) {
      return {
        rowIndex: rowAtYIndex,
        offset: offsetInRowAtX(rowAtY!, rowAtYIndex, clientX, clientY),
      }
    }

    return focus
  }

  function resolveCaretPointNearest(clientX: number, clientY: number): CaretPoint | null {
    const root = getRoot()
    if (!root || !anchor) return null

    const rowEls = Array.from(
      root.querySelectorAll<HTMLElement>('.vlist-row:not(.vlist-row--blank)'),
    ).sort((a, b) => (getRowIndex(a) ?? 0) - (getRowIndex(b) ?? 0))

    for (let i = 0; i < rowEls.length - 1; i++) {
      const upper = rowEls[i]!
      const lower = rowEls[i + 1]!
      const upperRect = upper.getBoundingClientRect()
      const lowerRect = lower.getBoundingClientRect()
      if (clientY > upperRect.bottom && clientY < lowerRect.top) {
        const upperIndex = getRowIndex(upper)
        const lowerIndex = getRowIndex(lower)
        if (upperIndex == null || lowerIndex == null) break

        if (anchor.rowIndex <= upperIndex) {
          return { rowIndex: lowerIndex, offset: 0 }
        }
        if (anchor.rowIndex >= lowerIndex) {
          const upperText = rowsRef.value[upperIndex]?.text ?? ''
          return { rowIndex: upperIndex, offset: upperText.length }
        }
      }
    }

    let best: { row: HTMLElement; dist: number } | null = null

    for (const row of rowEls) {
      const rect = row.getBoundingClientRect()
      const dist =
        clientY < rect.top
          ? rect.top - clientY
          : clientY > rect.bottom
            ? clientY - rect.bottom
            : 0
      if (!best || dist < best.dist) best = { row, dist }
    }

    if (!best || best.dist > NEAREST_ROW_MAX_GAP_PX) return null

    const rowIndex = getRowIndex(best.row)
    if (rowIndex == null) return null

    return {
      rowIndex,
      offset: offsetInRowAtX(best.row, rowIndex, clientX, clientY),
    }
  }

  function resolveCaretPoint(clientX: number, clientY: number): CaretPoint | null {
    const raw = resolveCaretPointDirect(clientX, clientY) ?? resolveCaretPointNearest(clientX, clientY)
    if (!raw) return null
    return stabilizeFocus(raw, clientX, clientY)
  }

  function releasePointerCapture(pointerId: number) {
    const root = getRoot()
    if (!root?.hasPointerCapture(pointerId)) return
    try {
      root.releasePointerCapture(pointerId)
    } catch {
      /* ignore */
    }
  }

  function onPointerDown(ev: PointerEvent) {
    if (ev.button !== 0) return
    const root = getRoot()
    if (!root) return

    const row = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.vlist-row')
    if (!row || !root.contains(row) || row.classList.contains('vlist-row--blank')) return

    const rowIndex = getRowIndex(row)
    if (rowIndex == null) return

    ev.preventDefault()

    const offset = offsetInRowAtX(row, rowIndex, ev.clientX, ev.clientY)
    const now = performance.now()
    const isDoubleClick =
      now - lastClickAt <= DBLCLICK_MS &&
      Math.hypot(ev.clientX - lastClickX, ev.clientY - lastClickY) <= DBLCLICK_SLOP_PX
    pointerMoved = false
    downX = ev.clientX
    downY = ev.clientY
    if (isDoubleClick) {
      lastClickAt = 0
      selectWordAt(rowIndex, offset)
      return
    }

    isPointerDown = true
    anchor = {
      rowIndex,
      offset,
    }
    lastValidFocus = { ...anchor }

    try {
      root.setPointerCapture(ev.pointerId)
    } catch {
      /* ignore */
    }

    clearNativeSelection()
    commitSelection(anchor)
  }

  function onDocumentPointerMove(ev: PointerEvent) {
    if (!isPointerDown || !anchor) return
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > DBLCLICK_SLOP_PX) {
      pointerMoved = true
    }
    ev.preventDefault()

    const focus = resolveCaretPoint(ev.clientX, ev.clientY)
    if (!focus) return
    lastValidFocus = { ...focus }
    commitSelection(focus)
  }

  function onDocumentPointerUp(ev: PointerEvent) {
    if (!isPointerDown) return
    isPointerDown = false
    releasePointerCapture(ev.pointerId)
    if (!pointerMoved && anchor) {
      lastClick.value = { ...anchor, x: ev.clientX, y: ev.clientY }
    } else {
      lastClick.value = null
    }
    anchor = null
    lastValidFocus = null
    if (!pointerMoved) {
      lastClickAt = performance.now()
      lastClickX = downX
      lastClickY = downY
    } else {
      lastClickAt = 0
    }
    clearNativeSelection()
  }

  function onSelectStart(ev: Event) {
    if (!isPointerDown) return
    ev.preventDefault()
  }

  function onCopy(ev: ClipboardEvent) {
    const text = selectedText.value
    if (!text) return
    ev.preventDefault()
    ev.clipboardData?.setData('text/plain', text)
  }

  function onScrollReposition() {
    if (selectionRange.value) applyVisualHighlight(selectionRange.value)
    applyStoredNoteHighlights()
  }

  function attachSelectionListeners() {
    detachSelectionListeners()
    const root = getRoot()
    if (!root) return

    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('copy', onCopy)
    root.addEventListener('selectstart', onSelectStart)
    root.addEventListener('scroll', onScrollReposition, { passive: true })
    document.addEventListener('pointermove', onDocumentPointerMove)
    document.addEventListener('pointerup', onDocumentPointerUp)
    document.addEventListener('pointercancel', onDocumentPointerUp)
  }

  function detachSelectionListeners() {
    const root = getRoot()
    if (root) {
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('copy', onCopy)
      root.removeEventListener('selectstart', onSelectStart)
      root.removeEventListener('scroll', onScrollReposition)
    }
    document.removeEventListener('pointermove', onDocumentPointerMove)
    document.removeEventListener('pointerup', onDocumentPointerUp)
    document.removeEventListener('pointercancel', onDocumentPointerUp)
    isPointerDown = false
    anchor = null
    lastValidFocus = null
  }

  function clearSelection() {
    selectedText.value = ''
    selectionRange.value = null
    anchor = null
    lastValidFocus = null
    isPointerDown = false
    clearVisualHighlight()
    clearNativeSelection()
  }

  onUnmounted(() => {
    detachSelectionListeners()
    overlayEl?.remove()
    overlayEl = null
    clearVisualHighlight()
    if (supportsCssHighlight()) CSS.highlights.delete(NOTES_HIGHLIGHT_NAME)
  })

  return {
    selectedText,
    selectionRange,
    lastClick,
    attachSelectionListeners,
    detachSelectionListeners,
    clearSelection,
    setNoteHighlights,
    measureSelectionRect,
    refreshVisualHighlight: () => {
      if (selectionRange.value) applyVisualHighlight(selectionRange.value)
      applyStoredNoteHighlights()
    },
  }
}
