import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import type {
  AsrSegment,
  AsrTranscript,
} from '@/files/ai/index/types/asr.types';

/** 读取 ASR 的 baseURL / apiKey / model（含 Key 回退链） */
function getAsrConfig() {
  const baseURL = (
    process.env.AI_ASR_BASE_URL?.trim() ||
    process.env.AI_VISION_BASE_URL?.trim() ||
    'https://api.siliconflow.cn/v1'
  ).replace(/\/$/, '');
  const apiKey =
    process.env.AI_ASR_API_KEY?.trim() ||
    process.env.AI_VISION_API_KEY?.trim() ||
    process.env.AI_EMBEDDING_API_KEY?.trim() ||
    process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing environment variable: AI_API_KEY');
  }
  const model =
    process.env.AI_ASR_MODEL?.trim() || 'FunAudioLLM/SenseVoiceSmall';
  return { apiKey, baseURL, model };
}

/**
 * 仅接受 string / number，避免对对象用 String() 变成 "[object Object]"。
 * @param value 上游任意字段值
 */
function asTrimmedText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).trim();
  }
  return '';
}

/**
 * 把上游返回的 segments 统一成毫秒时间轴。
 * @param raw 上游 segments 原始值（可能是秒级 start/end，或已是 startMs/endMs；也可能缺失）
 * @param fallbackText 当 raw 为空时，用整段全文兜底成一条 segment
 * @returns 规范化后的句子列表（text + startMs + endMs）
 */
export function normalizeAsrSegments(
  raw: unknown,
  fallbackText: string,
): AsrSegment[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    const text = fallbackText.trim();
    if (!text) return [];
    return [{ text, startMs: 0, endMs: 0 }];
  }

  const out: AsrSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const text = asTrimmedText(row.text) || asTrimmedText(row.transcript);
    if (!text) continue;

    let startMs: number;
    let endMs: number;
    if (typeof row.startMs === 'number' || typeof row.endMs === 'number') {
      startMs = Math.max(0, Math.round(Number(row.startMs) || 0));
      endMs = Math.max(startMs, Math.round(Number(row.endMs) || startMs));
    } else {
      // Whisper 常见：start/end 为秒
      const startSec = Number(row.start ?? 0);
      const endSec = Number(row.end ?? startSec);
      startMs = Math.max(0, Math.round(startSec * 1000));
      endMs = Math.max(startMs, Math.round(endSec * 1000));
    }
    out.push({ text, startMs, endMs });
  }
  return out;
}

/**
 * 调用硅基兼容 /audio/transcriptions，使用 verbose_json 尽量拿到带时间轴的 segments。
 * @param absPath 本地音频文件的绝对路径
 * @returns 全文 text + 带 startMs/endMs 的 segments
 */
export async function transcribeFile(absPath: string): Promise<AsrTranscript> {
  const { apiKey, baseURL, model } = getAsrConfig();

  const form = new FormData();
  // Node 18+：用 Blob 挂文件；若你环境对 Blob+FormData 不友好，可再改成 file-from path 方案
  const buf = await readFile(absPath);
  form.append('file', new Blob([buf]), basename(absPath) || 'audio.wav');
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  // ! 调用硅基 ASR 转写接口（multipart 上传本地音频）
  const res = await fetch(`${baseURL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  // ! 转写结果解析，取出转写结果
  const raw = await res.text();
  if (!res.ok) {
    let message = `ASR API failed: ${res.status}`;
    try {
      const json = JSON.parse(raw) as {
        error?: { message?: string };
        message?: string;
      };
      message = json.error?.message || json.message || message;
    } catch {
      if (raw.trim()) message = raw.slice(0, 200);
    }
    throw new Error(message);
  }

  let parsed: {
    text?: string;
    segments?: unknown;
  };
  try {
    // !把转写结果 JSON 字符串解析成对象
    parsed = JSON.parse(raw) as { text?: string; segments?: unknown };
  } catch {
    throw new Error('ASR 返回了无法解析的 JSON');
  }

  // ! 取出全文 text + 规范化 segments
  const text = asTrimmedText(parsed.text);
  const segments = normalizeAsrSegments(parsed.segments, text);
  if (!text && segments.length === 0) {
    throw new Error('ASR 未返回可用文本');
  }

  return {
    // !直接取全文text或者所有segments的text拼接成全文
    text: text || segments.map((s) => s.text).join(''),
    segments, //! 带上 包含startMs/endMs 的规范化 segments数组
    durationMs: 0,
  };
}
