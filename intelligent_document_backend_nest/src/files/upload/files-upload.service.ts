import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FileType } from '@prisma/client';
import type { Request } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  LogOperationType,
  LogResourceType,
  OperationLogService,
} from '@/operation-log/operation-log.service';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/storage/storage.service';
import { calculateFileHash, ensureDirectoryExists } from '../utils/file.utils';
import { toStoredRelativePath } from '../utils/storagePath.utils';
import { MergeUploadError } from './merge-upload.errors';
import { MergeUploadService } from './merge-upload.service';
import { applyDecodedOriginalName } from './multipart-filename.util';

function parseOptionalInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = parseInt(value.trim(), 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

@Injectable()
export class FilesUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mergeUploadService: MergeUploadService,
    private readonly storageService: StorageService,
    private readonly operationLogService: OperationLogService,
  ) {}

  private mapMergeError(error: unknown): never {
    if (error instanceof MergeUploadError) {
      throw new HttpException(
        { success: false, message: error.message },
        error.statusCode,
      );
    }
    throw error;
  }

  async checkFileExists(fileHash: string) {
    if (!fileHash) {
      throw new BadRequestException('文件哈希值不能为空');
    }

    const existingFile = await this.prisma.fileStorage.findUnique({
      where: { fileHash, status: 'active' },
    });

    if (existingFile) {
      return {
        success: true,
        data: {
          exists: true,
          fileInfo: {
            fileSize: Number(existingFile.fileSize),
            mimeType: existingFile.mimeType,
          },
        },
      };
    }

    return {
      success: true,
      data: { exists: false },
    };
  }

  async checkFileName(
    userId: number,
    body: { fileName?: unknown; parentId?: unknown; type?: unknown },
  ) {
    const fileName =
      typeof body.fileName === 'string' ? body.fileName.trim() : '';
    if (!fileName) {
      throw new BadRequestException('文件名不能为空');
    }

    const parentId = parseOptionalInt(body.parentId);
    const fileType: FileType =
      typeof body.type === 'string' && body.type === 'folder'
        ? 'folder'
        : 'file';

    const exists = await this.prisma.userFile.findFirst({
      where: {
        userId,
        parentId,
        fileName,
        isDeleted: false,
        fileType,
      },
    });

    return {
      success: true,
      exists: !!exists,
    };
  }

  async uploadChunk(
    userId: number,
    file: Express.Multer.File | undefined,
    body: Record<string, unknown>,
  ) {
    if (!file) {
      throw new BadRequestException('分片文件或用户信息缺失');
    }

    const fileHash =
      typeof body.fileHash === 'string' ? body.fileHash.trim() : '';
    const chunkIndexRaw = body.chunkIndex;
    const chunkHash =
      typeof body.chunkHash === 'string' ? body.chunkHash.trim() : '';

    if (!fileHash || chunkIndexRaw === undefined || !chunkHash) {
      throw new BadRequestException('分片信息不完整');
    }

    const chunkIndex = Number(chunkIndexRaw);
    if (!Number.isFinite(chunkIndex)) {
      throw new BadRequestException('分片信息不完整');
    }

    const chunksDir = path.join(process.cwd(), 'chunks', fileHash);
    ensureDirectoryExists(chunksDir);

    const chunkPath = path.join(chunksDir, `chunk-${chunkIndex}`);
    fs.renameSync(file.path, chunkPath);

    await this.prisma.uploadChunk.upsert({
      where: {
        fileHash_chunkIndex: {
          fileHash,
          chunkIndex,
        },
      },
      update: {
        chunkHash,
        chunkSize: file.size,
        chunkPath: toStoredRelativePath(chunkPath),
        status: 'completed',
      },
      create: {
        userId,
        fileHash,
        chunkIndex,
        chunkHash,
        chunkSize: file.size,
        chunkPath: toStoredRelativePath(chunkPath),
        status: 'completed',
      },
    });

    return { success: true, message: '分片上传成功' };
  }

  async getUploadedChunks(userId: number, fileHash: string) {
    const uploadedChunks = await this.prisma.uploadChunk.findMany({
      where: {
        fileHash,
        userId,
        status: 'completed',
      },
      select: { chunkIndex: true },
      orderBy: { chunkIndex: 'asc' },
    });

    return {
      success: true,
      data: uploadedChunks.map((chunk) => chunk.chunkIndex),
    };
  }

  async mergeChunks(
    req: Request,
    userId: number,
    body: Record<string, unknown>,
  ) {
    try {
      const parsed = this.mergeUploadService.assertValidMergeChunksBody(body);
      const {
        fileHash,
        fileName,
        fileSize,
        mimeType,
        totalChunks,
        parentId,
        conflictAction,
      } = parsed;

      const finalFilePath =
        totalChunks > 0
          ? await this.mergeUploadService.mergeChunkFilesToDisk({
              fileHash,
              fileName,
              userId,
              totalChunks,
            })
          : this.mergeUploadService.createEmptyMergedFileOnDisk(
              fileHash,
              fileName,
            );

      const finalMimeType = this.mergeUploadService.refineMimeTypeForMergedFile(
        finalFilePath,
        mimeType,
        fileName,
      );

      const result = await this.mergeUploadService.persistMergedFileRecords({
        finalFilePath,
        fileHash,
        fileSize,
        finalMimeType,
        userId,
        parentId,
        fileName,
        conflictAction,
      });

      await this.mergeUploadService.cleanupChunksAfterMerge(
        fileHash,
        userId,
        totalChunks,
      );

      await this.operationLogService.logOperation({
        req,
        userId,
        operationType: LogOperationType.UPLOAD,
        resourceType: LogResourceType.FILE,
        resourceId: result.userFile.id,
        description: `Uploaded file (merged): ${result.userFile.fileName}`,
      });

      return {
        success: true,
        message: '文件上传成功',
        data: {
          id: result.userFile.id,
          fileName: result.userFile.fileName,
          fileSize: Number(result.fileStorage.fileSize),
          mimeType: result.fileStorage.mimeType,
          fileType: result.userFile.fileType,
          createdAt: result.userFile.createdAt,
        },
      };
    } catch (error) {
      this.mapMergeError(error);
    }
  }

  async instantUpload(
    req: Request,
    userId: number,
    body: Record<string, unknown>,
  ) {
    const fileHash =
      typeof body.fileHash === 'string' ? body.fileHash.trim() : '';
    const fileName =
      typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const fileSize = body.fileSize;
    const mimeType =
      typeof body.mimeType === 'string' ? body.mimeType.trim() : '';
    const parentId = parseOptionalInt(body.parentId);
    const conflictAction =
      typeof body.conflictAction === 'string' ? body.conflictAction : undefined;

    if (
      !fileHash ||
      !fileName ||
      fileSize === undefined ||
      fileSize === null ||
      !mimeType
    ) {
      throw new BadRequestException('秒传参数不完整');
    }

    let existingFile = await this.prisma.fileStorage.findUnique({
      where: { fileHash },
    });

    if (!existingFile) {
      throw new NotFoundException('文件不存在，无法秒传');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (existingFile!.status === 'pending_delete') {
        existingFile = await tx.fileStorage.update({
          where: { id: existingFile!.id },
          data: {
            status: 'active',
            markedDeleteAt: null,
          },
        });
      }

      await tx.fileStorage.update({
        where: { id: existingFile!.id },
        data: { referenceCount: { increment: 1 } },
      });

      const existingUserFile = await tx.userFile.findFirst({
        where: {
          userId,
          parentId,
          fileName,
          isDeleted: false,
          fileType: 'file',
        },
        include: { storage: true },
      });

      let userFile;
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
            storageId: existingFile!.id,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
      } else {
        userFile = await tx.userFile.create({
          data: {
            userId,
            storageId: existingFile!.id,
            parentId,
            fileName,
            fileType: 'file',
          },
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          storageUsed: { increment: BigInt(Number(fileSize)) },
        },
      });

      return userFile;
    });

    await this.operationLogService.logOperation({
      req,
      userId,
      operationType: LogOperationType.UPLOAD,
      resourceType: LogResourceType.FILE,
      resourceId: result.id,
      description: `Uploaded file (instant): ${result.fileName}`,
    });

    return {
      success: true,
      message: '文件秒传成功',
      data: {
        id: result.id,
        fileName: result.fileName,
        fileSize: Number(existingFile.fileSize),
        mimeType: existingFile.mimeType,
        fileType: result.fileType,
        createdAt: result.createdAt,
      },
    };
  }

  async uploadFile(
    req: Request,
    userId: number,
    file: Express.Multer.File | undefined,
    parentIdRaw?: unknown,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }
    // multipart 文件名默认 latin1，中文笔记名在入库前还原成 UTF-8
    applyDecodedOriginalName(file);

    const storage = this.storageService.getStorageProvider();
    const fileHash = calculateFileHash(file.path);
    const parentId = parseOptionalInt(parentIdRaw);

    const result = await this.prisma.$transaction(async (tx) => {
      let fileStorage = await tx.fileStorage.findUnique({
        where: { fileHash },
      });

      if (fileStorage && fileStorage.status === 'pending_delete') {
        fileStorage = await tx.fileStorage.update({
          where: { id: fileStorage.id },
          data: {
            status: 'active',
            markedDeleteAt: null,
          },
        });
      }

      if (!fileStorage) {
        const storedPath = await storage.putFromLocalFile({
          localFilePath: file.path,
          suggestedName: `${fileHash}-${file.originalname}`,
        });
        fileStorage = await tx.fileStorage.create({
          data: {
            fileHash,
            filePath: storedPath,
            fileSize: BigInt(file.size),
            mimeType: file.mimetype,
            referenceCount: 1,
            status: 'active',
          },
        });
      } else {
        fileStorage = await tx.fileStorage.update({
          where: { id: fileStorage.id },
          data: { referenceCount: { increment: 1 } },
        });
        await storage.delete(file.path);
      }

      const userFile = await tx.userFile.create({
        data: {
          userId,
          storageId: fileStorage.id,
          parentId,
          fileName: file.originalname,
          fileType: 'file',
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          storageUsed: { increment: BigInt(file.size) },
        },
      });

      return { userFile, fileStorage };
    });

    await this.operationLogService.logOperation({
      req,
      userId,
      operationType: LogOperationType.UPLOAD,
      resourceType: LogResourceType.FILE,
      resourceId: result.userFile.id,
      description: `Uploaded file: ${result.userFile.fileName}`,
    });

    return {
      success: true,
      message: '文件上传成功',
      data: {
        id: result.userFile.id,
        fileName: result.userFile.fileName,
        fileSize: Number(result.fileStorage.fileSize),
        mimeType: result.fileStorage.mimeType,
        createdAt: result.userFile.createdAt,
      },
    };
  }

  async createFolder(
    req: Request,
    userId: number,
    body: { name?: unknown; parentId?: unknown },
  ) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      throw new BadRequestException('文件夹名称不能为空');
    }

    const parentId = parseOptionalInt(body.parentId);

    const existingFolder = await this.prisma.userFile.findFirst({
      where: {
        userId,
        parentId,
        fileName: name,
        isDeleted: false,
      },
    });

    if (existingFolder) {
      throw new BadRequestException('文件夹名称已存在');
    }

    const folder = await this.prisma.userFile.create({
      data: {
        userId,
        parentId,
        fileName: name,
        fileType: 'folder',
      },
    });

    await this.operationLogService.logOperation({
      req,
      userId,
      operationType: LogOperationType.UPLOAD,
      resourceType: LogResourceType.FOLDER,
      resourceId: folder.id,
      description: `Created folder: ${folder.fileName}`,
    });

    return {
      success: true,
      message: '文件夹创建成功',
      data: {
        id: folder.id,
        fileName: folder.fileName,
        fileType: folder.fileType,
        fileSize: 0,
        mimeType: 'folder',
        createdAt: folder.createdAt,
      },
    };
  }
}
