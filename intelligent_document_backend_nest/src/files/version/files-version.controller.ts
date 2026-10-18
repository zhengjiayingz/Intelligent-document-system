import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { RequestUser } from '@/auth/types/jwt-payload.type';
import { FilesVersionService } from './files-version.service';

@Controller('files')
export class FilesVersionController {
  constructor(private readonly filesVersionService: FilesVersionService) {}

  @Get(':id/versions')
  getFileVersions(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) fileId: number,
  ) {
    return this.filesVersionService.getFileVersions(user.id, fileId);
  }

  @Put(':id/text-content')
  @HttpCode(HttpStatus.OK)
  replaceTextContent(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) fileId: number,
    @Body() body: { content?: unknown; encoding?: unknown },
  ) {
    return this.filesVersionService.replaceTextContent(
      req,
      user.id,
      fileId,
      body?.content,
      body?.encoding,
    );
  }

  @Post(':id/versions/:versionId/rollback')
  @HttpCode(HttpStatus.OK)
  rollbackVersion(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) fileId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
  ) {
    return this.filesVersionService.rollbackVersion(
      req,
      user.id,
      fileId,
      versionId,
    );
  }

  @Get(':id/versions/:versionId/download')
  async downloadVersion(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseIntPipe) fileId: number,
    @Param('versionId', ParseIntPipe) versionId: number,
  ): Promise<void> {
    await this.filesVersionService.downloadVersion(
      req,
      res,
      user.id,
      fileId,
      versionId,
    );
  }
}
