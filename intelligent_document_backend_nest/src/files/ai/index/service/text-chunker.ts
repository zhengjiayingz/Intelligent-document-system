export const DEFAULT_CHUNK_SIZE = 800;
export const DEFAULT_CHUNK_OVERLAP = 100;

export type TextChunk = {
  index: number;
  content: string;
};

export type ChunkTextOptions = {
  chunkSize?: number;
  overlap?: number;
  maxChunks?: number;
};

function resolveMaxChunks(maxChunks?: number): number {
  if (maxChunks != null && maxChunks > 0) {
    return maxChunks;
  }
  const fromEnv = Number.parseInt(
    process.env.AI_MAX_INDEX_CHUNKS?.trim() || '500',
    10,
  );
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 500;
}

/**
 * 按 Unicode 码点切开（Array.from），避免 String.slice 劈开代理对，
 * 导致 Prisma createMany 报 unexpected end of hex escape。
 */
function toCodePoints(text: string): string[] {
  return Array.from(text);
}

/** 固定窗口 + overlap 滑动分块，超出 AI_MAX_INDEX_CHUNKS 时截断 */
export function chunkText(
  fullText: string,
  options: ChunkTextOptions = {},
): TextChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE; // 800
  const overlap = options.overlap ?? DEFAULT_CHUNK_OVERLAP; // 100
  const maxChunks = resolveMaxChunks(options.maxChunks); // 500

  if (!fullText) {
    return [];
  }
  if (chunkSize <= 0) {
    throw new Error('chunkSize 必须大于 0');
  }
  if (overlap < 0 || overlap >= chunkSize) {
    throw new Error('overlap 必须满足 0 <= overlap < chunkSize');
  }

  const units = toCodePoints(fullText);
  const stride = chunkSize - overlap;
  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < units.length && chunks.length < maxChunks) {
    chunks.push({
      index: chunks.length,
      content: units.slice(start, start + chunkSize).join(''),
    });

    if (start + chunkSize >= units.length) {
      break;
    }
    start += stride;
  }

  if (start + chunkSize < units.length && chunks.length >= maxChunks) {
    console.warn(
      `[text-chunker] 文档过长，已截断为 ${maxChunks} 块（chunkSize=${chunkSize}, overlap=${overlap}）`,
    );
  }

  return chunks;
}

/**
 * 按 chunkIndex 还原近似全文（去掉滑动窗口 overlap 的重复前缀）。
 */
export function joinOverlappingChunkContents(
  contents: string[],
  overlap: number = DEFAULT_CHUNK_OVERLAP,
): string {
  if (contents.length === 0) return '';
  if (contents.length === 1) return contents[0] ?? '';
  if (overlap <= 0) return contents.join('');

  let text = contents[0] ?? '';
  for (let i = 1; i < contents.length; i++) {
    const part = contents[i] ?? '';
    const units = toCodePoints(part);
    text += units.slice(Math.min(overlap, units.length)).join('');
  }
  return text;
}
