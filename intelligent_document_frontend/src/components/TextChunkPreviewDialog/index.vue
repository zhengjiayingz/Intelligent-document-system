<template>
  <el-dialog v-model="visible" :title="dialogTitle" class="text-chunk-preview-dialog" width="min(96vw, 1280px)"
    top="3vh" destroy-on-close @open="onOpen" @opened="onDialogOpened" @close="onClose" @closed="onClosed">
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
          <el-checkbox v-model="reflowForReading" :disabled="initialLoading || editingText" @change="onReflowChange">
            {{ t('preview.textChunkReflow') }}
          </el-checkbox>
          <div class="text-chunk-font-size" role="group" :aria-label="t('preview.textChunkFontSize')">
            <el-button
              size="small"
              :disabled="initialLoading || contentFontSize <= MIN_TEXT_CHUNK_FONT_SIZE"
              :title="t('preview.textChunkFontSizeDown')"
              @click="bumpFontSize(-TEXT_CHUNK_FONT_SIZE_STEP)"
            >
              A−
            </el-button>
            <span class="text-chunk-font-size__value">{{ contentFontSize }}px</span>
            <el-button
              size="small"
              :disabled="initialLoading || contentFontSize >= MAX_TEXT_CHUNK_FONT_SIZE"
              :title="t('preview.textChunkFontSizeUp')"
              @click="bumpFontSize(TEXT_CHUNK_FONT_SIZE_STEP)"
            >
              A+
            </el-button>
          </div>
          <el-button
            v-if="!editingText"
            size="small"
            :disabled="initialLoading || !done"
            :title="done ? '' : t('preview.textChunkEditNeedFull')"
            @click="startTextEdit"
          >
            {{ t('preview.textChunkEdit') }}
          </el-button>
          <template v-else>
            <el-button size="small" :disabled="textSaving" @click="cancelTextEdit">
              {{ t('preview.textChunkEditCancel') }}
            </el-button>
            <el-button size="small" type="primary" :loading="textSaving" @click="saveTextEdit">
              {{ t('preview.textChunkEditSave') }}
            </el-button>
          </template>
        </div>
        <div v-if="findOpen" class="text-chunk-find" @keydown.stop>
          <el-input
            ref="findInputRef"
            v-model="findQuery"
            size="small"
            clearable
            class="text-chunk-find__input"
            :placeholder="t('preview.textChunkFindPlaceholder')"
            @keydown.enter.exact.prevent="() => void findNext()"
            @keydown.enter.shift.prevent="() => void findPrev()"
          />
          <span class="text-chunk-find__status" aria-live="polite">{{ findStatusText }}</span>
          <el-button size="small" :disabled="findBusy || initialLoading" @click="() => void findPrev()">
            {{ t('preview.textChunkFindPrev') }}
          </el-button>
          <el-button size="small" type="primary" :disabled="findBusy || initialLoading" @click="() => void findNext()">
            {{ t('preview.textChunkFindNext') }}
          </el-button>
          <el-button size="small" text :aria-label="t('preview.textChunkFindClose')" @click="closeFindBar">
            ×
          </el-button>
        </div>
        <textarea
          v-if="editingText"
          v-model="editDraft"
          class="text-chunk-editor"
          spellcheck="false"
          :style="contentFontStyle"
        />
        <div
          v-else
          ref="scrollRef"
          v-loading="initialLoading"
          class="text-chunk-scroll"
          :style="contentFontStyle"
          @scroll.passive="onScroll"
        >
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
            <div class="text-note-colors" :aria-label="t('preview.textNoteColor')">
              <button
                v-for="preset in NOTE_COLOR_PRESETS"
                :key="preset"
                type="button"
                class="text-note-colors__swatch"
                :class="{ 'text-note-colors__swatch--active': noteColor === preset }"
                :style="{ background: preset }"
                :title="preset"
                @click="noteColor = preset"
              />
              <el-color-picker
                :model-value="noteColor"
                color-format="hex"
                size="small"
                @update:model-value="onPickCustomColor"
              />
            </div>
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
          v-model:selected-text="selectedText" :notes-saving="notesSaving" @generate-notes="onGenerateNotes" />
      </section>
    </div>
  </el-dialog>

  <el-dialog
    v-model="generateNotesOpen"
    class="generate-notes-dialog"
    :title="t('preview.generateNotesTitle')"
    width="420px"
    append-to-body
    destroy-on-close
    @closed="onGenerateNotesClosed"
  >
    <p class="generate-notes-hint">{{ t('preview.generateNotesNameHint') }}</p>
    <p class="generate-notes-colors-label">{{ t('preview.generateNotesColors') }}</p>
    <div class="generate-notes-colors" role="group" :aria-label="t('preview.generateNotesColors')">
      <button
        v-for="color in generateNotesColorOptions"
        :key="color"
        type="button"
        class="generate-notes-colors__swatch"
        :class="{ 'generate-notes-colors__swatch--active': generateNotesSelectedColors.includes(color) }"
        :style="{ background: color }"
        :title="color"
        :aria-pressed="generateNotesSelectedColors.includes(color)"
        @click="toggleGenerateNotesColor(color)"
      />
    </div>
    <el-checkbox
      class="generate-notes-colors-all"
      :model-value="generateNotesAllSelected"
      :indeterminate="generateNotesPartialSelected"
      @change="onToggleAllGenerateNotesColors"
    >
      {{ t('preview.generateNotesColorsAll') }}
    </el-checkbox>
    <el-input
      v-model="generateNotesFileName"
      class="generate-notes-filename"
      :placeholder="defaultNoteFileName(fileName || '笔记')"
      @keydown.enter.prevent="() => void confirmGenerateNotes()"
    />
    <template #footer>
      <el-button :disabled="notesSaving" @click="generateNotesOpen = false">
        {{ t('common.cancel') }}
      </el-button>
      <el-button type="primary" :loading="notesSaving" @click="() => void confirmGenerateNotes()">
        {{ t('preview.textNoteSave') }}
      </el-button>
    </template>
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
  findRemappedNoteRange,
  normalizeNewlines,
  noteAnchorFromSelection,
  noteStatus,
  pickNoteAtCaret,
  sourceRangeToRows,
} from '@/utils/textNoteAnchor'
import {
  colorsInNoteExcerpt,
  defaultNoteFileName,
  formatNoteExcerpt,
  normalizeNoteFileName,
  withBlankLineAfterEachLine,
} from '@/utils/textChunkNoteExcerpt'
import {
  DEFAULT_NOTE_COLOR,
  NOTE_COLOR_PRESETS,
  normalizeNoteColor,
  noteColorToOverlay,
} from '@/utils/textNoteColors'
import {
  loadTextChunkProgress,
  rowIndexForSourceOffset,
  saveTextChunkProgress,
} from '@/utils/textChunkReadingProgress'
import {
  loadTextChunkReflow,
  saveTextChunkReflow,
} from '@/utils/textChunkReflowPreference'
import {
  DEFAULT_TEXT_CHUNK_FONT_SIZE,
  MAX_TEXT_CHUNK_FONT_SIZE,
  MIN_TEXT_CHUNK_FONT_SIZE,
  TEXT_CHUNK_FONT_SIZE_STEP,
  clampTextChunkFontSize,
  loadTextChunkFontSize,
  saveTextChunkFontSize,
} from '@/utils/textChunkFontSizePreference'
import {
  applyScrollPreference,
  loadTextChunkScroll,
  saveTextChunkScroll,
  scrollMetricsFromElement,
  type TextChunkScrollPreference,
} from '@/utils/textChunkScrollPreference'
import {
  findContiguousMatches,
  normalizeFindQuery,
  type TextChunkFindMatch,
} from '@/utils/textChunkFind'
import { useAuthStore } from '@stores/auth'

const FIND_HIGHLIGHT_COLOR = 'rgba(255, 213, 0, 0.55)'

const CHUNK_BYTES = 256 * 1024

const props = defineProps<{
  modelValue: boolean
  fileId: number
  fileName?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'notes-saved'): void
}>()

const { t } = useI18n()
const authStore = useAuthStore()

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
/** 正文字号（px），按用户+文件记住 */
const contentFontSize = ref(DEFAULT_TEXT_CHUNK_FONT_SIZE)
const contentFontStyle = computed(() => ({
  '--text-chunk-font-size': `${contentFontSize.value}px`,
}))

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
const noteColor = ref(DEFAULT_NOTE_COLOR)
const noteCard = ref<{ mode: 'create' } | { mode: 'edit'; id: number } | null>(null)
const popoverPos = ref<{ top: number; left: number } | null>(null)
const saving = ref(false)
const notesSaving = ref(false)
const generateNotesOpen = ref(false)
const generateNotesFileName = ref('')
const generateNotesColorOptions = ref<string[]>([])
const generateNotesSelectedColors = ref<string[]>([])
const generateNotesRange = ref<{ start: number; end: number } | null>(null)
const generateNotesAllSelected = computed(
  () =>
    generateNotesColorOptions.value.length > 0 &&
    generateNotesSelectedColors.value.length === generateNotesColorOptions.value.length,
)
const generateNotesPartialSelected = computed(
  () =>
    generateNotesSelectedColors.value.length > 0 &&
    generateNotesSelectedColors.value.length < generateNotesColorOptions.value.length,
)
const editingText = ref(false)
const editDraft = ref('')
const textSaving = ref(false)
let noteLoadGen = 0
let restoringProgress = false
/** 关闭/重置时避免把默认 reflow / 滚动写回 localStorage */
let suppressProgressSave = false
let progressSaveTimer: ReturnType<typeof setTimeout> | null = null
/** destroy-on-close 后 DOM 已拆，关闭时用这份内存快照落盘 */
let latestSourceOffset = 0
let latestScroll: TextChunkScrollPreference = { scrollTop: 0, scrollRatio: 0 }

function currentUserId(): number | null {
  const id = Number(authStore.user?.id)
  if (Number.isFinite(id) && id > 0) return id
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return null
    const fromStorage = Number((JSON.parse(raw) as { id?: unknown })?.id)
    return Number.isFinite(fromStorage) && fromStorage > 0 ? fromStorage : null
  } catch {
    return null
  }
}

function persistReflowPreference(reflow: boolean) {
  if (!(props.fileId > 0)) return
  saveTextChunkReflow(props.fileId, reflow, currentUserId())
}

function persistScrollPreference(scroll: TextChunkScrollPreference) {
  if (!(props.fileId > 0)) return
  saveTextChunkScroll(props.fileId, scroll, currentUserId())
}

function persistFontSizePreference(size: number) {
  if (!(props.fileId > 0)) return
  saveTextChunkFontSize(props.fileId, size, currentUserId())
}

function onReflowChange(value: string | number | boolean) {
  persistReflowPreference(value === true)
}

function bumpFontSize(delta: number) {
  const next = clampTextChunkFontSize(contentFontSize.value + delta)
  if (next === contentFontSize.value) return
  contentFontSize.value = next
  persistFontSizePreference(next)
  void nextTick(() => {
    try {
      virtualizer.value.measure()
    } catch {
      /* virtualizer 尚未就绪时忽略 */
    }
    refreshVisualHighlight()
  })
}

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

function highlightRangesForNote(
  startOffset: number,
  endOffset: number,
): VirtualTextSelectionRange[] {
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
  readyNotes.value.flatMap((note) => {
    const color = noteColorToOverlay(note.color)
    return highlightRangesForNote(note.startOffset, note.endOffset).map((range) => ({
      range,
      color,
    }))
  }),
)

const FIND_QUERY_DEBOUNCE_MS = 200
const findOpen = ref(false)
const findQuery = ref('')
const findMatches = ref<TextChunkFindMatch[]>([])
const findIndex = ref(-1)
const findBusy = ref(false)
const findInputRef = ref<{ focus: () => void } | null>(null)
let findQueryTimer: ReturnType<typeof setTimeout> | null = null

const findHighlightRanges = computed(() => {
  if (!findOpen.value || findIndex.value < 0) return []
  const match = findMatches.value[findIndex.value]
  if (!match) return []
  return highlightRangesForNote(match.start, match.end).map((range) => ({
    range,
    color: FIND_HIGHLIGHT_COLOR,
  }))
})

const allHighlightRanges = computed(() => [
  ...noteHighlightRanges.value,
  ...findHighlightRanges.value,
])

const findStatusText = computed(() => {
  if (findBusy.value) return t('preview.textChunkFindLoading')
  if (!normalizeFindQuery(findQuery.value)) return ''
  if (findMatches.value.length === 0) return t('preview.textChunkFindNone')
  const current = Math.max(1, findIndex.value + 1)
  const total = findMatches.value.length
  if (!done.value) {
    return t('preview.textChunkFindStatusMore', { current, total })
  }
  return t('preview.textChunkFindStatus', { current, total })
})

const POPOVER_MARGIN = 8

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right
}

function placeInPane(x: number, y: number, pane: DOMRect) {
  const card = !!noteCard.value
  const width = card ? 260 : 108
  const height = card ? 248 : 32
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
  noteColor.value = DEFAULT_NOTE_COLOR
  void nextTick(() => syncPopover())
}

function openCreateCard() {
  if (!selectionRange.value) return
  noteDraft.value = ''
  noteColor.value = DEFAULT_NOTE_COLOR
  noteCard.value = { mode: 'create' }
  syncPopover()
}

function onPickCustomColor(value: string | null) {
  noteColor.value = normalizeNoteColor(value)
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
        color: normalizeNoteColor(noteColor.value),
      })
      if (gen !== noteLoadGen) return
      notes.value = [...notes.value, created]
      clearSelection()
      closeNoteCard()
    } else {
      const updated = await fileApiService.updateTextNote(props.fileId, card.id, {
        content: draftContent(),
        color: normalizeNoteColor(noteColor.value),
      })
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

watch(allHighlightRanges, (ranges) => {
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
  noteColor.value = normalizeNoteColor(hit.color)
  noteCard.value = { mode: 'edit', id: hit.id }
  syncPopover()
})

const virtualizer = useVirtualizer(
  computed(() => {
    const scale = contentFontSize.value / DEFAULT_TEXT_CHUNK_FONT_SIZE
    return {
      count: displayRows.value.length,
      getScrollElement: () => scrollRef.value,
      // 与 .vlist-row 实测行高接近，并随字号缩放，减少 measure 后总高暴涨导致的跳底
      estimateSize: (index: number) =>
        Math.round((displayRows.value[index]?.isBlank ? 14 : 46) * scale),
      overscan: 12,
      // destroy-on-close 只拆 DOM，composables 状态还在；必须显式从 0 起，否则会沿用上次的 scrollOffset 直接跳到底
      initialOffset: 0,
    }
  })
)

/** 把虚拟列表内部偏移和 DOM scrollTop 都拉回顶部（跨次打开时必需） */
function resetVirtualScroll() {
  const el = scrollRef.value
  if (el) el.scrollTop = 0
  try {
    virtualizer.value.scrollToOffset(0)
  } catch {
    /* virtualizer 尚未就绪时忽略 */
  }
}

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
  setNoteHighlights(allHighlightRanges.value)
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

function onPageHide() {
  captureReadingProgress()
  flushReadingProgress()
}

function onDialogOpened() {
  attachScrollSizeObserver()
  attachSelectionListeners()
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('keydown', onFindKeydown, true)
  window.addEventListener('pagehide', onPageHide)
  scheduleRemeasure()
  setTimeout(() => virtualizer.value.measure(), 100)
}

onUnmounted(() => {
  resizeUnsub?.()
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onFindKeydown, true)
  window.removeEventListener('pagehide', onPageHide)
  detachSelectionListeners()
  if (progressSaveTimer != null) {
    clearTimeout(progressSaveTimer)
    progressSaveTimer = null
  }
  if (findQueryTimer != null) {
    clearTimeout(findQueryTimer)
    findQueryTimer = null
  }
})

function sourceOffsetAtViewport(): number {
  const el = scrollRef.value
  const rows = mappedRows.value
  if (!el || rows.length === 0) return latestSourceOffset

  const items = virtualizer.value.getVirtualItems()
  if (items.length === 0) {
    // 虚拟列表尚未量好时，用 scrollTop / 总高粗估行号
    const total = virtualizer.value.getTotalSize() || el.scrollHeight
    if (total <= 0) return latestSourceOffset
    const ratio = Math.min(1, Math.max(0, el.scrollTop / total))
    const index = Math.min(rows.length - 1, Math.floor(ratio * rows.length))
    const row = rows[index]
    return row ? caretToSource(row, 0) : latestSourceOffset
  }

  let index = items[0]!.index
  for (const item of items) {
    if (item.start <= el.scrollTop) index = item.index
    else break
  }
  const row = rows[index]
  if (!row) return latestSourceOffset
  return caretToSource(row, 0)
}

function captureReadingProgress() {
  const el = scrollRef.value
  if (!el || mappedRows.value.length === 0) return
  latestSourceOffset = sourceOffsetAtViewport()
  latestScroll = scrollMetricsFromElement(el)
}

function flushReadingProgress() {
  if (suppressProgressSave || restoringProgress) return
  const uid = currentUserId()
  if (uid == null || !(props.fileId > 0)) return
  // 关闭时不要再读 DOM：动画/销毁常把 scrollTop 清成 0，会冲掉滚动时记下的位置
  saveTextChunkProgress(uid, props.fileId, {
    reflow: reflowForReading.value,
    sourceOffset: latestSourceOffset,
  })
  persistScrollPreference(latestScroll)
  persistReflowPreference(reflowForReading.value)
}

function scheduleReadingProgressSave() {
  if (suppressProgressSave || restoringProgress || initialLoading.value) return
  captureReadingProgress()
  if (progressSaveTimer != null) return
  progressSaveTimer = setTimeout(() => {
    progressSaveTimer = null
    flushReadingProgress()
  }, 400)
}

function reset() {
  noteLoadGen += 1
  restoringProgress = false
  if (progressSaveTimer != null) {
    clearTimeout(progressSaveTimer)
    progressSaveTimer = null
  }
  aiPanelRef.value?.reset()
  detachSelectionListeners()
  clearSelection()
  resizeUnsub?.()
  resizeUnsub = null
  rawText.value = ''
  // 不在这里把 reflow 重置为 true：reset 后 watch 异步触发会冲掉刚写入的「取消重排」
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
  noteColor.value = DEFAULT_NOTE_COLOR
  popoverPos.value = null
  saving.value = false
  editingText.value = false
  editDraft.value = ''
  textSaving.value = false
  resetFindState()
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onFindKeydown, true)
  window.removeEventListener('pagehide', onPageHide)
  setNoteHighlights([])
}

/** 关闭动画开始时正文还在，先落盘；@closed 时 destroy-on-close 已拆 DOM */
function onClose() {
  if (progressSaveTimer != null) {
    clearTimeout(progressSaveTimer)
    progressSaveTimer = null
  }
  restoringProgress = false
  persistReflowPreference(reflowForReading.value)
  flushReadingProgress()
}

function onClosed() {
  suppressProgressSave = true
  resetVirtualScroll()
  reset()
  // watch 默认异步调度，须等一拍再放开，否则会把默认 true 写回 localStorage
  void nextTick(() => {
    suppressProgressSave = false
  })
}

async function fetchChunk(fromOffset: number) {
  return fileApiService.getTextFileChunk(
    props.fileId,
    fromOffset,
    CHUNK_BYTES,
    fileEncoding.value
  )
}

async function waitFrames(n = 1) {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

async function restoreScrollPosition(
  gen: number,
  sourceOffset: number,
  scrollPref: TextChunkScrollPreference | null,
) {
  const hasScroll = !!scrollPref && (scrollPref.scrollTop > 0 || scrollPref.scrollRatio > 0)
  if (gen !== noteLoadGen || (sourceOffset <= 0 && !hasScroll)) {
    restoringProgress = false
    return
  }
  await nextTick()
  virtualizer.value.measure()
  await nextTick()
  if (gen !== noteLoadGen) return

  const applyTarget = () => {
    if (gen !== noteLoadGen) return
    virtualizer.value.measure()
    // 按退出时视口顶部的原文偏移定位。滚动比例只对「当时已加载的高度」有效，长文档重开时加载量不同，比例会把人带到开头附近
    if (sourceOffset > 0) {
      const rowIndex = rowIndexForSourceOffset(mappedRows.value, sourceOffset)
      virtualizer.value.scrollToIndex(rowIndex, { align: 'start' })
    } else if (hasScroll && scrollRef.value) {
      const total = virtualizer.value.getTotalSize()
      if (total > 0) {
        virtualizer.value.scrollToOffset(Math.round(scrollPref!.scrollRatio * total))
      }
      applyScrollPreference(scrollRef.value, scrollPref!)
    }
  }

  for (let i = 0; i < 5; i++) {
    applyTarget()
    await waitFrames(1)
  }
  // 对话框打开动画 / ResizeObserver 量测还会再抖，延迟再钉一次
  await new Promise<void>((resolve) => setTimeout(resolve, 120))
  applyTarget()
  await waitFrames(2)

  if (gen !== noteLoadGen) return
  if (hasScroll && scrollPref) latestScroll = { ...scrollPref }
  if (sourceOffset > 0) latestSourceOffset = sourceOffset
  else if (scrollRef.value) latestSourceOffset = sourceOffsetAtViewport()
  restoringProgress = false
  refreshVisualHighlight()
  syncPopover()
}

async function onOpen() {
  suppressProgressSave = true
  reset()
  const gen = noteLoadGen
  const uid = currentUserId()
  const savedReflow = loadTextChunkReflow(props.fileId, uid)
  reflowForReading.value = savedReflow ?? true
  contentFontSize.value =
    loadTextChunkFontSize(props.fileId, uid) ?? DEFAULT_TEXT_CHUNK_FONT_SIZE
  void nextTick(() => {
    suppressProgressSave = false
  })
  const saved = uid != null ? loadTextChunkProgress(uid, props.fileId) : null
  const savedScroll = loadTextChunkScroll(props.fileId, uid)
  latestSourceOffset = saved?.sourceOffset ?? 0
  latestScroll = savedScroll ?? { scrollTop: 0, scrollRatio: 0 }
  if (
    (saved && saved.sourceOffset > 0) ||
    (savedScroll && (savedScroll.scrollTop > 0 || savedScroll.scrollRatio > 0))
  ) {
    restoringProgress = true
  }

  initialLoading.value = true
  loadError.value = ''
  aiPanelRef.value?.activate()
  const notesPromise = fileApiService.listTextNotes(props.fileId).catch((error: unknown) => {
    if (gen === noteLoadGen) ElMessage.error(apiMessage(error, t('preview.textChunkError')))
    return [] as FileTextNote[]
  })
  try {
    const data = await fetchChunk(0)
    if (gen !== noteLoadGen) {
      restoringProgress = false
      return
    }
    if (data.fileEncoding) fileEncoding.value = data.fileEncoding
    rawText.value += data.text
    nextOffset.value = data.nextOffset
    totalSize.value = data.totalSize
    done.value = data.done

    const target = saved?.sourceOffset ?? 0
    while (
      gen === noteLoadGen &&
      !done.value &&
      target > 0 &&
      normalizeNewlines(rawText.value).length <= target
    ) {
      const more = await fetchChunk(nextOffset.value)
      if (gen !== noteLoadGen) {
        restoringProgress = false
        return
      }
      if (more.fileEncoding) fileEncoding.value = more.fileEncoding
      rawText.value += more.text
      nextOffset.value = more.nextOffset
      if (more.totalSize) totalSize.value = more.totalSize
      done.value = more.done
    }
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    loadError.value = msg || t('preview.textChunkError')
    restoringProgress = false
  } finally {
    if (gen === noteLoadGen) initialLoading.value = false
    await nextTick()
    scheduleRemeasure()
  }
  const listed = await notesPromise
  if (gen !== noteLoadGen) {
    restoringProgress = false
    return
  }
  notes.value = listed
  // 若上次误把正文「每行加空行」写回，打开时按 quote 把注解锚点找回来
  if (done.value && listed.length > 0) {
    await remapNotesToText(rawText.value)
    if (gen !== noteLoadGen) {
      restoringProgress = false
      return
    }
  }
  await nextTick()
  // 正文挂载后先清掉上次会话残留的虚拟滚动偏移，再恢复进度
  resetVirtualScroll()
  await waitFrames(1)
  refreshVisualHighlight()

  if (gen === noteLoadGen && restoringProgress) {
    await restoreScrollPosition(gen, saved?.sourceOffset ?? 0, savedScroll)
  } else {
    restoringProgress = false
  }
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
    if (data.done && notes.value.length > 0) {
      await remapNotesToText(rawText.value)
    }
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
  scheduleReadingProgressSave()
  const el = scrollRef.value
  // 恢复进度时禁止触底续载：短内容上按比例滚动会贴近底部，续载会把位置拖到底
  if (!el || done.value || loadingMore.value || initialLoading.value || restoringProgress) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_LOAD_THRESHOLD) {
    void loadNext()
  }
}

function resetFindState() {
  if (findQueryTimer != null) {
    clearTimeout(findQueryTimer)
    findQueryTimer = null
  }
  findOpen.value = false
  findQuery.value = ''
  findMatches.value = []
  findIndex.value = -1
  findBusy.value = false
}

function openFindBar() {
  findOpen.value = true
  void nextTick(() => {
    findInputRef.value?.focus?.()
  })
}

function closeFindBar() {
  findOpen.value = false
  findMatches.value = []
  findIndex.value = -1
  findBusy.value = false
  setNoteHighlights(allHighlightRanges.value)
}

function recomputeFindMatches() {
  const q = normalizeFindQuery(findQuery.value)
  findMatches.value = q ? findContiguousMatches(normalizedText.value, q) : []
}

async function revealCurrentFind() {
  const match = findMatches.value[findIndex.value]
  if (!match) return
  const rowIndex = rowIndexForSourceOffset(mappedRows.value, match.start)
  await nextTick()
  virtualizer.value.measure()
  virtualizer.value.scrollToIndex(rowIndex, { align: 'center' })
  await waitFrames(2)
  virtualizer.value.measure()
  virtualizer.value.scrollToIndex(rowIndex, { align: 'center' })
  await waitFrames(1)
  setNoteHighlights(allHighlightRanges.value)
  refreshVisualHighlight()
}

/** 从当前已加载正文起搜；没有命中则续载直到找到或文件结束 */
async function searchFirstMatch() {
  const q = normalizeFindQuery(findQuery.value)
  if (!q) {
    findMatches.value = []
    findIndex.value = -1
    return
  }
  findBusy.value = true
  try {
    recomputeFindMatches()
    while (findMatches.value.length === 0 && !done.value) {
      const before = nextOffset.value
      await loadNext()
      if (nextOffset.value === before && !done.value) break
      recomputeFindMatches()
    }
    findIndex.value = findMatches.value.length > 0 ? 0 : -1
    if (findIndex.value >= 0) await revealCurrentFind()
    else setNoteHighlights(allHighlightRanges.value)
  } finally {
    findBusy.value = false
  }
}

async function findNext() {
  const q = normalizeFindQuery(findQuery.value)
  if (!q) return
  findBusy.value = true
  try {
    recomputeFindMatches()
    const curStart =
      findIndex.value >= 0 ? (findMatches.value[findIndex.value]?.start ?? -1) : -1
    let next = findMatches.value.findIndex((m) => m.start > curStart)
    while (next < 0 && !done.value) {
      const before = nextOffset.value
      await loadNext()
      if (nextOffset.value === before && !done.value) break
      recomputeFindMatches()
      next = findMatches.value.findIndex((m) => m.start > curStart)
    }
    if (findMatches.value.length === 0) {
      findIndex.value = -1
      setNoteHighlights(allHighlightRanges.value)
      return
    }
    findIndex.value = next < 0 ? 0 : next
    await revealCurrentFind()
  } finally {
    findBusy.value = false
  }
}

async function findPrev() {
  const q = normalizeFindQuery(findQuery.value)
  if (!q) return
  findBusy.value = true
  try {
    recomputeFindMatches()
    if (findMatches.value.length === 0) {
      findIndex.value = -1
      setNoteHighlights(allHighlightRanges.value)
      return
    }
    const curStart =
      findIndex.value >= 0
        ? (findMatches.value[findIndex.value]?.start ?? Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY
    let prev = -1
    for (let i = findMatches.value.length - 1; i >= 0; i--) {
      if (findMatches.value[i]!.start < curStart) {
        prev = i
        break
      }
    }
    findIndex.value = prev < 0 ? findMatches.value.length - 1 : prev
    await revealCurrentFind()
  } finally {
    findBusy.value = false
  }
}

function onFindKeydown(e: KeyboardEvent) {
  if (!visible.value) return
  const key = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && key === 'f') {
    e.preventDefault()
    e.stopPropagation()
    openFindBar()
    return
  }
  if (!findOpen.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeFindBar()
    return
  }
  if (e.key === 'F3') {
    e.preventDefault()
    e.stopPropagation()
    if (e.shiftKey) void findPrev()
    else void findNext()
  }
}

function startTextEdit() {
  if (!done.value || initialLoading.value) {
    ElMessage.warning(t('preview.textChunkEditNeedFull'))
    return
  }
  closeFindBar()
  editDraft.value = rawText.value
  editingText.value = true
}

function cancelTextEdit() {
  editingText.value = false
  editDraft.value = ''
}

async function remapNotesToText(text: string) {
  const normalized = normalizeNewlines(text)
  const next: FileTextNote[] = []
  for (const note of notes.value) {
    const range = findRemappedNoteRange(normalized, note)
    if (!range) {
      next.push(note)
      continue
    }
    if (range.startOffset === note.startOffset && range.endOffset === note.endOffset) {
      next.push(note)
      continue
    }
    try {
      const updated = await fileApiService.updateTextNote(props.fileId, note.id, {
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        quote: note.quote,
      })
      next.push(updated)
    } catch {
      next.push(note)
    }
  }
  notes.value = next
}

async function saveTextEdit() {
  if (textSaving.value) return
  textSaving.value = true
  try {
    // 写回原文只统一换行，不要做「每行后加空行」——那是导出笔记给重排用的，会打乱注解偏移
    const content = normalizeNewlines(editDraft.value)
    editDraft.value = content
    const saved = await fileApiService.replaceFileText(
      props.fileId,
      content,
      fileEncoding.value,
    )
    rawText.value = content
    // 按服务端实际落盘编码更新（常见 GBK 小说须写回 gb18030，避免再打开乱码）
    if (saved?.encoding === 'utf-8' || saved?.encoding === 'gb18030') {
      fileEncoding.value = saved.encoding
    }
    const bytes =
      typeof saved?.fileSize === 'number' && saved.fileSize > 0
        ? saved.fileSize
        : new Blob([content]).size
    nextOffset.value = bytes
    totalSize.value = bytes
    done.value = true
    editingText.value = false
    await remapNotesToText(content)
    ElMessage.success(
      saved?.unchanged ? t('preview.textChunkEditUnchanged') : t('preview.textChunkEditSaved'),
    )
    emit('notes-saved')
    await nextTick()
    scheduleRemeasure()
  } catch (error: unknown) {
    ElMessage.error(apiMessage(error, t('preview.textChunkEditFailed')))
  } finally {
    textSaving.value = false
  }
}

function toggleGenerateNotesColor(color: string) {
  const key = normalizeNoteColor(color)
  const cur = generateNotesSelectedColors.value
  if (cur.includes(key)) {
    generateNotesSelectedColors.value = cur.filter((c) => c !== key)
  } else {
    generateNotesSelectedColors.value = [...cur, key]
  }
}

function onToggleAllGenerateNotesColors(value: string | number | boolean) {
  generateNotesSelectedColors.value =
    value === true ? [...generateNotesColorOptions.value] : []
}

function onGenerateNotesClosed() {
  generateNotesRange.value = null
  generateNotesColorOptions.value = []
  generateNotesSelectedColors.value = []
  generateNotesFileName.value = ''
}

function onGenerateNotes() {
  const range = selectionRange.value
  if (!range || notesSaving.value || generateNotesOpen.value) return
  const anchor = noteAnchorFromSelection(normalizedText.value, mappedRows.value, range)
  const body = formatNoteExcerpt(notes.value, anchor.startOffset, anchor.endOffset)
  if (!body) {
    ElMessage.warning(t('preview.generateNotesEmpty'))
    return
  }
  const colors = colorsInNoteExcerpt(notes.value, anchor.startOffset, anchor.endOffset)
  generateNotesRange.value = { start: anchor.startOffset, end: anchor.endOffset }
  generateNotesColorOptions.value = colors
  generateNotesSelectedColors.value = [...colors]
  generateNotesFileName.value = defaultNoteFileName(props.fileName || '笔记')
  generateNotesOpen.value = true
}

async function confirmGenerateNotes() {
  const range = generateNotesRange.value
  if (!range || notesSaving.value) return
  if (generateNotesSelectedColors.value.length === 0) {
    ElMessage.warning(t('preview.generateNotesNoColors'))
    return
  }
  const body = formatNoteExcerpt(notes.value, range.start, range.end, {
    colors: generateNotesSelectedColors.value,
  })
  if (!body) {
    ElMessage.warning(t('preview.generateNotesEmpty'))
    return
  }
  const checked = normalizeNoteFileName(generateNotesFileName.value)
  if (!checked.ok) {
    ElMessage.warning(t('preview.generateNotesBadName'))
    return
  }

  notesSaving.value = true
  try {
    const meta = await fileApiService.getFileById(props.fileId)
    const parentId = meta.parentId ?? undefined
    const nameCheck = await fileApiService.checkFileName(checked.name, parentId)
    if (nameCheck.exists) {
      ElMessage.warning(t('preview.generateNotesExists'))
      return
    }
    const file = new File([body], checked.name, { type: 'text/plain' })
    await fileApiService.uploadFile(file, parentId)
    ElMessage.success(t('preview.generateNotesSaved', { name: checked.name }))
    generateNotesOpen.value = false
    emit('notes-saved')
  } catch (error: unknown) {
    ElMessage.error(apiMessage(error, t('preview.generateNotesFailed')))
  } finally {
    notesSaving.value = false
  }
}

watch(findQuery, () => {
  if (!findOpen.value) return
  if (findQueryTimer != null) clearTimeout(findQueryTimer)
  findQueryTimer = setTimeout(() => {
    findQueryTimer = null
    void searchFirstMatch()
  }, FIND_QUERY_DEBOUNCE_MS)
})

// 流式重排只在 checkbox @change / 关闭对话框时写入，避免 reset 触发的异步 watch 覆盖持久化值
</script>

<style lang="scss">
::highlight(vlist-sel) {
  background: rgba(64, 158, 255, 0.35);
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

.text-note-colors {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.text-note-colors__swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.12);
  padding: 0;
  cursor: pointer;
  box-sizing: border-box;
}

.text-note-colors__swatch--active {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.text-chunk-font-size {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.text-chunk-font-size__value {
  min-width: 3.2em;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
}

.text-chunk-editor {
  flex: 1 1 auto;
  min-height: 280px;
  width: 100%;
  margin: 0;
  padding: 12px 14px;
  box-sizing: border-box;
  resize: none;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-lighter, #f5f7fa);
  color: var(--el-text-color-primary);
  font-family: 'Sarasa Term SC', 'Source Han Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'PingFang SC',
    ui-sans-serif, system-ui, sans-serif;
  font-size: var(--text-chunk-font-size, 14px);
  line-height: 1.65;
  white-space: pre-wrap;
}

.text-chunk-find {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin: 0 0 8px;
  padding: 6px 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color);
}

.text-chunk-find__input {
  width: min(100%, 220px);
  flex: 1 1 160px;
}

.text-chunk-find__status {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  min-width: 4em;
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
  /* 虚拟列表量行高时内容高度会跳，浏览器默认 scroll anchoring 会把视口拖到底 */
  overflow-anchor: none;
  background: var(--el-fill-color-lighter, #f5f7fa);
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  /* padding 不能加在滚动根上，否则 @tanstack/virtual 的 scrollOffset 会算偏并越滚越沉底 */
  padding: 0;
  box-sizing: border-box;
}

.vlist-inner {
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
}

/* 左对齐、自然字距。首行缩进 2 字用 text-indent: 2em（与正文 em 等宽，符合中文习惯） */
.vlist-row {
  margin: 0;
  font-family: 'Sarasa Term SC', 'Source Han Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'PingFang SC',
    ui-sans-serif, system-ui, sans-serif;
  font-size: var(--text-chunk-font-size, 14px);
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

:deep(.vlist-selection-overlay),
:deep(.vlist-notes-overlay) {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

:deep(.vlist-notes-overlay) {
  z-index: 1;
}

:deep(.vlist-selection-overlay__rect),
:deep(.vlist-notes-overlay__rect) {
  position: absolute;
  border-radius: 2px;
}

:deep(.vlist-selection-overlay__rect) {
  background: rgba(64, 158, 255, 0.35);
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

<style lang="scss">
.generate-notes-dialog {
  .generate-notes-hint {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--el-text-color-regular);
  }

  .generate-notes-colors-label {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .generate-notes-colors {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }

  .generate-notes-colors__swatch {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  }

  .generate-notes-colors__swatch--active {
    border-color: var(--el-color-primary);
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.08),
      0 0 0 1px var(--el-color-primary-light-5);
  }

  .generate-notes-colors-all {
    margin-bottom: 12px;
  }

  .generate-notes-filename {
    width: 100%;
  }
}
</style>
