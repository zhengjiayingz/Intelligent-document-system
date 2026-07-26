import type { SummaryGenre } from '@prisma/client';

export const DOCUMENT_INDEX_QUEUE_NAME = 'document-index';
export const DOCUMENT_INDEX_JOB_NAME = 'index';

export type DocumentIndexJobData = {
  userFileId: number;
  userId: number;
  mode: 'general' | 'academic';
  summaryGenre: SummaryGenre;
};

/** 供 API 侧调用的队列端口（避免把 BullMQ Queue 类型泄漏进调用方） */
export type DocumentIndexQueuePort = {
  removeDocumentIndexJob(userFileId: number): Promise<void>;
  enqueueDocumentIndex(data: DocumentIndexJobData): Promise<unknown>;
};
