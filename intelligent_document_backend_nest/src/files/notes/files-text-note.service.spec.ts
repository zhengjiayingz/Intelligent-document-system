import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FilesTextNoteService } from './files-text-note.service';

describe('FilesTextNoteService', () => {
  const prisma = {
    userFile: { findFirst: jest.fn() },
    fileTextNote: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const service = new FilesTextNoteService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('文件不属于当前用户时 404', async () => {
    prisma.userFile.findFirst.mockResolvedValue(null);
    await expect(service.list(1, 9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('起点不小于终点时 400', async () => {
    prisma.userFile.findFirst.mockResolvedValue({ id: 9 });
    await expect(
      service.create(1, 9, { startOffset: 3, endOffset: 3, quote: 'a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('空正文保存为 null', async () => {
    prisma.userFile.findFirst.mockResolvedValue({ id: 9 });
    prisma.fileTextNote.create.mockResolvedValue({ id: 4, content: null });
    await service.create(1, 9, {
      startOffset: 0,
      endOffset: 5,
      quote: 'hello',
      content: '   ',
    });
    expect(prisma.fileTextNote.create).toHaveBeenCalledWith({
      data: {
        userId: 1,
        userFileId: 9,
        startOffset: 0,
        endOffset: 5,
        quote: 'hello',
        content: null,
      },
    });
  });

  it('只能改自己的注释正文', async () => {
    prisma.fileTextNote.findFirst.mockResolvedValue(null);
    await expect(service.updateContent(1, 9, 4, 'note')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
