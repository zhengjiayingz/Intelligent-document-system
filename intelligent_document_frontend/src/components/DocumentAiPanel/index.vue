<template>
  <div class="ai-chat-panel">
    <header class="ai-chat-header">
      <div class="ai-chat-header-top">
        <div class="ai-chat-header-main">
          <h4 class="ai-chat-title">{{ t('preview.aiAskTitle') }}</h4>
          <p class="ai-chat-hint">
            {{
              !selectionEnabled
                ? t('preview.aiSelectionDisabledHint')
                : chatMode === 'selection'
                  ? t('preview.aiAskHint')
                  : chatMode === 'rag'
                    ? t('preview.aiRagHint')
                    : t('preview.aiSolveHint')
            }}
          </p>
        </div>
        <el-button
          v-if="activeChatMessages.length > 0"
          size="small"
          text
          type="danger"
          class="ai-chat-clear"
          @click="clearChat"
        >
          {{ t('preview.aiChatClear') }}
        </el-button>
      </div>
      <div v-if="chatMode === 'selection'" class="ai-chat-header-actions">
        <el-select v-model="translateTargetLang" size="small" class="ai-translate-lang" :disabled="asking"
          :title="t('preview.aiTranslateTarget')">
          <el-option :label="t('preview.aiTranslateDefault')" value="default" />
          <el-option :label="t('preview.aiTranslateZh')" value="zh" />
          <el-option :label="t('preview.aiTranslateEn')" value="en" />
          <el-option :label="t('preview.aiTranslateJa')" value="ja" />
        </el-select>
        <el-button size="small" type="primary" plain :loading="asking" :disabled="asking" @click="submitTranslate">
          {{ t('preview.aiTranslate') }}
        </el-button>
        <template v-if="canUseTts">
          <el-select
            v-model="ttsVoiceId"
            size="small"
            class="ai-tts-voice"
            :disabled="ttsLoading || asking"
            :title="t('preview.aiTtsVoice')"
          >
            <el-option
              v-for="v in ttsVoices"
              :key="v.id"
              :label="v.label"
              :value="v.id"
            />
          </el-select>
          <el-select
            v-model="ttsStyleId"
            size="small"
            class="ai-tts-style"
            :disabled="ttsLoading || asking"
            :title="t('ttsPage.style')"
          >
            <el-option :label="t('ttsPage.styleDefault')" value="default" />
            <el-option :label="t('ttsPage.styleEnglish')" value="english" />
            <el-option :label="t('ttsPage.styleCantonese')" value="cantonese" />
            <el-option :label="t('ttsPage.styleSichuan')" value="sichuan" />
            <el-option :label="t('ttsPage.styleShanghai')" value="shanghai" />
            <el-option :label="t('ttsPage.styleTianjin')" value="tianjin" />
          </el-select>
          <el-button
            size="small"
            type="primary"
            plain
            :loading="ttsLoading"
            :disabled="ttsLoading || asking"
            @click="submitTts"
          >
            {{ t('preview.aiTtsSpeak') }}
          </el-button>
        </template>
      </div>
    </header>

    <div class="ai-index-bar">
      <el-select v-model="summaryGenre" size="small" class="ai-index-genre" :disabled="indexTriggering || indexPolling">
        <el-option-group v-for="group in SUMMARY_GENRE_GROUPS" :key="group.groupKey"
          :label="t(`preview.aiSummaryGenreGroup.${group.groupKey}`)">
          <el-option v-for="genre in group.genres" :key="genre" :label="t(`preview.aiSummaryGenre.${genre}`)"
            :value="genre" />
        </el-option-group>
      </el-select>
      <el-button size="small" type="primary" plain :loading="indexTriggering"
        :disabled="indexTriggering || indexPolling" @click="triggerIndex">
        {{ indexTriggerLabel }}
      </el-button>
      <span class="ai-index-status">{{ indexStatusLabel }}</span>
    </div>

    <el-tabs v-model="rightPanelTab" class="ai-right-tabs">
      <el-tab-pane :label="t('preview.aiTabChat')" name="chat">
        <div class="ai-chat-tab">
          <div class="ai-chat-mode">
            <el-radio-group v-model="chatMode" size="small">
              <el-radio-button
                value="selection"
                :disabled="!selectionEnabled"
                :title="selectionEnabled ? undefined : t('preview.aiSelectionDisabledHint')"
              >
                {{ t('preview.aiChatModeSelection') }}
              </el-radio-button>
              <el-radio-button value="rag">{{ t('preview.aiChatModeRag') }}</el-radio-button>
              <el-radio-button v-if="enableSolveMode" value="solve">
                {{ t('preview.aiChatModeSolve') }}
              </el-radio-button>
            </el-radio-group>
            <p v-if="!selectionEnabled" class="ai-selection-disabled-tip">
              {{ t('preview.aiSelectionDisabledHint') }}
            </p>
          </div>

          <p v-if="chatMode === 'solve'" class="ai-solve-verify">
            {{ t('preview.solveMathVerifyHint') }}
          </p>
          <div v-if="chatMode === 'solve'" class="ai-solve-save-bar">
            <el-select
              v-model="saveDifficulty"
              size="small"
              class="ai-solve-difficulty"
              :disabled="asking || savingWrongBook"
              :title="t('wrongBook.colDifficulty')"
            >
              <el-option
                v-for="d in WRONG_QUESTION_DIFFICULTIES"
                :key="d"
                :label="t(`wrongBook.difficulty.${d}`)"
                :value="d"
              />
            </el-select>
            <el-select
              v-model="saveTags"
              multiple
              filterable
              allow-create
              default-first-option
              clearable
              collapse-tags
              collapse-tags-tooltip
              size="small"
              class="ai-solve-tags"
              :placeholder="t('wrongBook.tagsPlaceholder')"
              :disabled="asking || savingWrongBook"
            >
              <el-option
                v-for="tag in tagOptions"
                :key="tag"
                :label="tag"
                :value="tag"
              />
            </el-select>
            <el-button
              type="success"
              size="small"
              plain
              :loading="savingWrongBook"
              :disabled="asking || !canSaveToWrongBook"
              @click="saveToWrongBook"
            >
              {{ t('preview.saveToWrongBook') }}
            </el-button>
          </div>

          <div v-if="chatMode === 'selection'" class="ai-chat-context">
            <span class="ai-chat-context-label">{{ t('preview.aiChatContext') }}</span>
            <p v-if="selectedText" class="ai-chat-context-text">{{ selectedPreview }}</p>
            <p v-else class="ai-chat-context-empty">{{ t('preview.aiAskSelectedEmpty') }}</p>
          </div>

          <div v-if="canUseTts && ttsAudioUrl" class="ai-tts-player">
            <audio :src="ttsAudioUrl" controls class="ai-tts-audio" />
            <el-button size="small" link type="primary" @click="downloadTts">
              {{ t('preview.aiTtsDownload') }}
            </el-button>
            <p v-if="ttsError" class="ai-tts-error">{{ ttsError }}</p>
          </div>
          <p v-else-if="canUseTts && ttsError" class="ai-tts-error ai-tts-error--alone">
            {{ ttsError }}
          </p>

          <div ref="chatScrollRef" class="ai-chat-messages">
            <p v-if="activeChatMessages.length === 0" class="ai-chat-empty">{{ t('preview.aiChatEmpty') }}</p>
            <div v-for="msg in activeChatMessages" :key="msg.id" class="ai-chat-bubble"
              :class="msg.role === 'user' ? 'ai-chat-bubble--user' : 'ai-chat-bubble--assistant'">
              <span class="ai-chat-bubble-role">
                {{ msg.role === 'user' ? t('preview.aiChatYou') : t('preview.aiChatAssistant') }}
              </span>
              <div v-if="msg.role === 'assistant' && msg.content"
                class="ai-chat-bubble-content ai-chat-bubble-content--md" v-html="renderMarkdown(msg.content)" />
              <p v-else-if="msg.content" class="ai-chat-bubble-content">{{ msg.content }}</p>
              <p v-else-if="msg.streaming" class="ai-chat-bubble-content">{{ t('preview.aiAskThinking') }}</p>
            </div>
          </div>

          <div v-if="askError" class="err-line">{{ askError }}</div>

          <div class="ai-chat-input">
            <el-input v-model="question" type="textarea" :rows="3" :placeholder="t('preview.aiAskQuestionPlaceholder')"
              :disabled="asking" resize="none" @keydown.enter.exact.prevent="submitChat" />
            <div class="ai-chat-input-actions">
              <el-button type="primary" :loading="asking" :disabled="asking" @click="submitChat">
                {{ t('preview.aiAskSubmit') }}
              </el-button>
              <el-button v-if="asking" @click="stopAsk">{{ t('preview.aiAskStop') }}</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane :label="t('preview.aiTabSummary')" name="summary">
        <SummaryPanel :summary-genre="summaryData?.summaryGenre ?? indexStatus?.summaryGenre ?? null"
          :payload="summaryData?.payload ?? null" :loading="summaryLoading" :error="summaryError"
          :ready="indexStatus?.status === 'ready'" />
      </el-tab-pane>
      <el-tab-pane v-if="showKnowledgeTab" :label="t('preview.aiTabKnowledge')" name="knowledge">
        <KnowledgePanel :summary-genre="knowledgeData?.summaryGenre ?? indexStatus?.summaryGenre ?? null"
          :payload="knowledgeData?.payload ?? null" :loading="knowledgeLoading" :error="knowledgeError"
          :ready="indexStatus?.status === 'ready'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  getDocumentIndexStatus,
  getDocumentSummary,
  getDocumentKnowledge,
  streamAskAboutSelection,
  streamRagAsk,
  streamTranslate,
  triggerDocumentIndex,
  SUMMARY_GENRE_GROUPS,
  streamSolveMath,
  getFileAiChatSession,
  clearFileAiChatSession,
  appendFileAiChatMessage,
  getTtsVoices,
  synthesizeSpeech,
  type AiChatMessage,
  type DocumentIndexStatus,
  type DocumentIndexStatusData,
  type DocumentKnowledgeData,
  type DocumentSummaryData,
  type FileAiChatMode,
  type SummaryGenre,
  type TranslateTargetLang,
  type TtsStyleId,
  type TtsVoice,
} from '@api/ai'
import { useAuthStore } from '@stores/auth'
import {
  createWrongQuestion,
  listWrongQuestions,
  WRONG_QUESTION_DIFFICULTIES,
  type WrongQuestionDifficulty,
  type WrongQuestionItem,
} from '@api/wrong-questions'
import { renderMarkdown } from '@utils/renderMarkdown'
import SummaryPanel from '@components/SummaryPanel/index.vue'
import KnowledgePanel from '@components/KnowledgePanel/index.vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'

const SELECTED_PREVIEW_MAX = 200
const INDEX_POLL_INTERVAL_MS = 2500

const INDEX_ACTIVE_STATUSES: DocumentIndexStatus[] = [
  'pending',
  'extracting',
  'chunking',
  'embedding',
  'summarizing',
  'extracting_knowledge',
]

type UiChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

let chatIdSeq = 0
function genChatId(): string {
  chatIdSeq += 1
  return `chat-${Date.now()}-${chatIdSeq}`
}

const props = withDefaults(
  defineProps<{
    fileId: number
    fileName?: string
    selectedText?: string
    /** 仅图片预览开启解题模式入口 */
    enableSolveMode?: boolean
    /**
     * 是否允许划词问答。
     * 扫描 PDF 无文字层时应为 false：禁用划词并默认全文问答。
     */
    selectionEnabled?: boolean
  }>(),
  {
    enableSolveMode: false,
    selectionEnabled: true,
  },
)

const emit = defineEmits<{
  (e: 'update:selectedText', v: string): void
}>()

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()

const selectedText = computed({
  get: () => props.selectedText ?? '',
  set: (v) => emit('update:selectedText', v),
})

const question = ref('')
/** 默认划词；扫描件等无文字层场景由 selectionEnabled 切到 rag */
const chatMode = ref<FileAiChatMode>(
  props.selectionEnabled === false ? 'rag' : 'selection',
)
/** 划词 / RAG / 解题 三套独立会话（与落盘 mode 对齐） */
const selectionMessages = ref<UiChatMessage[]>([])
const ragMessages = ref<UiChatMessage[]>([])
const solveMessages = ref<UiChatMessage[]>([])
const historyLoading = ref(false)
/** startSolve 等场景自行拉历史时，跳过 chatMode watch 的二次加载 */
let suppressHistoryLoad = false
/** 当前模式展示的消息列表 */
const activeChatMessages = computed(() => messagesRefFor(chatMode.value).value)

function messagesRefFor(mode: FileAiChatMode) {
  if (mode === 'solve') return solveMessages
  if (mode === 'rag') return ragMessages
  return selectionMessages
}
const asking = ref(false)
const askError = ref('')
const translateTargetLang = ref<TranslateTargetLang>('default')
let askAbort: AbortController | null = null

/** 管理员或后台开通后可用划词朗读 */
const canUseTts = computed(
  () =>
    authStore.user?.role === 'admin' || authStore.user?.canUseTts === true,
)
const ttsVoices = ref<TtsVoice[]>([])
const ttsVoiceId = ref('alex')
const ttsStyleId = ref<TtsStyleId>('default')
const ttsLoading = ref(false)
const ttsAudioUrl = ref('')
const ttsError = ref('')

function revokeTtsUrl() {
  if (ttsAudioUrl.value) {
    URL.revokeObjectURL(ttsAudioUrl.value)
    ttsAudioUrl.value = ''
  }
}

async function loadTtsVoices() {
  if (!canUseTts.value) return
  try {
    const data = await getTtsVoices()
    ttsVoices.value = data.voices
    if (
      !data.voices.some((v) => v.id === ttsVoiceId.value) &&
      data.voices[0]
    ) {
      ttsVoiceId.value = data.voices[0].id
    }
  } catch {
    /* 无权限或失败时保持空列表，由 submit 报错 */
  }
}

async function submitTts() {
  ttsError.value = ''
  if (!selectedText.value.trim()) {
    ttsError.value = t('preview.aiTtsNoSelection')
    return
  }
  ttsLoading.value = true
  try {
    const blob = await synthesizeSpeech({
      text: selectedText.value,
      voiceId: ttsVoiceId.value,
      style: ttsStyleId.value,
    })
    revokeTtsUrl()
    ttsAudioUrl.value = URL.createObjectURL(blob)
  } catch (e: unknown) {
    ttsError.value = e instanceof Error ? e.message : t('preview.aiTtsError')
  } finally {
    ttsLoading.value = false
  }
}

function downloadTts() {
  if (!ttsAudioUrl.value) return
  const a = document.createElement('a')
  a.href = ttsAudioUrl.value
  a.download = 'speech.mp3'
  a.click()
}

/** 存入错题本：考点（可多选 / 可新建） */
const saveTags = ref<string[]>([])
const tagOptions = ref<string[]>([])
const saveDifficulty = ref<WrongQuestionDifficulty>('medium')
const savingWrongBook = ref(false)

function collectTags(rows: WrongQuestionItem[]): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    for (const tag of row.tags || []) {
      const t0 = tag.trim()
      if (t0) set.add(t0)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

async function refreshTagOptions() {
  try {
    const res = await listWrongQuestions({ page: 1, pageSize: 100 })
    tagOptions.value = collectTags(res.items)
  } catch {
    /* 选项刷新失败不影响存入 */
  }
}

/** 有完整助手解答时可存入 */
const canSaveToWrongBook = computed(() => {
  if (chatMode.value !== 'solve') return false
  const lastAssistant = [...solveMessages.value]
    .reverse()
    .find((m) => m.role === 'assistant' && !m.streaming && m.content.trim())
  return Boolean(lastAssistant)
})

const indexStatus = ref<DocumentIndexStatusData | null>(null)
const indexTriggering = ref(false)
const indexPolling = ref(false)
let indexPollTimer: ReturnType<typeof setInterval> | null = null

const summaryGenre = ref<SummaryGenre>('novel')
const rightPanelTab = ref<'chat' | 'summary' | 'knowledge'>('chat')
const summaryData = ref<DocumentSummaryData | null>(null)
const summaryLoading = ref(false)
const summaryError = ref('')
const knowledgeData = ref<DocumentKnowledgeData | null>(null)
const knowledgeLoading = ref(false)
const knowledgeError = ref('')
const chatScrollRef = ref<HTMLElement | null>(null)

// 跟下拉体裁走，不要优先用 indexStatus（否则已用 paper 索引后，切到 lab_report 仍会显示知识点 Tab）
const showKnowledgeTab = computed(() => summaryGenre.value === 'paper')

const selectedPreview = computed(() => {
  const s = selectedText.value
  if (s.length <= SELECTED_PREVIEW_MAX) return s
  return `${s.slice(0, SELECTED_PREVIEW_MAX)}…`
})

const indexStatusLabel = computed(() => {
  const data = indexStatus.value
  if (!data || data.status === 'none') {
    return t('preview.aiIndexStatusNone')
  }
  if (data.status === 'ready') {
    return t('preview.aiIndexStatusReady', { count: data.chunkCount })
  }
  if (data.status === 'failed') {
    return t('preview.aiIndexStatusFailed', {
      reason: data.errorMessage || t('preview.jobUnknownError'),
    })
  }
  if (INDEX_ACTIVE_STATUSES.includes(data.status)) {
    return t('preview.aiIndexStatusPending', {
      msg: data.progressMsg || data.status,
      progress: data.progress,
    })
  }
  return data.status
})

const indexTriggerLabel = computed(() =>
  indexStatus.value?.status === 'ready' || indexStatus.value?.status === 'failed'
    ? t('preview.aiIndexRetrigger')
    : t('preview.aiIndexTrigger'),
)

watch(rightPanelTab, (tab) => {
  if (tab === 'summary' && indexStatus.value?.status === 'ready' && !summaryData.value && !summaryLoading.value) {
    void loadSummary()
  }
  if (tab === 'knowledge' && indexStatus.value?.status === 'ready' && !knowledgeData.value && !knowledgeLoading.value) {
    void loadKnowledge()
  }
})

watch(showKnowledgeTab, (visible) => {
  if (!visible && rightPanelTab.value === 'knowledge') {
    rightPanelTab.value = 'chat'
  }
})

watch(chatMode, (mode) => {
  if (mode === 'solve') {
    void refreshTagOptions()
  }
  if (suppressHistoryLoad) return
  void loadChatHistory(mode)
})

/** 扫描件探测完成后：禁用划词并切到全文问答 */
watch(
  () => props.selectionEnabled,
  (enabled) => {
    if (!enabled && chatMode.value === 'selection') {
      chatMode.value = 'rag'
    }
  },
)

watch(
  () => props.fileId,
  () => {
    selectionMessages.value = []
    ragMessages.value = []
    solveMessages.value = []
    void loadChatHistory(chatMode.value)
  },
)

onUnmounted(() => {
  stopAsk()
  stopIndexPolling()
  revokeTtsUrl()
})

/** 从服务端加载当前文件某模式历史 */
async function loadChatHistory(mode: FileAiChatMode) {
  if (!props.fileId) return
  historyLoading.value = true
  try {
    const data = await getFileAiChatSession(props.fileId, mode)
    const list = messagesRefFor(mode)
    list.value = data.messages.map((m) => ({
      id: `stored-${m.id}`,
      role: m.role,
      content: m.content,
    }))
    scrollChatToBottom()
  } catch {
    /* 拉历史失败不阻断对话 */
  } finally {
    historyLoading.value = false
  }
}

/** 流式成功后落盘一轮问答 */
async function persistChatRound(
  mode: FileAiChatMode,
  userContent: string,
  assistantContent: string,
  userMeta?: Record<string, unknown>,
) {
  if (!userContent.trim() || !assistantContent.trim()) return
  try {
    await appendFileAiChatMessage(props.fileId, mode, {
      role: 'user',
      content: userContent,
      meta: userMeta,
    })
    await appendFileAiChatMessage(props.fileId, mode, {
      role: 'assistant',
      content: assistantContent,
    })
  } catch {
    /* 落盘失败不打断 UI */
  }
}

function stopIndexPolling() {
  if (indexPollTimer) {
    clearInterval(indexPollTimer)
    indexPollTimer = null
  }
  indexPolling.value = false
}

function shouldPollIndex(status: DocumentIndexStatus): boolean {
  return INDEX_ACTIVE_STATUSES.includes(status)
}

async function refreshIndexStatus() {
  try {
    const data = await getDocumentIndexStatus(props.fileId)
    const prevStatus = indexStatus.value?.status
    indexStatus.value = data
    if (data.summaryGenre) {
      summaryGenre.value = data.summaryGenre
    }
    if (data.status === 'ready' && prevStatus !== 'ready') {
      void loadSummary()
      if (rightPanelTab.value === 'knowledge') {
        void loadKnowledge()
      }
    }
    if (shouldPollIndex(data.status)) {
      if (!indexPollTimer) {
        indexPolling.value = true
        indexPollTimer = setInterval(() => {
          void refreshIndexStatus()
        }, INDEX_POLL_INTERVAL_MS)
      }
    } else {
      stopIndexPolling()
    }
  } catch {
    /* 索引状态查询失败时保持当前展示 */
  }
}

async function loadSummary() {
  if (indexStatus.value?.status !== 'ready') {
    summaryData.value = null
    return
  }
  summaryLoading.value = true
  summaryError.value = ''
  try {
    summaryData.value = await getDocumentSummary(props.fileId, { type: 'book' })
  } catch (e: unknown) {
    summaryData.value = null
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      t('preview.aiSummaryLoadError')
    summaryError.value = msg
  } finally {
    summaryLoading.value = false
  }
}

async function loadKnowledge() {
  if (indexStatus.value?.status !== 'ready') {
    knowledgeData.value = null
    return
  }
  if (!showKnowledgeTab.value) {
    knowledgeData.value = null
    return
  }
  knowledgeLoading.value = true
  knowledgeError.value = ''
  try {
    knowledgeData.value = await getDocumentKnowledge(props.fileId)
  } catch (e: unknown) {
    knowledgeData.value = null
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      t('preview.aiKnowledgeLoadError')
    knowledgeError.value = msg
  } finally {
    knowledgeLoading.value = false
  }
}

async function triggerIndex() {
  if (indexTriggering.value) return
  indexTriggering.value = true
  summaryData.value = null
  summaryError.value = ''
  knowledgeData.value = null
  knowledgeError.value = ''
  const force =
    indexStatus.value?.status === 'ready' ||
    indexStatus.value?.status === 'failed' ||
    // Worker 强杀后可能卡在 ACTIVE：允许 force 顶替并走断点续建
    (indexStatus.value?.status != null &&
      INDEX_ACTIVE_STATUSES.includes(indexStatus.value.status))
  try {
    const data = await triggerDocumentIndex(props.fileId, summaryGenre.value, { force })
    indexStatus.value = data
    if (shouldPollIndex(data.status)) {
      stopIndexPolling()
      indexPolling.value = true
      indexPollTimer = setInterval(() => {
        void refreshIndexStatus()
      }, INDEX_POLL_INTERVAL_MS)
    }
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data
        ?.message || t('preview.aiIndexTriggerError')
    askError.value = msg
  } finally {
    indexTriggering.value = false
  }
}

function scrollChatToBottom() {
  void nextTick(() => {
    const el = chatScrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function clearChat() {
  stopAsk()
  const mode = chatMode.value
  messagesRefFor(mode).value = []
  question.value = ''
  askError.value = ''
  try {
    await clearFileAiChatSession(props.fileId, mode)
  } catch {
    /* 忽略清空失败 */
  }
}

function stopAsk() {
  askAbort?.abort()
  askAbort = null
  asking.value = false
  for (const msg of selectionMessages.value) {
    if (msg.streaming) msg.streaming = false
  }
  for (const msg of ragMessages.value) {
    if (msg.streaming) msg.streaming = false
  }
  for (const msg of solveMessages.value) {
    if (msg.streaming) msg.streaming = false
  }
}

async function submitChat() {
  if (asking.value) return
  askError.value = ''
  const userContent = question.value.trim()
  if (!userContent) {
    askError.value = t('preview.aiAskNoQuestion')
    return
  }

  if (chatMode.value === 'selection') {
    if (!selectedText.value) {
      askError.value = t('preview.aiAskNoSelection')
      return
    }
  } else if (chatMode.value === 'rag') {
    if (indexStatus.value?.status !== 'ready') {
      askError.value = t('preview.aiRagNotReady')
      return
    }
  }
  // solve：不要求选中 / 索引

  const list = messagesRefFor(chatMode.value)
  const history: AiChatMessage[] = list.value
    .filter((m) => !m.streaming && m.content.trim())
    .map(({ role, content }) => ({ role, content }))

  const userId = genChatId()
  const assistantId = genChatId()
  list.value.push({ id: userId, role: 'user', content: userContent })
  list.value.push({ id: assistantId, role: 'assistant', content: '', streaming: true })
  question.value = ''
  scrollChatToBottom()

  asking.value = true
  askAbort = new AbortController()
  const modeSnapshot = chatMode.value
  const selectionSnapshot = selectedText.value

  try {
    const onChunk = (chunk: string) => {
      const msg = list.value.find((m) => m.id === assistantId)
      if (msg) {
        msg.content += chunk
        scrollChatToBottom()
      }
    }

    if (modeSnapshot === 'solve') {
      await streamSolveMath({
        fileId: props.fileId,
        question: userContent,
        messages: history,
        fileName: props.fileName,
        signal: askAbort.signal,
        onChunk,
      })
    } else if (modeSnapshot === 'selection') {
      await streamAskAboutSelection({
        fileId: props.fileId,
        question: userContent,
        selectedText: selectionSnapshot,
        messages: history,
        fileName: props.fileName,
        signal: askAbort.signal,
        onChunk,
      })
    } else {
      await streamRagAsk({
        fileId: props.fileId,
        question: userContent,
        messages: history,
        signal: askAbort.signal,
        onChunk,
      })
    }

    const assistantMsg = list.value.find((m) => m.id === assistantId)
    if (assistantMsg?.content.trim()) {
      await persistChatRound(
        modeSnapshot,
        userContent,
        assistantMsg.content,
        modeSnapshot === 'selection'
          ? { selectedText: selectionSnapshot }
          : undefined,
      )
    }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return
    }
    const idx = list.value.findIndex((m) => m.id === assistantId)
    if (idx >= 0 && !list.value[idx]?.content) {
      list.value.splice(idx, 1)
    }
    const fallback =
      modeSnapshot === 'solve'
        ? t('preview.solveMathError')
        : t('preview.aiAskError')
    const msg = e instanceof Error ? e.message : fallback
    askError.value = msg || fallback
  } finally {
    const msg = list.value.find((m) => m.id === assistantId)
    if (msg) msg.streaming = false
    asking.value = false
    askAbort = null
    scrollChatToBottom()
  }
}

function translateLangLabel(lang: TranslateTargetLang): string {
  if (lang === 'default') return t('preview.aiTranslateDefault')
  if (lang === 'zh') return t('preview.aiTranslateZh')
  if (lang === 'en') return t('preview.aiTranslateEn')
  return t('preview.aiTranslateJa')
}

async function submitTranslate() {
  if (asking.value) return
  if (chatMode.value !== 'selection') return
  askError.value = ''

  if (!selectedText.value.trim()) {
    askError.value = t('preview.aiTranslateNoSelection')
    return
  }

  rightPanelTab.value = 'chat'
  const selectionSnapshot = selectedText.value
  const userContent = t('preview.aiTranslateUserMsg', {
    lang: translateLangLabel(translateTargetLang.value),
  })
  const userId = genChatId()
  const assistantId = genChatId()
  selectionMessages.value.push({ id: userId, role: 'user', content: userContent })
  selectionMessages.value.push({
    id: assistantId,
    role: 'assistant',
    content: '',
    streaming: true,
  })
  scrollChatToBottom()

  asking.value = true
  askAbort = new AbortController()

  try {
    await streamTranslate({
      fileId: props.fileId,
      text: selectionSnapshot,
      targetLang: translateTargetLang.value,
      fileName: props.fileName,
      signal: askAbort.signal,
      onChunk: (chunk: string) => {
        const msg = selectionMessages.value.find((m) => m.id === assistantId)
        if (msg) {
          msg.content += chunk
          scrollChatToBottom()
        }
      },
    })
    const assistantMsg = selectionMessages.value.find((m) => m.id === assistantId)
    if (assistantMsg?.content.trim()) {
      await persistChatRound('selection', userContent, assistantMsg.content, {
        selectedText: selectionSnapshot,
        kind: 'translate',
        targetLang: translateTargetLang.value,
      })
    }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return
    }
    const idx = selectionMessages.value.findIndex((m) => m.id === assistantId)
    if (idx >= 0 && !selectionMessages.value[idx]?.content) {
      selectionMessages.value.splice(idx, 1)
    }
    const msg = e instanceof Error ? e.message : t('preview.aiTranslateError')
    askError.value = msg || t('preview.aiTranslateError')
  } finally {
    const msg = selectionMessages.value.find((m) => m.id === assistantId)
    if (msg) msg.streaming = false
    asking.value = false
    askAbort = null
    scrollChatToBottom()
  }
}

function reset() {
  stopAsk()
  stopIndexPolling()
  selectedText.value = ''
  question.value = ''
  selectionMessages.value = []
  ragMessages.value = []
  solveMessages.value = []
  askError.value = ''
  translateTargetLang.value = 'default'
  revokeTtsUrl()
  ttsError.value = ''
  indexStatus.value = null
  indexTriggering.value = false
  chatMode.value = props.selectionEnabled === false ? 'rag' : 'selection'
  rightPanelTab.value = 'chat'
  summaryGenre.value = 'novel'
  summaryData.value = null
  summaryLoading.value = false
  summaryError.value = ''
  knowledgeData.value = null
  knowledgeLoading.value = false
  knowledgeError.value = ''
}

function activate() {
  void refreshIndexStatus()
  void loadChatHistory(chatMode.value)
  void loadTtsVoices()
}

/**
 * 切入解题：切到 solve 并加载落盘历史；
 * 若尚无历史则发起默认首轮解题
 */
async function startSolve() {
  if (!props.enableSolveMode) return
  stopAsk()
  askError.value = ''
  question.value = ''
  suppressHistoryLoad = true
  chatMode.value = 'solve'
  suppressHistoryLoad = false
  rightPanelTab.value = 'chat'
  await loadChatHistory('solve')
  if (solveMessages.value.length > 0) {
    void refreshTagOptions()
    return
  }

  const userContent = t('preview.solveMathDefaultQuestion')
  const userId = genChatId()
  const assistantId = genChatId()
  solveMessages.value.push({ id: userId, role: 'user', content: userContent })
  solveMessages.value.push({
    id: assistantId,
    role: 'assistant',
    content: '',
    streaming: true,
  })
  scrollChatToBottom()

  asking.value = true
  askAbort = new AbortController()
  try {
    await streamSolveMath({
      fileId: props.fileId,
      question: userContent,
      messages: [],
      fileName: props.fileName,
      signal: askAbort.signal,
      onChunk: (chunk: string) => {
        const msg = solveMessages.value.find((m) => m.id === assistantId)
        if (msg) {
          msg.content += chunk
          scrollChatToBottom()
        }
      },
    })
    const assistantMsg = solveMessages.value.find((m) => m.id === assistantId)
    if (assistantMsg?.content.trim()) {
      await persistChatRound('solve', userContent, assistantMsg.content)
    }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    const idx = solveMessages.value.findIndex((m) => m.id === assistantId)
    if (idx >= 0 && !solveMessages.value[idx]?.content) {
      solveMessages.value.splice(idx, 1)
    }
    askError.value =
      (e instanceof Error ? e.message : '') || t('preview.solveMathError')
  } finally {
    const msg = solveMessages.value.find((m) => m.id === assistantId)
    if (msg) msg.streaming = false
    asking.value = false
    askAbort = null
    scrollChatToBottom()
    void refreshTagOptions()
  }
}

/** 将当前解题结果存入错题本（题干由服务端对原图 OCR，不传提示词） */
async function saveToWrongBook() {
  if (!canSaveToWrongBook.value || savingWrongBook.value) return
  const lastAssistant = [...solveMessages.value]
    .reverse()
    .find((m) => m.role === 'assistant' && !m.streaming && m.content.trim())
  if (!lastAssistant) return

  const tags = saveTags.value.map((s) => s.trim()).filter(Boolean)

  savingWrongBook.value = true
  try {
    const item = await createWrongQuestion({
      userFileId: props.fileId,
      answerText: lastAssistant.content,
      tags,
      difficulty: saveDifficulty.value,
    })
    if (tags.length) {
      const set = new Set(tagOptions.value)
      for (const tag of tags) set.add(tag)
      tagOptions.value = [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    }
    ElMessage.success(t('preview.saveToWrongBookSuccess'))
    try {
      await ElMessageBox.confirm(
        t('preview.saveToWrongBookGoConfirm'),
        t('preview.saveToWrongBook'),
        {
          type: 'success',
          confirmButtonText: t('preview.saveToWrongBookGo'),
          cancelButtonText: t('preview.saveToWrongBookStay'),
        },
      )
      void router.push(`/wrong-questions/${item.id}`)
    } catch {
      /* 用户选择留在预览 */
    }
  } catch (e) {
    ElMessage.error(
      (e instanceof Error ? e.message : '') || t('preview.saveToWrongBookError'),
    )
  } finally {
    savingWrongBook.value = false
  }
}

defineExpose({ reset, activate, startSolve })
</script>

<style lang="scss" scoped>
.ai-chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-fill-color-blank, #fff);
  overflow: hidden;
}

.ai-chat-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
  min-width: 0;
}

.ai-chat-header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.ai-chat-header-main {
  min-width: 0;
  flex: 1 1 auto;
}

.ai-chat-clear {
  flex-shrink: 0;
}

.ai-chat-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-start;
  min-width: 0;
  width: 100%;
}

.ai-translate-lang {
  width: 100px;
}

.ai-tts-voice {
  width: 110px;
}

.ai-tts-style {
  width: 100px;
}

.ai-tts-player {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  flex-shrink: 0;
}

.ai-tts-audio {
  max-width: 100%;
  height: 32px;
}

.ai-tts-error {
  margin: 0;
  width: 100%;
  font-size: 12px;
  color: var(--el-color-danger);
}

.ai-tts-error--alone {
  padding: 0 14px 8px;
}

.ai-chat-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.ai-chat-hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}

.ai-solve-verify {
  margin: 0 0 8px;
  padding: 0 14px;
  font-size: 12px;
  color: var(--el-color-warning);
  flex-shrink: 0;
}

.ai-solve-save-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 0 14px 8px;
  flex-shrink: 0;
}

.ai-solve-difficulty {
  width: 110px;
  flex-shrink: 0;
}

.ai-solve-tags {
  flex: 1;
  min-width: 0;
}

.ai-index-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-blank, #fff);
  flex-shrink: 0;
}

.ai-index-status {
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.4;
}

.ai-index-genre {
  width: 148px;
  flex-shrink: 0;
}

.ai-right-tabs {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  :deep(.el-tabs__header) {
    margin: 0;
    padding: 0 14px;
    flex-shrink: 0;
  }

  :deep(.el-tabs__content) {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  /* 勿写 display:flex 覆盖 EP 隐藏未激活 pane；由内部 .ai-chat-tab 承担列布局 */
  :deep(.el-tab-pane) {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
}

.ai-chat-tab {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-chat-mode {
  padding: 8px 14px 0;
  flex-shrink: 0;
}

.ai-selection-disabled-tip {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}

.ai-chat-context {
  padding: 8px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter, #f5f7fa);
  flex-shrink: 0;
}

.ai-chat-context-label {
  display: block;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.ai-chat-context-text,
.ai-chat-context-empty {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  max-height: 72px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-chat-context-empty {
  color: var(--el-text-color-placeholder);
}

.ai-chat-messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-chat-empty {
  margin: auto 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  line-height: 1.6;
}

.ai-chat-bubble {
  max-width: 92%;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.55;
}

.ai-chat-bubble--user {
  align-self: flex-end;
  background: var(--el-color-primary-light-9, #ecf5ff);
  border: 1px solid var(--el-color-primary-light-7, #c6e2ff);
}

.ai-chat-bubble--assistant {
  align-self: flex-start;
  background: var(--el-fill-color-lighter, #f5f7fa);
  border: 1px solid var(--el-border-color-lighter);
}

.ai-chat-bubble-role {
  display: block;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--el-text-color-secondary);
}

.ai-chat-bubble-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-primary);
}

.ai-chat-bubble-content--md {
  white-space: normal;

  :deep(p) {
    margin: 0 0 0.6em;

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(strong) {
    font-weight: 600;
  }

  :deep(ul),
  :deep(ol) {
    margin: 0.4em 0 0.6em;
    padding-left: 1.4em;
  }

  :deep(li + li) {
    margin-top: 0.25em;
  }

  :deep(code) {
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.92em;
    background: var(--el-fill-color, #f0f2f5);
  }

  :deep(pre) {
    margin: 0.5em 0;
    padding: 8px 10px;
    border-radius: 6px;
    overflow: auto;
    background: var(--el-fill-color, #f0f2f5);

    code {
      padding: 0;
      background: transparent;
    }
  }

  :deep(blockquote) {
    margin: 0.5em 0;
    padding-left: 0.8em;
    border-left: 3px solid var(--el-border-color);
    color: var(--el-text-color-secondary);
  }
}

.err-line {
  margin: 0 14px 8px;
  font-size: 12px;
  color: var(--el-color-danger);
}

.ai-chat-input {
  padding: 10px 14px 14px;
  border-top: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}

.ai-chat-input-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
