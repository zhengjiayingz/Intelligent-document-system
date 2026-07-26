jest.mock('@/files/ai/summary/service/summary-map-reduce.service', () => ({
  SummaryMapReduceService: class MockSummaryMapReduceService {
    runMapReduce = jest.fn().mockResolvedValue(undefined);
  },
}));

jest.mock('@/files/ai/summary/service/media-semantic-chapters.service', () => ({
  MediaSemanticChaptersService: class MockMediaSemanticChaptersService {
    enrichBookSummaryWithMediaChapters = jest.fn().mockResolvedValue(true);
  },
}));

jest.mock('@/files/ai/knowledge/service/knowledge-extract.service', () => ({
  KnowledgeExtractService: class MockKnowledgeExtractService {
    extractKnowledge = jest.fn().mockResolvedValue(undefined);
  },
}));

jest.mock('@/files/ai/index/utils/pdf-text.util', () => ({
  extractPdfTextWithPdfJs: jest.fn().mockResolvedValue(''),
}));

jest.mock('@/files/ai/index/utils/pdf-ocr.util', () => ({
  extractScannedPdfText: jest
    .fn()
    .mockResolvedValue(
      '--- Page 1 ---\n扫描 PDF OCR 正文内容足够长可以完成索引分块与向量化流程',
    ),
  PdfOcrPageLimitError: class PdfOcrPageLimitError extends Error {
    constructor(message?: string) {
      super(message ?? 'PDF 页数超过 OCR 上限');
      this.name = 'PdfOcrPageLimitError';
    }
  },
}));

jest.mock('@/files/ai/index/provider/embedding.provider', () => ({
  embedMany: jest.fn(),
}));

jest.mock('@/files/ai/index/service/text-chunker', () => ({
  chunkText: jest.fn(),
}));

jest.mock('@/files/ai/index/service/audio-transcript.extractor', () => ({
  extractAudioTranscriptFromStorage: jest.fn(),
}));

import { Readable } from 'node:stream';
import { Job } from 'bullmq';
import { embedMany } from '@/files/ai/index/provider/embedding.provider';
import { chunkText } from '@/files/ai/index/service/text-chunker';
import { extractAudioTranscriptFromStorage } from '@/files/ai/index/service/audio-transcript.extractor';
import { DocumentIndexProcessor } from '@/files/ai/index/processor/document-index.processor';
import {
  DOCUMENT_INDEX_JOB_NAME,
  type DocumentIndexJobData,
} from '@/files/ai/index/types/document-index-queue.types';

type DocumentIndexJobUpdateArgs = {
  where: { userFileId: number };
  data: {
    status?: string;
    progressMsg?: string;
    errorMessage?: string | null;
    progress?: number;
    chunkCount?: number;
    indexedFileHash?: string | null;
  };
};

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);

const embedManyMock = embedMany as jest.MockedFunction<typeof embedMany>;
const chunkTextMock = chunkText as jest.MockedFunction<typeof chunkText>;
const extractAudioMock =
  extractAudioTranscriptFromStorage as jest.MockedFunction<
    typeof extractAudioTranscriptFromStorage
  >;

/** 全量路径：resume 探测空 → embedding 读库 → summary 读库 */
function mockChunkFindManyFullPath(
  chunkFindMany: jest.Mock,
  summaryRows: Array<{
    chunkIndex: number;
    chapterNo: number | null;
    content: string;
  }>,
) {
  const embedRows = summaryRows.map((r) => ({
    chunkIndex: r.chunkIndex,
    content: r.content,
    embedding: null,
  }));
  chunkFindMany
    .mockResolvedValueOnce([]) // resume 探测
    .mockResolvedValueOnce(embedRows) // embedding 阶段
    .mockResolvedValueOnce(summaryRows); // summarizing
}

function createProcessor() {
  const jobUpdate = jest
    .fn<Promise<void>, [DocumentIndexJobUpdateArgs]>()
    .mockResolvedValue(undefined);
  const findFirst = jest.fn();
  const jobFindUnique = jest.fn().mockResolvedValue({ chunkCount: 0 });
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const createMany = jest.fn().mockResolvedValue({ count: 0 });
  const chunkUpdate = jest.fn().mockResolvedValue(undefined);
  const chunkFindMany = jest.fn().mockResolvedValue([]);

  const prisma = {
    userFile: { findFirst },
    documentIndexJob: { update: jobUpdate, findUnique: jobFindUnique },
    documentChunk: {
      deleteMany,
      createMany,
      update: chunkUpdate,
      findMany: chunkFindMany,
    },
  };

  const getReadStream = jest
    .fn()
    .mockResolvedValue(Readable.from([MINIMAL_PDF]));
  const exists = jest.fn().mockResolvedValue(true);
  const storageService = {
    getStorageProvider: () => ({ exists, getReadStream }),
  };

  const summaryMapReduce = {
    runMapReduce: jest.fn().mockResolvedValue(undefined),
  };

  const knowledgeExtract = {
    extractKnowledge: jest.fn().mockResolvedValue(undefined),
  };

  const mediaSemanticChapters = {
    enrichBookSummaryWithMediaChapters: jest.fn().mockResolvedValue(true),
  };

  const indexQueue = {
    removeDocumentIndexJob: jest.fn().mockResolvedValue(undefined),
  };

  const processor = new DocumentIndexProcessor(
    prisma as never,
    storageService as never,
    summaryMapReduce as never,
    knowledgeExtract as never,
    mediaSemanticChapters as never,
    indexQueue as never,
  );

  return {
    processor,
    prisma: {
      findFirst,
      jobUpdate,
      jobFindUnique,
      deleteMany,
      createMany,
      chunkFindMany,
      chunkUpdate,
      getReadStream,
    },
    summaryMapReduce,
    knowledgeExtract,
    mediaSemanticChapters,
  };
}

function createJob(data: DocumentIndexJobData): Job<DocumentIndexJobData> {
  return {
    name: DOCUMENT_INDEX_JOB_NAME,
    data,
  } as Job<DocumentIndexJobData>;
}

describe('DocumentIndexProcessor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const scanJobData: DocumentIndexJobData = {
    userFileId: 2218,
    userId: 42,
    mode: 'general',
    summaryGenre: 'novel',
  };

  it('无文字层 PDF 应经 OCR 后标记 ready', async () => {
    const { processor, prisma } = createProcessor();
    const ocrText =
      '--- Page 1 ---\n扫描 PDF OCR 正文内容足够长可以完成索引分块与向量化流程';
    prisma.findFirst.mockResolvedValue({
      fileName: 'scan.pdf',
      storage: {
        filePath: 'uploads/scan.pdf',
        mimeType: 'application/pdf',
        fileHash: 'pdf-hash',
      },
    });
    chunkTextMock.mockReturnValue([{ index: 0, content: ocrText }]);
    embedManyMock.mockResolvedValue([[1, 0, 0]]);
    mockChunkFindManyFullPath(prisma.chunkFindMany, [
      { chunkIndex: 0, chapterNo: null, content: ocrText },
    ]);

    await processor.process(createJob(scanJobData));

    const statuses = prisma.jobUpdate.mock.calls.map((c) => c[0].data.status);
    expect(statuses.at(-1)).toBe('ready');
    expect(chunkTextMock).toHaveBeenCalledWith(
      expect.stringContaining('扫描 PDF OCR'),
    );
  });

  async function runTxtIndex(
    summaryGenre: DocumentIndexJobData['summaryGenre'],
    mode: DocumentIndexJobData['mode'],
  ) {
    const ctx = createProcessor();
    const text =
      'This is a long enough document body for indexing and knowledge extraction.';
    ctx.prisma.findFirst.mockResolvedValue({
      fileName: 'doc.txt',
      storage: {
        filePath: 'uploads/doc.txt',
        mimeType: 'text/plain',
        fileHash: 'txt-hash',
      },
    });
    ctx.prisma.getReadStream.mockResolvedValue(
      Readable.from([Buffer.from(text)]),
    );
    chunkTextMock.mockReturnValue([{ index: 0, content: text }]);
    embedManyMock.mockResolvedValue([[1, 0, 0]]);
    mockChunkFindManyFullPath(ctx.prisma.chunkFindMany, [
      { chunkIndex: 0, chapterNo: null, content: text },
    ]);

    await ctx.processor.process(
      createJob({
        userFileId: 3001,
        userId: 7,
        mode,
        summaryGenre,
      }),
    );

    return ctx;
  }

  it('summaryGenre=paper 应调用 knowledgeExtract', async () => {
    const { knowledgeExtract, summaryMapReduce, prisma } = await runTxtIndex(
      'paper',
      'academic',
    );

    expect(summaryMapReduce.runMapReduce).toHaveBeenCalled();
    expect(knowledgeExtract.extractKnowledge).toHaveBeenCalledWith(
      3001,
      'paper',
    );

    const statuses = prisma.jobUpdate.mock.calls.map((c) => c[0].data.status);
    expect(statuses).toContain('extracting_knowledge');
    expect(statuses.at(-1)).toBe('ready');
  });

  it('summaryGenre=novel 不应调用 knowledgeExtract', async () => {
    const { knowledgeExtract } = await runTxtIndex('novel', 'general');

    expect(knowledgeExtract.extractKnowledge).not.toHaveBeenCalled();
  });

  it('O-01：已有文稿缺向量时应 skipAsr 并补 embedding', async () => {
    const { processor, prisma, summaryMapReduce } = createProcessor();
    const logSpy = jest.spyOn(
      (processor as unknown as { logger: { log: (m: string) => void } })
        .logger,
      'log',
    );
    prisma.findFirst.mockResolvedValue({
      fileName: 'clip.mp4',
      storage: {
        filePath: 'uploads/clip.mp4',
        mimeType: 'video/mp4',
        fileHash: 'vid-hash',
      },
    });
    prisma.jobFindUnique.mockResolvedValue({ chunkCount: 2 });
    const persisted = [
      {
        chunkIndex: 0,
        content: '第一句文稿',
        embedding: null,
        startMs: 0,
        endMs: 1000,
      },
      {
        chunkIndex: 1,
        content: '第二句文稿',
        embedding: null,
        startMs: 1000,
        endMs: 2000,
      },
    ];
    prisma.chunkFindMany
      .mockResolvedValueOnce(persisted) // resume
      .mockResolvedValueOnce(persisted) // embedding pending
      .mockResolvedValueOnce([
        { chunkIndex: 0, chapterNo: null, content: '第一句文稿' },
        { chunkIndex: 1, chapterNo: null, content: '第二句文稿' },
      ]);
    embedManyMock.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);

    await processor.process(
      createJob({
        userFileId: 2618,
        userId: 2,
        mode: 'general',
        summaryGenre: 'novel',
      }),
    );

    expect(extractAudioMock).not.toHaveBeenCalled();
    expect(prisma.deleteMany).not.toHaveBeenCalled();
    expect(prisma.createMany).not.toHaveBeenCalled();
    expect(embedManyMock).toHaveBeenCalledWith(['第一句文稿', '第二句文稿']);
    expect(summaryMapReduce.runMapReduce).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('resume from=embedding skipAsr=true'),
    );
    const statuses = prisma.jobUpdate.mock.calls.map((c) => c[0].data.status);
    expect(statuses.at(-1)).toBe('ready');
  });
});