import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';
import {
  LogOperationType,
  LogResourceType,
  OperationLogService,
} from '@/operation-log/operation-log.service';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { FilesQueryService } from '../query/files-query.service';
import { calculateFileHash } from '../utils/file.utils';
import { resolveStorageFilePath } from '../utils/storagePath.utils';

type TextSaveEncoding = 'utf-8' | 'gb18030';

@Injectable()
export class FilesVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogService: OperationLogService,
    private readonly storageService: StorageService,
    private readonly filesQueryService: FilesQueryService,
  ) {}

  async replaceTextContent(
    req: Request,
    userId: number,
    fileId: number,
    contentRaw: unknown,
    encodingRaw?: unknown,
  ) {
    if (typeof contentRaw !== 'string') {
      throw new BadRequestException('正文不能为空');
    }
    const content = contentRaw;

    const userFile = await this.prisma.userFile.findFirst({
      where: { id: fileId, userId, isDeleted: false, fileType: 'file' },
      include: { storage: true },
    });
    if (!userFile) {
      throw new NotFoundException('文件不存在或无权访问');
    }
    const name = userFile.fileName.toLowerCase();
    const mime = userFile.storage?.mimeType ?? '';
    if (!name.endsWith('.txt') && !mime.startsWith('text/plain')) {
      throw new BadRequestException('只能修改文本文件');
    }

    // 按原文件编码写回（常见 GBK 小说）；否则会写成 UTF-8，再用 GBK 打开就乱码
    const encoding = this.resolveSaveEncoding(
      userId,
      fileId,
      userFile.storage?.filePath ?? null,
      encodingRaw,
    );
    const bytes =
      encoding === 'gb18030'
        ? iconv.encode(content, 'gb18030')
        : Buffer.from(content, 'utf8');
    const maxBytes = parseInt(process.env.MAX_FILE_SIZE || '10485760', 10);
    if (bytes.length > maxBytes) {
      const maxMb = Math.max(1, Math.floor(maxBytes / (1024 * 1024)));
      throw new BadRequestException(
        `文件过大，最多 ${maxMb}MB（当前约 ${(bytes.length / (1024 * 1024)).toFixed(1)}MB）`,
      );
    }

    const tmpPath = path.join(
      os.tmpdir(),
      `text-edit-${userId}-${fileId}-${Date.now()}.txt`,
    );
    fs.writeFileSync(tmpPath, bytes);
    const fileHash = calculateFileHash(tmpPath);

    if (userFile.storage?.fileHash === fileHash) {
      fs.rmSync(tmpPath, { force: true });
      return {
        success: true,
        message: '内容未变化',
        data: { id: userFile.id, version: userFile.version, unchanged: true },
      };
    }

    let storedPath: string | null = null;
    const existingStorage = await this.prisma.fileStorage.findUnique({
      where: { fileHash },
    });
    if (existingStorage) {
      fs.rmSync(tmpPath, { force: true });
    } else {
      const storage = this.storageService.getStorageProvider();
      storedPath = await storage.putFromLocalFile({
        localFilePath: tmpPath,
        suggestedName: `${fileHash}-${userFile.fileName}`,
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let fileStorage = await tx.fileStorage.findUnique({
        where: { fileHash },
      });
      if (!fileStorage) {
        if (!storedPath) {
          throw new Error('TEXT_STORE_MISSING');
        }
        fileStorage = await tx.fileStorage.create({
          data: {
            fileHash,
            filePath: storedPath,
            fileSize: BigInt(bytes.length),
            mimeType:
              encoding === 'gb18030'
                ? 'text/plain; charset=gb18030'
                : 'text/plain; charset=utf-8',
            referenceCount: 1,
            status: 'active',
          },
        });
      } else {
        fileStorage = await tx.fileStorage.update({
          where: { id: fileStorage.id },
          data: { referenceCount: { increment: 1 } },
        });
      }

      if (userFile.storageId && userFile.storage) {
        await tx.fileHistory.create({
          data: {
            userFileId: userFile.id,
            storageId: userFile.storageId,
            fileName: userFile.fileName,
            version: userFile.version,
            fileSize: userFile.storage.fileSize,
          },
        });
      }

      const updated = await tx.userFile.update({
        where: { id: userFile.id },
        data: {
          storageId: fileStorage.id,
          version: { increment: 1 },
        },
      });

      const oldSize = userFile.storage?.fileSize ?? 0n;
      const delta = BigInt(bytes.length) - oldSize;
      if (delta !== 0n) {
        await tx.user.update({
          where: { id: userId },
          data: { storageUsed: { increment: delta } },
        });
      }

      return updated;
    });

    await this.operationLogService.logOperation({
      req,
      userId,
      operationType: LogOperationType.UPDATE,
      resourceType: LogResourceType.FILE,
      resourceId: result.id,
      description: `Updated text content: ${userFile.fileName}`,
    });

    this.filesQueryService.forgetTextChunkEncoding(userId, fileId);

    return {
      success: true,
      message: '已保存',
      data: {
        id: result.id,
        fileName: userFile.fileName,
        version: result.version,
        fileSize: bytes.length,
        unchanged: false,
        encoding,
      },
    };
  }

  private resolveSaveEncoding(
    userId: number,
    fileId: number,
    storagePath: string | null,
    encodingRaw: unknown,
  ): TextSaveEncoding {
    const fromClient = this.filesQueryService.mapTextChunkEncoding(
      typeof encodingRaw === 'string' ? encodingRaw : undefined,
    );
    if (fromClient) return fromClient;

    if (storagePath) {
      try {
        const physical = resolveStorageFilePath(storagePath);
        if (physical && fs.existsSync(physical)) {
          const fd = fs.openSync(physical, 'r');
          try {
            const sample = Buffer.alloc(Math.min(65536, fs.fstatSync(fd).size));
            const n = fs.readSync(fd, sample, 0, sample.length, 0);
            if (n > 0) {
              return this.filesQueryService.detectTextChunkEncoding(
                sample.subarray(0, n),
              );
            }
          } finally {
            fs.closeSync(fd);
          }
        }
      } catch {
        /* 探测失败则回退 utf-8 */
      }
    }

    // 未传 encoding 且探测失败时，勿沿用可能过期的预览缓存
    this.filesQueryService.forgetTextChunkEncoding(userId, fileId);
    return 'utf-8';
  }

  async getFileVersions(userId: number, fileId: number) {
    const userFile = await this.prisma.userFile.findFirst({
      where: {
        id: fileId,
        userId,
        isDeleted: false,
      },
    });

    if (!userFile) {
      throw new NotFoundException('文件不存在或无权访问');
    }

    const versions = await this.prisma.fileHistory.findMany({
      where: { userFileId: fileId },
      orderBy: { version: 'desc' },
    });

    return {
      success: true,
      data: versions.map((v) => ({
        id: v.id,
        version: v.version,
        fileName: v.fileName,
        fileSize: Number(v.fileSize),
        createdAt: v.createdAt,
      })),
    };
  }

  async rollbackVersion(
    req: Request,
    userId: number,
    fileId: number,
    versionId: number,
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const userFile = await tx.userFile.findFirst({
          where: { id: fileId, userId, isDeleted: false },
          include: { storage: true },
        });

        if (!userFile) {
          throw new Error('FILE_NOT_FOUND');
        }

        const targetVersion = await tx.fileHistory.findFirst({
          where: { id: versionId, userFileId: fileId },
        });

        if (!targetVersion) {
          throw new Error('VERSION_NOT_FOUND');
        }

        if (userFile.storage) {
          await tx.fileHistory.create({
            data: {
              userFileId: userFile.id,
              storageId: userFile.storageId!,
              fileName: userFile.fileName,
              version: userFile.version,
              fileSize: userFile.storage.fileSize,
            },
          });
        }

        const updatedFile = await tx.userFile.update({
          where: { id: userFile.id },
          data: {
            storageId: targetVersion.storageId,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });

        await tx.fileStorage.update({
          where: { id: targetVersion.storageId },
          data: { referenceCount: { increment: 1 } },
        });

        await tx.user.update({
          where: { id: userId },
          data: {
            storageUsed: { increment: targetVersion.fileSize },
          },
        });

        return updatedFile;
      });

      await this.operationLogService.logOperation({
        req,
        userId,
        operationType: LogOperationType.VERSION_ROLLBACK,
        resourceType: LogResourceType.FILE,
        resourceId: result.id,
        description: `Rolled back file ${result.fileName} to version`,
      });

      return {
        success: true,
        message: '回滚成功',
        data: { version: result.version },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg === 'FILE_NOT_FOUND') {
        throw new NotFoundException('文件不存在');
      }
      if (msg === 'VERSION_NOT_FOUND') {
        throw new NotFoundException('版本不存在');
      }
      throw error;
    }
  }

  async downloadVersion(
    req: Request,
    res: Response,
    userId: number,
    fileId: number,
    versionId: number,
  ): Promise<void> {
    const userFile = await this.prisma.userFile.findFirst({
      where: { id: fileId, userId, isDeleted: false },
    });

    if (!userFile) {
      res.status(404).json({ success: false, message: '文件不存在或无权访问' });
      return;
    }

    const version = await this.prisma.fileHistory.findFirst({
      where: {
        id: versionId,
        userFileId: fileId,
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

    if (!version?.storage) {
      res.status(404).json({ success: false, message: '版本文件不存在' });
      return;
    }

    const physicalPath = resolveStorageFilePath(version.storage.filePath);

    if (!fs.existsSync(physicalPath)) {
      res.status(404).json({ success: false, message: '物理文件已丢失' });
      return;
    }

    const isPreview = req.query.preview === 'true';
    const disposition = isPreview ? 'inline' : 'attachment';

    let contentType = version.storage.mimeType || 'application/octet-stream';
    const ext = path.extname(version.fileName).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogg': 'video/ogg',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.mkv': 'video/x-matroska',
      '.rmvb': 'application/vnd.rn-realmedia',
      '.rm': 'application/vnd.rn-realmedia',
    };
    if (mimeMap[ext]) {
      contentType = mimeMap[ext];
    }

    if (
      isPreview &&
      (contentType.startsWith('text/') ||
        ext === '.txt' ||
        ext === '.md' ||
        ext === '.json' ||
        ext === '.js' ||
        ext === '.css' ||
        ext === '.html')
    ) {
      if (!contentType.includes('charset')) {
        contentType += '; charset=utf-8';
      }
    }

    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(version.fileName)}"`,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.sendFile(physicalPath);
  }
}
