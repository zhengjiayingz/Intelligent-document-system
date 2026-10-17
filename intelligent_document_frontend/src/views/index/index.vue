<template>
  <div class="index-container">
    <!-- 左侧导航栏 -->
    <Sidebar />

    <!-- 主要内容区域 -->
    <el-container class="main-container">
      <!-- 顶部工具栏 -->
      <GlobalHeader>
        <template #left>
          <FileUpload ref="fileUploadRef" :parent-id="currentFolderId" :show-drop-zone="false"
            @upload-success="handleUploadSuccess" @upload-error="handleUploadError" :interceptImage="true"
            @select-image="handleSelectImage" />
          <el-button :icon="FolderAdd" @click="showCreateFolderDialog">{{ t('index.createFolder') }}</el-button>
        </template>
        <template #right>
          <el-button @click="semanticSearchVisible = true">
            {{ t('semanticSearch.title') }}
          </el-button>
          <el-button @click="duplicatesVisible = true">
            {{ t('duplicates.title') }}
          </el-button>
        </template>
      </GlobalHeader>

      <!-- 文件操作工具栏 -->
      <div class="toolbar">
        <div class="toolbar-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item @click="navigateToFolder()" style="cursor: pointer;">{{ t('index.toolbar.all')
            }}</el-breadcrumb-item>
            <el-breadcrumb-item v-for="folder in breadcrumbs" :key="folder.id" @click="navigateToFolder(folder.id)"
              style="cursor: pointer;">
              {{ folder.name }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="toolbar-right">
          <el-button-group>
            <el-button :icon="List" @click="viewMode = 'list'" :type="viewMode === 'list' ? 'primary' : ''">
              {{ t('index.toolbar.list') }}
            </el-button>
            <el-button :icon="Grid" @click="viewMode = 'grid'" :type="viewMode === 'grid' ? 'primary' : ''">
              {{ t('index.toolbar.grid') }}
            </el-button>
          </el-button-group>
        </div>
      </div>

      <FileFilterBar :model-value="fileFilters" :features="driveFilterBarFeatures" :tag-options="tagOptions"
        @update:model-value="onFileFiltersUpdate" @apply="loadFiles" />

      <!-- 批量操作工具栏：始终占位，避免选中时高度变化导致双击第二次点空 -->
      <div class="batch-toolbar" :class="{ 'is-idle': selectedFiles.size === 0 }">
        <template v-if="selectedFiles.size > 0">
          <div class="batch-info">
            已选中 {{ selectedFiles.size }} 项
            <el-button link type="primary" @click="clearSelection">取消选择</el-button>
          </div>
          <div class="batch-actions">
            <el-button type="primary" :icon="Document" @click="batchDownload">{{ t('fileList.action.download') || '下载'
            }}</el-button>
            <el-button type="primary" plain :icon="Share" @click="openShareDialog">分享</el-button>
            <el-button type="success" :icon="Folder" @click="batchMove">{{ t('fileList.action.move') }}</el-button>
            <el-button type="warning" plain @click="openBatchTagDialog">打标签</el-button>
            <el-button type="danger" :icon="Delete" @click="batchDelete">{{ t('fileList.action.delete') }}</el-button>
          </div>
        </template>
      </div>


      <!-- 文件列表区域：在此区域监听拖拽，避免未 preventDefault 时浏览器默认打开文件 -->
      <el-main class="file-content" @dragover.prevent @drop.prevent="handleDrop" @dragenter="handleDragEnter"
        @dragleave="handleDragLeave">
        <!-- 拖拽提示层（仅展示；事件由父级 el-main 统一处理） -->
        <div class="drop-zone-overlay" :class="{ show: isDragOver }">
          <div class="drop-zone-content">
            <el-icon class="drop-icon" size="64">
              <Upload />
            </el-icon>
            <p class="drop-text">拖拽文件到此处上传</p>
          </div>
        </div>

        <!-- 文件列表 -->
        <!-- 文件列表 -->
        <FileList :files="filteredFiles" :view-mode="viewMode" :loading="loading" :selected-files="selectedFiles"
          :sort-by="sortBy" :sort-order="sortOrder" @click-file="handleFileClick" @dblclick-file="handleFileDoubleClick"
          @context-menu="handleRightClick" @rename="showRenameDialog" @delete="deleteFile" @move="handleMoveFile"
          @download="downloadFile" @history="showHistory" @file-drop="handleFileItemDrop"
          @sort-change="handleSortChange" @toggle-selection="toggleSelection" @select-all="selectAll"
          @tag="handleTagFile" />
      </el-main>
    </el-container>

    <!-- 创建文件夹对话框 -->
    <el-dialog v-model="createFolderDialogVisible" title="新建文件夹" width="400px">
      <el-form @submit.prevent="createFolder">
        <el-form-item label="文件夹名称">
          <el-input v-model="newFolderName" placeholder="请输入文件夹名称" maxlength="255" show-word-limit
            @keyup.enter="createFolder" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createFolderDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="createFolder" :loading="isCreatingFolder">
          创建
        </el-button>
      </template>
    </el-dialog>

    <!-- 图片裁剪弹窗 -->
    <image-cropper-dialog v-model="showCropper" :img-file="croppingFile as any" @upload="handleCroppedUpload" />

    <!-- 重命名对话框 -->
    <el-dialog v-model="renameDialogVisible" title="重命名" width="400px">
      <el-form @submit.prevent="confirmRename">
        <el-form-item label="新名称">
          <el-input v-model="newFileName" placeholder="请输入新名称" maxlength="255" show-word-limit
            @keyup.enter="confirmRename" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renameDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmRename" :loading="isRenaming">
          确定
        </el-button>
      </template>
    </el-dialog>
    <ImageDocumentPreviewDialog
      v-model="imagePreviewVisible"
      :file-id="currentImageFile?.id"
      :file-name="currentImageFile?.fileName"
      :gallery-url-list="imageGalleryUrlList"
      :gallery-initial-index="imageGalleryInitialIndex"
      @download="currentImageFile && downloadFile(currentImageFile)"
    />

    <!-- 视频播放弹窗 -->
    <video-player-dialog v-model="videoPlayerVisible" :title="currentVideoTitle" :video-url="currentVideoUrl"
      :file-name="currentVideoTitle" :file-id="currentVideoFile?.id" :media-kind="currentMediaKind"
      @download="currentVideoFile && downloadFile(currentVideoFile)" />

    <!-- 移动文件弹窗 -->
    <MoveDialog v-model="moveDialogVisible" :files-to-move="filesToMove" @success="handleMoveSuccess" />

    <!-- 历史版本弹窗 -->
    <FileHistoryDialog v-model="showHistoryDialog" :file-id="historyFile?.id"
      @rollback-success="handleHistorySuccess" />

    <!-- Office 文档预览弹窗 -->
    <OfficePreviewDialog v-model="officePreviewVisible" :file-id="currentOfficeFile?.id"
      :file-name="currentOfficeFile?.fileName"
      :file-size-bytes="currentOfficeFile?.storage?.fileSize ?? currentOfficeFile?.fileSize ?? 0"
      :enable-ai-panel="officePreviewEnableAi" @download="currentOfficeFile && downloadFile(currentOfficeFile)" />

    <PdfDocumentPreviewDialog v-model="pdfPreviewVisible" :file-id="currentPdfFile?.id"
      :file-name="currentPdfFile?.fileName" @download="currentPdfFile && downloadFile(currentPdfFile)" />

    <TextChunkPreviewDialog v-model="textChunkPreviewVisible" :file-id="textChunkFileId"
      :file-name="textChunkFileName" @notes-saved="loadFiles" />

    <!-- 压缩包在线解压到当前网盘目录 -->
    <ArchiveExtractDialog v-if="archiveExtractTarget" v-model="archiveExtractVisible" :file-id="archiveExtractTarget.id"
      :parent-id="currentFolderId" :current-dir-name="archiveExtractCurrentDirLabel" @success="loadFiles" />

    <FileTagDialog v-model="tagDialogVisible" :files="filesForTagDialog" @success="onTagDialogSuccess" />

    <ShareLinkDialog v-model="shareDialogVisible" :files="shareDialogFiles" />

    <SemanticSearchDialog v-model="semanticSearchVisible" @select="onSemanticSearchSelect" />
    <DuplicatesDialog v-model="duplicatesVisible" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox, ElImageViewer } from 'element-plus'
import {
  User, ArrowDown, Folder, FolderAdd,
  Clock, Star, Delete, List, Grid, MoreFilled, Document, Download, Share
} from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@stores/auth'
import { authApi } from '@api/auth'
import fileApiService from '@api/file'
import type {
  FileItem as FileInfo,
  FileTagItem,
  FileQueryParams,
  FileTypeCategory,
  SemanticSearchItem,
  ImageSearchItem,
} from '@typing/file'
import type { FileFilterState, FileFilterFeatures } from '@typing/fileFilter'
import { defaultFileFilterState, defaultFileFilterFeatures } from '@typing/fileFilter'
import FileUpload from '@components/FileUpload/index.vue'
import ImageCropperDialog from '@components/ImageCropperDialog/index.vue'
import VideoPlayerDialog from '@components/VideoPlayerDialog/index.vue'
import MoveDialog from '@components/MoveDialog/index.vue'
import FileHistoryDialog from '@components/FileHistoryDialog/index.vue'
import OfficePreviewDialog from '@components/OfficePreviewDialog/index.vue'
import PdfDocumentPreviewDialog from '@components/PdfDocumentPreviewDialog/index.vue'
import TextChunkPreviewDialog from '@components/TextChunkPreviewDialog/index.vue'
import ArchiveExtractDialog from '@components/ArchiveExtractDialog/index.vue'
import FileTagDialog from '@components/FileTagDialog/index.vue'
import ShareLinkDialog from '@components/ShareLinkDialog/index.vue'
// import CustomImageViewer from '@components/CustomImageViewer/index.vue'
import ImageDocumentPreviewDialog from '@components/ImageDocumentPreviewDialog/index.vue'
import Sidebar from './cpns/Sidebar.vue'
import FileList from './cpns/FileList.vue'
import GlobalHeader from '@components/GlobalHeader/index.vue'
import SemanticSearchDialog from '@components/SemanticSearchDialog/index.vue'
import DuplicatesDialog from '@components/DuplicatesDialog/index.vue'
import FileFilterBar from '@components/FileFilterBar/index.vue'
import { formatFileSize } from '@utils/fileUpload'
import { buildFileThumbnailUrl } from '@utils/fileThumbnailUrl'
import {
  isArchiveFile,
  isZipExtractableOnline,
  canUseOnlineArchiveExtract
} from '@utils/archive'
import {
  DRIVE_FILES_CHANGED,
  type DriveFilesChangedDetail,
} from '@utils/driveEvents'
import { compareFileEntryCategory, getFileEntryCategory } from '@utils/fileCategory'
import { isAudioMedia, isVideoMedia } from '@utils/mediaFileDetect'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t, locale } = useI18n()

// 响应式数据
const viewMode = ref<'list' | 'grid'>('list')
const files = ref<FileInfo[]>([])
const currentFolderId = ref<number | undefined>(undefined)
const breadcrumbs = ref<{ id: number; name: string }[]>([])
const isDragOver = ref(false)
const loading = ref(false)

const fileFilters = reactive<FileFilterState>(defaultFileFilterState())

/** 首页筛选：可在此写入 { tag: false } 等；分类视图下自动隐藏「文件类型」避免与侧栏重复 */
const driveFilterFeatures = {} as Partial<FileFilterFeatures>

const driveFilterBarFeatures = computed(() => ({
  ...defaultFileFilterFeatures,
  ...driveFilterFeatures,
  ...(route.query.type ? { fileTypeCategory: false } : {})
}))

function onFileFiltersUpdate(v: FileFilterState) {
  Object.assign(fileFilters, v)
}

const tagOptions = ref<FileTagItem[]>([])
const tagDialogVisible = ref(false)
const filesForTagDialog = ref<FileInfo[]>([])

const loadTagOptions = async () => {
  try {
    tagOptions.value = await fileApiService.listFileTags()
  } catch {
    /* 筛选下拉失败时忽略 */
  }
}

const openBatchTagDialog = () => {
  const list = files.value.filter((f) => selectedFiles.value.has(f.id))
  if (list.length === 0) return
  filesForTagDialog.value = list
  tagDialogVisible.value = true
}

const handleTagFile = (file: FileInfo) => {
  filesForTagDialog.value = [file]
  tagDialogVisible.value = true
}

const onTagDialogSuccess = () => {
  void loadFiles()
  void loadTagOptions()
}

const shareDialogVisible = ref(false)
const shareDialogFiles = ref<FileInfo[]>([])

const openShareDialog = () => {
  const list = files.value.filter((f) => selectedFiles.value.has(f.id))
  if (list.length === 0) {
    ElMessage.warning('请先勾选要分享的文件或文件夹')
    return
  }
  shareDialogFiles.value = list
  shareDialogVisible.value = true
}

// 对话框相关
const createFolderDialogVisible = ref(false)
const newFolderName = ref('')
const isCreatingFolder = ref(false)

const renameDialogVisible = ref(false)
const newFileName = ref('')
const currentRenameFile = ref<FileInfo | null>(null)
const isRenaming = ref(false)

const showCropper = ref(false)
const croppingFile = ref<File | null>(null)
const fileUploadRef = ref()

const showHistoryDialog = ref(false)
const historyFile = ref<FileInfo | null>(null)

// Office 文档预览相关
const officePreviewVisible = ref(false)
const officePreviewEnableAi = ref(false)
const currentOfficeFile = ref<FileInfo | null>(null)

// PDF 文档预览（含 AI）
const pdfPreviewVisible = ref(false)
const currentPdfFile = ref<FileInfo | null>(null)

// 视频播放相关
const videoPlayerVisible = ref(false)
const currentVideoUrl = ref('')
const currentVideoTitle = ref('')
const currentVideoFile = ref<FileInfo | null>(null)
const currentMediaKind = ref<'video' | 'audio'>('video')

// 移动文件相关
const moveDialogVisible = ref(false)
const filesToMove = ref<FileInfo[]>([])

const handleSelectImage = (file: File) => {
  croppingFile.value = file
  showCropper.value = true
}

// 计算属性
const sortBy = ref<'name' | 'size' | 'time' | 'type'>('time')
const sortOrder = ref<'asc' | 'desc'>('desc')
const selectedFiles = ref<Set<number>>(new Set())

// 计算属性
const filteredFiles = computed(() => {
  const result = [...files.value]

  // 排序（筛选已由服务端完成）
  return result.sort((a: FileInfo, b: FileInfo) => {
    // 按类型排序时：顺序完全由类型/名称决定；其它列排序时文件夹优先
    if (sortBy.value !== 'type') {
      if (a.fileType === 'folder' && b.fileType !== 'folder') return -1
      if (a.fileType !== 'folder' && b.fileType === 'folder') return 1
    }

    let compareResult = 0
    switch (sortBy.value) {
      case 'name':
        compareResult = a.fileName.localeCompare(b.fileName, 'zh-CN')
        break
      case 'size':
        compareResult = (a.fileSize || 0) - (b.fileSize || 0)
        break
      case 'type':
        compareResult = compareFileEntryCategory(getFileEntryCategory(a), getFileEntryCategory(b))
        if (compareResult === 0) {
          compareResult = a.fileName.localeCompare(b.fileName, 'zh-CN')
        }
        break
      case 'time':
      default:
        compareResult = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        break
    }

    return sortOrder.value === 'asc' ? compareResult : -compareResult
  })
})

const handleSortChange = (column: 'name' | 'size' | 'time' | 'type') => {
  if (sortBy.value === column) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = column
    sortOrder.value = 'desc' // 默认降序
  }
}

// 多选相关逻辑
const toggleSelection = (file: FileInfo, multiSelect = false) => {
  if (multiSelect) {
    if (selectedFiles.value.has(file.id)) {
      selectedFiles.value.delete(file.id)
    } else {
      selectedFiles.value.add(file.id)
    }
  } else {
    // 单选模式 (或者点击非选框区域)
    selectedFiles.value.clear()
    selectedFiles.value.add(file.id)
  }
}

const clearSelection = () => {
  selectedFiles.value.clear()
}

const selectAll = (checked: boolean) => {
  if (checked) {
    files.value.forEach(f => selectedFiles.value.add(f.id))
  } else {
    selectedFiles.value.clear()
  }
}

// 生命周期
const onDriveFilesChanged = (event: Event) => {
  const { parentId } = (event as CustomEvent<DriveFilesChangedDetail>).detail ?? {
    parentId: null,
  }
  const viewingParent = currentFolderId.value ?? null
  if (parentId === viewingParent) {
    void loadFiles()
  }
  void authStore.refreshUserInfo()
}

onMounted(() => {
  loadFiles()
  loadTagOptions()
  window.addEventListener(DRIVE_FILES_CHANGED, onDriveFilesChanged)
})

onUnmounted(() => {
  window.removeEventListener(DRIVE_FILES_CHANGED, onDriveFilesChanged)
})

// 加载文件列表
const loadFiles = async () => {
  try {
    loading.value = true
    const params: FileQueryParams = {}

    const routeType = route.query.type
    if (routeType && typeof routeType === 'string') {
      params.type = routeType as FileTypeCategory
    } else {
      params.parentId = currentFolderId.value ?? ''
      if (fileFilters.type && fileFilters.type !== 'all') {
        params.type = fileFilters.type
      }
    }

    if (fileFilters.q?.trim()) {
      params.q = fileFilters.q.trim()
    }
    if (fileFilters.createdFrom) {
      params.createdFrom = fileFilters.createdFrom
    }
    if (fileFilters.createdTo) {
      params.createdTo = fileFilters.createdTo
    }
    if (fileFilters.entryKind && fileFilters.entryKind !== 'all') {
      params.entryKind = fileFilters.entryKind
    }
    if (fileFilters.tagId != null) {
      params.tagId = fileFilters.tagId
    }

    files.value = await fileApiService.getFiles(params)
  } catch (error: any) {
    ElMessage.error('加载文件列表失败: ' + (error.message || '未知错误'))
  } finally {
    loading.value = false
  }
}

watch(
  () => route.query.type,
  () => {
    if (route.query.type) {
      currentFolderId.value = undefined
      breadcrumbs.value = []
      fileFilters.q = ''
    }
    loadFiles()
  }
)

// 文件上传成功处理
const handleUploadSuccess = (fileInfo: FileInfo) => {
  files.value.unshift(fileInfo)
  ElMessage.success('文件上传成功')
  // 刷新用户信息以更新存储配额显示
  authStore.refreshUserInfo()
}

// 文件上传错误处理
const handleUploadError = (error: string) => {
  ElMessage.error('文件上传失败: ' + error)
}

// 拖拽上传：必须在可接收拖放的容器上 dragover/drop 调用 preventDefault，否则会触发浏览器默认行为（打开文件等）
const handleDragEnter = (event: DragEvent) => {
  event.preventDefault()
  if (event.dataTransfer?.types?.includes('Files')) {
    isDragOver.value = true
  }
}

const handleDragLeave = (event: DragEvent) => {
  const main = event.currentTarget as HTMLElement
  const rel = event.relatedTarget as Node | null
  if (!rel || !main.contains(rel)) {
    isDragOver.value = false
  }
}

const handleDrop = (event: DragEvent) => {
  isDragOver.value = false
  const list = event.dataTransfer?.files
  if (list?.length && fileUploadRef.value?.addDroppedFiles) {
    fileUploadRef.value.addDroppedFiles(Array.from(list))
  }
}

// 文件点击处理
const handleFileClick = (file: FileInfo) => {
  // 单击选中文件
  console.log('选中文件:', file)
}

const semanticSearchVisible = ref(false)
const duplicatesVisible = ref(false)

const onSemanticSearchSelect = async (item: SemanticSearchItem | ImageSearchItem) => {
  semanticSearchVisible.value = false
  const file: FileInfo = {
    id: item.id,
    userId: 0,
    parentId: item.parentId,
    fileName: item.fileName,
    fileType: 'file',
    mimeType: item.mimeType ?? undefined,
    fileSize: item.fileSize ?? undefined,
    isDeleted: false,
    createdAt: '',
    updatedAt: '',
  }
  await handleFileDoubleClick(file)
}

// 图片预览（三栏 AI）+ 双击大图轮播用的画廊
const imagePreviewVisible = ref(false)
const currentImageFile = ref<FileInfo | null>(null)
const imageGalleryUrlList = ref<string[]>([])
const imageGalleryInitialIndex = ref(0)

// 获取文件下载链接（用于预览原图或播放视频）
const getFileViewUrl = (file: FileInfo) => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
  const token = authStore.token || ''
  return `${API_BASE_URL}/api/files/${file.id}/download?token=${token}&preview=true`
}

// 辅助函数
const isImageFile = (file: FileInfo) => {
  return (file.mimeType && file.mimeType.startsWith('image/')) ||
    /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.fileName)
}

const isVideoFile = (file: FileInfo) => isVideoMedia(file)

const isAudioFile = (file: FileInfo) => isAudioMedia(file)

const isDocumentFile = (file: FileInfo) => {
  const mime = file.mimeType || ''
  const name = file.fileName.toLowerCase()
  // 支持浏览器直接预览的类型：PDF, 文本, 图片(有些图片非image/开头), 代码文件
  return mime.startsWith('text/') ||
    mime === 'application/pdf' ||
    /\.(pdf|txt|md|json|xml|html|js|css|ts)$/i.test(name)
}

/** 是否为 PDF 文件（双击进应用内预览 + AI） */
const isPdfFile = (file: FileInfo) => {
  const mime = file.mimeType || ''
  return mime === 'application/pdf' || /\.pdf$/i.test(file.fileName)
}

/** 与后端 getTextFileChunk 白名单一致，用于文本分块预览（排除 PDF） */
const isTextLikeForChunk = (file: FileInfo) => {
  const mime = (file.mimeType || '').toLowerCase()
  if (mime === 'application/pdf') return false
  const m = file.fileName.toLowerCase().match(/(\.[^.]+)$/)
  const ext = (m && m[1]) || ''
  if (mime.startsWith('text/')) return true
  return ['.txt', '.md', '.json', '.js', '.css', '.html', '.ts', '.log', '.csv', '.xml'].includes(ext)
}

const textChunkPreviewVisible = ref(false)
const textChunkFileId = ref(0)
const textChunkFileName = ref('')

// 获取文件下载链接
const getFileDownloadUrl = (file: FileInfo) => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
  const token = authStore.token || ''
  return `${API_BASE_URL}/api/files/${file.id}/download?token=${token}`
}

// 文件双击处理
const handleFileDoubleClick = async (file: FileInfo) => {
  console.log('Double clicked file:', file)
  if (file.fileType === 'folder') {
    navigateToFolder(file.id, file.fileName)
  } else {
    if (isImageFile(file)) {
      currentImageFile.value = file
      const imageFiles = filteredFiles.value.filter((f) => isImageFile(f))
      imageGalleryUrlList.value = imageFiles.map((f) => getFileViewUrl(f))
      const idx = imageFiles.findIndex((f) => f.id === file.id)
      imageGalleryInitialIndex.value = idx >= 0 ? idx : 0
      imagePreviewVisible.value = true
    } else if (isAudioFile(file)) {
      currentMediaKind.value = 'audio'
      currentVideoUrl.value = getFileViewUrl(file)
      currentVideoTitle.value = file.fileName
      currentVideoFile.value = file
      videoPlayerVisible.value = true
    } else if (isVideoFile(file)) {
      currentMediaKind.value = 'video'
      currentVideoUrl.value = getFileViewUrl(file)
      currentVideoTitle.value = file.fileName
      currentVideoFile.value = file
      videoPlayerVisible.value = true
    } else if (isArchiveFile(file.fileName)) {
      await handleArchiveDoubleClick(file)
    } else if (isExcelFile(file)) {
      // Excel 文件直接下载（LibreOffice 转换效果不佳）
      downloadFile(file)
    } else if (isWordFile(file)) {
      currentOfficeFile.value = file
      officePreviewEnableAi.value = true
      officePreviewVisible.value = true
    } else if (isPptFile(file)) {
      currentOfficeFile.value = file
      officePreviewEnableAi.value = false
      officePreviewVisible.value = true
    } else if (isPdfFile(file)) {
      currentPdfFile.value = file
      pdfPreviewVisible.value = true
    } else if (isDocumentFile(file)) {
      if (isTextLikeForChunk(file)) {
        textChunkFileId.value = file.id
        textChunkFileName.value = file.fileName
        textChunkPreviewVisible.value = true
      } else {
        const url = getFileViewUrl(file)
        window.open(url, '_blank')
      }
    } else {
      // 其他文件不进行默认操作，如需下载请点击下载按钮
      // downloadFile(file)
    }
  }
}

// 判断是否为 Excel 文件（双击直接下载）
const isExcelFile = (file: FileInfo) => {
  return /\.(xls|xlsx)$/i.test(file.fileName)
}

// 判断是否为 Word 文件（预览 + AI，后端索引支持 .docx）
const isWordFile = (file: FileInfo) => {
  return /\.(doc|docx)$/i.test(file.fileName)
}

// 判断是否为 PPT 文件（仅预览，暂不启用 AI）
const isPptFile = (file: FileInfo) => {
  return /\.(ppt|pptx)$/i.test(file.fileName)
}

const handleRightClick = (event: MouseEvent, file: FileInfo) => {
  // 暂时不处理右键菜单，或者将来显示自定义菜单
}

// 导航到文件夹
const navigateToFolder = (folderId?: number, folderName?: string) => {
  // If we are in category view, we must exit it first
  if (route.query.type) {
    router.push({ path: '/', query: {} })
  }

  currentFolderId.value = folderId
  fileFilters.q = ''

  // 更新面包屑导航
  if (folderId === undefined) {
    // 返回根目录
    breadcrumbs.value = []
  } else {
    // 检查是否点击了已存在的面包屑
    const existingIndex = breadcrumbs.value.findIndex(b => b.id === folderId)
    if (existingIndex !== -1) {
      // 点击了已存在的面包屑，截断到该位置
      breadcrumbs.value = breadcrumbs.value.slice(0, existingIndex + 1)
    } else if (folderName) {
      // 进入新文件夹，添加到面包屑
      breadcrumbs.value.push({ id: folderId, name: folderName })
    }
  }

  loadFiles()
}

// 获取文件图标颜色
const getFileIconColor = (file: FileInfo): string => {
  if (file.fileType === 'folder') {
    return '#ffd04b'
  }

  // 根据文件类型返回不同颜色
  if (file.mimeType && file.mimeType.startsWith('image/')) {
    return '#67c23a'
  } else if (file.mimeType && file.mimeType.startsWith('video/')) {
    return '#e6a23c'
  } else if (file.mimeType && file.mimeType.includes('pdf')) {
    return '#f56c6c'
  } else {
    return '#909399'
  }
}

// 格式化日期
const formatDate = (dateString: string): string => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return '今天'
  } else if (days === 1) {
    return '昨天'
  } else if (days < 7) {
    return `${days}天前`
  } else {
    return date.toLocaleDateString()
  }
}

// 批量下载（单文件直链；多选或单个文件夹 → ZIP，含文件夹递归）
const batchDownload = async () => {
  if (selectedFiles.value.size === 0) return
  const selected = files.value.filter((f) => selectedFiles.value.has(f.id))
  if (selected.length === 0) return
  if (selected.length === 1 && selected[0]!.fileType === 'file') {
    await downloadFile(selected[0]!)
    return
  }
  try {
    const blob = await fileApiService.downloadBatchZip(selected.map((f) => f.id))
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch-download-${Date.now()}.zip`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
    ElMessage.success('压缩包下载已开始')
  } catch (error: unknown) {
    let msg = '打包下载失败'
    const ax = error as { response?: { data?: Blob } }
    const data = ax.response?.data
    if (data instanceof Blob && data.type.includes('json')) {
      try {
        const text = await data.text()
        const j = JSON.parse(text) as { message?: string }
        if (j.message) msg = j.message
      } catch {
        /* ignore */
      }
    } else if (error instanceof Error && error.message) {
      msg = error.message
    }
    ElMessage.error(msg)
  }
}

// 批量移动
const batchMove = () => {
  if (selectedFiles.value.size === 0) return
  const selected = files.value.filter(f => selectedFiles.value.has(f.id))
  filesToMove.value = selected
  moveDialogVisible.value = true
}

// 批量删除
const batchDelete = async () => {
  if (selectedFiles.value.size === 0) return

  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedFiles.value.size} 个文件吗？`,
      '批量删除',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    const ids = Array.from(selectedFiles.value)
    const { deletedCount } = await fileApiService.deleteFilesBatch(ids)

    ElMessage.success(`已移入回收站 ${deletedCount} 项`)
    clearSelection()
    loadFiles()
  } catch (e) {
    // user cancel
  }
}

const showHistory = (file: FileInfo) => {
  historyFile.value = file
  showHistoryDialog.value = true
}

const handleHistorySuccess = () => {
  loadFiles()
  authStore.refreshUserInfo()
}

// 文件操作处理
const handleFileAction = async (command: string, file: FileInfo) => {
  switch (command) {
    case 'download':
      await downloadFile(file)
      break
    case 'rename':
      showRenameDialog(file)
      break
    case 'move':
      handleMoveFile(file)
      break
    case 'delete':
      await deleteFile(file)
      break
  }
}

// 获取文件预览 URL
const getFilePreviewUrl = (file: FileInfo) => {
  return buildFileThumbnailUrl(file.id, authStore.token || '')
}

// 处理裁剪后的上传
const handleCroppedUpload = async (file: File) => {
  try {
    if (fileUploadRef.value) {
      fileUploadRef.value.addFile(file)
    } else {
      ElMessage.error('上传组件未就绪')
    }
  } catch (err: any) {
    console.error(err)
    ElMessage.error('上传处理失败')
  }
}
const handleImageError = (e: Event) => {
  const target = e.target as HTMLImageElement
  target.style.display = 'none'

  const parent = target.closest('.image-thumbnail') as HTMLElement
  if (parent) {
    parent.style.display = 'none'
  }
}

// 下载文件
const downloadFile = async (file: FileInfo) => {
  try {
    const blob = await fileApiService.downloadFile(file.id)
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.fileName
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
    ElMessage.success('文件下载成功')
  } catch (error: any) {
    ElMessage.error('文件下载失败: ' + (error.message || '未知错误'))
  }
}

const archiveExtractVisible = ref(false)
const archiveExtractTarget = ref<FileInfo | null>(null)

const archiveExtractCurrentDirLabel = computed(() => {
  if (!breadcrumbs.value.length) return String(t('index.toolbar.all'))
  return breadcrumbs.value.map((b) => b.name).join(' / ')
})

/** 压缩包：普通用户直接下载；VIP/管理员打开在线解压到当前目录 */
const handleArchiveDoubleClick = async (file: FileInfo) => {
  if (!canUseOnlineArchiveExtract(authStore.user)) {
    await downloadFile(file)
    return
  }
  if (!isZipExtractableOnline(file)) {
    ElMessage.warning('当前在线解压仅支持 ZIP 格式，已改为直接下载原文件')
    await downloadFile(file)
    return
  }
  archiveExtractTarget.value = file
  archiveExtractVisible.value = true
}

watch(archiveExtractVisible, (v) => {
  if (!v) archiveExtractTarget.value = null
})

// 显示创建文件夹对话框
const showCreateFolderDialog = () => {
  newFolderName.value = ''
  createFolderDialogVisible.value = true
}

// 创建文件夹
const createFolder = async () => {
  if (!newFolderName.value.trim()) {
    ElMessage.warning('请输入文件夹名称')
    return
  }

  try {
    isCreatingFolder.value = true
    const folder = await fileApiService.createFolder(newFolderName.value.trim(), currentFolderId.value)
    files.value.unshift(folder)
    createFolderDialogVisible.value = false
    ElMessage.success('文件夹创建成功')
  } catch (error: any) {
    ElMessage.error('文件夹创建失败: ' + (error.message || '未知错误'))
  } finally {
    isCreatingFolder.value = false
  }
}

// 显示重命名对话框
const showRenameDialog = (file: FileInfo) => {
  currentRenameFile.value = file
  newFileName.value = file.fileName
  renameDialogVisible.value = true
}

// 确认重命名
const confirmRename = async () => {
  if (!currentRenameFile.value || !newFileName.value.trim()) {
    ElMessage.warning('请输入新名称')
    return
  }

  try {
    isRenaming.value = true
    if (!currentRenameFile.value) return

    await fileApiService.renameFile(currentRenameFile.value.id, newFileName.value.trim())

    // 更新本地数据
    const index = files.value.findIndex((f: FileInfo) => f.id === currentRenameFile.value?.id)
    if (index > -1 && currentRenameFile.value && files.value[index]) {
      files.value[index].fileName = newFileName.value.trim()
    }

    renameDialogVisible.value = false
    ElMessage.success('重命名成功')
  } catch (error: any) {
    ElMessage.error('重命名失败: ' + (error?.message || '未知错误'))
  } finally {
    isRenaming.value = false
  }
}

// 删除文件
const deleteFile = async (file: FileInfo) => {
  try {
    await ElMessageBox.confirm(
      `确定要将 "${file.fileName}" 移入回收站吗？`,
      '删除文件',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await fileApiService.deleteFilesBatch([file.id])

    // 从列表中移除
    const index = files.value.findIndex((f: FileInfo) => f.id === file.id)
    if (index > -1) {
      files.value.splice(index, 1)
    }

    ElMessage.success('文件删除成功')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('文件删除失败: ' + (error?.message || '未知错误'))
    }
  }
}

const handleMoveFile = (file: FileInfo) => {
  filesToMove.value = [file]
  moveDialogVisible.value = true
}

const handleMoveSuccess = () => {
  loadFiles()
  // 刷新左侧空间信息等（如果需要）
  authStore.refreshUserInfo()
}

const handleFileItemDrop = async (source: FileInfo, target: FileInfo) => {
  ElMessage.info(`Request to move ${source.fileName} to ${target.fileName} (Dev)`)
}

// 格式化存储大小
const formatStorage = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 处理下拉菜单命令

</script>

<style lang="scss" scoped>
.index-container {
  display: flex;
  height: 100vh;
  background-color: #f5f7fa;
}

.logo {
  color: #303133;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

// 主容器
.main-container {
  flex: 1;
  display: flex;
  flex-direction: column;
}

// 顶部工具栏
.header {
  background: white;
  border-bottom: 1px solid #e4e7ed;
  padding: 0 20px;

  &-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 100%;
  }

  &-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &-right {
    display: flex;
    align-items: center;
  }
}

.user-dropdown {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #606266;
  font-size: 14px;
  padding: 8px 12px;
  border-radius: 4px;
  transition: background-color 0.3s;

  &:hover {
    background-color: #f5f7fa;
  }

  .el-icon {
    margin: 0 4px;
  }
}

.batch-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-sizing: border-box;
  /* 与有按钮时高度一致，防止选中瞬间撑开导致双击落空 */
  min-height: 52px;
  padding: 10px 20px;
  background-color: #ecf5ff;
  border-bottom: 1px solid #d9ecff;

  &.is-idle {
    background-color: transparent;
    border-bottom-color: transparent;
  }

  @at-root html.dark & {
    background-color: #2b2b2b;
    border-bottom-color: #4c4d4f;

    &.is-idle {
      background-color: transparent;
      border-bottom-color: transparent;
    }
  }

  .batch-info {
    font-size: 14px;
    color: #409eff;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .batch-actions {
    display: flex;
    gap: 8px;
  }
}

// 工具栏
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: white;
  border-bottom: 1px solid #e4e7ed;

  &-left {
    .el-breadcrumb {
      font-size: 14px;

      :deep(.el-breadcrumb__item) {
        cursor: pointer;

        &:hover {
          color: #409eff;
        }
      }
    }
  }
}

// 文件内容区域
.file-content {
  background: white;
  padding: 20px;
  overflow-y: auto;
  position: relative;
}

// 拖拽上传覆盖层
.drop-zone-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(64, 158, 255, 0.1);
  border: 2px dashed #409eff;
  border-radius: 8px;
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1000;

  &.show {
    display: flex;
  }

  .drop-zone-content {
    text-align: center;

    .drop-icon {
      color: #409eff;
      margin-bottom: 16px;
    }

    .drop-text {
      font-size: 18px;
      color: #409eff;
      margin: 0;
      font-weight: 600;
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .sidebar {
    width: 60px !important;

    &-header .logo {
      display: none;
    }
  }

  .header {
    &-left {
      gap: 8px;
    }

    &-right .el-input {
      width: 200px !important;
    }
  }

  .file-list.grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  }
}

.tag-opt {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tag-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
</style>