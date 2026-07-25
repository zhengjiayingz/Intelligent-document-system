import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { generateStructuredObject } from '@/files/ai/chat/utils/structured-object.util';
import { mediaSemanticChaptersLlmSchema } from '@/files/ai/summary/types/media-chapters.schemas';
import { buildMediaSemanticChaptersPrompt } from '@/files/ai/summary/types/media-chapters.prompt';
import {
  mapRatioChaptersToMediaChapters,
  type MediaChapter,
} from '@/files/ai/summary/utils/media-chapter-time.util';

export type MediaSemanticChaptersResult = {
  oneLiner: string;
  overview: string;
  durationMs: number;
  mediaChapters: MediaChapter[];
};

@Injectable()
export class MediaSemanticChaptersService {
  private readonly logger = new Logger(MediaSemanticChaptersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 根据转写全文生成语义章节，并 merge 进已有 book 摘要 payload。
   * 失败时打日志并返回 false（不抛，以免阻断索引 ready）。
   */
  async enrichBookSummaryWithMediaChapters(
    userFileId: number,
    transcriptText: string,
    durationMs: number,
  ): Promise<boolean> {
    const text = transcriptText.trim();
    if (!text) {
      this.logger.warn(
        `[media-chapters] 跳过：转写为空 userFileId=${userFileId}`,
      );
      return false;
    }

    try {
      const generated = await this.generateChapters(text, durationMs);
      await this.mergeIntoBookPayload(userFileId, generated);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[media-chapters] 失败 userFileId=${userFileId}: ${message}`,
      );
      return false;
    }
  }

  async generateChapters(
    transcriptText: string,
    durationMs: number,
  ): Promise<MediaSemanticChaptersResult> {
    const object = await generateStructuredObject({
      schema: mediaSemanticChaptersLlmSchema,
      prompt: buildMediaSemanticChaptersPrompt(transcriptText, durationMs),
      schemaName: 'media_semantic_chapters',
    });

    const mediaChapters = mapRatioChaptersToMediaChapters(
      object.chapters,
      durationMs,
    );

    return {
      oneLiner: object.oneLiner.trim(),
      overview: object.overview.trim(),
      durationMs: Math.max(0, Math.round(durationMs)),
      mediaChapters,
    };
  }

  private async mergeIntoBookPayload(
    userFileId: number,
    generated: MediaSemanticChaptersResult,
  ): Promise<void> {
    const existing = await this.prisma.documentSummary.findUnique({
      where: {
        userFileId_type_refKey: {
          userFileId,
          type: 'book',
          refKey: 'book',
        },
      },
      select: { payload: true },
    });

    const base =
      existing?.payload &&
      typeof existing.payload === 'object' &&
      !Array.isArray(existing.payload)
        ? { ...(existing.payload as Record<string, unknown>) }
        : {};

    if (generated.oneLiner) {
      base.oneLiner = generated.oneLiner;
    }
    if (generated.overview) {
      base.overview = generated.overview;
    }
    base.durationMs = generated.durationMs;
    base.mediaChapters = generated.mediaChapters;

    const payload = base as Prisma.InputJsonValue;
    await this.prisma.documentSummary.upsert({
      where: {
        userFileId_type_refKey: {
          userFileId,
          type: 'book',
          refKey: 'book',
        },
      },
      create: {
        userFileId,
        type: 'book',
        refKey: 'book',
        payload,
      },
      update: { payload },
    });
  }
}
