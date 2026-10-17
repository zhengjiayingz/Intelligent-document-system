import { generateStructuredObject } from '@/files/ai/chat/utils/structured-object.util';
import { SummaryMapReduceService } from '@/files/ai/summary/service/summary-map-reduce.service';

jest.mock('@/files/ai/chat/utils/structured-object.util', () => ({
  generateStructuredObject: jest.fn(),
}));

const generateStructuredObjectMock =
  generateStructuredObject as jest.MockedFunction<
    typeof generateStructuredObject
  >;

describe('SummaryMapReduceService', () => {
  const upsert = jest.fn();
  const findMany = jest.fn();
  const prisma = {
    documentSummary: { upsert, findMany },
  } as never;

  const service = new SummaryMapReduceService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
    let call = 0;
    generateStructuredObjectMock.mockImplementation(() => {
      call += 1;
      // 前 3 次 chunk，第 4 次 book
      if (call <= 3) {
        return Promise.resolve({
          summary: `chunk-${call}`,
          keyPoints: [],
        });
      }
      return Promise.resolve({
        oneLiner: '全书一句话',
        overview: '全书概览',
        plotPoints: ['A', 'B'],
        characters: [{ name: '主角', role: '主人公' }],
      });
    });
  });

  it('3 个 chunk → 3 条 chunk + 1 条 book（跳过 chapter）', async () => {
    const chunks = [
      { chunkIndex: 0, chapterNo: null, content: '第一段' },
      { chunkIndex: 1, chapterNo: null, content: '第二段' },
      { chunkIndex: 2, chapterNo: null, content: '第三段' },
    ];

    await service.runMapReduce(1, 'novel', chunks);

    expect(generateStructuredObjectMock).toHaveBeenCalledTimes(4); // 3 map + 1 book
    expect(upsert).toHaveBeenCalledTimes(4);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userFileId_type_refKey: {
            userFileId: 1,
            type: 'chunk',
            refKey: 'chunk:0',
          },
        },
      }),
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userFileId_type_refKey: {
            userFileId: 1,
            type: 'book',
            refKey: 'book',
          },
        },
      }),
    );
  });

  it('已有 chunk 摘要时跳过 LLM Map，只跑 book Reduce', async () => {
    findMany.mockResolvedValue([
      {
        refKey: 'chunk:0',
        payload: { summary: 'cached-0', keyPoints: [] },
      },
      {
        refKey: 'chunk:1',
        payload: { summary: 'cached-1', keyPoints: [] },
      },
      {
        refKey: 'chunk:2',
        payload: { summary: 'cached-2', keyPoints: [] },
      },
    ]);
    generateStructuredObjectMock.mockResolvedValue({
      oneLiner: '全书一句话',
      overview: '全书概览',
      plotPoints: ['A'],
      characters: [],
    });

    const chunks = [
      { chunkIndex: 0, chapterNo: null, content: '第一段' },
      { chunkIndex: 1, chapterNo: null, content: '第二段' },
      { chunkIndex: 2, chapterNo: null, content: '第三段' },
    ];

    await service.runMapReduce(1, 'novel', chunks);

    expect(generateStructuredObjectMock).toHaveBeenCalledTimes(1); // 仅 book
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userFileId_type_refKey: {
            userFileId: 1,
            type: 'book',
            refKey: 'book',
          },
        },
      }),
    );
  });

  it('长文无 chapterNo → 按批 chapter Reduce 再 book', async () => {
    const chunks = Array.from({ length: 4 }, (_, i) => ({
      chunkIndex: i,
      chapterNo: null as number | null,
      content: `段${i}`,
    }));

    // 强制小批次：4 chunk / batchSize=2 → 2 次 chapter + 1 book；Map 4 次
    const prev = process.env.AI_SUMMARY_BATCH_SIZE;
    process.env.AI_SUMMARY_BATCH_SIZE = '2';
    try {
      let call = 0;
      generateStructuredObjectMock.mockImplementation(() => {
        call += 1;
        if (call <= 4) {
          return Promise.resolve({ summary: `chunk-${call}`, keyPoints: [] });
        }
        if (call <= 6) {
          return Promise.resolve({
            summary: `chapter-${call}`,
            keyPoints: [],
          });
        }
        return Promise.resolve({
          oneLiner: '全书',
          overview: '概览',
          plotPoints: [],
          characters: [],
        });
      });

      await service.runMapReduce(1, 'novel', chunks);

      // 4 map + 2 batch-chapter + 1 book
      expect(generateStructuredObjectMock).toHaveBeenCalledTimes(7);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userFileId_type_refKey: {
              userFileId: 1,
              type: 'chapter',
              refKey: 'chapter:1',
            },
          },
        }),
      );
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userFileId_type_refKey: {
              userFileId: 1,
              type: 'chapter',
              refKey: 'chapter:2',
            },
          },
        }),
      );
    } finally {
      if (prev == null) {
        delete process.env.AI_SUMMARY_BATCH_SIZE;
      } else {
        process.env.AI_SUMMARY_BATCH_SIZE = prev;
      }
    }
  });

  it('onProgress 上报 chunk / book 进度', async () => {
    const onProgress = jest.fn();
    const chunks = [
      { chunkIndex: 0, chapterNo: null, content: '第一段' },
      { chunkIndex: 1, chapterNo: null, content: '第二段' },
      { chunkIndex: 2, chapterNo: null, content: '第三段' },
    ];

    await service.runMapReduce(1, 'novel', chunks, onProgress);

    expect(onProgress).toHaveBeenCalledWith({
      phase: 'chunk',
      done: 1,
      total: 3,
    });
    expect(onProgress).toHaveBeenCalledWith({
      phase: 'chunk',
      done: 3,
      total: 3,
    });
    expect(onProgress).toHaveBeenCalledWith({
      phase: 'book',
      done: 1,
      total: 1,
    });
  });
});
