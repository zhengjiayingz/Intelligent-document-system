import crypto from 'node:crypto';
import fs from 'node:fs';

/** 哈希 / 合并拷贝块大小：控内存，同时减少系统调用次数 */
const IO_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MiB

/**
 * 流式 MD5：按块读盘，避免大文件整文件进内存。
 * 结果与「整文件 Buffer 再 hash」一致。
 */
export const calculateFileHash = (filePath: string): string => {
  const hash = crypto.createHash('md5');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(IO_CHUNK_BYTES);
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
};

/**
 * 按顺序拼接多个源文件到 dest，边写边算 MD5（单次扫盘）。
 * 用大块 read/write，避免默认 64KB 流 + Transform 在本地盘上偏慢。
 * @returns 合并结果的 md5 hex
 */
export async function concatenateFilesWithMd5(
  sourcePaths: string[],
  destPath: string,
): Promise<string> {
  if (sourcePaths.length === 0) {
    fs.writeFileSync(destPath, '');
    return calculateFileHash(destPath);
  }

  const hash = crypto.createHash('md5');
  const buf = Buffer.alloc(IO_CHUNK_BYTES);
  const out = await fs.promises.open(destPath, 'w');

  try {
    for (const src of sourcePaths) {
      const inp = await fs.promises.open(src, 'r');
      try {
        for (;;) {
          const { bytesRead } = await inp.read(buf, 0, buf.length, null);
          if (bytesRead === 0) break;
          const slice = buf.subarray(0, bytesRead);
          hash.update(slice);
          await out.write(slice);
        }
      } finally {
        await inp.close();
      }
    }
  } catch (err) {
    await out.close().catch(() => undefined);
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    throw err;
  }

  await out.close();
  return hash.digest('hex');
}

export const ensureDirectoryExists = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};
