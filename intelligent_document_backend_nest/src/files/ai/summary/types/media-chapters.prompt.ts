/** 媒体语义分章 Prompt */

const MAX_TRANSCRIPT_CHARS = 48_000;

export function truncateTranscriptForChapters(text: string): {
  text: string;
  truncated: boolean;
} {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_TRANSCRIPT_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return {
    text: `${trimmed.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n…（后文已截断）`,
    truncated: true,
  };
}

export function buildMediaSemanticChaptersPrompt(
  transcriptText: string,
  durationMs: number,
): string {
  const { text, truncated } = truncateTranscriptForChapters(transcriptText);
  const durationSec = Math.max(0, Math.round(durationMs / 1000));
  return [
    '你是音视频内容编辑。根据转写全文，按「大意/主题变化」划分语义章节。',
    '',
    '规则：',
    '1. 按主题分段，段数自定（通常 2～8；极短可 1 段；最多 12 段）。',
    '2. 禁止为了凑数而按固定字数或固定时间均分。',
    '3. chapters 按内容先后排列；每段 endRatio > startRatio；比例在 0～1。',
    '4. startRatio/endRatio 表示该主题在「全文内容」中的大致起止位置（按叙述先后，不是必须精确到秒）。',
    '5. 覆盖全文主要部分，段与段可轻微重叠但不要大面积重复。',
    '6. 标题短、摘要 1～3 句中文。',
    truncated ? '7. 转写已截断，请基于已提供部分划分。' : '',
    '',
    `媒体时长约 ${durationSec} 秒（仅供理解篇幅，时间轴以你给出的比例为准）。`,
    '',
    '【转写全文】',
    text,
  ]
    .filter(Boolean)
    .join('\n');
}
