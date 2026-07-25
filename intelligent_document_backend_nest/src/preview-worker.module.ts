import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DocumentIndexProcessor } from '@/files/ai/index/processor/document-index.processor';
import { DOCUMENT_INDEX_QUEUE_NAME } from '@/files/ai/index/types/document-index-queue.types';
import { PREVIEW_QUEUE_NAME } from '@/files/preview/preview-queue.types';
import { PreviewQueueService } from '@/files/preview/preview-queue.service';
import { FilesPreviewService } from '@/files/preview/files-preview.service';
import { PreviewProcessor } from '@/files/preview/preview.processor';
import { OperationLogService } from '@/operation-log/operation-log.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { StorageModule } from '@/storage/storage.module';
import { SummaryMapReduceService } from '@/files/ai/summary/service/summary-map-reduce.service';
import { KnowledgeExtractService } from '@/files/ai/knowledge/service/knowledge-extract.service';
import { MediaSemanticChaptersService } from '@/files/ai/summary/service/media-semantic-chapters.service';
import { DocumentIndexQueueService } from '@/files/ai/index/service/document-index-queue.service';

/** 独立 Worker 进程（docker worker / pnpm start:worker） */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL'),
          maxRetriesPerRequest: null,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: PREVIEW_QUEUE_NAME }),
    BullModule.registerQueue({ name: DOCUMENT_INDEX_QUEUE_NAME }),
  ],
  providers: [
    PreviewQueueService,
    OperationLogService,
    FilesPreviewService,
    PreviewProcessor,
    SummaryMapReduceService,
    MediaSemanticChaptersService,
    DocumentIndexQueueService,
    DocumentIndexProcessor,
    KnowledgeExtractService,
  ],
})
export class PreviewWorkerModule {}
