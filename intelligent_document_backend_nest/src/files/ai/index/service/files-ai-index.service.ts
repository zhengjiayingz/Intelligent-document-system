import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DocumentIndexMode, DocumentIndexStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { isIndexableMedia, isIndexableTextDocument } from './text-extractor';

import { DocumentIndexQueueService } from './document-index-queue.service';
import {
  isSummaryGenre,
  toIndexMode,
  type SummaryGenreValue,
} from '@/files/ai/summary/types/summary-genre.types';

import { joinOverlappingChunkContents } from './text-chunker';
import {
  assessIndexResume,
  shouldKeepChunksForResume,
} from '../utils/index-resume.util';
import type { DocumentIndexJobData } from '../types/document-index-queue.types';

/** 本地端口类型，避免跨文件类型在 ESLint project 中解析失败 */
type IndexQueuePort = {
  removeDocumentIndexJob(userFileId: number): Promise<void>;
  enqueueDocumentIndex(data: DocumentIndexJobData): Promise<unknown>;
};

const ACTIVE_STATUSES: DocumentIndexStatus[] = [
  'pending',
  'extracting',
  'chunking',
  'embedding',
  'summarizing',
  'extracting_knowledge',
];

// 校验 summaryGenre
function validateIndexBody(body: unknown): {
  summaryGenre: SummaryGenreValue;
  force: boolean;
} {
  if (body == null || typeof body !== 'object') {
    throw new BadRequestException('summaryGenre 必填');
  }
  const payload = body as { summaryGenre?: unknown; force?: unknown };
  const genre = payload.summaryGenre;
  if (!isSummaryGenre(genre)) {
    throw new BadRequestException('summaryGenre 无效');
  }
  return {
    summaryGenre: genre,
    force: payload.force === true,
  };
}

function toStatusDto(job: {
  status: DocumentIndexStatus;
  progress: number;
  progressMsg: string | null;
  chunkCount: number;
  errorMessage: string | null;
  mode: DocumentIndexMode;
  summaryGenre: SummaryGenreValue | null;
  updatedAt: Date;
}) {
  return {
    status: job.status,
    mode: job.mode,
    progress: job.progress,
    progressMsg: job.progressMsg,
    chunkCount: job.chunkCount,
    errorMessage: job.errorMessage,
    updatedAt: job.updatedAt.toISOString(),
    summaryGenre: job.summaryGenre,
  };
}

@Injectable()
export class FilesAiIndexService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DocumentIndexQueueService)
    private readonly indexQueue: IndexQueuePort,
  ) {}

  /** POST /api/files/:id/ai/index */
  // 在用户点「建立索引」时，做校验、重置 DB 状态、把任务丢进 Redis 队列，然后立刻返回当前状态
  async triggerIndex(userId: number, fileId: number, body: unknown) {
    const { summaryGenre, force } = validateIndexBody(body);
    const mode = toIndexMode(summaryGenre); // 用体裁推导索引模式，general或者academic
    // 查文件是否存在且属于当前用户
    const userFile = await this.prisma.userFile.findFirst({
      where: { id: fileId, userId, isDeleted: false },
      select: {
        id: true,
        fileName: true,
        fileType: true,
        storage: { select: { mimeType: true, filePath: true, fileHash: true } },
      },
    });
    // 文件存在性校验
    if (!userFile) {
      throw new NotFoundException('文件不存在');
    }
    if (userFile.fileType === 'folder') {
      throw new BadRequestException('文件夹不支持索引');
    }
    if (!userFile.storage) {
      throw new NotFoundException('文件不存在');
    }
    // 格式校验：文档/图片 或 常见音视频（扩展名 + MIME）
    const indexableInput = {
      fileName: userFile.fileName,
      mimeType: userFile.storage.mimeType,
    };
    if (
      !isIndexableTextDocument(indexableInput) &&
      !isIndexableMedia(indexableInput)
    ) {
      throw new BadRequestException(
        '仅支持 UTF-8 的 .txt / .md、.pdf（含扫描件）、.docx、可 OCR 图片，以及常见音频（mp3/wav/m4a）或视频（mp4/webm/mov）',
      );
    }
    // 是否已有进行中的任务，每个文件在 document_index_jobs 里最多一行（userFileId 唯一）。
    const existing = await this.prisma.documentIndexJob.findUnique({
      where: { userFileId: fileId },
    });

    // failed / force 重建：先清掉队列残留（delayed/failed/waiting 等）
    if (existing?.status === 'failed' || force) {
      await this.indexQueue.removeDocumentIndexJob(fileId);
    }

    // 非 force 时拒绝并发；force（失败重试 / 强制重建）允许顶替
    if (existing && ACTIVE_STATUSES.includes(existing.status) && !force) {
      throw new ConflictException('索引任务进行中，请稍后再试');
    }
    if (
      !force &&
      existing?.status === 'ready' &&
      existing.indexedFileHash &&
      existing.indexedFileHash === userFile.storage.fileHash
    ) {
      throw new ConflictException('检查到文档未更新，无需重新建立索引');
    }

    // O-01：失败/卡住重试时若文稿块可用则保留 chunks，只清摘要与知识；ready+force 仍全量清空
    const existingChunks = await this.prisma.documentChunk.findMany({
      where: { userFileId: fileId },
      select: { chunkIndex: true, content: true, embedding: true },
      orderBy: { chunkIndex: 'asc' },
    });
    const resumeFrom = assessIndexResume(
      existingChunks,
      existing?.chunkCount ?? null,
    );
    const keepChunks = shouldKeepChunksForResume({
      force,
      existingStatus: existing?.status,
      resumeFrom,
    });
    const progressMsg = keepChunks
      ? resumeFrom === 'summarizing'
        ? '断点续建：从摘要继续'
        : '断点续建：从生成向量继续'
      : '已加入队列';

    // ready（内容已变）/ failed / 无记录 → 允许（重新）索引
    await this.prisma.$transaction(async (tx) => {
      if (!keepChunks) {
        await tx.documentChunk.deleteMany({ where: { userFileId: fileId } });
      }
      await tx.documentSummary.deleteMany({ where: { userFileId: fileId } });
      await tx.documentKnowledge.deleteMany({ where: { userFileId: fileId } });
      await tx.documentIndexJob.upsert({
        where: { userFileId: fileId },
        create: {
          userFileId: fileId,
          mode, // 用户选的 general/academic
          summaryGenre,
          status: 'pending', //等待 Worker 处理
          progress: keepChunks ? 50 : 0,
          progressMsg,
          chunkCount: keepChunks ? existingChunks.length : 0,
          errorMessage: null, // 清掉上次失败信息
        },
        // 更新的时候
        update: {
          mode, // 用户选的 general/academic
          summaryGenre,
          status: 'pending', //等待 Worker 处理
          progress: keepChunks ? 50 : 0,
          progressMsg,
          chunkCount: keepChunks ? existingChunks.length : 0,
          errorMessage: null, // 清掉上次失败信息
        },
      });
    });
    // 入队 BullMQ
    await this.indexQueue.enqueueDocumentIndex({
      userFileId: fileId,
      userId,
      mode,
      summaryGenre,
    });
    // 读最新状态并返回
    const job = await this.prisma.documentIndexJob.findUniqueOrThrow({
      where: { userFileId: fileId },
    });

    return {
      success: true,
      data: toStatusDto(job),
    };
  }

  /** GET /api/files/:id/ai/index/status */
  async getIndexStatus(userId: number, fileId: number) {
    const userFile = await this.prisma.userFile.findFirst({
      where: { id: fileId, userId, isDeleted: false },
      select: { id: true },
    });

    if (!userFile) {
      throw new NotFoundException('文件不存在');
    }

    const job = await this.prisma.documentIndexJob.findUnique({
      where: { userFileId: fileId },
    });

    if (!job) {
      return {
        success: true,
        data: {
          status: 'none' as const,
          mode: null,
          summaryGenre: null,
          progress: 0,
          progressMsg: null,
          chunkCount: 0,
          errorMessage: null,
          updatedAt: null,
        },
      };
    }

    return {
      success: true,
      data: toStatusDto(job),
    };
  }

  /** GET /api/files/:id/ai/extracted-text */
  // 索引 ready 后返回近似全文（由 chunks 去 overlap 拼接），供图片 OCR 划词面板使用。
  async getExtractedText(userId: number, fileId: number) {
    const userFile = await this.prisma.userFile.findFirst({
      where: { id: fileId, userId, isDeleted: false },
      select: { id: true },
    });
    if (!userFile) {
      throw new NotFoundException('文件不存在');
    }
    const job = await this.prisma.documentIndexJob.findUnique({
      where: { userFileId: fileId },
      select: { status: true },
    });
    if (!job || job.status !== 'ready') {
      throw new BadRequestException('请先完成文档索引后再查看提取文本');
    }
    const rows = await this.prisma.documentChunk.findMany({
      where: { userFileId: fileId },
      orderBy: { chunkIndex: 'asc' },
      select: { content: true },
    });
    const text = joinOverlappingChunkContents(rows.map((r) => r.content));
    return {
      success: true,
      data: { text, chunkCount: rows.length },
    };
  }

  /**
   * GET /api/files/:id/ai/transcript
   * 返回带时间轴的转写分句（音频索引）；普通文档若无时间戳则 startMs/endMs 可能为 null。
   * @param userId 当前用户 ID
   * @param fileId 用户文件 ID
   */
  async getTranscript(userId: number, fileId: number) {
    const userFile = await this.prisma.userFile.findFirst({
      where: { id: fileId, userId, isDeleted: false },
      select: { id: true },
    });
    if (!userFile) {
      throw new NotFoundException('文件不存在');
    }
    const job = await this.prisma.documentIndexJob.findUnique({
      where: { userFileId: fileId },
      select: { status: true },
    });
    if (!job || job.status !== 'ready') {
      throw new BadRequestException('请先完成索引后再查看转写文稿');
    }
    const rows = await this.prisma.documentChunk.findMany({
      where: { userFileId: fileId },
      orderBy: { chunkIndex: 'asc' },
      // 音频索引写入的时间轴；普通文档一般为 null
      select: { content: true, startMs: true, endMs: true },
    });
    return {
      success: true,
      data: {
        segments: rows.map((r) => ({
          text: r.content,
          startMs: r.startMs,
          endMs: r.endMs,
        })),
      },
    };
  }
}
