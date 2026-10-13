import { Injectable } from '@nestjs/common';
import type { FileStorage, UserFile } from '@prisma/client';
import jschardet from 'jschardet';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import {
  calculateFileHash,
  concatenateFilesWithMd5,
  ensureDirectoryExists,
} from '../utils/file.utils';
import {
  getUploadRootDir,
  resolveStorageFilePath,
  toStoredRelativePath,
} from '../utils/storagePath.utils';
import { MergeChunksBody, MergeUploadError } from './merge-upload.errors';

function mergeBodyString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new MergeUploadError('合并参数不完整', 400);
}

function mergeBodyOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return mergeBodyString(value);
}

const EXT_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export type MergePersistParams = {
  finalFilePath: string;
  fileHash: string;
  fileSize: number;
  finalMimeType: string;
  userId: number;
  parentId?: number;
  fileName: string;
  conflictAction?: string;
};

export type RegisterLocalConflictAction = 'version' | 'duplicate' | 'suffix';

@Injectable()
export class MergeUploadService {
  constructor(private readonly prisma: PrismaService) {}

  assertValidMergeChunksBody(body: Record<string, unknown>): MergeChunksBody {
    const {
      fileHash,
      fileName,
      fileSize,
      mimeType,
      totalChunks,
      parentId,
      conflictAction,
    } = body;
    if (
      !fileHash ||
      !fileName ||
      fileSize === undefined ||
      fileSize === null ||
      !mimeType ||
      totalChunks === undefined ||
      totalChunks === null
    ) {
      throw new MergeUploadError('合并参数不完整', 400);
    }
    return {
      fileHash: mergeBodyString(fileHash),
      fileName: mergeBodyString(fileName),
      fileSize: Number(fileSize),
      mimeType: mergeBodyString(mimeType),
      totalChunks: Number(totalChunks),
      parentId:
        parentId !== undefined && parentId !== null
          ? Number(parentId)
          : undefined,
      conflictAction: mergeBodyOptionalString(conflictAction),
    };
  }

  private buildFinalFilePath(fileHash: string, fileName: string): string {
    const uploadsDir = getUploadRootDir();
    ensureDirectoryExists(uploadsDir);
    return path.join(uploadsDir, `${fileHash}-${fileName}`);
  }

  async mergeChunkFilesToDisk(params: {
    fileHash: string;
    fileName: string;
    userId: number;
    totalChunks: number;
  }): Promise<string> {
    const { fileHash, fileName, userId, totalChunks } = params;

    const uploadedChunks = await this.prisma.uploadChunk.findMany({
      where: {
        fileHash,
        userId,
        status: 'completed',
      },
      orderBy: { chunkIndex: 'asc' },
    });

    if (uploadedChunks.length !== totalChunks) {
      throw new MergeUploadError('分片不完整，无法合并', 400);
    }

    const finalFilePath = this.buildFinalFilePath(fileHash, fileName);
    const chunkAbsPaths = uploadedChunks.map((chunk) =>
      resolveStorageFilePath(chunk.chunkPath),
    );

    const mergedFileHash = await concatenateFilesWithMd5(
      chunkAbsPaths,
      finalFilePath,
    );
    if (mergedFileHash !== fileHash) {
      if (fs.existsSync(finalFilePath)) {
        fs.unlinkSync(finalFilePath);
      }
      throw new MergeUploadError('文件合并失败，哈希值不匹配', 400);
    }

    return finalFilePath;
  }

  createEmptyMergedFileOnDisk(fileHash: string, fileName: string): string {
    const finalFilePath = this.buildFinalFilePath(fileHash, fileName);
    fs.writeFileSync(finalFilePath, '');
    return finalFilePath;
  }

  refineMimeTypeForMergedFile(
    finalFilePath: string,
    mimeType: string,
    fileName: string,
  ): string {
    let finalMimeType = mimeType;
    if (
      mimeType.startsWith('text/') ||
      /\.(txt|md|json|csv|html|css|js|ts)$/i.test(fileName)
    ) {
      try {
        const buffer = Buffer.alloc(4096);
        const fd = fs.openSync(finalFilePath, 'r');
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
        fs.closeSync(fd);

        const slice = buffer.slice(0, bytesRead);
        const detected = jschardet.detect(slice);

        if (detected?.encoding && detected.confidence > 0.8) {
          finalMimeType = `${mimeType}; charset=${detected.encoding.toLowerCase()}`;
        }
      } catch (e) {
        console.warn('Encoding detection failed:', e);
      }
    }
    return finalMimeType;
  }

  async persistMergedFileRecords(
    params: MergePersistParams,
  ): Promise<{ userFile: UserFile; fileStorage: FileStorage }> {
    const {
      finalFilePath,
      fileHash,
      fileSize,
      finalMimeType,
      userId,
      parentId,
      fileName,
      conflictAction,
    } = params;

    return this.prisma.$transaction(async (tx) => {
      let fileStorage = await tx.fileStorage.findUnique({
        where: { fileHash },
      });
      if (!fileStorage) {
        fileStorage = await tx.fileStorage.create({
          data: {
            fileHash,
            filePath: toStoredRelativePath(finalFilePath),
            fileSize: BigInt(fileSize),
            mimeType: finalMimeType,
            referenceCount: 1,
            status: 'active',
          },
        });
      }

      const existingUserFile = await tx.userFile.findFirst({
        where: {
          userId,
          parentId:
            parentId !== undefined && parentId !== null
              ? parseInt(String(parentId), 10)
              : null,
          fileName,
          isDeleted: false,
          fileType: 'file',
        },
        include: { storage: true },
      });

      let userFile: UserFile;
      if (existingUserFile && conflictAction === 'version') {
        if (existingUserFile.storage) {
          await tx.fileHistory.create({
            data: {
              userFileId: existingUserFile.id,
              storageId: existingUserFile.storageId!,
              fileName: existingUserFile.fileName,
              version: existingUserFile.version,
              fileSize: existingUserFile.storage.fileSize,
            },
          });
        }
        userFile = await tx.userFile.update({
          where: { id: existingUserFile.id },
          data: {
            storageId: fileStorage.id,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
      } else {
        userFile = await tx.userFile.create({
          data: {
            userId,
            storageId: fileStorage.id,
            parentId:
              parentId !== undefined && parentId !== null
                ? parseInt(String(parentId), 10)
                : null,
            fileName,
            fileType: 'file',
          },
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          storageUsed: { increment: BigInt(fileSize) },
        },
      });

      return { userFile, fileStorage };
    });
  }

  guessMimeFromFileName(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    return EXT_MIME[ext] || 'application/octet-stream';
  }

  async resolveUniqueNameInFolder(
    tx: {
      userFile: {
        findFirst: (args: unknown) => Promise<unknown>;
      };
    },
    userId: number,
    parentId: number | null | undefined,
    desiredName: string,
  ): Promise<string> {
    const pid = parentId !== undefined && parentId !== null ? parentId : null;
    let finalFileName = desiredName;
    let counter = 1;
    let basePart = finalFileName;
    let extPart = '';
    const lastDotIdx = finalFileName.lastIndexOf('.');
    if (lastDotIdx !== -1) {
      basePart = finalFileName.substring(0, lastDotIdx);
      extPart = finalFileName.substring(lastDotIdx);
    }

    while (true) {
      const exists = await tx.userFile.findFirst({
        where: {
          userId,
          parentId: pid,
          fileName: finalFileName,
          isDeleted: false,
        },
      });
      if (!exists) break;
      finalFileName = `${basePart}(${counter})${extPart}`;
      counter++;
    }
    return finalFileName;
  }

  async registerLocalFileInDrive(params: {
    absolutePath: string;
    userId: number;
    parentId: number | null;
    logicalFileName: string;
    conflictAction?: RegisterLocalConflictAction;
  }): Promise<UserFile> {
    const { absolutePath, userId, parentId, logicalFileName } = params;
    const conflictAction: RegisterLocalConflictAction =
      params.conflictAction ?? 'suffix';
    const baseName = path.basename(logicalFileName.replace(/\\/g, '/'));
    if (!baseName || baseName === '.' || baseName === '..') {
      throw new Error('无效的文件名');
    }

    const fileHash = calculateFileHash(absolutePath);
    const fileSize = fs.statSync(absolutePath).size;

    return this.prisma.$transaction(async (tx) => {
      const pid = parentId !== undefined && parentId !== null ? parentId : null;
      const existingUserFile = await tx.userFile.findFirst({
        where: {
          userId,
          parentId: pid,
          fileName: baseName,
          isDeleted: false,
          fileType: 'file',
        },
        include: { storage: true },
      });

      let targetFileName = baseName;
      if (existingUserFile) {
        if (conflictAction === 'suffix') {
          targetFileName = await this.resolveUniqueNameInFolder(
            tx,
            userId,
            parentId,
            baseName,
          );
        }
      }

      const baseMime = this.guessMimeFromFileName(targetFileName);
      const finalMime = this.refineMimeTypeForMergedFile(
        absolutePath,
        baseMime,
        targetFileName,
      );
      const finalFilePath = this.buildFinalFilePath(fileHash, targetFileName);

      let fileStorage = await tx.fileStorage.findUnique({
        where: { fileHash },
      });
      if (!fileStorage) {
        try {
          fs.renameSync(absolutePath, finalFilePath);
        } catch {
          fs.copyFileSync(absolutePath, finalFilePath);
          fs.unlinkSync(absolutePath);
        }
        fileStorage = await tx.fileStorage.create({
          data: {
            fileHash,
            filePath: toStoredRelativePath(finalFilePath),
            fileSize: BigInt(fileSize),
            mimeType: finalMime,
            referenceCount: 1,
            status: 'active',
          },
        });
      } else {
        if (fileStorage.status === 'pending_delete') {
          fileStorage = await tx.fileStorage.update({
            where: { id: fileStorage.id },
            data: { status: 'active', markedDeleteAt: null },
          });
        }
        await tx.fileStorage.update({
          where: { id: fileStorage.id },
          data: { referenceCount: { increment: 1 } },
        });
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
        }
      }

      let userFile: UserFile;

      if (existingUserFile && conflictAction === 'version') {
        if (existingUserFile.storage) {
          await tx.fileHistory.create({
            data: {
              userFileId: existingUserFile.id,
              storageId: existingUserFile.storageId!,
              fileName: existingUserFile.fileName,
              version: existingUserFile.version,
              fileSize: existingUserFile.storage.fileSize,
            },
          });
        }
        userFile = await tx.userFile.update({
          where: { id: existingUserFile.id },
          data: {
            storageId: fileStorage.id,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
      } else {
        userFile = await tx.userFile.create({
          data: {
            userId,
            storageId: fileStorage.id,
            parentId: pid,
            fileName: targetFileName,
            fileType: 'file',
          },
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: { storageUsed: { increment: BigInt(fileSize) } },
      });

      return userFile;
    });
  }

  async cleanupChunksAfterMerge(
    fileHash: string,
    userId: number,
    totalChunks: number,
  ): Promise<void> {
    if (totalChunks <= 0) return;

    const chunksDir = path.join(process.cwd(), 'chunks', fileHash);
    if (fs.existsSync(chunksDir)) {
      fs.rmSync(chunksDir, { recursive: true, force: true });
    }

    await this.prisma.uploadChunk.deleteMany({
      where: {
        fileHash,
        userId,
      },
    });
  }
}
