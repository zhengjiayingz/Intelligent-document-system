import { z } from 'zod';
import { llmString } from '@/files/ai/chat/utils/llm-schema.util';

/** LLM 输出的媒体语义分章（比例时间轴） */
export const mediaSemanticChaptersLlmSchema = z.object({
  oneLiner: llmString().describe('整段音视频一句话概括'),
  overview: llmString().describe('整段音视频概览，2～5 句'),
  chapters: z
    .array(
      z.object({
        title: llmString().describe('该主题小标题'),
        summary: llmString().describe('该主题短摘要'),
        startRatio: z.coerce
          .number()
          .describe('该段在全文内容中的起始比例 0～1'),
        endRatio: z.coerce.number().describe('该段在全文内容中的结束比例 0～1'),
      }),
    )
    .min(1)
    .max(12),
});

export type MediaSemanticChaptersLlm = z.infer<
  typeof mediaSemanticChaptersLlmSchema
>;
