import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

const QUOTE_MAX = 8000;
const CONTENT_MAX = 2000;
const DEFAULT_NOTE_COLOR = '#FFD666';
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

type CreateNoteBody = {
  startOffset: number;
  endOffset: number;
  quote: string;
  content?: string | null;
  color?: string | null;
};

type UpdateNoteBody = {
  content?: unknown;
  color?: unknown;
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

function normalizeColor(value: unknown, required: boolean): string | undefined {
  if (value == null || value === '') {
    if (required) return DEFAULT_NOTE_COLOR;
    return undefined;
  }
  if (typeof value !== 'string' || !COLOR_RE.test(value)) {
    throw new BadRequestException('color 须为 #RRGGBB');
  }
  return value.toUpperCase();
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
    const color = normalizeColor(body.color, true)!;
    return this.prisma.fileTextNote.create({
      data: {
        userId,
        userFileId: fileId,
        startOffset,
        endOffset,
        quote: body.quote,
        content: normalizeContent(body.content),
        color,
      },
    });
  }

  async updateNote(
    userId: number,
    fileId: number,
    noteId: number,
    body: UpdateNoteBody,
  ) {
    const note = await this.prisma.fileTextNote.findFirst({
      where: { id: noteId, userId, userFileId: fileId },
      select: { id: true },
    });
    if (!note) throw new NotFoundException('注释不存在');

    const data: { content?: string | null; color?: string } = {};
    if ('content' in body) {
      data.content = normalizeContent(body.content);
    }
    if ('color' in body) {
      const color = normalizeColor(body.color, true);
      if (color) data.color = color;
    }
    if (!('content' in body) && !('color' in body)) {
      throw new BadRequestException('须提供 content 或 color');
    }

    return this.prisma.fileTextNote.update({
      where: { id: noteId },
      data,
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
