import {
  DEFAULT_CHUNK_SIZE,
  chunkText,
} from '@/files/ai/index/service/text-chunker';

export type MediaTranscriptSegment = {
  text: string;
  startMs?: number | null;
  endMs?: number | null;
};

export type MediaIndexChunk = {
  index: number;
  content: string;
  startMs?: number | null;
  endMs?: number | null;
};

/** 去掉 NUL / 孤立代理，避免 Prisma 报 unexpected end of hex escape */
function sanitizeSegmentText(text: string): string {
  if (!text) return '';
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp == null || cp === 0) continue;
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    out += ch;
  }
  return out.trim();
}

/**
 * SenseVoice 等常只返回 1 条超长 segment；整段 embedding 易 400。
 * 对超长句按文档同款窗口切开，并在原时间轴内按块序插值。
 */
export function buildMediaIndexChunks(input: {
  segments: MediaTranscriptSegment[];
  fullText: string;
  durationMs: number;
  maxCharsPerChunk?: number;
}): MediaIndexChunk[] {
  const maxChars = input.maxCharsPerChunk ?? DEFAULT_CHUNK_SIZE;
  const durationMs = Math.max(0, Math.floor(input.durationMs || 0));
  const raw = input.segments
    .map((s) => ({
      text: sanitizeSegmentText(s.text ?? ''),
      startMs: s.startMs ?? null,
      endMs: s.endMs ?? null,
    }))
    .filter((s) => s.text.length > 0);

  const fullText = sanitizeSegmentText(input.fullText);

  const source: MediaTranscriptSegment[] =
    raw.length > 0
      ? raw
      : fullText
        ? [
            {
              text: fullText,
              startMs: 0,
              endMs: durationMs || null,
            },
          ]
        : [];

  const out: MediaIndexChunk[] = [];
  for (const seg of source) {
    const text = sanitizeSegmentText(seg.text ?? '');
    if (!text) continue;

    const spanStart =
      typeof seg.startMs === 'number' && Number.isFinite(seg.startMs)
        ? Math.max(0, Math.round(seg.startMs))
        : 0;
    const spanEnd =
      typeof seg.endMs === 'number' && Number.isFinite(seg.endMs)
        ? Math.max(spanStart, Math.round(seg.endMs))
        : durationMs > 0
          ? durationMs
          : spanStart;
    const span = Math.max(spanEnd - spanStart, 0);
    const unitCount = Array.from(text).length;

    if (unitCount <= maxChars) {
      out.push({
        index: out.length,
        content: text,
        startMs: spanStart,
        endMs: span > 0 ? spanEnd : null,
      });
      continue;
    }

    const parts = chunkText(text, { chunkSize: maxChars });
    const n = Math.max(parts.length, 1);
    for (const part of parts) {
      const startMs =
        span > 0 ? Math.round(spanStart + (part.index / n) * span) : spanStart;
      const endMs =
        span > 0
          ? Math.round(spanStart + ((part.index + 1) / n) * span)
          : null;
      out.push({
        index: out.length,
        content: part.content,
        startMs,
        endMs: endMs != null && endMs > startMs ? endMs : null,
      });
    }
  }

  return out;
}
