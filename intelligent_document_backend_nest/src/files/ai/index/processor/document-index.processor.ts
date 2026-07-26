import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { DocumentIndexStatus } from '@prisma/client';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { chunkText } from '@/files/ai/index/service/text-chunker';
import {
  extractTextFromStorage,
  isIndexableMedia,
  isIndexableVideo,
} from '@/files/ai/index/service/text-extractor';
import { extractAudioTranscriptFromStorage } from '@/files/ai/index/service/audio-transcript.extractor';
import { buildMediaIndexChunks } from '@/files/ai/index/utils/media-transcript-chunks.util';
import {
  assessIndexResume,
  hasChunkEmbedding,
  type IndexResumeFrom,
} from '@/files/ai/index/utils/index-resume.util';

import {
  DOCUMENT_INDEX_JOB_NAME, // 任务名
  DOCUMENT_INDEX_QUEUE_NAME, // 队列名
  type DocumentIndexJobData, // 任务 payload 类型
} from '@/files/ai/index/types/document-index-queue.types';
import { embedMany } from '@/files/ai/index/provider/embedding.provider';
import { SummaryMapReduceService } from '@/files/ai/summary/service/summary-map-reduce.service';
import { KnowledgeExtractService } from '@/files/ai/knowledge/service/knowledge-extract.service';
import { MediaSemanticChaptersService } from '@/files/ai/summary/service/media-semantic-chapters.service';
import { DocumentIndexQueueService } from '@/files/ai/index/service/document-index-queue.service';
import { isSummaryGenre } from '@/files/ai/summary/types/summary-genre.types';

type IndexChunk = {
  index: number;
  content: string;
  startMs?: number | null;
  endMs?: number | null;
};

//  BullMQ 异步 Worker，负责消费 document-index 队列里的索引任务。用户在前端对某个文件点「建立索引」后，API 只负责入队；真正耗时的活都在这里做
// @Processor 装饰器，第一个参数表示监听DOCUMENT_INDEX_QUEUE_NAME这个队列，约定了队列只要有任务就调用process方法处理
// 所以要实现WorkerHost的process方法，这个方法就是 BullMQ 回调：每个 job 进队后执行
@Processor(DOCUMENT_INDEX_QUEUE_NAME, { concurrency: 1 }) //  表示同一 Worker 同时只跑 1 个索引任务（避免 embedding 打爆 API/内存）
export class DocumentIndexProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentIndexProcessor.name); // 创建带类名的 Logger

  constructor(
    private readonly prisma: PrismaService, // 注入 Prisma
    private readonly storageService: StorageService, // 注入 Storage
    private readonly summaryMapReduce: SummaryMapReduceService,
    private readonly knowledgeExtract: KnowledgeExtractService,
    private readonly mediaSemanticChapters: MediaSemanticChaptersService,
    private readonly indexQueue: DocumentIndexQueueService,
  ) {
    super();
  }
  // 按 userFileId 更新索引任务记录，可改状态、进度、消息、chunk 数、错误信息
  private async patchJob(
    userFileId: number,
    data: {
      status?: DocumentIndexStatus;
      progress?: number;
      progressMsg?: string;
      chunkCount?: number;
      errorMessage?: string | null;
      indexedFileHash?: string | null;
    },
  ) {
    // 每个文件对应一条 documentIndexJob（主键是 userFileId）
    await this.prisma.documentIndexJob.update({
      where: { userFileId },
      data,
    });
  }

  private async loadPersistedChunks(userFileId: number): Promise<{
    resumeFrom: IndexResumeFrom | null;
    chunks: IndexChunk[];
  }> {
    const jobMeta = await this.prisma.documentIndexJob.findUnique({
      where: { userFileId },
      select: { chunkCount: true },
    });
    const rows = await this.prisma.documentChunk.findMany({
      where: { userFileId },
      orderBy: { chunkIndex: 'asc' },
      select: {
        chunkIndex: true,
        content: true,
        embedding: true,
        startMs: true,
        endMs: true,
      },
    });
    const resumeFrom = assessIndexResume(rows, jobMeta?.chunkCount ?? null);
    if (resumeFrom == null) {
      return { resumeFrom: null, chunks: [] };
    }
    return {
      resumeFrom,
      chunks: rows.map((r) => ({
        index: r.chunkIndex,
        content: r.content,
        startMs: r.startMs,
        endMs: r.endMs,
      })),
    };
  }

  private async persistNewChunks(
    userFileId: number,
    chunks: IndexChunk[],
  ): Promise<void> {
    await this.prisma.documentChunk.deleteMany({ where: { userFileId } });
    await this.prisma.documentChunk.createMany({
      data: chunks.map((chunk) => ({
        userFileId,
        chunkIndex: chunk.index,
        content: chunk.content,
        startMs: chunk.startMs ?? null,
        endMs: chunk.endMs ?? null,
      })),
    });
  }

  private async runEmbeddingPhase(
    userFileId: number,
    chunks: IndexChunk[],
  ): Promise<void> {
    const rows = await this.prisma.documentChunk.findMany({
      where: { userFileId },
      orderBy: { chunkIndex: 'asc' },
      select: { chunkIndex: true, content: true, embedding: true },
    });
    const pending = rows.filter((r) => !hasChunkEmbedding(r.embedding));
    const total = chunks.length;
    const already = total - pending.length;

    await this.patchJob(userFileId, {
      chunkCount: total,
      status: 'embedding',
      progress: 50 + Math.floor((already / Math.max(total, 1)) * 45),
      progressMsg: `正在生成向量 ${already}/${total}`,
    });

    if (pending.length === 0) return;

    const embeddings = await embedMany(pending.map((c) => c.content));
    for (let i = 0; i < pending.length; i++) {
      await this.prisma.documentChunk.update({
        where: {
          userFileId_chunkIndex: {
            userFileId,
            chunkIndex: pending[i].chunkIndex,
          },
        },
        data: { embedding: embeddings[i] },
      });
      const done = already + i + 1;
      await this.patchJob(userFileId, {
        progress: 50 + Math.floor((done / total) * 45),
        progressMsg: `正在生成向量 ${done}/${total}`,
      });
    }
  }

  // BullMQ 回调：每个 job 进队后执行
  async process(job: Job<DocumentIndexJobData>): Promise<void> {
    // 只接受任务名 index，否则抛错
    if (job.name !== DOCUMENT_INDEX_JOB_NAME) {
      throw new Error(`未知索引任务类型: ${job.name}`);
    }
    // 从 payload 解构文件 ID 和用户 ID
    const { userFileId, userId } = job.data;
    this.logger.log(`[document-index] 开始 userFileId=${userFileId}`); // 打开始日志
    // 提取文本
    try {
      //查userFile 且必须 userId 匹配、isDeleted: false，并带上 storage 路径和 MIME
      const userFile = await this.prisma.userFile.findFirst({
        where: { id: userFileId, userId, isDeleted: false },
        select: {
          fileName: true,
          storage: {
            select: { filePath: true, mimeType: true, fileHash: true },
          },
        },
      });
      // 文件或 storage 不存在则失败
      if (!userFile?.storage) {
        throw new Error('文件不存在或 storage 缺失');
      }
      // 从数据库记录中取出 storedPath / fileName / mimeType
      const fileRef = {
        storedPath: userFile.storage.filePath,
        fileName: userFile.fileName,
        mimeType: userFile.storage.mimeType,
      };

      let chunks: IndexChunk[];
      let mediaDurationMs = 0;
      let mediaTranscriptText = '';

      // O-01：探测可续断点（跳过 ASR / 抽文本）
      const persisted = await this.loadPersistedChunks(userFileId);
      const resumeFrom = persisted.resumeFrom;

      if (resumeFrom != null) {
        chunks = persisted.chunks;
        mediaTranscriptText = chunks.map((c) => c.content).join('');
        mediaDurationMs = Math.max(
          0,
          ...chunks.map((c) => c.endMs ?? 0),
          ...chunks.map((c) => c.startMs ?? 0),
        );
        this.logger.log(
          `[document-index] resume from=${resumeFrom} skipAsr=true userFileId=${userFileId} chunks=${chunks.length}`,
        );
      } else if (isIndexableMedia(fileRef)) {
        const isVideo = isIndexableVideo(fileRef);
        // 更新状态 → extracting
        await this.patchJob(userFileId, {
          status: 'extracting',
          progress: 10,
          progressMsg: isVideo ? '正在抽取音轨并转写' : '正在转写音频',
          errorMessage: null,
        });
        // ! 调用 ASR 转写接口，得到带时间轴文稿
        const transcript = await extractAudioTranscriptFromStorage(
          this.storageService.getStorageProvider(),
          fileRef,
        );
        mediaDurationMs = transcript.durationMs ?? 0;
        mediaTranscriptText = transcript.text?.trim() || '';
        // SenseVoice 常只有 1 条超长 segment：需再切开再 embedding，否则易 400
        chunks = buildMediaIndexChunks({
          segments: transcript.segments,
          fullText: mediaTranscriptText,
          durationMs: mediaDurationMs,
        });
        if (!mediaTranscriptText) {
          mediaTranscriptText = chunks.map((c) => c.content).join('');
        }
      } else {
        // 更新状态 → extracting，进度 10%，清空旧错误
        await this.patchJob(userFileId, {
          status: 'extracting',
          progress: 10,
          progressMsg: '正在提取文本',
          errorMessage: null,
        });
        // 用 storage provider 读文件，按扩展名/MIME 解析成字符串（PDF、Office、txt 等由 text-extractor 处理）
        const fullText = await extractTextFromStorage(
          this.storageService.getStorageProvider(),
          fileRef,
          {
            onProgress: async (p) => {
              if (p.kind !== 'pdf_ocr_page') return;
              // extracting 阶段：10%～28% 之间随页推进
              const progress =
                10 + Math.floor((p.page / Math.max(p.totalPages, 1)) * 18);
              await this.patchJob(userFileId, {
                progress,
                progressMsg: `OCR 第 ${p.page}/${p.totalPages} 页`,
              });
            },
          },
        );

        // 更新状态 → chunking，进度 30%
        await this.patchJob(userFileId, {
          status: 'chunking',
          progress: 30,
          progressMsg: '正在分块',
        });
        // 按固定策略把长文本切成 { index, content }[]
        chunks = chunkText(fullText).map((c) => ({
          index: c.index,
          content: c.content,
        }));
      }

      if (chunks.length === 0) {
        throw new Error(
          isIndexableMedia(fileRef)
            ? '转写结果为空，无法索引'
            : '文档内容为空，无法索引',
        );
      }

      // 全量路径：写入分句；续建路径：复用已有 rows
      if (resumeFrom == null) {
        if (isIndexableMedia(fileRef)) {
          await this.patchJob(userFileId, {
            status: 'chunking',
            progress: 30,
            progressMsg: isIndexableVideo(fileRef)
              ? '正在写入视频文稿分句'
              : '正在写入转写分句',
          });
        }
        await this.persistNewChunks(userFileId, chunks);
      }

      if (resumeFrom !== 'summarizing') {
        await this.runEmbeddingPhase(userFileId, chunks);
      }

      // 1. 进入 summarizing
      await this.patchJob(userFileId, {
        status: 'summarizing',
        progress: 96,
        progressMsg: '正在生成摘要',
      });
      // 2. 从 job.data 取 summaryGenre
      const summaryGenreRaw: unknown = job.data.summaryGenre;
      if (!isSummaryGenre(summaryGenreRaw)) {
        throw new Error('缺少 summaryGenre');
      }
      const summaryGenre = summaryGenreRaw;
      // 3. 从 DB 读 chunks（含 content、chapterNo）
      const dbChunks = await this.prisma.documentChunk.findMany({
        where: { userFileId },
        orderBy: { chunkIndex: 'asc' },
        select: { chunkIndex: true, chapterNo: true, content: true },
      });
      const chunkInputs = dbChunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        chapterNo: c.chapterNo,
        content: c.content,
      }));
      // 4. 跑 Map-Reduce 生成摘要，按照块->章->书逐级合并，并且每生成一层摘要都会把摘要入库。
      await this.summaryMapReduce.runMapReduce(
        userFileId,
        summaryGenre,
        chunkInputs,
      );
      // 4b. 媒体：语义章节摘要（失败不阻断 ready）
      if (isIndexableMedia(fileRef) && mediaTranscriptText) {
        await this.patchJob(userFileId, {
          progress: 97,
          progressMsg: '正在生成语义章节摘要',
        });
        await this.mediaSemanticChapters.enrichBookSummaryWithMediaChapters(
          userFileId,
          mediaTranscriptText,
          mediaDurationMs,
        );
      }
      // 5. 学术体裁（用户选了学术论文）：抽取知识卡片（F-06）
      if (summaryGenre === 'paper') {
        await this.patchJob(userFileId, {
          status: 'extracting_knowledge',
          progress: 98,
          progressMsg: '正在抽取知识卡片',
        });
        await this.knowledgeExtract.extractKnowledge(userFileId, summaryGenre);
      }

      // 成功收尾：状态 → ready，进度 100%
      await this.patchJob(userFileId, {
        status: 'ready',
        progress: 100,
        progressMsg: '索引完成',
        errorMessage: null,
        indexedFileHash: userFile.storage.fileHash,
      });
      // 打成功日志
      this.logger.log(
        `[document-index] 完成 userFileId=${userFileId} chunks=${chunks.length}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '索引失败';
      this.logger.error(
        `[document-index] 失败 userFileId=${userFileId}: ${message}`,
      );

      await this.patchJob(userFileId, {
        status: 'failed',
        progressMsg: '索引失败',
        errorMessage: message,
      }).catch((patchError) => {
        this.logger.error(
          `[document-index] 更新失败状态出错 userFileId=${userFileId}`,
          patchError,
        );
      });

      // 失败即终态：不自动重试；尽量出队，避免同 jobId 残留挡住重建
      await this.indexQueue.removeDocumentIndexJob(userFileId).catch((err) => {
        this.logger.warn(
          `[document-index] 失败后出队失败 userFileId=${userFileId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      throw new UnrecoverableError(message);
    }
  }
}
