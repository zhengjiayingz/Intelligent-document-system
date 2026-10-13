import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

const QUOTE_MAX = 8000;
const CONTENT_MAX = 2000;

type CreateNoteBody = {
  startOffset: number;
  endOffset: number;
  quote: string;
  content?: string | null;
};

function requireInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${name} 须为非负整数`);
  }
  return value;
}

function normalizeContent(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('content 须为字符串');
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CONTENT_MAX) {
    throw new BadRequestException(`注释不能超过 ${CONTENT_MAX} 字`);
  }
  return trimmed;
}

@Injectable()
export class FilesTextNoteService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwnFile(userId: number, fileId: number) {
    const file = await this.prisma.userFile.findFirst({
      where: { id: fileId, userId, isDeleted: false },
      select: { id: true },
    });
    if (!file) throw new NotFoundException('文件不存在');
  }

  async list(userId: number, fileId: number) {
    await this.assertOwnFile(userId, fileId);
    return this.prisma.fileTextNote.findMany({
      where: { userId, userFileId: fileId },
      orderBy: [{ startOffset: 'asc' }, { id: 'asc' }],
    });
  }

  async create(userId: number, fileId: number, body: CreateNoteBody) {
    await this.assertOwnFile(userId, fileId);
    const startOffset = requireInt(body.startOffset, 'startOffset');
    const endOffset = requireInt(body.endOffset, 'endOffset');
    if (startOffset >= endOffset) {
      throw new BadRequestException('选区长度无效');
    }
    if (typeof body.quote !== 'string' || body.quote.length === 0) {
      throw new BadRequestException('quote 不能为空');
    }
    if (body.quote.length > QUOTE_MAX) {
      throw new BadRequestException(`选中原文不能超过 ${QUOTE_MAX} 字`);
    }
    if (body.quote.length !== endOffset - startOffset) {
      throw new BadRequestException('quote 长度与偏移不一致');
    }
    return this.prisma.fileTextNote.create({
      data: {
        userId,
        userFileId: fileId,
        startOffset,
        endOffset,
        quote: body.quote,
        content: normalizeContent(body.content),
      },
    });
  }

  async updateContent(
    userId: number,
    fileId: number,
    noteId: number,
    content: unknown,
  ) {
    const note = await this.prisma.fileTextNote.findFirst({
      where: { id: noteId, userId, userFileId: fileId },
      select: { id: true },
    });
    if (!note) throw new NotFoundException('注释不存在');
    return this.prisma.fileTextNote.update({
      where: { id: noteId },
      data: { content: normalizeContent(content) },
    });
  }

  async remove(userId: number, fileId: number, noteId: number) {
    const note = await this.prisma.fileTextNote.findFirst({
      where: { id: noteId, userId, userFileId: fileId },
      select: { id: true },
    });
    if (!note) throw new NotFoundException('注释不存在');
    await this.prisma.fileTextNote.delete({ where: { id: noteId } });
    return { success: true };
  }
}
