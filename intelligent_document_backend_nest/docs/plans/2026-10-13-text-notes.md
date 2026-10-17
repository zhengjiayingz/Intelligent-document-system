# 文本预览划词注释 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在文本分块预览里保存 Kindle 式划词注释：可只高亮，也可写一句说明，下次打开仍画在原文上。

**Architecture:** 注释存在 `file_text_notes`，锚点是换行归一化后的字符偏移加选中原文。前端用同一套映射把「显示行」和「原文偏移」互转，流式重排不另存一套坐标。服务端只校验归属和长度，不重读文件核对原文。

**Tech Stack:** NestJS、Prisma（MySQL）、Jest、Vue 3、现有虚拟列表划词（`useVirtualTextSelection`）。

设计说明：`docs/plans/2026-10-13-text-notes-design.md`。

---

### Task 1: 原文与显示行的偏移映射

**Files:**
- Create: `intelligent_document_frontend/src/utils/textNoteAnchor.ts`
- Create: `intelligent_document_frontend/src/utils/textNoteAnchor.spec.ts`
- Modify: `intelligent_document_frontend/src/components/TextChunkPreviewDialog/index.vue`（下一步才改，本任务只加纯函数）

**Step 1: Write the failing test**

在 `textNoteAnchor.spec.ts` 写入：

```typescript
import { describe, expect, it } from 'vitest'
import {
  buildMappedRows,
  caretToSource,
  normalizeNewlines,
  noteAnchorFromSelection,
  noteStatus,
  pickNoteAtCaret,
  sourceRangeToRows,
} from './textNoteAnchor'

describe('textNoteAnchor', () => {
  it('normalizeNewlines 把 CRLF 和 CR 收成 LF', () => {
    expect(normalizeNewlines('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('不重排时，跨行选区的 quote 含中间换行', () => {
    const normalized = 'hello\nworld'
    const rows = buildMappedRows(normalized, false)
    const anchor = noteAnchorFromSelection(normalized, rows, {
      start: { rowIndex: 0, offset: 1 },
      end: { rowIndex: 1, offset: 3 },
    })
    expect(anchor).toEqual({
      startOffset: 1,
      endOffset: 9,
      quote: 'ello\nwor',
    })
  })

  it('流式重排合并段内换行，但 quote 仍是原文切片', () => {
    const normalized = 'hello\nworld\n\nnext'
    const rows = buildMappedRows(normalized, true)
    expect(rows.map((row) => row.text)).toEqual(['helloworld', 'next'])
    const anchor = noteAnchorFromSelection(normalized, rows, {
      start: { rowIndex: 0, offset: 0 },
      end: { rowIndex: 0, offset: 10 },
    })
    expect(anchor.quote).toBe('hello\nworld')
    expect(anchor.startOffset).toBe(0)
    expect(anchor.endOffset).toBe(11)
  })

  it('原文偏移映射回当前显示行', () => {
    const normalized = 'hello\nworld\n\nnext'
    const rows = buildMappedRows(normalized, true)
    expect(sourceRangeToRows(rows, 0, 11)).toEqual([
      { rowIndex: 0, from: 0, to: 10 },
    ])
  })

  it('未加载到的注释是 pending，切片不符是 stale', () => {
    expect(
      noteStatus('hello', { startOffset: 0, endOffset: 5, quote: 'hello' }, false),
    ).toBe('ready')
    expect(
      noteStatus('hel', { startOffset: 0, endOffset: 5, quote: 'hello' }, false),
    ).toBe('pending')
    expect(
      noteStatus('hel', { startOffset: 0, endOffset: 5, quote: 'hello' }, true),
    ).toBe('stale')
    expect(
      noteStatus('hello', { startOffset: 0, endOffset: 5, quote: 'hellp' }, true),
    ).toBe('stale')
  })

  it('重叠时取更短的一条，一样短则取较新的', () => {
    const notes = [
      { id: 1, startOffset: 0, endOffset: 10, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 2, startOffset: 2, endOffset: 5, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 3, startOffset: 2, endOffset: 5, createdAt: '2026-01-03T00:00:00.000Z' },
    ]
    expect(pickNoteAtCaret(notes, 3)?.id).toBe(3)
    expect(pickNoteAtCaret(notes, 8)?.id).toBe(1)
  })

  it('caretToSource 在行尾落到 endSource', () => {
    const rows = buildMappedRows('ab\ncd', false)
    expect(caretToSource(rows[0]!, 2)).toBe(2)
    expect(caretToSource(rows[1]!, 0)).toBe(3)
  })
})
```

**Step 2: Run test to verify it fails**

Run（在 `intelligent_document_frontend`）：

```bash
pnpm exec vitest run src/utils/textNoteAnchor.spec.ts
```

Expected: FAIL，找不到模块 `./textNoteAnchor`。

**Step 3: Write minimal implementation**

`textNoteAnchor.ts`：

```typescript
export type NoteCaret = { rowIndex: number; offset: number }

export type MappedRow = {
  text: string
  indentFirstLine: boolean
  isBlank?: boolean
  charSources: number[]
  endSource: number
}

const VIRTUAL_MAX_LINE = 4000

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function chunkMapped(row: MappedRow, indentFirstLine: boolean): MappedRow[] {
  if (row.text.length === 0) {
    return [{ ...row, indentFirstLine: false, isBlank: true }]
  }
  if (row.text.length <= VIRTUAL_MAX_LINE) {
    return [{ ...row, indentFirstLine, isBlank: false }]
  }
  const out: MappedRow[] = []
  for (let i = 0; i < row.text.length; i += VIRTUAL_MAX_LINE) {
    const text = row.text.slice(i, i + VIRTUAL_MAX_LINE)
    const charSources = row.charSources.slice(i, i + VIRTUAL_MAX_LINE)
    const endSource =
      i + VIRTUAL_MAX_LINE >= row.text.length
        ? row.endSource
        : charSources[charSources.length - 1]! + 1
    out.push({
      text,
      charSources,
      endSource,
      indentFirstLine: indentFirstLine && i === 0,
      isBlank: false,
    })
  }
  return out
}

function mapPlain(normalized: string): MappedRow[] {
  const logical: MappedRow[] = []
  let text = ''
  let charSources: number[] = []
  const pushLine = (endSource: number) => {
    logical.push({
      text,
      charSources,
      endSource,
      indentFirstLine: false,
      isBlank: text.length === 0,
    })
    text = ''
    charSources = []
  }
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '\n') pushLine(i)
    else {
      text += normalized[i]
      charSources.push(i)
    }
  }
  if (text.length > 0 || !normalized.endsWith('\n')) {
    if (normalized.length > 0 || logical.length === 0) pushLine(normalized.length)
  }
  if (normalized.length === 0) return []

  const out: MappedRow[] = []
  for (let r = 0; r < logical.length; r++) {
    const line = logical[r]!
    const indent =
      !line.isBlank && (r === 0 || logical[r - 1]?.isBlank === true)
    out.push(...chunkMapped(line, indent))
  }
  return out
}

function isBlankGap(normalized: string, index: number): number {
  if (normalized[index] !== '\n') return 0
  let i = index + 1
  let sawAnotherNewline = false
  while (i < normalized.length) {
    const ch = normalized[i]!
    if (ch === ' ' || ch === '\t' || ch === '\u3000') {
      i++
      continue
    }
    if (ch === '\n') {
      sawAnotherNewline = true
      i++
      continue
    }
    break
  }
  return sawAnotherNewline ? i - index : 0
}

function collapseBlock(segs: { ch: string; source: number }[]): { ch: string; source: number }[] {
  const lines: { ch: string; source: number }[][] = [[]]
  for (const seg of segs) {
    if (seg.ch === '\n') lines.push([])
    else lines[lines.length - 1]!.push(seg)
  }
  const joined: { ch: string; source: number }[] = []
  for (const line of lines) {
    let end = line.length
    while (end > 0 && /[ \t\u3000]/.test(line[end - 1]!.ch)) end--
    joined.push(...line.slice(0, end))
  }
  let start = 0
  let end = joined.length
  while (start < end && /[ \t\u3000]/.test(joined[start]!.ch)) start++
  while (end > start && /[ \t\u3000]/.test(joined[end - 1]!.ch)) end--
  return joined.slice(start, end)
}

function mapReflow(normalized: string): MappedRow[] {
  if (!normalized.trim()) return []
  const paragraphs: MappedRow[] = []
  let segs: { ch: string; source: number }[] = []
  const flush = () => {
    const kept = collapseBlock(segs)
    segs = []
    if (kept.length === 0) return
    paragraphs.push({
      text: kept.map((seg) => seg.ch).join(''),
      charSources: kept.map((seg) => seg.source),
      endSource: kept[kept.length - 1]!.source + 1,
      indentFirstLine: true,
      isBlank: false,
    })
  }
  for (let i = 0; i < normalized.length; ) {
    const gap = isBlankGap(normalized, i)
    if (gap > 0) {
      flush()
      i += gap
      continue
    }
    segs.push({ ch: normalized[i]!, source: i })
    i++
  }
  flush()
  return paragraphs.flatMap((row) => chunkMapped(row, true))
}

export function buildMappedRows(normalized: string, reflow: boolean): MappedRow[] {
  return reflow ? mapReflow(normalized) : mapPlain(normalized)
}

export function caretToSource(row: MappedRow, offset: number): number {
  if (row.charSources.length === 0) return row.endSource
  if (offset <= 0) return row.charSources[0]!
  if (offset >= row.text.length) return row.endSource
  return row.charSources[offset]!
}

export function noteAnchorFromSelection(
  normalized: string,
  rows: MappedRow[],
  range: { start: NoteCaret; end: NoteCaret },
): { startOffset: number; endOffset: number; quote: string } {
  const startOffset = caretToSource(rows[range.start.rowIndex]!, range.start.offset)
  const endOffset = caretToSource(rows[range.end.rowIndex]!, range.end.offset)
  return {
    startOffset,
    endOffset,
    quote: normalized.slice(startOffset, endOffset),
  }
}

export function sourceRangeToRows(
  rows: MappedRow[],
  startOffset: number,
  endOffset: number,
): { rowIndex: number; from: number; to: number }[] {
  const spans: { rowIndex: number; from: number; to: number }[] = []
  rows.forEach((row, rowIndex) => {
    if (row.isBlank || row.charSources.length === 0) return
    let from = -1
    let to = -1
    row.charSources.forEach((source, index) => {
      if (source >= startOffset && source < endOffset) {
        if (from < 0) from = index
        to = index + 1
      }
    })
    if (from >= 0 && to > from) spans.push({ rowIndex, from, to })
  })
  return spans
}

export function noteStatus(
  normalized: string,
  note: { startOffset: number; endOffset: number; quote: string },
  fullyLoaded: boolean,
): 'ready' | 'pending' | 'stale' {
  if (note.endOffset > normalized.length) return fullyLoaded ? 'stale' : 'pending'
  if (normalized.slice(note.startOffset, note.endOffset) !== note.quote) return 'stale'
  return 'ready'
}

export function pickNoteAtCaret<
  T extends { id: number; startOffset: number; endOffset: number; createdAt: string },
>(notes: T[], sourceOffset: number): T | null {
  const probe = (offset: number) =>
    notes
      .filter((note) => offset >= note.startOffset && offset < note.endOffset)
      .sort((a, b) => {
        const span = a.endOffset - a.startOffset - (b.endOffset - b.startOffset)
        if (span !== 0) return span
        const time = b.createdAt.localeCompare(a.createdAt)
        if (time !== 0) return time
        return b.id - a.id
      })[0] ?? null
  return probe(sourceOffset) ?? probe(sourceOffset - 1)
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm exec vitest run src/utils/textNoteAnchor.spec.ts
```

Expected: PASS，7 tests。

**Step 5: Commit**

```bash
git add src/utils/textNoteAnchor.ts src/utils/textNoteAnchor.spec.ts
git commit -m "feat: map text-preview selections to source offsets"
```

---

### Task 2: Prisma 模型

**Files:**
- Modify: `intelligent_document_backend_nest/prisma/schema.prisma`（`User` 关系、`UserFile` 关系、新 model）

**Step 1: Add the model**

在 `User` 的关系里加 `fileTextNotes FileTextNote[]`。在 `UserFile` 的关系里加 `fileTextNotes FileTextNote[]`。在 `UserFile` model 后加：

```prisma
model FileTextNote {
  id          Int      @id @default(autoincrement())
  userId      Int      @map("user_id")
  userFileId  Int      @map("user_file_id")
  startOffset Int      @map("start_offset")
  endOffset   Int      @map("end_offset")
  quote       String   @db.VarChar(8000)
  content     String?  @db.VarChar(2000)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userFile UserFile @relation(fields: [userFileId], references: [id], onDelete: Cascade)

  @@index([userId, userFileId])
  @@map("file_text_notes")
}
```

**Step 2: Migrate and generate**

在 `intelligent_document_backend_nest`：

```bash
pnpm exec prisma migrate dev --name add_file_text_notes
```

Expected: 迁移成功，`@prisma/client` 出现 `FileTextNote`。

**Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add file_text_notes table"
```

---

### Task 3: 注释服务

**Files:**
- Create: `intelligent_document_backend_nest/src/files/notes/files-text-note.service.ts`
- Test: `intelligent_document_backend_nest/src/files/notes/files-text-note.service.spec.ts`

常量：`QUOTE_MAX = 8000`，`CONTENT_MAX = 2000`。空白正文存 `null`。

**Step 1: Write the failing test**

```typescript
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
```

**Step 2: Run test to verify it fails**

```bash
pnpm exec jest --testPathPatterns=files-text-note.service.spec --no-coverage
```

Expected: FAIL，找不到 `./files-text-note.service`。

**Step 3: Write minimal implementation**

```typescript
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
```

**Step 4: Run test to verify it passes**

```bash
pnpm exec jest --testPathPatterns=files-text-note.service.spec --no-coverage
```

Expected: PASS，4 tests。

**Step 5: Commit**

```bash
git add src/files/notes/files-text-note.service.ts src/files/notes/files-text-note.service.spec.ts
git commit -m "feat: add file text note service"
```

---

### Task 4: HTTP 接口

**Files:**
- Create: `intelligent_document_backend_nest/src/files/notes/files-text-note.controller.ts`
- Modify: `intelligent_document_backend_nest/src/files/files.module.ts`

**Step 1: Add the controller**

路由挂在 `files` 下，注册位置放在 `FilesTagController` 之后、`FilesQueryController` 之前。

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { RequestUser } from '@/auth/types/jwt-payload.type';
import { FilesTextNoteService } from './files-text-note.service';

@Controller('files')
export class FilesTextNoteController {
  constructor(private readonly notes: FilesTextNoteService) {}

  @Get(':id/text-notes')
  list(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) fileId: number,
  ) {
    return this.notes.list(user.id, fileId);
  }

  @Post(':id/text-notes')
  create(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) fileId: number,
    @Body()
    body: {
      startOffset?: number;
      endOffset?: number;
      quote?: string;
      content?: string | null;
    },
  ) {
    return this.notes.create(user.id, fileId, {
      startOffset: body.startOffset ?? -1,
      endOffset: body.endOffset ?? -1,
      quote: body.quote ?? '',
      content: body.content,
    });
  }

  @Patch(':id/text-notes/:noteId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) fileId: number,
    @Param('noteId', ParseIntPipe) noteId: number,
    @Body() body: { content?: unknown },
  ) {
    return this.notes.updateContent(user.id, fileId, noteId, body.content);
  }

  @Delete(':id/text-notes/:noteId')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) fileId: number,
    @Param('noteId', ParseIntPipe) noteId: number,
  ) {
    return this.notes.remove(user.id, fileId, noteId);
  }
}
```

在 `files.module.ts` 的 `controllers` 里、`FilesQueryController` 之前加入 `FilesTextNoteController`，`providers` 加入 `FilesTextNoteService`。

**Step 2: Verify the service tests still pass**

```bash
pnpm exec jest --testPathPatterns=files-text-note.service.spec --no-coverage
```

Expected: PASS。

**Step 3: Commit**

```bash
git add src/files/notes/files-text-note.controller.ts src/files/files.module.ts
git commit -m "feat: expose file text note routes"
```

---

### Task 5: 前端 API

**Files:**
- Modify: `intelligent_document_frontend/src/api/file.ts`（接在 `getTextFileChunk` 附近）

**Step 1: Add the client**

```typescript
export type FileTextNote = {
  id: number
  startOffset: number
  endOffset: number
  quote: string
  content: string | null
  createdAt: string
  updatedAt: string
}

async listTextNotes(fileId: number): Promise<FileTextNote[]> {
  const res = await request.get<FileTextNote[]>(`/files/${fileId}/text-notes`)
  return res.data
},

async createTextNote(
  fileId: number,
  body: { startOffset: number; endOffset: number; quote: string; content?: string | null },
): Promise<FileTextNote> {
  const res = await request.post<FileTextNote>(`/files/${fileId}/text-notes`, body)
  return res.data
},

async updateTextNote(fileId: number, noteId: number, content: string | null): Promise<FileTextNote> {
  const res = await request.patch<FileTextNote>(`/files/${fileId}/text-notes/${noteId}`, { content })
  return res.data
},

async deleteTextNote(fileId: number, noteId: number): Promise<void> {
  await request.delete(`/files/${fileId}/text-notes/${noteId}`)
},
```

先看 `request` 拦截器是否已经解包 `data`。`getTextFileChunk` 使用 `res.data.data`。若全局拦截器没有解包，上面四个方法改成读取 `res.data.data`，并让后端这三个接口与现有文件接口一样返回 `{ success: true, data }`。以 `getTextFileChunk` 的实际解包为准，不要另造一层。

**Step 2: Commit**

```bash
git add src/api/file.ts
git commit -m "feat: add text note API client"
```

若后端现有接口统一包 `{ success, data }`，在 Task 4 的 controller 返回值外包这一层，再跑一次 service 测试（service 仍返回裸记录，包装放在 controller）。

---

### Task 6: 预览里的高亮和注释卡片

**Files:**
- Modify: `intelligent_document_frontend/src/composables/useVirtualTextSelection.ts`
- Modify: `intelligent_document_frontend/src/components/TextChunkPreviewDialog/index.vue`
- Modify: `intelligent_document_frontend/src/locales/zh-CN.ts`、`zh-TW.ts`、`en-US.ts`（`preview` 段）

**Step 1: 显示行改用映射结果**

`TextChunkPreviewDialog` 删除本地的 `reflowBookText`、`lineRows`、`displayRows`。改为：

```typescript
const normalizedText = computed(() => normalizeNewlines(rawText.value))
const mappedRows = computed(() =>
  buildMappedRows(normalizedText.value, reflowForReading.value),
)
const displayRows = computed(() => mappedRows.value)
```

`useVirtualTextSelection(scrollRef, displayRows)` 保持不变。`displayRows` 仍带 `text`、`indentFirstLine`、`isBlank`。

**Step 2: 单击光标**

在 `useVirtualTextSelection` 增加 `lastClick` ref。`onDocumentPointerUp` 里、把 `anchor` 清空之前：若 `!pointerMoved && anchor`，写入 `{ ...anchor, x: ev.clientX, y: ev.clientY }`，否则写入 `null`。从返回值导出 `lastClick`。

**Step 3: 持久高亮**

另用 CSS highlight 名 `vlist-notes`，颜色 `rgba(255, 214, 102, 0.55)`。对 `noteStatus(...) === 'ready'` 的注释调用 `sourceRangeToRows`，再复用现有的按行建 Range 的方式画高亮。`pending` 不画。`stale` 不画在句子上。

临时选区继续用 `vlist-sel`，不要和 `vlist-notes` 写进同一个 `Highlight`。

**Step 4: 卡片**

- 有 `selectionRange` 时，在选区附近显示「添加注释」。点开卡片，正文可空，保存或取消。
- 保存调用 `noteAnchorFromSelection`。`quote.length > 8000` 或 `startOffset >= endOffset` 时不请求，提示选区无效。
- `watch(lastClick)`：用 `caretToSource` 得到原文偏移，再 `pickNoteAtCaret`。命中则打开该条的卡片（可改、可删），并 `clearSelection()`。
- 打开对话框时 `listTextNotes`。`reset()` 清空注释和卡片。`rawText` 变长或切换重排后重画。
- 文案走 i18n：`preview.textNoteAdd`、`preview.textNoteSave`、`preview.textNoteDelete`、`preview.textNotePlaceholder`、`preview.textNoteStale`。本任务不在界面上列出 stale 列表；stale 只是不画错位置。若保存时接口 400，用返回的 `message` 提示。

**Step 5: 手动验证**

1. 打开一篇英文 txt 的文本分块预览。
2. 划一句，只保存高亮，关闭再打开，淡黄高亮还在。
3. 点高亮，补一句注释，再打开仍在。
4. 删除后高亮消失。
5. 打开「流式重排」和关掉，同一条高亮仍打在同一句原文上。
6. 选区跨一段内换行时，重排视图里高亮是合并后的那一句。

**Step 6: Commit**

```bash
git add src/composables/useVirtualTextSelection.ts src/components/TextChunkPreviewDialog/index.vue src/locales/zh-CN.ts src/locales/zh-TW.ts src/locales/en-US.ts
git commit -m "feat: highlight and edit text notes in preview"
```

---

## 完成标准

- `textNoteAnchor.spec.ts` 与 `files-text-note.service.spec.ts` 通过。
- 注释只属于当前用户和这篇文件；别人的文件返回 404。
- 正文可空；重叠时点开更短的那条。
- 不做 PDF、颜色、标签、右侧列表、分享可见。
