import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import type { StorageProvider } from '@/storage/types';
import {
  isIndexableAudio,
  isIndexableVideo,
  type TextDocumentRef,
} from '@/files/ai/index/service/text-extractor';
import { UnsupportedDocumentFormatError } from '@/files/ai/index/service/text-extractor';

import { transcribeFile } from '@/files/ai/index/provider/asr.provider';
import type { AsrTranscript } from '@/files/ai/index/types/asr.types';
import {
  cleanupPreparedAudio,
  getMaxVideoDurationSec,
  prepareAudioForAsr,
  probeMediaDurationSec,
} from '@/files/ai/index/utils/media-audio.util';

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    // 统一经 Buffer.from，避免 Readable chunk 的 Buffer<any> 触发 no-unsafe-argument
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * 从 Storage 拉取音频或视频 →（视频校验时长）→ 转 16k mono → ASR。
 * @param storage 当前 StorageProvider（与文档索引同一套）
 * @param input storedPath / fileName / mimeType
 * @returns 全文 + segments（startMs/endMs）
 */
export async function extractAudioTranscriptFromStorage(
  storage: StorageProvider,
  input: TextDocumentRef,
): Promise<AsrTranscript> {
  const isAudio = isIndexableAudio(input);
  const isVideo = isIndexableVideo(input);
  if (!isAudio && !isVideo) {
    throw new UnsupportedDocumentFormatError(
      '不支持的媒体格式，请使用常见音频（mp3/wav/m4a）或视频（mp4/webm/mov）',
    );
  }

  const exists = await storage.exists(input.storedPath);
  if (!exists) {
    throw new Error('文件不存在或已被删除');
  }

  const stream = await storage.getReadStream(input.storedPath);
  const buffer = await readStreamToBuffer(stream);

  // 原始字节落临时文件，供 ffmpeg / ASR 读路径
  const downloadDir = await mkdtemp(join(tmpdir(), 'asr-dl-'));
  const sourcePath = join(
    downloadDir,
    input.fileName || (isVideo ? 'video.bin' : 'audio.bin'),
  );
  let prepared: Awaited<ReturnType<typeof prepareAudioForAsr>> | null = null;

  try {
    await writeFile(sourcePath, buffer);
    let durationMs = 0;
    try {
      const durationSec = await probeMediaDurationSec(sourcePath);
      durationMs = Math.round(durationSec * 1000);
      if (isVideo) {
        const maxSec = getMaxVideoDurationSec();
        if (durationSec > maxSec) {
          throw new Error(
            `视频时长约 ${Math.ceil(durationSec / 60)} 分钟，超过上限 ${Math.floor(maxSec / 60)} 分钟`,
          );
        }
      }
    } catch (err) {
      if (isVideo) throw err;
      // 音频时长探测失败不阻断转写
    }
    prepared = await prepareAudioForAsr(sourcePath);
    const transcript = await transcribeFile(prepared.wavPath);
    return { ...transcript, durationMs };
  } finally {
    await cleanupPreparedAudio(prepared);
    await rm(downloadDir, { recursive: true, force: true });
  }
}
