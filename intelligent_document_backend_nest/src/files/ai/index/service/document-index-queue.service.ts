import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import {
  DOCUMENT_INDEX_JOB_NAME,
  DOCUMENT_INDEX_QUEUE_NAME,
  type DocumentIndexJobData,
} from '@/files/ai/index/types/document-index-queue.types';

@Injectable()
export class DocumentIndexQueueService implements OnModuleDestroy {
  private queue: Queue<DocumentIndexJobData> | null = null;

  constructor(private readonly config: ConfigService) {}

  private getConnection(): ConnectionOptions {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      throw new Error('REDIS_URL 未配置，文档索引队列不可用');
    }
    return { url, maxRetriesPerRequest: null };
  }

  private getQueue(): Queue<DocumentIndexJobData> {
    if (!this.queue) {
      this.queue = new Queue<DocumentIndexJobData>(DOCUMENT_INDEX_QUEUE_NAME, {
        connection: this.getConnection(),
        defaultJobOptions: {
          // 失败即终态：避免「DB 已 failed 但队列仍 delayed/retry」导致无法重新入队
          attempts: 1,
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 100 },
        },
      });
    }
    return this.queue;
  }

  private jobIdFor(userFileId: number) {
    return `document-index-${userFileId}`;
  }

  /**
   * 从队列移除该文件的索引任务（failed / delayed / waiting / completed）。
   * active 时尽量移除；失败忽略。
   */
  async removeDocumentIndexJob(userFileId: number): Promise<void> {
    const queue = this.getQueue();
    const existing = await queue.getJob(this.jobIdFor(userFileId));
    if (!existing) return;
    try {
      await existing.remove();
    } catch {
      // active 等状态可能暂时无法 remove
    }
  }

  async enqueueDocumentIndex(data: DocumentIndexJobData) {
    const jobId = this.jobIdFor(data.userFileId);
    const queue = this.getQueue();
    const existing = await queue.getJob(jobId);

    if (existing) {
      const state = await existing.getState();
      if (
        state === 'completed' ||
        state === 'failed' ||
        state === 'delayed' ||
        state === 'waiting' ||
        state === 'prioritized'
      ) {
        await existing.remove().catch(() => undefined);
      } else if (state === 'active') {
        // 真正执行中：不顶替
        return existing;
      }
    }

    return queue.add(DOCUMENT_INDEX_JOB_NAME, data, { jobId });
  }

  async onModuleDestroy() {
    await this.queue?.close();
    this.queue = null;
  }
}
