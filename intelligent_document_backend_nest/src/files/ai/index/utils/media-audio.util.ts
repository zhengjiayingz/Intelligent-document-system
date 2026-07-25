// ASR 对格式挑剔,利用ffmpeg 把任意本地音/视频转成 16kHz / mono / wav
import { mkdtemp, rm } from 'node:fs/promises'; // 在 temp 下建一个专属子目录
import { tmpdir } from 'node:os'; // 创建临时目录
import { join } from 'node:path';

import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/** 视频最长秒数；未配置时默认 60 分钟 */
export function getMaxVideoDurationSec(): number {
  const raw = process.env.AI_MAX_VIDEO_DURATION_SEC?.trim();
  const n = raw ? Number(raw) : 3600;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3600;
}

/**
 * 用 ffprobe 读取媒体时长（秒）。失败时抛错。
 */
export async function probeMediaDurationSec(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const sec = data?.format?.duration;
      if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) {
        reject(new Error('无法读取媒体时长'));
        return;
      }
      resolve(sec);
    });
  });
}

export type PreparedAudio = {
  /** 转码后的 wav 绝对路径 */
  wavPath: string;
  /** 临时目录；用完后应调用 cleanupPreparedAudio */
  tempDir: string;
};

/**
 * 把本地音频转成 ASR 友好的 16kHz 单声道 wav（写到系统临时目录）。
 * @param inputPath 原始音频文件的绝对路径（mp3/wav/m4a 等）
 * @returns wav 路径 + 临时目录（调用方负责 cleanup）
 */
export async function prepareAudioForAsr(
  inputPath: string,
): Promise<PreparedAudio> {
  const tempDir = await mkdtemp(join(tmpdir(), 'asr-prep-'));
  const wavPath = join(tempDir, 'audio-16k-mono.wav');
  // ! 用 ffmpeg 把原始音频转成 16kHz 单声道 wav
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo() // 无视频
      .audioChannels(1) // 单声道
      .audioFrequency(16000) // 16kHz
      .format('wav') // 转成 wav 格式
      .on('end', () => resolve()) // 转写完成resolve()
      .on('error', (err: Error) => reject(err))
      .save(wavPath); // 保存到临时目录
  });
  // ! 返回 wav 路径 + 临时目录
  return { wavPath, tempDir };
}

/**
 * 删除 prepareAudioForAsr 产生的临时目录。
 * @param prepared prepareAudioForAsr 的返回值；也可传 null/undefined（空操作）
 */
export async function cleanupPreparedAudio(
  prepared: PreparedAudio | null | undefined,
): Promise<void> {
  if (!prepared?.tempDir) return;
  await rm(prepared.tempDir, { recursive: true, force: true });
}
