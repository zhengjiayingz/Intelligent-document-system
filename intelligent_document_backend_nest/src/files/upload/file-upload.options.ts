import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import type { Request } from 'express';
import { diskStorage } from 'multer';
import { getUploadRootDir } from '../utils/storagePath.utils';
import { applyDecodedOriginalName } from './multipart-filename.util';

function ensureChunkTmpDir(): string {
  const dir = join(process.cwd(), 'chunks', '_tmp');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export const chunkUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, ensureChunkTmpDir());
    },
    filename: (_req, file, cb) => {
      applyDecodedOriginalName(file);
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `chunk-${uniqueSuffix}${extname(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
  },
};

export const fileUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const dir = getUploadRootDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      applyDecodedOriginalName(file);
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = extname(file.originalname);
      const nameWithoutExt = file.originalname.slice(
        0,
        file.originalname.length - ext.length,
      );
      cb(null, `${nameWithoutExt}-${uniqueSuffix}${ext}`);
    },
  }),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10),
  },
  fileFilter: (req: Request, file, cb) => {
    applyDecodedOriginalName(file);
    const body = req.body as Record<string, unknown>;
    if (body.fileHash && body.chunkIndex !== undefined) {
      cb(null, true);
      return;
    }

    const allowedTypes =
      /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|markdown|zip|rar|7z|mp3|wav|ogg|mp4|avi|mov|rmvb/;
    const ext = extname(file.originalname).toLowerCase();
    const extnameOk = allowedTypes.test(ext);
    const mimetypeOk = allowedTypes.test(file.mimetype);

    if (extnameOk && mimetypeOk) {
      cb(null, true);
      return;
    }
    // 部分浏览器对 .md / .rmvb 会上报 application/octet-stream 等非标准 MIME
    if (ext === '.rmvb' || ext === '.md') {
      cb(null, true);
      return;
    }
    // 简单上传 .txt 时浏览器 MIME 是 text/plain，白名单正则只认 txt 子串
    if (
      ext === '.txt' &&
      (!file.mimetype || file.mimetype.startsWith('text/plain'))
    ) {
      cb(null, true);
      return;
    }
    cb(new Error('不支持的文件类型'), false);
  },
};
