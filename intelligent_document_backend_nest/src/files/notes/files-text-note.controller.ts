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
      color?: string | null;
    },
  ) {
    return this.notes.create(user.id, fileId, {
      startOffset: body.startOffset ?? -1,
      endOffset: body.endOffset ?? -1,
      quote: body.quote ?? '',
      content: body.content,
      color: body.color,
    });
  }

  @Patch(':id/text-notes/:noteId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) fileId: number,
    @Param('noteId', ParseIntPipe) noteId: number,
    @Body()
    body: {
      content?: unknown;
      color?: unknown;
      startOffset?: unknown;
      endOffset?: unknown;
      quote?: unknown;
    },
  ) {
    return this.notes.updateNote(user.id, fileId, noteId, body);
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
