import { ref, type Ref } from 'vue'
import { wordRangeAtOffset } from '@/composables/useVirtualTextSelection'

const MIN_SELECTION_LEN = 2
const MAX_SELECTION_LEN = 8000
const HIGHLIGHT_CLASS = 'pdf-selection-highlight-rect'
const SAME_LINE_THRESHOLD_PX = 8

type ClientPoint = { x: number; y: number }

type TextItem = {
  str: string
  transform: number[]
  width: number
  height: number
}

type ViewportLike = {
  scale: number
  width: number
  height: number
  convertToViewportRectangle: (rect: number[]) => number[]
}

type TextLayerData = {
  el: HTMLElement
  items: TextItem[]
  viewport: ViewportLike
  /** 每个 item 在 viewport 坐标系下的包围盒 */
  rects: DOMRect[]
  /** item 所属的 pageInner */
  pageInner: HTMLElement
}

type SelectionPart = {
  data: TextLayerData
  itemIdx: number
  start: number
  end: number
  /** 高亮矩形（相对 pageInner） */
  rect: { left: number; top: number; right: number; bottom: number }
}

/** 阅读顺序中的一个字符光标（落在某个 text item 内） */
type TextCaret = {
  data: TextLayerData
  itemIdx: number
  /** 在 flatten 列表中的序号，用于比较先后 */
  order: number
  offset: number
}

type FlatItem = {
  data: TextLayerData
  itemIdx: number
  order: number
}

function normalizeSelectedText(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function clearHighlightLayers(root: HTMLElement) {
  root.querySelectorAll('.selection-highlight-layer').forEach((layer) => {
    layer.replaceChildren()
  })
}

function dragDistance(a: ClientPoint, b: ClientPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** 从 textLayer 元素上读取 pdf.js 原始数据，计算每个 text item 的 viewport 坐标 */
function buildTextLayerData(textLayerEl: HTMLElement, root: HTMLElement): TextLayerData | null {
  const host = textLayerEl as HTMLElement & {
    __pdfTextItems?: TextItem[]
    __pdfViewport?: ViewportLike
  }
  const items = host.__pdfTextItems
  const viewport = host.__pdfViewport
  if (!items?.length || !viewport) return null

  const pageInner = textLayerEl.closest('.pdf-page-inner') as HTMLElement | null
  if (!pageInner || !root.contains(pageInner)) return null

  const rects: DOMRect[] = items.map((item) => {
    if (!item.str || !item.transform) return new DOMRect()
    const t = item.transform
    const tx = t[4] ?? 0
    const ty = t[5] ?? 0
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
      tx,
      ty,
      tx + item.width,
      ty + item.height,
    ])
    const left = Math.min(x1 ?? 0, x2 ?? 0)
    const top = Math.min(y1 ?? 0, y2 ?? 0)
    const right = Math.max(x1 ?? 0, x2 ?? 0)
    const bottom = Math.max(y1 ?? 0, y2 ?? 0)
    return new DOMRect(left, top, right - left, bottom - top)
  })

  return { el: textLayerEl, items, viewport, rects, pageInner }
}

/** 收集 root 下所有已渲染的 textLayer 数据 */
function collectAllTextLayers(root: HTMLElement): TextLayerData[] {
  const results: TextLayerData[] = []
  for (const el of root.querySelectorAll('.textLayer')) {
    const data = buildTextLayerData(el as HTMLElement, root)
    if (data) results.push(data)
  }
  return results
}

function sortTextLayerData(allData: TextLayerData[]): TextLayerData[] {
  return [...allData].sort((a, b) => {
    const ra = a.pageInner.getBoundingClientRect()
    const rb = b.pageInner.getBoundingClientRect()
    return ra.top - rb.top
  })
}

function compareItemsOnPage(data: TextLayerData, a: number, b: number): number {
  const ra = data.rects[a]!
  const rb = data.rects[b]!
  const dy = ra.top - rb.top
  if (Math.abs(dy) > SAME_LINE_THRESHOLD_PX) return dy
  return ra.left - rb.left
}

/** 按阅读顺序展平所有 text item（跨页） */
function flattenReadingOrder(allData: TextLayerData[]): FlatItem[] {
  const pages = sortTextLayerData(allData)
  const flat: FlatItem[] = []
  let order = 0
  for (const data of pages) {
    const indices: number[] = []
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]!
      const r = data.rects[i]!
      if (!item.str || r.width <= 0 || r.height <= 0) continue
      indices.push(i)
    }
    indices.sort((a, b) => compareItemsOnPage(data, a, b))
    for (const itemIdx of indices) {
      flat.push({ data, itemIdx, order: order++ })
    }
  }
  return flat
}

function compareCarets(a: TextCaret, b: TextCaret): number {
  if (a.order !== b.order) return a.order - b.order
  return a.offset - b.offset
}

/** 用 item 的 viewport 宽度做线性映射（PDF text item 内字符等宽近似） */
function charOffsetAtX(itemRect: DOMRect, clientXInPage: number, text: string): number {
  if (!text.length) return 0
  if (itemRect.width <= 0) return 0
  if (clientXInPage <= itemRect.left) return 0
  if (clientXInPage >= itemRect.right) return text.length
  const ratio = (clientXInPage - itemRect.left) / itemRect.width
  const clamped = Math.max(0, Math.min(1, ratio))
  return Math.max(0, Math.min(text.length, Math.round(clamped * text.length)))
}

function screenRectForItem(data: TextLayerData, itemIdx: number) {
  const pageRect = data.pageInner.getBoundingClientRect()
  const r = data.rects[itemIdx]!
  return {
    left: r.left + pageRect.left,
    right: r.right + pageRect.left,
    top: r.top + pageRect.top,
    bottom: r.bottom + pageRect.top,
    pageLeft: pageRect.left,
  }
}

/**
 * 把指针映射到最近的阅读光标。
 * 优先同一行（纵向距离小），再按水平位置取字符偏移。
 */
function caretFromPoint(flat: FlatItem[], point: ClientPoint): TextCaret | null {
  if (flat.length === 0) return null

  let best: FlatItem | null = null
  let bestScore = Infinity

  for (const entry of flat) {
    const s = screenRectForItem(entry.data, entry.itemIdx)
    let vDist = 0
    if (point.y < s.top) vDist = s.top - point.y
    else if (point.y > s.bottom) vDist = point.y - s.bottom

    let hDist = 0
    if (point.x < s.left) hDist = s.left - point.x
    else if (point.x > s.right) hDist = point.x - s.right

    // 纵向权重大：保证落在「当前行」，避免窜到上下行
    const score = vDist * 10_000 + hDist
    if (score < bestScore) {
      bestScore = score
      best = entry
    }
  }

  if (!best) return null

  const r = best.data.rects[best.itemIdx]!
  const pageRect = best.data.pageInner.getBoundingClientRect()
  const text = best.data.items[best.itemIdx]!.str
  const offset = charOffsetAtX(r, point.x - pageRect.left, text)

  return {
    data: best.data,
    itemIdx: best.itemIdx,
    order: best.order,
    offset,
  }
}

function partialItemRect(
  r: DOMRect,
  text: string,
  start: number,
  end: number,
): { left: number; top: number; right: number; bottom: number } {
  const len = Math.max(text.length, 1)
  const left = r.left + (start / len) * r.width
  const right = r.left + (end / len) * r.width
  return {
    left: Math.min(left, right),
    top: r.top,
    right: Math.max(left, right),
    bottom: r.bottom,
  }
}

/**
 * 原生划词语义：从起点光标到终点光标的阅读区间。
 * 中间行整行选中；只有首尾 item 按字符裁剪。
 * （旧实现用对角 AABB，回拖缩短右边界时会误伤前面行。）
 */
function buildSelectionPartsFromCarets(
  flat: FlatItem[],
  anchor: TextCaret,
  focus: TextCaret,
): SelectionPart[] {
  let start = anchor
  let end = focus
  if (compareCarets(start, end) > 0) {
    start = focus
    end = anchor
  }

  const parts: SelectionPart[] = []
  for (const entry of flat) {
    if (entry.order < start.order || entry.order > end.order) continue

    const item = entry.data.items[entry.itemIdx]!
    const r = entry.data.rects[entry.itemIdx]!
    let from = 0
    let to = item.str.length

    if (entry.order === start.order) from = start.offset
    if (entry.order === end.order) to = end.offset

    from = Math.max(0, Math.min(from, item.str.length))
    to = Math.max(from, Math.min(to, item.str.length))
    if (to <= from) continue

    parts.push({
      data: entry.data,
      itemIdx: entry.itemIdx,
      start: from,
      end: to,
      rect: partialItemRect(r, item.str, from, to),
    })
  }

  return parts
}

function joinSelectionParts(parts: SelectionPart[]): string {
  if (parts.length === 0) return ''

  const sorted = [...parts].sort((a, b) => {
    const pa = a.data.pageInner.getBoundingClientRect()
    const pb = b.data.pageInner.getBoundingClientRect()
    if (Math.abs(pa.top - pb.top) > SAME_LINE_THRESHOLD_PX) return pa.top - pb.top
    const ra = a.data.rects[a.itemIdx]!
    const rb = b.data.rects[b.itemIdx]!
    const dy = ra.top - rb.top
    if (Math.abs(dy) > SAME_LINE_THRESHOLD_PX) return dy
    return ra.left - rb.left
  })

  const lineTexts: string[] = []
  let currentTop = -Infinity
  let currentText = ''
  let prevRight = -Infinity
  let prevHeight = 0
  let prevSliceEnd = ''

  for (const part of sorted) {
    const r = part.data.rects[part.itemIdx]!
    const slice = part.data.items[part.itemIdx]!.str.slice(part.start, part.end)

    if (Math.abs(r.top - currentTop) > SAME_LINE_THRESHOLD_PX) {
      if (currentText) lineTexts.push(normalizeSelectedText(currentText))
      currentText = slice
      currentTop = r.top
      prevRight = r.right
      prevHeight = r.height
      prevSliceEnd = slice
    } else {
      const gap = r.left - prevRight
      const heightRef = Math.max(prevHeight, r.height, 1)
      const alreadyHasSpace = prevSliceEnd.endsWith(' ') || slice.startsWith(' ')
      const needsSpace = gap > heightRef * 0.15 && !alreadyHasSpace
      currentText += needsSpace ? ' ' + slice : slice
      prevRight = Math.max(prevRight, r.right)
      prevHeight = r.height || prevHeight
      prevSliceEnd = slice
    }
  }
  if (currentText) lineTexts.push(normalizeSelectedText(currentText))

  return lineTexts.join(' ')
}

type LineChar = { entry: FlatItem; offset: number }

/** 同一行上的 text item 拼成字符串，双击时按词边界切，再映射回各 item */
function wordPartsAtCaret(flat: FlatItem[], caret: TextCaret): SelectionPart[] | null {
  const caretRect = caret.data.rects[caret.itemIdx]!
  const line = flat.filter((entry) => {
    if (entry.data.pageInner !== caret.data.pageInner) return false
    const rect = entry.data.rects[entry.itemIdx]!
    return Math.abs(rect.top - caretRect.top) <= SAME_LINE_THRESHOLD_PX
  })
  if (line.length === 0) return null

  const maps: Array<LineChar | null> = []
  let text = ''
  let caretCharIndex = caret.offset
  let prevRight = -Infinity
  let prevHeight = 0
  let prevEndedWithSpace = false

  for (const entry of line) {
    const item = entry.data.items[entry.itemIdx]!
    const rect = entry.data.rects[entry.itemIdx]!
    const gap = text.length === 0 ? 0 : rect.left - prevRight
    const heightRef = Math.max(prevHeight, rect.height, 1)
    const needsSpace =
      text.length > 0 &&
      gap > heightRef * 0.15 &&
      !prevEndedWithSpace &&
      !item.str.startsWith(' ')

    if (needsSpace) {
      text += ' '
      maps.push(null)
    }
    if (entry.order === caret.order) {
      caretCharIndex = text.length + Math.min(caret.offset, item.str.length)
    }
    for (let i = 0; i < item.str.length; i++) {
      maps.push({ entry, offset: i })
    }
    text += item.str
    prevRight = rect.right
    prevHeight = rect.height || prevHeight
    prevEndedWithSpace = item.str.endsWith(' ')
  }

  const bounds = wordRangeAtOffset(text, caretCharIndex)
  if (!bounds) return null

  const parts: SelectionPart[] = []
  let current: SelectionPart | null = null
  for (let i = bounds.start; i < bounds.end; i++) {
    const mapped = maps[i]
    if (!mapped) continue
    const item = mapped.entry.data.items[mapped.entry.itemIdx]!
    const rect = mapped.entry.data.rects[mapped.entry.itemIdx]!
    if (
      current &&
      current.data === mapped.entry.data &&
      current.itemIdx === mapped.entry.itemIdx &&
      current.end === mapped.offset
    ) {
      current.end = mapped.offset + 1
      current.rect = partialItemRect(rect, item.str, current.start, current.end)
      continue
    }
    current = {
      data: mapped.entry.data,
      itemIdx: mapped.entry.itemIdx,
      start: mapped.offset,
      end: mapped.offset + 1,
      rect: partialItemRect(rect, item.str, mapped.offset, mapped.offset + 1),
    }
    parts.push(current)
  }

  return parts.length > 0 ? parts : null
}

function paintSelectionHighlights(root: HTMLElement, parts: SelectionPart[]) {
  clearHighlightLayers(root)
  if (parts.length === 0) return

  for (const part of parts) {
    const highlightLayer = part.data.pageInner.querySelector<HTMLElement>(
      '.selection-highlight-layer',
    )
    if (!highlightLayer) continue

    const div = document.createElement('div')
    div.className = HIGHLIGHT_CLASS
    div.style.left = `${part.rect.left}px`
    div.style.top = `${part.rect.top}px`
    div.style.width = `${part.rect.right - part.rect.left}px`
    div.style.height = `${part.rect.bottom - part.rect.top}px`
    highlightLayer.appendChild(div)
  }
}

/**
 * PDF 划词：直接用 pdf.js getTextContent() 的原始坐标做命中测试，
 * 绕过 DOM text layer 的 scaleX 变换问题。
 * 高亮和文本都从同一个 text item 数据生成，天然一致。
 * 双击选中光标所在单词，规则与文本预览一致。
 */
export function usePdfTextSelection(scrollRef: Ref<HTMLElement | null | undefined>) {
  const selectedText = ref('')
  let isPointerDown = false
  let anchorPoint: ClientPoint | null = null
  let activeParts: SelectionPart[] = []
  let hasMeaningfulDrag = false
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

  function clearSelection() {
    selectedText.value = ''
    activeParts = []
    anchorPoint = null
    hasMeaningfulDrag = false
    const root = getRoot()
    if (root) clearHighlightLayers(root)
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) sel.removeAllRanges()
  }

  function applyParts(parts: SelectionPart[], minLen = MIN_SELECTION_LEN): string {
    const root = getRoot()
    if (!root) return ''

    activeParts = parts
    paintSelectionHighlights(root, parts)

    const text = joinSelectionParts(parts)
    if (!text || text.length < minLen) {
      selectedText.value = ''
      return ''
    }
    const clipped = text.length > MAX_SELECTION_LEN ? text.slice(0, MAX_SELECTION_LEN) : text
    selectedText.value = clipped
    return clipped
  }

  function updateDragSelection(point: ClientPoint) {
    if (!anchorPoint) return
    const root = getRoot()
    if (!root) return

    if (!hasMeaningfulDrag && dragDistance(anchorPoint, point) < 4) {
      activeParts = []
      clearHighlightLayers(root)
      if (!isPointerDown) selectedText.value = ''
      return
    }

    hasMeaningfulDrag = true
    const flat = flattenReadingOrder(collectAllTextLayers(root))
    const anchorCaret = caretFromPoint(flat, anchorPoint)
    const focusCaret = caretFromPoint(flat, point)
    if (!anchorCaret || !focusCaret) {
      applyParts([])
      return
    }
    const parts = buildSelectionPartsFromCarets(flat, anchorCaret, focusCaret)
    applyParts(parts)
  }

  function selectWordAt(point: ClientPoint) {
    isPointerDown = false
    anchorPoint = null
    hasMeaningfulDrag = false
    const root = getRoot()
    if (!root) return

    const flat = flattenReadingOrder(collectAllTextLayers(root))
    const caret = caretFromPoint(flat, point)
    if (!caret) {
      applyParts([])
      return
    }
    applyParts(wordPartsAtCaret(flat, caret) ?? [], 1)
  }

  function onDocumentPointerMove(ev: PointerEvent) {
    if (!isPointerDown) return
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > DBLCLICK_SLOP_PX) {
      pointerMoved = true
    }
    updateDragSelection({ x: ev.clientX, y: ev.clientY })
  }

  function onDocumentPointerUp(ev: PointerEvent) {
    if (!isPointerDown) return
    isPointerDown = false
    updateDragSelection({ x: ev.clientX, y: ev.clientY })
    anchorPoint = null
    hasMeaningfulDrag = false
    if (!pointerMoved) {
      lastClickAt = performance.now()
      lastClickX = downX
      lastClickY = downY
    } else {
      lastClickAt = 0
    }
  }

  function onPointerDown(ev: PointerEvent) {
    if (ev.button !== 0) return
    const root = getRoot()
    if (!root) return

    const textLayer = (ev.target as HTMLElement | null)?.closest('.textLayer')
    if (!textLayer || !root.contains(textLayer)) return

    ev.preventDefault()
    const sel = window.getSelection()
    if (sel) sel.removeAllRanges()

    const now = performance.now()
    const isDoubleClick =
      now - lastClickAt <= DBLCLICK_MS &&
      Math.hypot(ev.clientX - lastClickX, ev.clientY - lastClickY) <= DBLCLICK_SLOP_PX
    pointerMoved = false
    downX = ev.clientX
    downY = ev.clientY
    if (isDoubleClick) {
      lastClickAt = 0
      selectWordAt({ x: ev.clientX, y: ev.clientY })
      return
    }

    isPointerDown = true
    hasMeaningfulDrag = false
    anchorPoint = { x: ev.clientX, y: ev.clientY }
    activeParts = []

    clearHighlightLayers(root)
    selectedText.value = ''
  }

  function attachSelectionListeners() {
    detachSelectionListeners()
    const root = getRoot()
    if (!root) return

    root.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onDocumentPointerMove)
    document.addEventListener('pointerup', onDocumentPointerUp)
    document.addEventListener('pointercancel', onDocumentPointerUp)
  }

  function detachSelectionListeners() {
    const root = getRoot()
    if (root) {
      root.removeEventListener('pointerdown', onPointerDown)
    }
    document.removeEventListener('pointermove', onDocumentPointerMove)
    document.removeEventListener('pointerup', onDocumentPointerUp)
    document.removeEventListener('pointercancel', onDocumentPointerUp)
    isPointerDown = false
    clearSelection()
  }

  function finalizeSelection(): string {
    return selectedText.value
  }

  return {
    selectedText,
    onPointerDown,
    finalizeSelection,
    clearSelection,
    attachSelectionListeners,
    detachSelectionListeners,
    MIN_SELECTION_LEN,
    MAX_SELECTION_LEN,
  }
}
