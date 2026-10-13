import { Module } from '@nestjs/common';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { PasswordPolicyService } from '../common/password-policy/password-policy.service';
import { ShareModule } from '../share/share.module';
import { StorageModule } from '../storage/storage.module';
import { FilesUploadController } from './upload/files-upload.controller';
import { FilesUploadService } from './upload/files-upload.service';
import { MergeUploadService } from './upload/merge-upload.service';
import { FilesVersionController } from './version/files-version.controller';
import { FilesVersionService } from './version/files-version.service';
import { FilesArchiveController } from './archive/files-archive.controller';
import { FilesArchiveService } from './archive/files-archive.service';
import { DocumentIndexQueueService } from '@/files/ai/index/service/document-index-queue.service';
import { FilesAiController } from '@/files/ai/files-ai.controller';
import { FilesAiIndexService } from '@/files/ai/index/service/files-ai-index.service';
import { FilesAiService } from '@/files/ai/chat/service/files-ai.service';
import { FilesPreviewController } from './preview/files-preview.controller';
import { FilesPreviewService } from './preview/files-preview.service';
import { PreviewQueueService } from './preview/preview-queue.service';
import { FilesManageController } from './manage/files-manage.controller';
import { FilesManageService } from './manage/files-manage.service';
import { FileBatchHelper } from './helpers/file-batch.helper';
import { FilesQueryController } from './query/files-query.controller';
import { FilesQueryService } from './query/files-query.service';
import { FilesTagController } from './tag/files-tag.controller';
import { FilesTagService } from './tag/files-tag.service';
import { FilesTextNoteController } from './notes/files-text-note.controller';
import { FilesTextNoteService } from './notes/files-text-note.service';
import { FilesAiRagService } from '@/files/ai/chat/service/files-ai-rag.service';
import { FilesAiSummaryService } from '@/files/ai/summary/service/files-ai-summary.service';
import { FilesAiKnowledgeService } from '@/files/ai/knowledge/service/files-ai-knowledge.service';
import { FilesAiTranslateService } from '@/files/ai/translate/service/files-ai-translate.service';
import { FilesAiMathService } from '@/files/ai/math/service/files-ai-math.service';
import { FilesAiChatSessionService } from '@/files/ai/chat/service/files-ai-chat-session.service';
import { FilesSearchService } from './query/files-search.service';
import { ImageSearchController } from '@/files/ai/image-search.controller';
import { ImageSearchService } from '@/files/ai/image-search/service/image-search.service';
import { ImageFingerprintService } from '@/files/ai/image-search/service/image-fingerprint.service';
import { FilesDuplicatesController } from '@/files/duplicates/files-duplicates.controller';
import { FilesDuplicatesService } from '@/files/duplicates/files-duplicates.service';
import { FilesAiTtsController } from '@/files/ai/files-ai-tts.controller';
import { FilesAiTtsService } from '@/files/ai/tts/service/files-ai-tts.service';
import { FilesAiAssistantController } from '@/files/ai/files-ai-assistant.controller';
import { FilesAiAssistantService } from '@/files/ai/assistant/service/files-ai-assistant.service';

@Module({
  imports: [StorageModule, ShareModule, OperationLogModule],
  controllers: [
    FilesUploadController,
    FilesTagController,
    FilesTextNoteController,
    FilesVersionController,
    FilesArchiveController,
    FilesAiController,
    FilesPreviewController,
    FilesDuplicatesController,
    FilesQueryController,
    FilesManageController,
    ImageSearchController,
    FilesAiTtsController,
    FilesAiAssistantController,
  ],
  providers: [
    FilesUploadService,
    MergeUploadService,
    FilesVersionService,
    FilesArchiveService,
    FilesQueryService,
    FilesSearchService,
    ImageFingerprintService,
    ImageSearchService,
    FilesDuplicatesService,
    FilesManageService,
    FilesTagService,
    FilesTextNoteService,
    FilesAiService,
    FilesAiIndexService,
    FilesAiRagService,
    FilesAiSummaryService,
    FilesAiKnowledgeService,
    FilesAiTranslateService,
    FilesAiMathService,
    FilesAiChatSessionService,
    DocumentIndexQueueService,
    FilesPreviewService,
    PreviewQueueService,
    FileBatchHelper,
    PasswordPolicyService,
    FilesAiTtsService,
    FilesAiAssistantService,
  ],
})
export class FilesModule {}
