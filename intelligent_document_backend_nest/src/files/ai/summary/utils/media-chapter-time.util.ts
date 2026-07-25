/** 媒体语义章节：比例 ↔ 毫秒、校验与裁剪 */

export type RatioChapter = {
  title: string;
  summary: string;
  startRatio: number;
  endRatio: number;
};

export type MediaChapter = {
  index: number;
  title: string;
  summary: string;
  startMs: number;
  endMs: number;
  startRatio: number;
  endRatio: number;
};

const MAX_CHAPTERS = 12;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * 将 LLM 给出的比例章节映射为带毫秒的章节列表。
 * @param chapters 原始章节（可能乱序、重叠、越界）
 * @param durationMs 媒体总时长（毫秒）；≤0 时仍返回章节但时间为 0
 */
export function mapRatioChaptersToMediaChapters(
  chapters: RatioChapter[],
  durationMs: number,
): MediaChapter[] {
  const dur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const normalized = chapters
    .map((c) => {
      let startRatio = clamp01(Number(c.startRatio));
      let endRatio = clamp01(Number(c.endRatio));
      if (endRatio <= startRatio) {
        endRatio = Math.min(1, startRatio + 0.02);
      }
      if (endRatio <= startRatio) {
        startRatio = Math.max(0, endRatio - 0.02);
      }
      return {
        title: (c.title || '').trim() || '未命名段落',
        summary: (c.summary || '').trim() || '（暂无摘要）',
        startRatio,
        endRatio,
      };
    })
    .sort((a, b) => a.startRatio - b.startRatio)
    .slice(0, MAX_CHAPTERS);

  return normalized.map((c, i) => {
    const startMs = dur > 0 ? Math.round(c.startRatio * dur) : 0;
    let endMs = dur > 0 ? Math.round(c.endRatio * dur) : 0;
    if (dur > 0 && endMs <= startMs) {
      endMs = Math.min(dur, startMs + 1000);
    }
    return {
      index: i + 1,
      title: c.title,
      summary: c.summary,
      startMs,
      endMs,
      startRatio: c.startRatio,
      endRatio: c.endRatio,
    };
  });
}

export { MAX_CHAPTERS };
