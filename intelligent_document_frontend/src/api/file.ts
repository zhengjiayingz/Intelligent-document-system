import request from '@utils/request'
import type {
  FileItem,
  FileTagItem,
  CheckFileExistsResponse,
  CreateFolderParams,
  RenameFileParams,
  MoveFileParams,
  FileQueryParams,
  SemanticSearchResult,
  ImageSearchResult,
  DuplicatesScanResult,
} from '@typing/file'

export type FileTextNote = {
  id: number
  startOffset: number
  endOffset: number
  quote: string
  content: string | null
  color: string
  createdAt: string
  updatedAt: string
}

// 上传进度回调类型
export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

// 文件上传相关API
export const fileApiService = {
  // 检查文件是否已存在（秒传检测）
  async checkFileExists(fileHash: string): Promise<CheckFileExistsResponse> {
    const res = await request.post<any>('/files/check-exists', { fileHash })
    return res.data.data
  },

  // 获取已上传的分片列表（断点续传）
  async getUploadedChunks(fileHash: string): Promise<number[]> {
    const res = await request.get<any>(`/files/chunks/${fileHash}`)
    return res.data.data || []
  },

  // 上传单个分片
  async uploadChunk(
    fileHash: string,
    chunkIndex: number,
    chunkData: Blob,
    chunkHash: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    const formData = new FormData()
    formData.append('fileHash', fileHash)
    formData.append('chunkIndex', chunkIndex.toString())
    formData.append('chunkHash', chunkHash)
    formData.append('chunk', chunkData)

    await request.post('/files/upload-chunk', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      // 这个是axios的配置，底层对应 XHR 的 upload.onprogress，用于监听上传进度，不是后端接口回传
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          onProgress({
            loaded: progressEvent.loaded, // 当前这个请求里，已经发送出去的字节数
            total: progressEvent.total, // 当前这个请求里，整个 body 的总字节数
            percentage: Math.round((progressEvent.loaded / progressEvent.total) * 100)
          })
        }
      }
    })
  },

  // 合并分片
  async mergeChunks(
    fileHash: string,
    fileName: string,
    fileSize: number,
    mimeType: string,
    totalChunks: number,
    parentId?: number,
    conflictAction?: 'rename' | 'override' | 'version'
  ): Promise<FileItem> {
    const res = await request.post<any>('/files/merge-chunks', {
      fileHash,
      fileName,
      fileSize,
      mimeType,
      totalChunks,
      parentId,
      conflictAction
    })
    return res.data.data
  },

  // 秒传文件（文件已存在）
  async instantUpload(
    fileHash: string,
    fileName: string,
    fileSize: number,
    mimeType: string,
    parentId?: number,
    conflictAction?: 'rename' | 'override' | 'version'
  ): Promise<FileItem> {
    const res = await request.post<any>('/files/instant-upload', {
      fileHash,
      fileName,
      fileSize,
      mimeType,
      parentId,
      conflictAction
    })
    return res.data.data
  },

  // 检查文件名是否存在
  async checkFileName(fileName: string, parentId?: number): Promise<{ exists: boolean }> {
    const res = await request.post<any>('/files/check-name', { fileName, parentId });
    return res.data;
  },

  // 获取文件历史版本
  async getFileVersions(id: number): Promise<any[]> {
    const res = await request.get<any>(`/files/${id}/versions`);
    return res.data.data;
  },

  // 回滚版本
  async rollbackVersion(id: number, versionId: number): Promise<void> {
    await request.post(`/files/${id}/versions/${versionId}/rollback`);
  },

  async replaceFileText(
    id: number,
    content: string,
  ): Promise<{ id: number; version: number; unchanged: boolean; fileSize: number }> {
    const res = await request.put<any>(`/files/${id}/text-content`, { content })
    return res.data.data
  },

  // 简单文件上传
  async uploadFile(file: File, parentId?: number, onProgress?: (percentage: number) => void): Promise<FileItem> {
    const formData = new FormData()
    formData.append('file', file)
    if (parentId) formData.append('parentId', parentId.toString())

    const res = await request.post<any>('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          onProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100))
        }
      }
    })
    return res.data.data
  },

  // 获取文件列表
  async getFiles(params: FileQueryParams): Promise<FileItem[]> {
    const res = await request.get<any>('/files', { params })
    return res.data.data
  },

/** 语义搜索：按内容相关度找文件（仅已索引） */
async searchFilesSemantic(params: {
  q: string
  limit?: number
}): Promise<SemanticSearchResult> {
  const res = await request.get<any>('/files/search', { params })
  return res.data.data
},

/** 以图搜图：上传查询图，按视觉相似度找网盘图片 */
async searchFilesByImage(file: File, limit = 20): Promise<ImageSearchResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await request.post<any>('/ai/image-search/by-image', form, {
    params: { limit },
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
  return res.data.data
},

/** 高度相似查重：精确 hash + 图片向量近重 */
async scanDuplicateFiles(): Promise<DuplicatesScanResult> {
  const res = await request.post<any>('/files/duplicates/scan', {}, { timeout: 120000 })
  return res.data.data
},

  /** 用户标签列表 */
  async listFileTags(): Promise<FileTagItem[]> {
    const res = await request.get<any>('/files/tags')
    return res.data.data
  },

  async createFileTag(tagName: string, color?: string | null): Promise<FileTagItem> {
    const res = await request.post<any>('/files/tags', { tagName, color })
    return res.data.data
  },

  async updateFileTag(
    tagId: number,
    body: { tagName?: string; color?: string | null }
  ): Promise<FileTagItem> {
    const res = await request.put<any>(`/files/tags/${tagId}`, body)
    return res.data.data
  },

  async deleteFileTag(tagId: number): Promise<void> {
    await request.delete(`/files/tags/${tagId}`)
  },

  /** 全量替换某文件的标签，返回最新 tags */
  async setFileTags(fileId: number, tagIds: number[]): Promise<FileTagItem[]> {
    const res = await request.put<any>(`/files/${fileId}/tags`, { tagIds })
    return res.data.data.tags
  },

  // 获取回收站文件列表
  async getRecycleBinFiles(params?: Omit<FileQueryParams, 'isDeleted'>): Promise<FileItem[]> {
    const res = await request.get<any>('/files', {
      params: { isDeleted: true, ...params }
    })
    return res.data.data
  },

  // 获取单个文件信息
  async getFileById(id: number): Promise<FileItem> {
    const res = await request.get<any>(`/files/${id}`)
    return res.data.data
  },

  // 下载文件
  async downloadFile(id: number): Promise<Blob> {
    const res = await request.get(`/files/${id}/download`, {
      responseType: 'blob'
    })
    return res.data as Blob
  },

  /** 将选中的文件与文件夹（文件夹递归）打包为 ZIP */
  async downloadBatchZip(ids: number[]): Promise<Blob> {
    const res = await request.post(`/files/batch/download-zip`, { ids }, {
      responseType: 'blob',
      timeout: 600000
    })
    return res.data as Blob
  },

  /** 批量移入回收站（软删），服务端展开子孙并一次 updateMany */
  async deleteFilesBatch(ids: number[]): Promise<{ deletedCount: number }> {
    if (ids.length > 1) {
      const res = await request.post<{
        success: boolean
        data: { deletedCount: number }
      }>('/files/batch/delete', { ids })
      return res.data.data
    }
    await request.delete(`/files/${ids[0]}`)
    return { deletedCount: 1 }
  },

  /** 批量移动（事务内更新；选中项会去重为顶层根） */
  async moveFilesBatch(ids: number[], parentId?: number): Promise<{ movedCount: number }> {
    const res = await request.post<any>('/files/batch/move', {
      ids,
      parentId: parentId === undefined ? null : parentId
    })
    return res.data.data
  },

  /** VIP/管理员：列出 ZIP 内条目（用于在线解压到网盘） */
  async listArchiveEntries(id: number): Promise<{
    archiveName: string
    entries: { path: string; isDirectory: boolean; size: number }[]
    truncated: boolean
  }> {
    const res = await request.get<any>(`/files/${id}/archive/entries`, { timeout: 120000 })
    return res.data.data
  },

  /** VIP/管理员：解压前检测选中路径是否与当前网盘目录下已有文件重名（不解压） */
  async checkArchiveExtractConflicts(
    id: number,
    parentId: number | undefined,
    paths: string[]
  ): Promise<{ hasConflict: boolean; conflictingPaths: string[] }> {
    const res = await request.post<any>(`/files/${id}/archive/conflicts`, {
      parentId: parentId === undefined ? null : parentId,
      paths
    })
    return res.data.data
  },

  /**
   * VIP/管理员：将 ZIP 内选中文件解压到网盘指定目录
   * @param paths 压缩包内文件路径（非目录），不含尾部 /
   * @param conflictAction 同名策略：suffix 自动改名 version 新版本 duplicate 同名并存
   */
  async extractArchiveToDrive(
    id: number,
    parentId: number | undefined,
    paths: string[],
    conflictAction: 'version' | 'duplicate' | 'suffix' = 'suffix'
  ): Promise<{ fileCount: number; folderCount: number }> {
    const res = await request.post<any>(
      `/files/${id}/archive/extract`,
      {
        parentId: parentId === undefined ? null : parentId,
        paths,
        conflictAction
      },
      { timeout: 600000 }
    )
    return res.data.data
  },

  // 还原文件
  async restoreFile(id: number): Promise<string> {
    const res = await request.post<any>(`/files/${id}/restore`)
    return res.data.message
  },

  // 彻底删除文件
  async permanentDeleteFile(id: number): Promise<void> {
    await request.delete(`/files/${id}/permanent`)
  },

  /** 回收站：批量彻底删除（后端会展开子项并按正确顺序删除） */
  async permanentDeleteFilesBatch(ids: number[]): Promise<{ deletedCount: number }> {
    const res = await request.post<any>('/files/batch/permanent-delete', { ids })
    return res.data.data
  },

  /** 回收站：批量还原（后端会展开子项并按父先于子顺序还原） */
  async restoreFilesBatch(ids: number[]): Promise<{ restoredCount: number }> {
    const res = await request.post<any>('/files/batch/restore', { ids })
    return res.data.data
  },

  // 创建文件夹
  async createFolder(name: string, parentId?: number): Promise<FileItem> {
    const data = { name, parentId: parentId || null }
    const res = await request.post<any>('/files/folder', data)
    return res.data.data
  },

  // 重命名文件/文件夹
  async renameFile(id: number, name: string): Promise<void> {
    const data = { name }
    await request.put(`/files/${id}/rename`, data)
  },

  // 移动文件/文件夹
  async moveFile(id: number, parentId?: number): Promise<void> {
    const data = { parentId: parentId || null }
    await request.put(`/files/${id}/move`, data)
  },

  // 保存他人分享的文件到我的网盘（链接分享转存需传 shareCode + extractCode）
  async saveSharedFileToMyDrive(
    id: number,
    parentId?: number,
    shareContext?: { shareCode: string; extractCode?: string | null }
  ): Promise<FileItem> {
    const body: Record<string, unknown> = { parentId: parentId ?? null }
    if (shareContext?.shareCode) {
      body.shareCode = shareContext.shareCode
      if (shareContext.extractCode) body.extractCode = shareContext.extractCode
    }
    const res = await request.post<any>(`/files/${id}/save-to-my-drive`, body)
    return res.data.data
  },

  /** 大文本分块预览：按字节 offset 拉取文本（UTF-8 或 GB18030 等由后端探测，续传带 fileEncoding） */
  async getTextFileChunk(
    fileId: number,
    offset: number,
    maxBytes?: number,
    fileEncoding?: 'utf-8' | 'gb18030'
  ): Promise<{
    text: string
    nextOffset: number
    totalSize: number
    done: boolean
    fileEncoding?: 'utf-8' | 'gb18030'
  }> {
    const res = await request.get<{
      success: boolean
      data: {
        text: string
        nextOffset: number
        totalSize: number
        done: boolean
        fileEncoding?: 'utf-8' | 'gb18030'
      }
    }>(`/files/${fileId}/text-chunk`, {
      params: {
        offset,
        maxBytes: maxBytes ?? 262144,
        ...(fileEncoding ? { encoding: fileEncoding } : {})
      }
    })
    return res.data.data
  },

  async listTextNotes(fileId: number): Promise<FileTextNote[]> {
    const res = await request.get<FileTextNote[]>(`/files/${fileId}/text-notes`)
    return res.data
  },

  async createTextNote(
    fileId: number,
    body: {
      startOffset: number
      endOffset: number
      quote: string
      content?: string | null
      color?: string | null
    }
  ): Promise<FileTextNote> {
    const res = await request.post<FileTextNote>(`/files/${fileId}/text-notes`, body)
    return res.data
  },

  async updateTextNote(
    fileId: number,
    noteId: number,
    body: { content?: string | null; color?: string | null }
  ): Promise<FileTextNote> {
    const res = await request.patch<FileTextNote>(`/files/${fileId}/text-notes/${noteId}`, body)
    return res.data
  },

  async deleteTextNote(fileId: number, noteId: number): Promise<void> {
    await request.delete(`/files/${fileId}/text-notes/${noteId}`)
  }
}

export default fileApiService