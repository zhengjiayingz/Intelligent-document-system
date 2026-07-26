/**
 * O-01：根据已有 document_chunks 判断能否断点续建，以及从哪一段继续。
 * - embedding：文稿齐全，但至少一条缺少向量 → 跳过 ASR/抽文本，只补向量及之后
 * - summarizing：文稿与向量均齐全 → 跳过提取与向量，只跑摘要及之后
 * - null：不可续（无块、缺字、chunkIndex 不连续等）→ 全量重跑
 */

export type IndexResumeFrom = 'embedding' | 'summarizing';

export type IndexResumeChunk = {
  chunkIndex: number;
  content: string;
  embedding?: unknown;
};

export function hasChunkEmbedding(embedding: unknown): boolean {
  return Array.isArray(embedding) && embedding.length > 0;
}

/**
 * @param chunks 该文件全部 chunks（无需预先排序）
 * @param expectedCount 可选：job.chunkCount；>0 且与行数不一致则视为不可靠
 */
export function assessIndexResume(
  chunks: IndexResumeChunk[],
  expectedCount?: number | null,
): IndexResumeFrom | null {
  if (chunks.length === 0) return null;
  if (
    expectedCount != null &&
    expectedCount > 0 &&
    expectedCount !== chunks.length
  ) {
    return null;
  }

  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].chunkIndex !== i) return null;
    if (!sorted[i].content?.trim()) return null;
  }

  const anyMissingEmbedding = sorted.some(
    (c) => !hasChunkEmbedding(c.embedding),
  );
  return anyMissingEmbedding ? 'embedding' : 'summarizing';
}

/**
 * 是否应保留已有 chunks（断点续建）。
 * ready + force：用户要全量重建 → 不保留。
 * failed / 卡住的进行中 + 有可续 chunks → 保留。
 */
export function shouldKeepChunksForResume(input: {
  force: boolean;
  existingStatus: string | null | undefined;
  resumeFrom: IndexResumeFrom | null;
}): boolean {
  if (input.resumeFrom == null) return false;
  if (input.force && input.existingStatus === 'ready') return false;
  return true;
}
