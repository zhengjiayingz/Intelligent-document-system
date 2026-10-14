<template>
  <el-dialog v-model="visible" :title="dialogTitle" class="text-chunk-preview-dialog" width="min(96vw, 1280px)"
    top="3vh" destroy-on-close @open="onOpen" @opened="onDialogOpened" @closed="reset">
    <div class="preview-split">
      <section class="preview-split__left">
        <p class="hint-line">{{ t('preview.textChunkBytesHint') }}</p>
        <p v-if="totalSize > 0" class="meta-line">
          {{
            t('preview.textChunkProgress', {
              loaded: nextOffset,
              total: totalSize
            })
          }}
        </p>
        <div class="text-chunk-options">
          <el-checkbox v-model="reflowForReading" :disabled="initialLoading">
            {{ t('preview.textChunkReflow') }}
          </el-checkbox>
        </div>
        <div ref="scrollRef" v-loading="initialLoading" class="text-chunk-scroll" @scroll.passive="onScroll">
          <div v-if="!initialLoading" class="vlist-inner" :style="{
            height: `${vTotalSize}px`,
            position: 'relative',
            width: '100%'
          }">
            <div v-for="v in virtualItems" :key="String(v.key)" :data-index="v.index" :ref="onRowRef" class="vlist-row"
              :class="{
                'vlist-row--para-indent': !!displayRows[v.index]?.indentFirstLine,
                'vlist-row--blank': !!displayRows[v.index]?.isBlank
              }" :style="{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                width: 'auto',
                transform: `translateY(${v.start}px)`
              }">
              {{ displayRows[v.index]?.text ?? '' }}
            </div>
          </div>
          <div v-if="appending && !initialLoading" class="vlist-appending">…</div>
        </div>
        <div v-if="loadError" class="err-line">{{ loadError }}</div>
        <p v-else-if="done && !initialLoading" class="end-line">{{ t('preview.textChunkEnd') }}</p>
        <div class="footer-actions">
          <el-button v-if="!done && !loadingMore && !initialLoading" type="primary" plain @click="loadNext">
            {{ t('preview.textChunkLoadMore') }}
          </el-button>
        </div>
        <div v-if="visible && popoverPos" class="text-note-popover" :style="{ top: `${popoverPos.top}px`, left: `${popoverPos.left}px` }"
          @pointerdown.stop>
          <el-button v-if="selectionRange && !noteCard" size="small" type="primary" @click="openCreateCard">
            {{ t('preview.textNoteAdd') }}
          </el-button>
          <div v-else-if="noteCard" class="text-note-card">
            <p v-if="openNoteStale" class="text-note-stale">{{ t('preview.textNoteStale') }}</p>
            <el-input v-model="noteDraft" type="textarea" :rows="3" maxlength="2000"
              :placeholder="t('preview.textNotePlaceholder')" />
            <div class="text-note-card__actions">
              <el-button v-if="noteCard.mode === 'edit'" size="small" type="danger" plain :disabled="saving"
                @click="deleteOpenNote">
                {{ t('preview.textNoteDelete') }}
              </el-button>
              <el-button size="small" :disabled="saving" @click="closeNoteCard">
                {{ t('common.cancel') }}
              </el-button>
              <el-button size="small" type="primary" :loading="saving" @click="saveNote">
                {{ t('preview.textNoteSave') }}
              </el-button>
            </div>
          </div>
        </div>
      </section>

      <section class="preview-split__right">
        <DocumentAiPanel ref="aiPanelRef" :file-id="fileId" :file-name="fileName"
          v-model:selected-text="selectedText" />
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { ElMessage } from 'element-plus'
import fileApiService, { type FileTextNote } from '@api/file'
import DocumentAiPanel from '@components/DocumentAiPanel/index.vue'
import {
  useVirtualTextSelection,
  type VirtualTextSelectionRange,
} from '@/composables/useVirtualTextSelection'
import {
  buildMappedRows,
  caretToSource,
  normalizeNewlines,
  noteAnchorFromSelection,
  noteStatus,
  pickNoteAtCaret,
  sourceRangeToRows,
} from '@/utils/textNoteAnchor'

const CHUNK_BYTES = 256 * 1024

const props = defineProps<{
  modelValue: boolean
  fileId: number
  fileName?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
}>()

const { t } = useI18n()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const dialogTitle = computed(() =>
  props.fileName ? `${t('preview.textChunkTitle')} - ${props.fileName}` : t('preview.textChunkTitle')
)

/** 已顺序拼接的已加载原文（分块接口保证字节顺序，直接 += 与纸面折行/跨块一致） */
const rawText = ref('')
/** 为 true 时按空行分段后合并段内换行，适合纸宽排版的小说；为 false 时与文件换行一致 */
const reflowForReading = ref(true)

const normalizedText = computed(() => normalizeNewlines(rawText.value))
const mappedRows = computed(() => buildMappedRows(normalizedText.value, reflowForReading.value))
/** 展示行；indentFirstLine 仅对自然段首行（2 字）缩进，超长段 4k 续块不缩进 */
const displayRows = computed(() => mappedRows.value)

const nextOffset = ref(0)
const totalSize = ref(0)
const done = ref(false)
const initialLoading = ref(false)
const loadingMore = ref(false)
const appending = ref(false)
const loadError = ref('')
const scrollRef = ref<HTMLElement | null>(null)
const fileEncoding = ref<'utf-8' | 'gb18030' | undefined>(undefined)
const aiPanelRef = ref<InstanceType<typeof DocumentAiPanel> | null>(null)
const notes = ref<FileTextNote[]>([])
const noteDraft = ref('')
const noteCard = ref<{ mode: 'create' } | { mode: 'edit'; id: number } | null>(null)
const popoverPos = ref<{ top: number; left: number } | null>(null)
const saving = ref(false)
let noteLoadGen = 0

const {
  selectedText,
  selectionRange,
  lastClick,
  attachSelectionListeners,
  detachSelectionListeners,
  clearSelection,
  refreshVisualHighlight,
  setNoteHighlights,
  measureSelectionRects,
} = useVirtualTextSelection(scrollRef, displayRows)

const readyNotes = computed(() =>
  notes.value.filter((note) => noteStatus(normalizedText.value, note, done.value) === 'ready'),
)

const openNoteStale = computed(() => {
  const card = noteCard.value
  if (card?.mode !== 'edit') return false
  const note = notes.value.find((item) => item.id === card.id)
  if (!note) return false
  return noteStatus(normalizedText.value, note, done.value) === 'stale'
})

function highlightRangesForNote(startOffset: number, endOffset: number): VirtualTextSelectionRange[] {
  const spans = sourceRangeToRows(mappedRows.value, startOffset, endOffset)
  if (spans.length === 0) return []
  const first = spans[0]!
  const last = spans[spans.length - 1]!
  return [
    {
      start: { rowIndex: first.rowIndex, offset: first.from },
      end: { rowIndex: last.rowIndex, offset: last.to },
    },
  ]
}

const noteHighlightRanges = computed(() =>
  readyNotes.value.flatMap((note) => highlightRangesForNote(note.startOffset, note.endOffset)),
)

const POPOVER_MARGIN = 8

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right
}

function placeInPane(x: number, y: number, pane: DOMRect) {
  const card = !!noteCard.value
  const width = card ? 260 : 108
  const height = card ? 200 : 32
  const minLeft = pane.left + POPOVER_MARGIN
  const maxLeft = Math.max(minLeft, pane.right - width - POPOVER_MARGIN)
  const left = Math.min(Math.max(minLeft, x), maxLeft)
  let top = y + POPOVER_MARGIN
  const minTop = pane.top + POPOVER_MARGIN
  const maxTop = Math.max(minTop, pane.bottom - height - POPOVER_MARGIN)
  if (top + height > pane.bottom - POPOVER_MARGIN) top = y - height - POPOVER_MARGIN
  top = Math.min(Math.max(minTop, top), maxTop)
  return { top, left }
}

function selectionAnchor(pane: DOMRect): { x: number; y: number } | null {
  for (const rect of measureSelectionRects()) {
    if (!rectsIntersect(rect, pane)) continue
    return {
      x: Math.max(rect.left, pane.left),
      y: Math.min(rect.bottom, pane.bottom),
    }
  }
  return null
}

function editAnchor(pane: DOMRect): { x: number; y: number } | null {
  const card = noteCard.value
  const root = scrollRef.value
  if (card?.mode !== 'edit' || !root) return null
  const note = notes.value.find((item) => item.id === card.id)
  if (!note) return null
  const spans = sourceRangeToRows(mappedRows.value, note.startOffset, note.endOffset)
  for (const span of spans) {
    const rowEl = root.querySelector<HTMLElement>(`[data-index="${span.rowIndex}"]`)
    if (!rowEl) continue
    const rect = rowEl.getBoundingClientRect()
    if (!rectsIntersect(rect, pane)) continue
    return {
      x: Math.max(rect.left, pane.left),
      y: Math.min(rect.bottom, pane.bottom),
    }
  }
  return null
}

function syncPopover() {
  const pane = scrollRef.value?.getBoundingClientRect()
  if (!pane) {
    popoverPos.value = null
    return
  }
  const point =
    noteCard.value?.mode === 'edit'
      ? editAnchor(pane)
      : noteCard.value?.mode === 'create' || selectionRange.value
        ? selectionAnchor(pane)
        : null
  popoverPos.value = point ? placeInPane(point.x, point.y, pane) : null
}

function closeNoteCard() {
  noteCard.value = null
  noteDraft.value = ''
  void nextTick(() => syncPopover())
}

function openCreateCard() {
  if (!selectionRange.value) return
  noteDraft.value = ''
  noteCard.value = { mode: 'create' }
  syncPopover()
}

function draftContent(): string | null {
  const text = noteDraft.value.trim()
  return text ? text : null
}

function apiMessage(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data
    ?.message
  if (Array.isArray(message)) return message.join('，')
  return message || fallback
}

async function saveNote() {
  if (!noteCard.value || saving.value) return
  const card = noteCard.value
  const gen = noteLoadGen
  saving.value = true
  try {
    if (card.mode === 'create') {
      const range = selectionRange.value
      if (!range) {
        ElMessage.warning(t('preview.textNoteInvalid'))
        return
      }
      const anchor = noteAnchorFromSelection(normalizedText.value, mappedRows.value, range)
      if (
        anchor.startOffset >= anchor.endOffset ||
        anchor.quote.length > 8000 ||
        anchor.quote.length !== anchor.endOffset - anchor.startOffset
      ) {
        ElMessage.warning(t('preview.textNoteInvalid'))
        return
      }
      const created = await fileApiService.createTextNote(props.fileId, {
        ...anchor,
        content: draftContent(),
      })
      if (gen !== noteLoadGen) return
      notes.value = [...notes.value, created]
      clearSelection()
      closeNoteCard()
    } else {
      const updated = await fileApiService.updateTextNote(props.fileId, card.id, draftContent())
      if (gen !== noteLoadGen) return
      notes.value = notes.value.map((note) => (note.id === updated.id ? updated : note))
      closeNoteCard()
    }
  } catch (error: unknown) {
    if (gen !== noteLoadGen) return
    ElMessage.error(apiMessage(error, t('preview.textChunkError')))
  } finally {
    if (gen === noteLoadGen) saving.value = false
  }
}

async function deleteOpenNote() {
  if (noteCard.value?.mode !== 'edit' || saving.value) return
  const noteId = noteCard.value.id
  const gen = noteLoadGen
  saving.value = true
  try {
    await fileApiService.deleteTextNote(props.fileId, noteId)
    if (gen !== noteLoadGen) return
    notes.value = notes.value.filter((note) => note.id !== noteId)
    closeNoteCard()
  } catch (error: unknown) {
    if (gen !== noteLoadGen) return
    ElMessage.error(apiMessage(error, t('preview.textChunkError')))
  } finally {
    if (gen === noteLoadGen) saving.value = false
  }
}

watch(noteHighlightRanges, (ranges) => {
  setNoteHighlights(ranges)
}, { flush: 'post' })

watch(selectionRange, (range) => {
  if (range && noteCard.value?.mode === 'edit') closeNoteCard()
  if (!range && noteCard.value?.mode === 'create') closeNoteCard()
  void nextTick(() => syncPopover())
})

watch(lastClick, (click) => {
  if (!click) return
  const row = mappedRows.value[click.rowIndex]
  if (!row) {
    if (noteCard.value?.mode === 'edit') closeNoteCard()
    return
  }
  const source = caretToSource(row, click.offset)
  const hit = pickNoteAtCaret(readyNotes.value, source)
  if (!hit) {
    if (noteCard.value?.mode === 'edit') closeNoteCard()
    else if (noteCard.value?.mode === 'create' && !selectionRange.value) closeNoteCard()
    return
  }
  clearSelection()
  noteDraft.value = hit.content ?? ''
  noteCard.value = { mode: 'edit', id: hit.id }
  syncPopover()
})

const virtualizer = useVirtualizer(
  computed(() => ({
    count: displayRows.value.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: () => 25,
    overscan: 12
  }))
)

const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const vTotalSize = computed(() => virtualizer.value.getTotalSize())

function onRowRef(ref: Element | ComponentPublicInstance | null) {
  const el = ref && typeof ref === 'object' && '$el' in ref ? (ref as ComponentPublicInstance).$el : ref
  virtualizer.value.measureElement(el as HTMLElement)
}

let resizeUnsub: (() => void) | null = null

function attachScrollSizeObserver() {
  resizeUnsub?.()
  resizeUnsub = null
  const el = scrollRef.value
  if (typeof ResizeObserver === 'undefined' || !el) return
  const ro = new ResizeObserver(() => {
    virtualizer.value.measure()
  })
  ro.observe(el)
  resizeUnsub = () => {
    ro.disconnect()
    resizeUnsub = null
  }
}

function scheduleRemeasure() {
  void nextTick(() => {
    requestAnimationFrame(() => {
      virtualizer.value.measure()
      void nextTick(() => {
        requestAnimationFrame(() => {
          refreshVisualHighlight()
          syncPopover()
        })
      })
    })
  })
}

watch(virtualItems, () => {
  setNoteHighlights(noteHighlightRanges.value)
  refreshVisualHighlight()
  syncPopover()
}, { flush: 'post' })

watch(displayRows, () => {
  scheduleRemeasure()
  refreshVisualHighlight()
}, { flush: 'post' })

function onWindowResize() {
  syncPopover()
}

function onDialogOpened() {
  attachScrollSizeObserver()
  attachSelectionListeners()
  window.addEventListener('resize', onWindowResize)
  scheduleRemeasure()
  setTimeout(() => virtualizer.value.measure(), 100)
}

onUnmounted(() => {
  resizeUnsub?.()
  window.removeEventListener('resize', onWindowResize)
  detachSelectionListeners()
})

function reset() {
  noteLoadGen += 1
  aiPanelRef.value?.reset()
  detachSelectionListeners()
  clearSelection()
  resizeUnsub?.()
  resizeUnsub = null
  rawText.value = ''
  reflowForReading.value = true
  nextOffset.value = 0
  totalSize.value = 0
  done.value = false
  initialLoading.value = false
  loadingMore.value = false
  appending.value = false
  loadError.value = ''
  fileEncoding.value = undefined
  notes.value = []
  noteCard.value = null
  noteDraft.value = ''
  popoverPos.value = null
  saving.value = false
  window.removeEventListener('resize', onWindowResize)
  setNoteHighlights([])
}

async function fetchChunk(fromOffset: number) {
  return fileApiService.getTextFileChunk(
    props.fileId,
    fromOffset,
    CHUNK_BYTES,
    fileEncoding.value
  )
}

async function onOpen() {
  reset()
  const gen = noteLoadGen
  initialLoading.value = true
  loadError.value = ''
  aiPanelRef.value?.activate()
  const notesPromise = fileApiService.listTextNotes(props.fileId).catch((error: unknown) => {
    if (gen === noteLoadGen) ElMessage.error(apiMessage(error, t('preview.textChunkError')))
    return [] as FileTextNote[]
  })
  try {
    const data = await fetchChunk(0)
    if (data.fileEncoding) fileEncoding.value = data.fileEncoding
    rawText.value += data.text
    nextOffset.value = data.nextOffset
    totalSize.value = data.totalSize
    done.value = data.done
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    loadError.value = msg || t('preview.textChunkError')
  } finally {
    initialLoading.value = false
    await nextTick()
    scheduleRemeasure()
  }
  const listed = await notesPromise
  if (gen !== noteLoadGen) return
  notes.value = listed
  await nextTick()
  refreshVisualHighlight()
}

async function loadNext() {
  if (done.value || loadingMore.value) return
  loadingMore.value = true
  appending.value = true
  loadError.value = ''
  try {
    const data = await fetchChunk(nextOffset.value)
    if (data.fileEncoding) fileEncoding.value = data.fileEncoding
    rawText.value += data.text
    nextOffset.value = data.nextOffset
    if (data.totalSize) totalSize.value = data.totalSize
    done.value = data.done
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    loadError.value = msg || t('preview.textChunkError')
  } finally {
    loadingMore.value = false
    appending.value = false
    await nextTick()
    scheduleRemeasure()
  }
}

const SCROLL_LOAD_THRESHOLD = 200

function onScroll() {
  syncPopover()
  const el = scrollRef.value
  if (!el || done.value || loadingMore.value || initialLoading.value) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_LOAD_THRESHOLD) {
    void loadNext()
  }
}
</script>

<style lang="scss">
::highlight(vlist-sel) {
  background: rgba(64, 158, 255, 0.35);
  color: inherit;
}

::highlight(vlist-notes) {
  background: rgba(255, 214, 102, 0.55);
  color: inherit;
}
</style>

<style lang="scss" scoped>
/* 主题里 --el-dialog-width 未覆盖时会回退到 50%（theme-chalk dialog.scss），全屏右侧大片留白时强制拉满 */
.text-chunk-preview-dialog {
  width: min(96vw, 1280px) !important;
  max-width: 96vw !important;
  box-sizing: border-box;

  :deep(.el-dialog__body) {
    padding-top: 8px;
    display: block;
    width: 100% !important;
    max-width: none !important;
    box-sizing: border-box;
  }
}

.preview-split {
  display: flex;
  gap: 14px;
  height: min(78vh, 720px);
  max-height: min(78vh, 720px);
  min-height: 0;
  align-items: stretch;
  overflow: hidden;
}

.preview-split__left {
  position: relative;
  flex: 1 1 56%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.text-note-popover {
  position: fixed;
  z-index: 20;
  max-width: 280px;
}

.text-note-card {
  width: 260px;
  padding: 10px;
  background: var(--el-bg-color-overlay, #fff);
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  box-shadow: var(--el-box-shadow-light);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.text-note-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.text-note-stale {
  margin: 0;
  font-size: 12px;
  color: var(--el-color-warning);
}

.preview-split__right {
  flex: 1 1 44%;
  min-width: 300px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (max-width: 900px) {
  .preview-split {
    flex-direction: column;
    height: auto;
    max-height: none;
    min-height: min(78vh, 720px);
    overflow: visible;
  }

  .preview-split__right {
    min-width: 0;
    min-height: 420px;
    height: min(52vh, 480px);
    max-height: min(52vh, 480px);
    overflow: hidden;
  }
}

.hint-line {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.meta-line {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.text-chunk-options {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}

/* 固定视口高度：仅 max-height 时父级/动画下 clientHeight 可能为 0，导致虚拟列表不渲染 */
.text-chunk-scroll {
  display: block;
  width: 100% !important;
  min-width: 0;
  max-width: none;
  flex: 1 1 auto;
  min-height: 280px;
  max-height: min(72vh, 640px);
  overflow: auto;
  background: var(--el-fill-color-lighter, #f5f7fa);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 12px 14px;
  box-sizing: border-box;
}

.vlist-inner {
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

/* 左对齐、自然字距。首行缩进 2 字用 text-indent: 2em（与正文 em 等宽，符合中文习惯） */
.vlist-row {
  margin: 0;
  font-family: 'Sarasa Term SC', 'Source Han Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'PingFang SC',
    ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  color: var(--el-text-color-primary);
  box-sizing: border-box;
  text-align: start;
  letter-spacing: normal;
  text-justify: auto;
  user-select: none;
  -webkit-user-select: none;
  cursor: text;
}

:deep(.vlist-selection-overlay) {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

:deep(.vlist-selection-overlay__rect) {
  position: absolute;
  background: rgba(64, 158, 255, 0.35);
  border-radius: 2px;
}

.text-chunk-scroll::selection {
  background: transparent;
}

.vlist-row--para-indent {
  text-indent: 2em;
}

.vlist-row--blank {
  min-height: 0.75em;
  pointer-events: none;
}

.vlist-appending {
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 6px 0 0;
}

.end-line,
.err-line {
  margin: 10px 0 0;
  font-size: 12px;
}

.err-line {
  color: var(--el-color-danger);
}

.footer-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
