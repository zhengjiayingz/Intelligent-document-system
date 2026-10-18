import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import archiver from 'archiver';
import ffmpeg from 'fluent-ffmpeg';
import iconv from 'iconv-lite';
import jschardet from 'jschardet';
import fs from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import {
  FileBatchHelper,
  ObjectNotFoundError,
} from '../helpers/file-batch.helper';
import { ensureDirectoryExists } from '../utils/file.utils';
import { resolveStorageFilePath } from '../utils/storagePath.utils';
import {
  resolveDownloadContentType,
  sendLocalFileWithRange,
} from '../utils/download-response.utils';
import {
  LogOperationType,
  LogResourceType,
  OperationLogService,
} from '@/operation-log/operation-log.service';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const BATCH_ZIP_MAX_TOP_IDS = 200;
const BATCH_ZIP_MAX_FILE_ENTRIES = 500;
const TEXT_CHUNK_MAX = 1024 * 1024;
const TEXT_CHUNK_DEFAULT = 256 * 1024;

type TextChunkFileEncoding = 'utf-8' | 'gb18030';
type ZipBuildEntry =
  | { kind: 'file'; abs: string; zipPath: string }
  | { kind: 'dir'; zipPath: string };

function queryString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return '';
}

function queryStringOr(value: unknown, fallback: string): string {
  const s = queryString(value);
  return s || fallback;
}

function parseQueryInt(value: unknown, fallback: number): number {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = parseInt(value.trim(), 10);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

function tryParseQueryInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return parseInt(value.trim(), 10);
  }
  return Number.NaN;
}

@Injectable()
export class FilesQueryService {
  private readonly textChunkEncodingCache = new Map<
    string,
    TextChunkFileEncoding
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly operationLogService: OperationLogService,
    private readonly fileBatchHelper: FileBatchHelper,
  ) {}

  async getFiles(userId: number, query: Record<string, unknown>) {
    const {
      parentId,
      isDeleted,
      q,
      type,
      tagId: tagIdQuery,
      createdFrom,
      createdTo,
      entryKind,
    } = query;
    const whereClause: Record<string, unknown> = {
      userId,
      isDeleted: isDeleted === 'true',
    };

    const tagIdNum = tryParseQueryInt(tagIdQuery);
    if (!Number.isNaN(tagIdNum)) {
      whereClause.userFileTags = {
        some: {
          tagId: tagIdNum,
          tag: { userId },
        },
      };
    }

    const cf = queryString(createdFrom);
    const ct = queryString(createdTo);
    if (cf || ct) {
      whereClause.createdAt = {};
      if (cf) {
        (whereClause.createdAt as { gte?: Date }).gte = new Date(cf);
      }
      if (ct) {
        const end = new Date(ct);
        end.setHours(23, 59, 59, 999);
        (whereClause.createdAt as { lte?: Date }).lte = end;
      }
    }

    const qStr = queryString(q);
    if (qStr) {
      whereClause.fileName = { contains: qStr };
    }

    const ek = queryStringOr(entryKind, 'all');
    if (ek === 'file') {
      whereClause.fileType = 'file';
    } else if (ek === 'folder') {
      whereClause.fileType = 'folder';
    }

    const typeStr = queryStringOr(type, 'all');
    const mimeWhere =
      typeStr !== 'all' ? this.storageWhereForMimeCategory(typeStr) : null;
    if (mimeWhere) {
      if (whereClause.fileType === 'folder') {
        whereClause.id = { in: [] };
      } else if (whereClause.fileType === 'file') {
        whereClause.storage = mimeWhere;
      } else {
        whereClause.AND = whereClause.AND || [];
        (whereClause.AND as unknown[]).push({
          OR: [
            { fileType: 'folder' },
            { fileType: 'file', storage: mimeWhere },
          ],
        });
      }
    }

    const isRecycle = isDeleted === 'true';
    if (!isRecycle) {
      const parentKeyPresent = Object.prototype.hasOwnProperty.call(
        query,
        'parentId',
      );
      if (parentKeyPresent) {
        const pv = parentId as string | undefined;
        whereClause.parentId =
          pv === '' || pv === undefined || pv === 'null' || pv === 'undefined'
            ? null
            : parseInt(String(pv), 10);
      } else if (typeStr === 'all') {
        whereClause.parentId = null;
      }
    }

    const userFiles = await this.prisma.userFile.findMany({
      where: whereClause,
      include: {
        storage: {
          select: {
            fileSize: true,
            mimeType: true,
          },
        },
        userFileTags: {
          include: {
            tag: true,
          },
        },
      },
      orderBy: [{ fileType: 'desc' }, { createdAt: 'desc' }],
    });

    const files = userFiles.map((file) => ({
      id: file.id,
      parentId: file.parentId,
      fileName: file.fileName,
      fileType: file.fileType,
      fileSize: file.storage ? Number(file.storage.fileSize) : 0,
      mimeType:
        file.storage?.mimeType ||
        (file.fileType === 'folder' ? 'folder' : 'unknown'),
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      isDeleted: file.isDeleted,
      tags: file.userFileTags.map((u) => ({
        id: u.tag.id,
        tagName: u.tag.tagName,
        color: u.tag.color,
      })),
    }));

    return {
      success: true,
      data: files,
      total: files.length,
    };
  }

  async getFileById(userId: number, fileId: number) {
    if (Number.isNaN(fileId)) throw new BadRequestException('无效的文件ID');

    const userFile = await this.prisma.userFile.findFirst({
      where: {
        id: fileId,
        userId,
        isDeleted: false,
      },
      include: {
        storage: {
          select: {
            fileSize: true,
            mimeType: true,
          },
        },
        userFileTags: {
          include: {
            tag: true,
          },
        },
      },
    });

    if (!userFile) throw new NotFoundException('文件不存在');

    return {
      success: true,
      data: {
        id: userFile.id,
        parentId: userFile.parentId,
        fileName: userFile.fileName,
        fileType: userFile.fileType,
        fileSize: userFile.storage ? Number(userFile.storage.fileSize) : 0,
        mimeType: userFile.storage?.mimeType || 'unknown',
        createdAt: userFile.createdAt,
        updatedAt: userFile.updatedAt,
        tags: userFile.userFileTags.map((u) => ({
          id: u.tag.id,
          tagName: u.tag.tagName,
          color: u.tag.color,
        })),
      },
    };
  }

  async downloadFile(
    req: Request,
    res: Response,
    userId: number,
    fileId: number,
  ): Promise<void> {
    if (Number.isNaN(fileId)) {
      res.status(400).json({ success: false, message: '无效的文件ID' });
      return;
    }

    const userFile = await this.prisma.userFile.findFirst({
      where: {
        id: fileId,
        userId,
        isDeleted: false,
      },
      include: {
        storage: {
          select: {
            filePath: true,
            mimeType: true,
          },
        },
      },
    });

    if (!userFile || !userFile.storage) {
      res.status(404).json({ success: false, message: '文件不存在' });
      return;
    }

    const storage = this.storageService.getStorageProvider();
    if (!(await storage.exists(userFile.storage.filePath))) {
      res.status(404).json({ success: false, message: '文件已被删除' });
      return;
    }

    const isPreview = req.query.preview === 'true';
    const disposition = isPreview ? 'inline' : 'attachment';
    let contentType = resolveDownloadContentType(
      userFile.fileName,
      userFile.storage.mimeType,
    );
    const ext = path.extname(userFile.fileName).toLowerCase();

    const textPreviewExts = new Set([
      '.txt',
      '.md',
      '.json',
      '.js',
      '.css',
      '.html',
      '.xml',
      '.log',
      '.csv',
    ]);
    if (
      isPreview &&
      (contentType.startsWith('text/') || textPreviewExts.has(ext))
    ) {
      if (!contentType.startsWith('text/')) {
        contentType = 'text/plain';
      }
      if (!contentType.includes('charset')) contentType += '; charset=utf-8';
    }

    await this.operationLogService.logOperation({
      req,
      userId,
      operationType: LogOperationType.DOWNLOAD,
      resourceType: LogResourceType.FILE,
      resourceId: userFile.id,
      description: `Downloaded file: ${userFile.fileName}`,
    });

    if (this.storageService.getStorageDriver() === 'local') {
      const physicalPath = resolveStorageFilePath(userFile.storage.filePath);
      sendLocalFileWithRange(req, res, physicalPath, {
        contentType,
        disposition,
        fileName: userFile.fileName,
      });
      return;
    }

    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(userFile.fileName)}"`,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    const stream = await storage.getReadStream(userFile.storage.filePath);
    stream.on('error', (err) => {
      console.error('Download stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: '文件下载失败' });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  }

  async getFileThumbnail(
    req: Request,
    res: Response,
    userId: number,
    fileId: number,
  ): Promise<void> {
    if (Number.isNaN(fileId)) {
      res.status(400).json({ success: false, message: '无效的文件ID' });
      return;
    }

    const userFile = await this.prisma.userFile.findFirst({
      where: {
        id: fileId,
        userId,
        isDeleted: false,
      },
      include: {
        storage: {
          select: {
            filePath: true,
            mimeType: true,
            fileHash: true,
          },
        },
      },
    });

    if (!userFile || !userFile.storage) {
      res.status(404).json({ success: false, message: '文件不存在' });
      return;
    }

    const physicalPath = resolveStorageFilePath(userFile.storage.filePath);
    const mimeType = userFile.storage.mimeType.toLowerCase();
    const fileName = userFile.fileName.toLowerCase();
    const isImage =
      mimeType.startsWith('image/') ||
      /\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff|svg)$/i.test(fileName);
    const isVideo =
      (mimeType.startsWith('video/') ||
        /\.(mp4|webm|mov|wmv|flv|avi|rmvb|mkv|3gp|asf|m4v)$/i.test(fileName)) &&
      !mimeType.startsWith('audio/');

    if (!isImage && !isVideo) {
      res
        .status(400)
        .json({ success: false, message: '不支持该文件类型的缩略图' });
      return;
    }
    if (!fs.existsSync(physicalPath)) {
      res.status(404).json({ success: false, message: '文件源已丢失' });
      return;
    }

    const thumbnailsDir = path.join(process.cwd(), 'thumbnails');
    ensureDirectoryExists(thumbnailsDir);
    const thumbnailName = `${userFile.storage.fileHash}-thumb.webp`;
    const thumbnailPath = path.join(thumbnailsDir, thumbnailName);

    if (fs.existsSync(thumbnailPath)) {
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.sendFile(thumbnailPath);
      return;
    }

    try {
      if (isImage) {
        await sharp(physicalPath)
          .resize(200, 200, { fit: 'cover', position: 'center' })
          .webp({ quality: 80 })
          .toFile(thumbnailPath);
      } else if (isVideo) {
        const tempThumbName = `${userFile.storage.fileHash}-temp.jpg`;
        const tempThumbPath = path.join(thumbnailsDir, tempThumbName);
        try {
          await new Promise((resolve, reject) => {
            ffmpeg(physicalPath)
              .seekInput('00:00:05')
              .frames(1)
              .on('end', () => resolve(true))
              .on('error', reject)
              .save(tempThumbPath);
          });
        } catch {
          try {
            await new Promise((resolve, reject) => {
              ffmpeg(physicalPath)
                .frames(1)
                .on('end', resolve)
                .on('error', reject)
                .save(tempThumbPath);
            });
          } catch {
            console.warn(
              `[Thumbnail] Failed to extract video frame for file ${userFile.id} (${userFile.fileName}).`,
            );
          }
        }
        if (fs.existsSync(tempThumbPath)) {
          await sharp(tempThumbPath)
            .resize(200, 200, { fit: 'cover' })
            .webp({ quality: 80 })
            .toFile(thumbnailPath);
          fs.unlinkSync(tempThumbPath);
        } else {
          throw new Error('无法生成视频预览图');
        }
      }

      if (fs.existsSync(thumbnailPath)) {
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.sendFile(thumbnailPath);
      } else {
        throw new Error('生成的缩略图文件不存在');
      }
    } catch (error) {
      console.error('Thumbnail generation error:', error);
      res.status(500).json({ success: false, message: '缩略图生成失败' });
    }
  }

  async getTextFileChunk(
    userId: number,
    fileId: number,
    query: Record<string, unknown>,
  ) {
    if (Number.isNaN(fileId)) throw new BadRequestException('无效的文件ID');

    const offsetRaw = query.offset;
    const maxBytesRaw = query.maxBytes;
    let offset = parseQueryInt(offsetRaw, 0);
    let maxBytes = parseQueryInt(maxBytesRaw, TEXT_CHUNK_DEFAULT);
    if (Number.isNaN(offset) || offset < 0) offset = 0;
    if (Number.isNaN(maxBytes) || maxBytes < 1024)
      maxBytes = TEXT_CHUNK_DEFAULT;
    if (maxBytes > TEXT_CHUNK_MAX) maxBytes = TEXT_CHUNK_MAX;

    const userFile = await this.prisma.userFile.findFirst({
      where: { id: fileId, userId, isDeleted: false },
      include: {
        storage: { select: { filePath: true, mimeType: true, fileSize: true } },
      },
    });
    if (!userFile || !userFile.storage)
      throw new NotFoundException('文件不存在');

    const ext = path.extname(userFile.fileName).toLowerCase();
    const contentType = (userFile.storage.mimeType || '').toLowerCase();
    if (!this.isTextLikeFileForChunk(ext, contentType)) {
      throw new BadRequestException('该文件类型不支持分块文本预览');
    }
    if (ext === '.pdf' || contentType === 'application/pdf') {
      throw new BadRequestException('PDF 请使用全量或 PDF 阅读器');
    }

    const physicalPath = resolveStorageFilePath(userFile.storage.filePath);
    if (!fs.existsSync(physicalPath))
      throw new NotFoundException('文件已被删除');

    const st = await stat(physicalPath);
    const totalSize = st.size;
    if (offset >= totalSize) {
      return {
        success: true,
        data: { text: '', nextOffset: totalSize, totalSize, done: true },
      };
    }

    const handle = await open(physicalPath, 'r');
    try {
      const qenc = this.mapQueryToChunkEncoding(
        query.encoding as string | string[] | undefined,
      );
      const ck = this.textChunkCacheKey(userId, fileId);
      let fileEnc: TextChunkFileEncoding = 'utf-8';

      if (qenc) {
        fileEnc = qenc;
        this.textChunkEncodingCache.set(ck, fileEnc);
      } else if (this.textChunkEncodingCache.has(ck)) {
        fileEnc = this.textChunkEncodingCache.get(ck)!;
      } else if (offset > 0) {
        const headLen = Math.min(65536, totalSize);
        const headBuf = Buffer.alloc(headLen);
        const hr = await handle.read(headBuf, 0, headLen, 0);
        fileEnc = this.detectTextFileEncodingFromBuffer(
          headBuf.subarray(0, hr.bytesRead),
        );
        this.textChunkEncodingCache.set(ck, fileEnc);
      }

      const toRead = Math.min(maxBytes, totalSize - offset);
      const buf = Buffer.alloc(toRead);
      const result = await handle.read(buf, 0, toRead, offset);
      let data = buf.subarray(0, result.bytesRead);

      if (offset === 0 && !qenc && !this.textChunkEncodingCache.has(ck)) {
        const sample = data.length > 65536 ? data.subarray(0, 65536) : data;
        fileEnc = this.detectTextFileEncodingFromBuffer(sample);
        this.textChunkEncodingCache.set(ck, fileEnc);
      }

      let useLen = this.rawCompletePrefixLength(data, fileEnc);
      let added = 0;
      while (
        useLen === 0 &&
        data.length > 0 &&
        added < 3 &&
        offset + data.length < totalSize
      ) {
        const one = Buffer.alloc(1);
        const r2 = await handle.read(one, 0, 1, offset + data.length);
        if (r2.bytesRead === 0) break;
        added += 1;
        data = Buffer.concat([data, one.subarray(0, 1)]);
        useLen = this.rawCompletePrefixLength(data, fileEnc);
      }
      if (useLen === 0 && data.length > 0) useLen = data.length;

      const slice = data.subarray(0, useLen);
      let text: string;
      if (fileEnc === 'utf-8') {
        text = slice.toString('utf8');
        if (offset === 0 && text.length > 0 && text.charCodeAt(0) === 0xfeff) {
          text = text.slice(1);
        }
      } else {
        text = iconv.decode(slice, 'gb18030');
      }

      const nextOffset = offset + useLen;
      return {
        success: true,
        data: {
          text,
          nextOffset,
          totalSize,
          done: nextOffset >= totalSize,
          fileEncoding: fileEnc,
        },
      };
    } finally {
      await handle.close();
    }
  }

  async downloadBatchAsZip(
    req: Request,
    res: Response,
    userId: number,
    idsPayload: unknown,
  ): Promise<void> {
    const raw = (idsPayload as { ids?: unknown })?.ids;
    if (!Array.isArray(raw) || raw.length === 0) {
      res
        .status(400)
        .json({ success: false, message: '请提供有效的文件 id 列表' });
      return;
    }

    const ids = [
      ...new Set(
        raw.map((x) => Number(x)).filter((n) => !Number.isNaN(n) && n > 0),
      ),
    ];
    if (ids.length === 0) {
      res
        .status(400)
        .json({ success: false, message: '请提供有效的文件 id 列表' });
      return;
    }
    if (ids.length > BATCH_ZIP_MAX_TOP_IDS) {
      res.status(400).json({
        success: false,
        message: `单次最多选择 ${BATCH_ZIP_MAX_TOP_IDS} 个顶层项`,
      });
      return;
    }

    const initialRows = await this.prisma.userFile.findMany({
      where: { id: { in: ids }, userId, isDeleted: false },
      select: { id: true },
    });
    if (initialRows.length !== ids.length) {
      res
        .status(400)
        .json({ success: false, message: '部分文件不存在或已删除' });
      return;
    }

    let pmap: Map<number, number | null>;
    try {
      pmap = await this.fileBatchHelper.loadParentChainMap(ids, userId);
    } catch (e) {
      if (e instanceof ObjectNotFoundError) {
        res
          .status(400)
          .json({ success: false, message: '路径数据不完整，请重试' });
        return;
      }
      throw e;
    }
    const rootIds = this.fileBatchHelper
      .computeSelectionRoots(ids, pmap)
      .sort((a, b) => a - b);

    let zipEntries: ZipBuildEntry[];
    try {
      zipEntries = await this.buildZipEntriesForRoots(
        userId,
        rootIds,
        BATCH_ZIP_MAX_FILE_ENTRIES,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.startsWith('ZIP_FILE_LIMIT:')) {
        res.status(400).json({
          success: false,
          message: `压缩包内文件数量超过上限（${BATCH_ZIP_MAX_FILE_ENTRIES}）`,
        });
        return;
      }
      if (msg.startsWith('MISSING_DISK:')) {
        const name = msg.split(':')[1] ?? '';
        res
          .status(404)
          .json({ success: false, message: `文件在磁盘上不存在：${name}` });
        return;
      }
      if (msg.startsWith('MISSING_STORAGE:')) {
        const name = msg.split(':')[1] ?? '';
        res
          .status(404)
          .json({ success: false, message: `存储记录缺失：${name}` });
        return;
      }
      if (msg === 'ROOT_MISMATCH') {
        res
          .status(400)
          .json({ success: false, message: '选中项数据不一致，请刷新后重试' });
        return;
      }
      throw e;
    }

    const filePieces = zipEntries.filter((e) => e.kind === 'file');
    if (filePieces.length === 0 && !zipEntries.every((e) => e.kind === 'dir')) {
      res.status(400).json({ success: false, message: '没有可打包的文件' });
      return;
    }

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err: Error & { code?: string }) => {
      if (err.code === 'ENOENT') {
        console.warn('[batch-zip]', err);
      } else {
        console.error('[batch-zip]', err);
      }
    });
    archive.on('error', (err: Error) => {
      console.error('[batch-zip] archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: '打包失败' });
      } else {
        res.end();
      }
    });

    const safeTs = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipName = `batch-download-${safeTs}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(zipName)}"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    );
    archive.pipe(res);

    await this.operationLogService.logOperation({
      req,
      userId,
      operationType: LogOperationType.DOWNLOAD,
      resourceType: LogResourceType.FILE,
      resourceId: rootIds[0],
      description: `Batch zip download (${filePieces.length} files)`,
    });

    for (const entry of zipEntries) {
      if (entry.kind === 'file') {
        archive.file(entry.abs, { name: entry.zipPath });
      } else {
        archive.append(Buffer.alloc(0), { name: entry.zipPath });
      }
    }

    await archive.finalize();
  }

  private storageWhereForMimeCategory(
    typeStr: string,
  ): Record<string, unknown> | null {
    switch (typeStr) {
      case 'image':
        return { mimeType: { startsWith: 'image/' } };
      case 'video':
        return { mimeType: { startsWith: 'video/' } };
      case 'audio':
        return { mimeType: { startsWith: 'audio/' } };
      case 'document':
        return {
          OR: [
            { mimeType: { startsWith: 'text/' } },
            { mimeType: { contains: 'pdf' } },
            { mimeType: { contains: 'word' } },
            { mimeType: { contains: 'excel' } },
            { mimeType: { contains: 'sheet' } },
            { mimeType: { contains: 'powerpoint' } },
            { mimeType: { contains: 'presentation' } },
            { mimeType: { contains: 'document' } },
          ],
        };
      case 'other':
        return {
          AND: [
            { mimeType: { not: { startsWith: 'image/' } } },
            { mimeType: { not: { startsWith: 'video/' } } },
            { mimeType: { not: { startsWith: 'audio/' } } },
            {
              NOT: {
                OR: [
                  { mimeType: { startsWith: 'text/' } },
                  { mimeType: { contains: 'pdf' } },
                  { mimeType: { contains: 'word' } },
                  { mimeType: { contains: 'excel' } },
                  { mimeType: { contains: 'sheet' } },
                  { mimeType: { contains: 'powerpoint' } },
                  { mimeType: { contains: 'presentation' } },
                  { mimeType: { contains: 'document' } },
                ],
              },
            },
          ],
        };
      default:
        return null;
    }
  }

  private isTextLikeFileForChunk(ext: string, contentType: string): boolean {
    if (contentType.startsWith('text/')) return true;
    return (
      ext === '.txt' ||
      ext === '.md' ||
      ext === '.json' ||
      ext === '.js' ||
      ext === '.css' ||
      ext === '.html' ||
      ext === '.ts' ||
      ext === '.log' ||
      ext === '.csv' ||
      ext === '.xml'
    );
  }

  private textChunkCacheKey(userId: number, fileId: number): string {
    return `${userId}:${fileId}`;
  }

  /** 正文写回后清掉编码缓存，避免仍按旧编码解码导致乱码 */
  forgetTextChunkEncoding(userId: number, fileId: number): void {
    this.textChunkEncodingCache.delete(this.textChunkCacheKey(userId, fileId));
  }

  mapTextChunkEncoding(
    s: string | string[] | undefined | null,
  ): TextChunkFileEncoding | null {
    return this.mapQueryToChunkEncoding(
      s === null ? undefined : (s as string | string[] | undefined),
    );
  }

  detectTextChunkEncoding(buf: Buffer): TextChunkFileEncoding {
    return this.detectTextFileEncodingFromBuffer(buf);
  }

  private mapQueryToChunkEncoding(
    s: string | string[] | undefined,
  ): TextChunkFileEncoding | null {
    if (s == null) return null;
    const u = (Array.isArray(s) ? s[0] : s).toLowerCase();
    if (u === 'utf-8' || u === 'utf8') return 'utf-8';
    if (u === 'gbk' || u === 'gb18030' || u === 'gb2312' || u === 'gb_2312')
      return 'gb18030';
    return null;
  }

  private detectTextFileEncodingFromBuffer(buf: Buffer): TextChunkFileEncoding {
    if (buf.length === 0) return 'utf-8';
    const d = jschardet.detect(buf);
    const enc = d?.encoding?.toUpperCase() || '';
    const conf = d?.confidence ?? 0;
    if (enc) {
      if (
        (enc.includes('GB') || enc === 'EUC-CN' || enc === 'HZ-GB-2312') &&
        conf >= 0.3
      ) {
        return 'gb18030';
      }
      if (
        enc === 'UTF-8' ||
        enc === 'UTF8' ||
        enc === 'ASCII' ||
        enc === 'ISO-8859-1'
      ) {
        if (enc === 'UTF-8' && conf >= 0.6) {
          if (this.utf8CompletePrefixLength(buf, buf.length) === buf.length) {
            const t = buf.toString('utf8');
            if (!t.includes('\uFFFD')) return 'utf-8';
          }
        } else if (enc === 'ASCII' && conf >= 0.4) {
          return 'utf-8';
        }
      }
    }
    const sUtf8 = buf.toString('utf8');
    const badU8 = (sUtf8.match(/\uFFFD/g) || []).length;
    const sGb = iconv.decode(buf, 'gb18030');
    const badGb = (sGb.match(/\uFFFD/g) || []).length;
    if (badGb < badU8) return 'gb18030';
    if (
      badU8 === 0 &&
      this.utf8CompletePrefixLength(buf, buf.length) === buf.length
    )
      return 'utf-8';
    return badU8 < badGb ? 'utf-8' : 'gb18030';
  }

  private utf8CompletePrefixLength(buf: Buffer, n: number): number {
    n = Math.min(n, buf.length);
    let i = 0;
    while (i < n) {
      const c = buf[i];
      if (c <= 0x7f) {
        i += 1;
      } else if ((c & 0xe0) === 0xc0) {
        if (i + 2 > n) return i;
        if ((buf[i + 1] & 0xc0) !== 0x80) {
          i += 1;
          continue;
        }
        i += 2;
      } else if ((c & 0xf0) === 0xe0) {
        if (i + 3 > n) return i;
        if ((buf[i + 1] & 0xc0) !== 0x80 || (buf[i + 2] & 0xc0) !== 0x80) {
          i += 1;
          continue;
        }
        i += 3;
      } else if ((c & 0xf8) === 0xf0) {
        if (i + 4 > n) return i;
        if (
          (buf[i + 1] & 0xc0) !== 0x80 ||
          (buf[i + 2] & 0xc0) !== 0x80 ||
          (buf[i + 3] & 0xc0) !== 0x80
        ) {
          i += 1;
          continue;
        }
        if (c > 0xf4) {
          i += 1;
          continue;
        }
        i += 4;
      } else {
        i += 1;
      }
    }
    return i;
  }

  private gb18030CompletePrefixLength(buf: Buffer, n: number): number {
    n = Math.min(n, buf.length);
    for (let k = 0; k < 4; k++) {
      const len = n - k;
      if (len <= 0) return 0;
      const sub = buf.subarray(0, len);
      try {
        const t = iconv.decode(sub, 'gb18030');
        if (t.includes('\uFFFD')) continue;
        const back = iconv.encode(t, 'gb18030');
        if (back.length === sub.length && back.equals(sub)) return len;
      } catch {
        // ignore
      }
    }
    return n;
  }

  private rawCompletePrefixLength(
    data: Buffer,
    fileEnc: TextChunkFileEncoding,
  ): number {
    if (fileEnc === 'utf-8')
      return this.utf8CompletePrefixLength(data, data.length);
    return this.gb18030CompletePrefixLength(data, data.length);
  }

  private async buildZipEntriesForRoots(
    userId: number,
    rootIds: number[],
    maxFiles: number,
  ): Promise<ZipBuildEntry[]> {
    const used = new Set<string>();
    const out: ZipBuildEntry[] = [];
    let fileCount = 0;

    const allocPath = (p: string): string => {
      const norm = p.replace(/\\/g, '/');
      let z = norm;
      let n = 0;
      while (used.has(z.toLowerCase())) {
        n += 1;
        if (z.endsWith('/')) {
          const d = z.replace(/\/$/, '');
          const ext = path.extname(d);
          const stem = path.basename(d, ext);
          const parent = path.posix.dirname(d);
          z =
            parent === '.' || parent === ''
              ? `${stem} (${n})/`
              : `${parent}/${stem} (${n})/`;
        } else {
          const ext = path.extname(z);
          const stem = path.basename(z, ext);
          const parent = path.posix.dirname(z);
          z =
            parent === '.' || parent === ''
              ? `${stem} (${n})${ext}`
              : `${parent}/${stem} (${n})${ext}`;
        }
      }
      used.add(z.toLowerCase());
      return z;
    };

    const walkFolder = async (
      folderId: number,
      prefix: string,
    ): Promise<void> => {
      const children = await this.prisma.userFile.findMany({
        where: { userId, parentId: folderId, isDeleted: false },
        orderBy: [{ fileType: 'desc' }, { fileName: 'asc' }],
        include: { storage: { select: { filePath: true } } },
      });
      const pref = prefix.replace(/\/$/, '');
      if (children.length === 0) {
        const dirPath = allocPath(`${pref}/`);
        out.push({ kind: 'dir', zipPath: dirPath });
        return;
      }
      for (const ch of children) {
        const seg = this.fileBatchHelper.sanitizeZipPathSegment(ch.fileName);
        const rel = pref ? `${pref}/${seg}` : seg;
        if (ch.fileType === 'folder') {
          await walkFolder(ch.id, rel);
        } else {
          if (fileCount >= maxFiles)
            throw new Error(`ZIP_FILE_LIMIT:${maxFiles}`);
          if (!ch.storage?.filePath)
            throw new Error(`MISSING_STORAGE:${ch.fileName}`);
          const abs = resolveStorageFilePath(ch.storage.filePath);
          if (!fs.existsSync(abs))
            throw new Error(`MISSING_DISK:${ch.fileName}`);
          fileCount += 1;
          out.push({ kind: 'file', abs, zipPath: allocPath(rel) });
        }
      }
    };

    const roots = await this.prisma.userFile.findMany({
      where: { id: { in: rootIds }, userId, isDeleted: false },
      orderBy: { id: 'asc' },
      include: { storage: { select: { filePath: true } } },
    });
    if (roots.length !== rootIds.length) throw new Error('ROOT_MISMATCH');

    for (const r of roots) {
      const seg = this.fileBatchHelper.sanitizeZipPathSegment(r.fileName);
      if (r.fileType === 'file') {
        if (fileCount >= maxFiles)
          throw new Error(`ZIP_FILE_LIMIT:${maxFiles}`);
        if (!r.storage?.filePath)
          throw new Error(`MISSING_STORAGE:${r.fileName}`);
        const abs = resolveStorageFilePath(r.storage.filePath);
        if (!fs.existsSync(abs)) throw new Error(`MISSING_DISK:${r.fileName}`);
        fileCount += 1;
        out.push({ kind: 'file', abs, zipPath: allocPath(seg) });
      } else {
        await walkFolder(r.id, seg);
      }
    }
    return out;
  }
}
