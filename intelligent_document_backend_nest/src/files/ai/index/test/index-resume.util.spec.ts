import {
  assessIndexResume,
  hasChunkEmbedding,
  shouldKeepChunksForResume,
} from '@/files/ai/index/utils/index-resume.util';

describe('index-resume.util', () => {
  it('hasChunkEmbedding：非空数组为 true', () => {
    expect(hasChunkEmbedding([0.1, 0.2])).toBe(true);
    expect(hasChunkEmbedding([])).toBe(false);
    expect(hasChunkEmbedding(null)).toBe(false);
    expect(hasChunkEmbedding(undefined)).toBe(false);
  });

  it('无 chunks → null', () => {
    expect(assessIndexResume([])).toBeNull();
  });

  it('chunkIndex 不连续 → null', () => {
    expect(
      assessIndexResume([
        { chunkIndex: 0, content: 'a', embedding: null },
        { chunkIndex: 2, content: 'b', embedding: null },
      ]),
    ).toBeNull();
  });

  it('空 content → null', () => {
    expect(
      assessIndexResume([{ chunkIndex: 0, content: '  ', embedding: null }]),
    ).toBeNull();
  });

  it('expectedCount 与行数不一致 → null', () => {
    expect(
      assessIndexResume(
        [{ chunkIndex: 0, content: 'a', embedding: null }],
        2,
      ),
    ).toBeNull();
  });

  it('有文稿缺向量 → embedding', () => {
    expect(
      assessIndexResume([
        { chunkIndex: 0, content: 'hello', embedding: null },
        { chunkIndex: 1, content: 'world', embedding: [1] },
      ]),
    ).toBe('embedding');
  });

  it('文稿与向量齐全 → summarizing', () => {
    expect(
      assessIndexResume([
        { chunkIndex: 1, content: 'b', embedding: [0, 1] },
        { chunkIndex: 0, content: 'a', embedding: [1, 0] },
      ]),
    ).toBe('summarizing');
  });

  it('shouldKeepChunksForResume：ready+force 不保留', () => {
    expect(
      shouldKeepChunksForResume({
        force: true,
        existingStatus: 'ready',
        resumeFrom: 'embedding',
      }),
    ).toBe(false);
  });

  it('shouldKeepChunksForResume：failed+force 可保留', () => {
    expect(
      shouldKeepChunksForResume({
        force: true,
        existingStatus: 'failed',
        resumeFrom: 'embedding',
      }),
    ).toBe(true);
  });

  it('shouldKeepChunksForResume：卡住 embedding+force 可保留', () => {
    expect(
      shouldKeepChunksForResume({
        force: true,
        existingStatus: 'embedding',
        resumeFrom: 'embedding',
      }),
    ).toBe(true);
  });
});
