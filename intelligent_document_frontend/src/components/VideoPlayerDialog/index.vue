<template>
  <el-dialog
    v-model="visible"
    :title="title"
    :width="dialogWidth"
    destroy-on-close
    align-center
    class="video-player-dialog"
    append-to-body
    :before-close="handleBeforeClose"
    @closed="handleClosed"
  >
    <div v-if="showVideoUnsupportedHint" class="unsupported-warning">
      <el-alert
        title="该视频格式 (RMVB/RM) 可能无法在浏览器直接播放"
        type="warning"
        description="建议下载后使用本地播放器（如 VLC, IINA）观看。"
        show-icon
        :closable="false"
      />
    </div>

    <div class="media-layout" :class="{ 'has-transcript': showTranscriptPanel }">
      <div class="media-container" :class="{ 'is-audio': mediaKind === 'audio' }">
        <video
          v-if="mediaKind === 'video'"
          ref="mediaRef"
          :src="videoUrl"
          controls
          crossorigin="anonymous"
          preload="auto"
          class="video-element"
          @loadedmetadata="tryApplySavedProgress"
          @durationchange="tryApplySavedProgress"
          @canplay="tryApplySavedProgress"
          @playing="onPlaying"
          @timeupdate="onTimeUpdate"
          @pause="flushProgress"
          @ended="onEnded"
        >
          <track
            v-if="vttObjectUrl"
            kind="subtitles"
            srclang="zh"
            label="AI"
            :src="vttObjectUrl"
            default
          />
          您的浏览器不支持 video 标签。
        </video>
        <audio
          v-else
          ref="mediaRef"
          :src="videoUrl"
          controls
          preload="auto"
          class="audio-element"
          @loadedmetadata="tryApplySavedProgress"
          @durationchange="tryApplySavedProgress"
          @canplay="tryApplySavedProgress"
          @playing="onPlaying"
          @timeupdate="onTimeUpdate"
          @pause="flushProgress"
          @ended="onEnded"
        >
          {{ t('mediaPlayer.audioNotSupported') }}
        </audio>
      </div>

      <aside v-if="showTranscriptPanel" class="transcript-panel">
        <div class="transcript-toolbar">
          <el-button
            size="small"
            type="primary"
            plain
            :loading="indexTriggering"
            :disabled="indexPolling"
            @click="onTriggerIndex"
          >
            {{ indexButtonLabel }}
          </el-button>
          <el-button
            size="small"
            plain
            :disabled="!canExportSrt"
            @click="onExportSrt"
          >
            导出 SRT
          </el-button>
        </div>
        <span class="transcript-status">{{ indexStatusLabel }}</span>

        <el-tabs v-model="sideTab" class="media-side-tabs">
          <el-tab-pane label="文稿" name="transcript">
            <p v-if="transcriptError" class="transcript-error">{{ transcriptError }}</p>
            <ul v-else class="transcript-list">
              <li
                v-for="(seg, i) in segments"
                :key="i"
                class="transcript-item"
                @click="seekToSegment(seg)"
              >
                <span v-if="seg.startMs != null" class="transcript-time">
                  {{ formatMs(seg.startMs) }}
                </span>
                <span class="transcript-text">{{ seg.text }}</span>
              </li>
            </ul>
            <p
              v-if="!transcriptError && segments.length === 0 && indexReady"
              class="transcript-empty"
            >
              暂无转写分句
            </p>
            <p v-else-if="!transcriptError && !indexReady" class="transcript-empty">
              请先建立索引以生成文稿与字幕
            </p>
          </el-tab-pane>
          <el-tab-pane label="摘要" name="summary">
            <div v-if="summaryLoading" class="transcript-empty">正在加载摘要…</div>
            <div v-else-if="summaryError" class="transcript-error">{{ summaryError }}</div>
            <div
              v-else-if="summaryOneLiner || summaryOverview || mediaChapters.length"
              class="summary-body"
            >
              <p v-if="summaryOneLiner" class="summary-oneliner">{{ summaryOneLiner }}</p>
              <p v-if="summaryOverview" class="summary-overview">{{ summaryOverview }}</p>
              <ul v-if="mediaChapters.length" class="chapter-list">
                <li
                  v-for="ch in mediaChapters"
                  :key="ch.index"
                  class="chapter-item"
                  :class="{ disabled: ch.startMs == null }"
                  @click="seekToChapter(ch)"
                >
                  <div class="chapter-head">
                    <span class="chapter-title">{{ ch.index }}. {{ ch.title }}</span>
                    <span v-if="ch.startMs != null" class="chapter-time">
                      {{ formatMs(ch.startMs)
                      }}<template v-if="ch.endMs != null">
                        – {{ formatMs(ch.endMs) }}</template
                      >
                    </span>
                  </div>
                  <p class="chapter-summary">{{ ch.summary }}</p>
                </li>
              </ul>
            </div>
            <p v-else-if="!indexReady" class="transcript-empty">
              请先建立索引；完成后将自动生成摘要
            </p>
            <p v-else class="transcript-empty">暂无摘要（可能仍在生成或体裁无全书摘要）</p>
          </el-tab-pane>
        </el-tabs>
      </aside>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="requestClose">关闭</el-button>
        <el-button type="primary" @click="emitDownload">{{ footerPrimaryLabel }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@stores/auth'
import {
  loadMediaProgress,
  saveMediaProgress,
  clearMediaProgress,
  shouldClearProgress,
} from '@utils/mediaPlaybackProgress'
import {
  getDocumentIndexStatus,
  getDocumentSummary,
  getFileTranscript,
  triggerDocumentIndex,
  type DocumentIndexStatusData,
  type TranscriptSegment,
} from '@api/ai'
import {
  downloadTextFile,
  segmentsToSrt,
  segmentsToVtt,
} from '@utils/subtitleFormat'

const INDEX_POLL_MS = 2500
const INDEX_ACTIVE = [
  'pending',
  'extracting',
  'chunking',
  'embedding',
  'summarizing',
  'extracting_knowledge',
] as const

const props = defineProps<{
  modelValue: boolean
  title: string
  videoUrl: string
  fileName?: string
  /** 用于读写播放进度；未传则不记忆 */
  fileId?: number
  mediaKind?: 'video' | 'audio'
}>()

const emit = defineEmits(['update:modelValue', 'download'])

const { t } = useI18n()
const authStore = useAuthStore()

const mediaKind = computed(() => props.mediaKind ?? 'video')

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const dialogWidth = computed(() => {
  if (showTranscriptPanel.value) {
    return mediaKind.value === 'video' ? '960px' : '860px'
  }
  return mediaKind.value === 'audio' ? '480px' : '800px'
})

const showVideoUnsupportedHint = computed(() => {
  if (mediaKind.value !== 'video') return false
  const name = (props.fileName || props.title || '').toLowerCase()
  return (
    name.endsWith('.rmvb') ||
    name.endsWith('.rm') ||
    name.endsWith('.avi') ||
    name.endsWith('.wmv') ||
    name.endsWith('.flv') ||
    name.endsWith('.mkv')
  )
})

const showTranscriptPanel = computed(() => props.fileId != null)

const mediaRef = ref<HTMLMediaElement | null>(null)
const restoreSettled = ref(false)
/** seek 恢复期间不写盘，避免 0 秒覆盖存档 */
let restoringSeek = false
let saveThrottleTimer: ReturnType<typeof setTimeout> | null = null
let restoreFallbackTimer: ReturnType<typeof setTimeout> | null = null

const indexStatus = ref<DocumentIndexStatusData | null>(null)
const indexTriggering = ref(false)
const indexPolling = ref(false)
const segments = ref<TranscriptSegment[]>([])
const transcriptError = ref('')
const sideTab = ref<'transcript' | 'summary'>('transcript')
const summaryLoading = ref(false)
const summaryError = ref('')
const summaryOneLiner = ref('')
const summaryOverview = ref('')

type MediaChapterItem = {
  index: number
  title: string
  summary: string
  startMs: number | null
  endMs: number | null
}
const mediaChapters = ref<MediaChapterItem[]>([])
const vttObjectUrl = ref('')
let indexPollTimer: ReturnType<typeof setInterval> | null = null

const indexReady = computed(() => indexStatus.value?.status === 'ready')

const canExportSrt = computed(
  () =>
    segments.value.some(
      (s) => s.text?.trim() && s.startMs != null && s.endMs != null,
    ),
)

function revokeVttUrl() {
  if (vttObjectUrl.value) {
    URL.revokeObjectURL(vttObjectUrl.value)
    vttObjectUrl.value = ''
  }
}

function refreshVttTrack() {
  revokeVttUrl()
  if (mediaKind.value !== 'video') return
  const vtt = segmentsToVtt(segments.value)
  if (!vtt || vtt.trim() === 'WEBVTT') return
  const blob = new Blob([vtt], { type: 'text/vtt' })
  vttObjectUrl.value = URL.createObjectURL(blob)
}

function onExportSrt() {
  const srt = segmentsToSrt(segments.value)
  if (!srt.trim()) {
    ElMessage.warning('暂无可导出的字幕')
    return
  }
  const base = (props.fileName || props.title || 'subtitle').replace(
    /\.[^.]+$/,
    '',
  )
  downloadTextFile(`${base}.srt`, srt, 'application/x-subrip')
}

const indexButtonLabel = computed(() =>
  indexReady.value || indexStatus.value?.status === 'failed'
    ? '重新建立索引'
    : '建立索引',
)

const indexStatusLabel = computed(() => {
  const s = indexStatus.value
  if (!s) return '未建立索引'
  if (s.progressMsg) return s.progressMsg
  return s.status
})

const userId = () => authStore.user?.id

function isFiniteDuration(d: number): boolean {
  return Number.isFinite(d) && d > 0
}

function formatMs(ms: number) {
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function clearRestoreFallbackTimer() {
  if (restoreFallbackTimer != null) {
    clearTimeout(restoreFallbackTimer)
    restoreFallbackTimer = null
  }
}

function scheduleRestoreFallback() {
  clearRestoreFallbackTimer()
  restoreFallbackTimer = setTimeout(() => {
    restoreFallbackTimer = null
    if (restoreSettled.value) return
    const el = mediaRef.value
    restoreSettled.value = true
    restoringSeek = false
    if (el) void el.play().catch(() => {})
  }, 2500)
}

function stopIndexPoll() {
  if (indexPollTimer) {
    clearInterval(indexPollTimer)
    indexPollTimer = null
  }
  indexPolling.value = false
}

async function loadTranscript() {
  if (props.fileId == null) return
  transcriptError.value = ''
  try {
    const data = await getFileTranscript(props.fileId)
    segments.value = data.segments ?? []
    refreshVttTrack()
  } catch (e: unknown) {
    segments.value = []
    revokeVttUrl()
    transcriptError.value =
      (e as { response?: { data?: { message?: string } } })?.response?.data
        ?.message || '加载转写失败'
  }
}

async function loadSummary() {
  if (props.fileId == null || !indexReady.value) {
    summaryOneLiner.value = ''
    summaryOverview.value = ''
    mediaChapters.value = []
    summaryError.value = ''
    return
  }
  summaryLoading.value = true
  summaryError.value = ''
  try {
    const data = await getDocumentSummary(props.fileId, { type: 'book' })
    const payload = data.payload || {}
    summaryOneLiner.value =
      typeof payload.oneLiner === 'string' ? payload.oneLiner : ''
    summaryOverview.value =
      typeof payload.overview === 'string' ? payload.overview : ''
    mediaChapters.value = parseMediaChapters(payload.mediaChapters)
  } catch (e: unknown) {
    summaryOneLiner.value = ''
    summaryOverview.value = ''
    mediaChapters.value = []
    summaryError.value =
      (e as { response?: { data?: { message?: string } } })?.response?.data
        ?.message || '摘要尚未就绪'
  } finally {
    summaryLoading.value = false
  }
}

function parseMediaChapters(raw: unknown): MediaChapterItem[] {
  if (!Array.isArray(raw)) return []
  const out: MediaChapterItem[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    const summary = typeof r.summary === 'string' ? r.summary.trim() : ''
    if (!title && !summary) continue
    const startMs =
      typeof r.startMs === 'number' && Number.isFinite(r.startMs)
        ? Math.max(0, Math.round(r.startMs))
        : null
    const endMs =
      typeof r.endMs === 'number' && Number.isFinite(r.endMs)
        ? Math.max(0, Math.round(r.endMs))
        : null
    out.push({
      index:
        typeof r.index === 'number' && Number.isFinite(r.index)
          ? r.index
          : i + 1,
      title: title || `段落 ${i + 1}`,
      summary: summary || '（暂无摘要）',
      startMs,
      endMs,
    })
  }
  return out
}

async function refreshIndexStatus() {
  if (props.fileId == null) return
  try {
    const data = await getDocumentIndexStatus(props.fileId)
    indexStatus.value = data
    if (data.status === 'ready') {
      stopIndexPoll()
      await loadTranscript()
      await loadSummary()
    } else if (data.status === 'failed') {
      stopIndexPoll()
    } else if (
      INDEX_ACTIVE.includes(data.status as (typeof INDEX_ACTIVE)[number]) &&
      !indexPollTimer
    ) {
      indexPolling.value = true
      indexPollTimer = setInterval(() => {
        void refreshIndexStatus()
      }, INDEX_POLL_MS)
    }
  } catch {
    /* 忽略轮询失败 */
  }
}

async function onTriggerIndex() {
  if (props.fileId == null || indexTriggering.value) return
  indexTriggering.value = true
  transcriptError.value = ''
  const force =
    indexStatus.value?.status === 'ready' ||
    indexStatus.value?.status === 'failed'
  try {
    // 音频先用 novel 体裁占位，与后端 summaryGenre 校验对齐
    const data = await triggerDocumentIndex(props.fileId, 'novel', { force })
    indexStatus.value = data
    if (INDEX_ACTIVE.includes(data.status as (typeof INDEX_ACTIVE)[number])) {
      stopIndexPoll()
      indexPolling.value = true
      indexPollTimer = setInterval(() => {
        void refreshIndexStatus()
      }, INDEX_POLL_MS)
    } else if (data.status === 'ready') {
      await loadTranscript()
      await loadSummary()
    }
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data
        ?.message || '建立索引失败',
    )
  } finally {
    indexTriggering.value = false
  }
}

function seekToSegment(seg: TranscriptSegment) {
  const el = mediaRef.value
  if (!el || seg.startMs == null) return
  el.currentTime = seg.startMs / 1000
  void el.play().catch(() => {})
}

function seekToChapter(ch: MediaChapterItem) {
  const el = mediaRef.value
  if (!el || ch.startMs == null) return
  el.currentTime = ch.startMs / 1000
  void el.play().catch(() => {})
}

const flushProgress = () => {
  if (restoringSeek) return
  const el = mediaRef.value
  const uid = userId()
  if (!el || !uid || props.fileId == null) return

  const current = el.currentTime
  if (!Number.isFinite(current) || current < 0.5) return

  const saved = loadMediaProgress(uid, props.fileId)
  if (current < 1 && saved != null && saved >= 1) return

  const d = el.duration
  if (isFiniteDuration(d)) {
    if (shouldClearProgress(current, d)) {
      clearMediaProgress(uid, props.fileId)
      return
    }
  }

  saveMediaProgress(uid, props.fileId, current)
}

const scheduleThrottledSave = () => {
  if (restoringSeek) return
  if (saveThrottleTimer != null) return
  saveThrottleTimer = setTimeout(() => {
    saveThrottleTimer = null
    flushProgress()
  }, 1500)
}

const tryApplySavedProgress = () => {
  if (restoreSettled.value) return

  const el = mediaRef.value
  const uid = userId()
  if (!el) return

  if (!uid || props.fileId == null) {
    restoreSettled.value = true
    restoringSeek = false
    clearRestoreFallbackTimer()
    void el.play().catch(() => {})
    return
  }

  const saved = loadMediaProgress(uid, props.fileId)
  const dur = el.duration

  const finishWithoutSeek = () => {
    restoreSettled.value = true
    restoringSeek = false
    clearRestoreFallbackTimer()
    void el.play().catch(() => {})
  }

  if (saved == null || saved < 1) {
    finishWithoutSeek()
    return
  }

  if (isFiniteDuration(dur) && saved >= dur - 2) {
    clearMediaProgress(uid, props.fileId)
    finishWithoutSeek()
    return
  }

  const target = isFiniteDuration(dur)
    ? Math.min(saved, Math.max(0, dur - 0.5))
    : saved

  const seekAndFinish = () => {
    restoreSettled.value = true
    clearRestoreFallbackTimer()
    restoringSeek = true
    try {
      el.currentTime = target
      if (saved >= 3) {
        ElMessage.info({
          message: t('mediaPlayer.restoredProgress'),
          duration: 2500,
        })
      }
    } catch {
      // seek 失败则从头播
    }
    restoringSeek = false
    void el.play().catch(() => {})
  }

  if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
    seekAndFinish()
    return
  }

  el.addEventListener('canplay', () => seekAndFinish(), { once: true })
}

const onPlaying = () => {
  flushProgress()
}

const onTimeUpdate = () => {
  scheduleThrottledSave()
}

const onEnded = () => {
  const uid = userId()
  if (uid && props.fileId != null) {
    clearMediaProgress(uid, props.fileId)
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      restoreSettled.value = false
      restoringSeek = false
      scheduleRestoreFallback()
    } else {
      clearRestoreFallbackTimer()
      stopIndexPoll()
    }
  },
)

watch(
  () => [props.modelValue, props.fileId] as const,
  async ([open, id]) => {
    if (!open || id == null) {
      if (!open) {
        segments.value = []
        indexStatus.value = null
        transcriptError.value = ''
        summaryOneLiner.value = ''
        summaryOverview.value = ''
        mediaChapters.value = []
        summaryError.value = ''
        revokeVttUrl()
      }
      return
    }
    await refreshIndexStatus()
    if (indexStatus.value?.status === 'ready') {
      await loadTranscript()
      await loadSummary()
    }
  },
)

const persistBeforeClose = () => {
  if (saveThrottleTimer != null) {
    clearTimeout(saveThrottleTimer)
    saveThrottleTimer = null
  }
  flushProgress()
}

const requestClose = () => {
  persistBeforeClose()
  visible.value = false
}

const handleBeforeClose = (done: () => void) => {
  persistBeforeClose()
  done()
}

const handleClosed = () => {
  stopIndexPoll()
  revokeVttUrl()
  if (mediaRef.value) {
    mediaRef.value.pause()
    mediaRef.value.src = ''
  }
}

onBeforeUnmount(() => {
  persistBeforeClose()
  clearRestoreFallbackTimer()
  stopIndexPoll()
})

const footerPrimaryLabel = computed(() =>
  mediaKind.value === 'audio'
    ? t('fileList.action.download')
    : t('mediaPlayer.downloadWithExternal'),
)

const emitDownload = () => {
  emit('download')
}
</script>

<style scoped>
.unsupported-warning {
  margin-bottom: 16px;
}

.video-player-dialog :deep(.el-dialog) {
  background: #1a1a1a;
  border-radius: 12px;
  overflow: hidden;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.3),
    0 10px 10px -5px rgba(0, 0, 0, 0.1);
}

.video-player-dialog :deep(.el-dialog__title) {
  color: #fff;
}

.video-player-dialog :deep(.el-dialog__headerbtn .el-dialog__close) {
  color: #999;
}

.video-player-dialog :deep(.el-dialog__headerbtn:hover .el-dialog__close) {
  color: #fff;
}

.media-layout.has-transcript {
  display: flex;
  gap: 12px;
  align-items: stretch;
  padding: 12px;
  background: #000;
}

.media-layout.has-transcript .media-container {
  flex: 1;
  min-width: 0;
}

.media-container {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #000;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.5);
  min-height: 400px;
}

.media-container.is-audio {
  min-height: 120px;
  padding: 16px 0;
}

.video-element {
  max-width: 100%;
  max-height: 70vh;
  outline: none;
  display: block;
}

.audio-element {
  width: 100%;
  outline: none;
}

.transcript-panel {
  width: 340px;
  flex-shrink: 0;
  border-left: 1px solid #333;
  padding-left: 12px;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  color: #e5e5e5;
}

.transcript-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.media-side-tabs {
  margin-top: 8px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.media-side-tabs :deep(.el-tabs__header) {
  margin-bottom: 8px;
}

.media-side-tabs :deep(.el-tabs__item) {
  color: #aaa;
}

.media-side-tabs :deep(.el-tabs__item.is-active) {
  color: #fff;
}

.media-side-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow: auto;
}

.summary-body {
  font-size: 13px;
  line-height: 1.55;
  color: #ddd;
}

.summary-oneliner {
  font-weight: 600;
  margin: 0 0 8px;
  color: #fff;
}

.summary-overview {
  margin: 0;
  white-space: pre-wrap;
}

.chapter-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}

.chapter-item {
  padding: 10px 8px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 8px;
  background: #1f1f1f;
  border: 1px solid #333;
}

.chapter-item:hover:not(.disabled) {
  background: #2a2a2a;
  border-color: #555;
}

.chapter-item.disabled {
  cursor: default;
  opacity: 0.75;
}

.chapter-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 4px;
}

.chapter-title {
  font-weight: 600;
  color: #fff;
  font-size: 13px;
}

.chapter-time {
  flex-shrink: 0;
  font-size: 11px;
  color: #8ab4f8;
  font-variant-numeric: tabular-nums;
}

.chapter-summary {
  margin: 0;
  font-size: 12px;
  color: #bbb;
  line-height: 1.45;
  white-space: pre-wrap;
}

.transcript-status {
  font-size: 12px;
  color: #999;
}

.transcript-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
}

.transcript-item {
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.45;
}

.transcript-item:hover {
  background: #2a2a2a;
}

.transcript-time {
  display: inline-block;
  min-width: 40px;
  margin-right: 6px;
  color: #999;
  font-variant-numeric: tabular-nums;
}

.transcript-error,
.transcript-empty {
  font-size: 12px;
  color: #999;
  margin: 8px 0 0;
}

.video-player-dialog :deep(.el-dialog__body) {
  padding: 0;
  background: #000;
}

.video-player-dialog :deep(.el-dialog__footer) {
  background: #1a1a1a;
  padding: 15px 20px;
  border-top: 1px solid #333;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

:deep(.el-button--primary),
:deep(.el-button--primary.is-plain) {
  background-color: #409eff;
  border-color: #409eff;
  color: #fff;
}

:deep(.el-button--default) {
  background-color: transparent;
  color: #ccc;
  border-color: #444;
}

:deep(.el-button--default:hover) {
  color: #fff;
  border-color: #666;
  background-color: #333;
}
</style>
