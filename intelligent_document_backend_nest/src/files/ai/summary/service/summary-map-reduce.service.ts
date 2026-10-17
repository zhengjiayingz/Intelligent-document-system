import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { generateStructuredObject } from '@/files/ai/chat/utils/structured-object.util';
import type { SummaryGenreValue } from '@/files/ai/summary/types/summary-genre.types';
import { pickBookSchema } from '@/files/ai/summary/types/summary-genre.types';
import {
  chunkSummarySchema,
  type ChunkSummary,
} from '@/files/ai/summary/types/summary.schemas';
import {
  buildBookPrompt,
  buildChapterPrompt,
  buildChunkPrompt,
} from '@/files/ai/summary/types/summary.prompt';

/** 短文：跳过 chapter Reduce */
const SHORT_DOC_MAX_CHUNKS = 3;

/**
 * 无 chapterNo 时按批合并，避免数百条 chunk 摘要一次塞进全书 Reduce（超上下文 / 极慢）。
 * 可用 AI_SUMMARY_BATCH_SIZE 覆盖。
 */
function resolveBatchSize(): number {
  const fromEnv = Number.parseInt(
    process.env.AI_SUMMARY_BATCH_SIZE?.trim() || '20',
    10,
  );
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 20;
}

type SummaryPayload = Prisma.InputJsonValue;
type PersistedSummaryType = 'chunk' | 'chapter' | 'book';

export type SummaryChunkInput = {
  chunkIndex: number;
  chapterNo: number | null;
  content: string;
};

export type SummaryMapReduceProgress = {
  phase: 'chunk' | 'chapter' | 'book';
  done: number;
  total: number;
};

export type SummaryMapReduceProgressCb = (
  p: SummaryMapReduceProgress,
) => void | Promise<void>;

type PersistedSummary = {
  refKey: string;
  payload: SummaryPayload;
};

@Injectable()
export class SummaryMapReduceService {
  constructor(private readonly prisma: PrismaService) {}

  async persistSummary(
    userFileId: number,
    type: PersistedSummaryType,
    refKey: string,
    payload: SummaryPayload,
  ): Promise<void> {
    await this.prisma.documentSummary.upsert({
      where: {
        userFileId_type_refKey: { userFileId, type, refKey },
      },
      create: { userFileId, type, refKey, payload },
      update: { payload },
    });
  }
  // chunk总结生成
  private async generateChunkSummary(
    genre: SummaryGenreValue,
    content: string,
  ): Promise<ChunkSummary> {
    //调用大模型
    const object = await generateStructuredObject({
      schema: chunkSummarySchema,
      prompt: buildChunkPrompt(genre, content),
    });
    return object;
  }
  // 章节总结生成
  private async generateChapterSummary(
    genre: SummaryGenreValue,
    chapterNo: number,
    chunkPayloads: SummaryPayload[],
  ): Promise<ChunkSummary> {
    const object = await generateStructuredObject({
      schema: chunkSummarySchema,
      prompt: buildChapterPrompt(
        genre,
        chapterNo,
        JSON.stringify(chunkPayloads, null, 2),
      ),
    });
    return object;
  }

  // 整书总结生成
  private async generateBookSummary(
    genre: SummaryGenreValue,
    intermediatePayloads: SummaryPayload[],
  ): Promise<SummaryPayload> {
    const schema = pickBookSchema(genre);
    const object = await generateStructuredObject({
      schema,
      prompt: buildBookPrompt(
        genre,
        JSON.stringify(intermediatePayloads, null, 2),
      ),
    });
    return object as SummaryPayload;
  }

  /** 传入chunks 给每个chunks生成总结，并把每个chunk总结存入数据库*/
  async summarizeChunks(
    userFileId: number,
    genre: SummaryGenreValue,
    chunks: SummaryChunkInput[],
    onProgress?: SummaryMapReduceProgressCb,
  ): Promise<PersistedSummary[]> {
    // 续跑：已入库的 chunk 摘要直接复用，避免 Worker 重启后从 0 重跑几百次 LLM
    const existingRows = await this.prisma.documentSummary.findMany({
      where: { userFileId, type: 'chunk' },
      select: { refKey: true, payload: true },
    });
    const existingByRef = new Map(
      existingRows.map((row) => [row.refKey, row.payload as SummaryPayload]),
    );

    const results: PersistedSummary[] = [];
    const total = chunks.length;
    // 生成 chunk 总结，并把每个chunk总结存入数据库
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const refKey = `chunk:${chunk.chunkIndex}`;
      const cached = existingByRef.get(refKey);
      if (cached != null) {
        results.push({ refKey, payload: cached });
      } else {
        const payload = await this.generateChunkSummary(genre, chunk.content);
        await this.persistSummary(userFileId, 'chunk', refKey, payload);
        results.push({ refKey, payload });
      }
      await onProgress?.({ phase: 'chunk', done: i + 1, total });
    }

    return results;
  }

  /** Reduce：同章 chunk 摘要 → type=chapter, refKey=chapter:{no} */
  //  把「同一章的多个块摘要」合并成「一条章节摘要」，存为 chapter:{章号}，供后续全书摘要使用
  async reduceChapters(
    userFileId: number,
    genre: SummaryGenreValue,
    chunks: SummaryChunkInput[],
    chunkSummaries: PersistedSummary[],
    onProgress?: SummaryMapReduceProgressCb,
  ): Promise<PersistedSummary[]> {
    const byChapter = new Map<number, SummaryPayload[]>(); // 把每个chunk总结按章节分组

    for (const chunk of chunks) {
      if (chunk.chapterNo == null) continue;
      const refKey = `chunk:${chunk.chunkIndex}`;
      const found = chunkSummaries.find((s) => s.refKey === refKey);
      if (!found) continue;
      const list = byChapter.get(chunk.chapterNo) ?? [];
      list.push(found.payload);
      byChapter.set(chunk.chapterNo, list);
    }

    const results: PersistedSummary[] = [];
    const entries = [...byChapter.entries()].sort((a, b) => a[0] - b[0]);
    const total = entries.length;
    // payloads是一章所有chunk摘要的数组
    for (let i = 0; i < entries.length; i++) {
      const [chapterNo, payloads] = entries[i]!;
      // 把这一章所有的块摘要交给 AI，合并成一条章节摘要
      const payload = await this.generateChapterSummary(
        genre,
        chapterNo,
        payloads,
      );
      const refKey = `chapter:${chapterNo}`;
      await this.persistSummary(userFileId, 'chapter', refKey, payload); // 把某一章的章节总结存入数据库
      results.push({ refKey, payload }); // 把这一章的章节总结存入结果数组
      await onProgress?.({ phase: 'chapter', done: i + 1, total });
    }
    // 返回章节总结数组
    return results;
  }

  /** Reduce：全书 → type=book, refKey=book */
  async reduceBook(
    userFileId: number,
    genre: SummaryGenreValue,
    intermediateSummaries: PersistedSummary[],
    onProgress?: SummaryMapReduceProgressCb,
  ): Promise<PersistedSummary> {
    await onProgress?.({ phase: 'book', done: 0, total: 1 });
    // 调用 AI，按体裁选 schema，合并成全书结构化摘要
    const payload = await this.generateBookSummary(
      genre,
      intermediateSummaries.map((s) => s.payload), // 只取出摘要内容，去掉 refKey 等元数据
    );
    const refKey = 'book'; // 固定键名，每个文件只有一条全书摘要
    await this.persistSummary(userFileId, 'book', refKey, payload); // 把全书总结存入数据库
    await onProgress?.({ phase: 'book', done: 1, total: 1 });
    return { refKey, payload }; // 返回全书总结
  }

  /**
   * 无真实章节时：按 batch 给 chunk 打上合成 chapterNo，走同一套 chapter Reduce。
   * 不写回 DocumentChunk.chapterNo，仅影响本次 Reduce 分组。
   */
  private withSyntheticBatchChapters(
    chunks: SummaryChunkInput[],
  ): SummaryChunkInput[] {
    const batchSize = resolveBatchSize();
    return chunks.map((c) => ({
      ...c,
      chapterNo: Math.floor(c.chunkIndex / batchSize) + 1,
    }));
  }

  /**
   * 一站式入口（单测 / 阶段 3 Worker 都调这个）
   * 顺序：Map → (可选) chapter / batch Reduce → book Reduce
   */
  async runMapReduce(
    userFileId: number,
    genre: SummaryGenreValue,
    chunks: SummaryChunkInput[],
    onProgress?: SummaryMapReduceProgressCb,
  ): Promise<void> {
    const chunkSummaries = await this.summarizeChunks(
      userFileId,
      genre,
      chunks,
      onProgress,
    );

    const hasChapter = chunks.some((c) => c.chapterNo != null);
    const isShort = chunks.length <= SHORT_DOC_MAX_CHUNKS;

    let intermediates: PersistedSummary[];
    if (isShort) {
      // 短文：跳过中间层，chunk 摘要直接 Reduce 为 book
      intermediates = chunkSummaries;
    } else if (hasChapter) {
      intermediates = await this.reduceChapters(
        userFileId,
        genre,
        chunks,
        chunkSummaries,
        onProgress,
      );
    } else {
      // 长文且无 chapterNo：按批合并（PRD：chapterNo 或 batch）
      intermediates = await this.reduceChapters(
        userFileId,
        genre,
        this.withSyntheticBatchChapters(chunks),
        chunkSummaries,
        onProgress,
      );
    }

    await this.reduceBook(userFileId, genre, intermediates, onProgress);
  }
}
