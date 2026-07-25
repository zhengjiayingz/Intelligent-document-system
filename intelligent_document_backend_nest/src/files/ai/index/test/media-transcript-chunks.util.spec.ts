import { buildMediaIndexChunks } from '@/files/ai/index/utils/media-transcript-chunks.util';

describe('buildMediaIndexChunks', () => {
  it('keeps short segments as-is', () => {
    const chunks = buildMediaIndexChunks({
      segments: [{ text: '你好', startMs: 0, endMs: 1000 }],
      fullText: '你好',
      durationMs: 1000,
    });
    expect(chunks).toEqual([
      { index: 0, content: '你好', startMs: 0, endMs: 1000 },
    ]);
  });

  it('splits one oversized SenseVoice blob into multiple embeddable chunks', () => {
    const text = '测'.repeat(2500);
    const chunks = buildMediaIndexChunks({
      segments: [{ text, startMs: 0, endMs: 60_000 }],
      fullText: text,
      durationMs: 60_000,
      maxCharsPerChunk: 800,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 800)).toBe(true);
    expect(chunks[0]?.startMs).toBe(0);
    expect(chunks[chunks.length - 1]?.endMs).toBe(60_000);
  });

  it('falls back to fullText when segments empty', () => {
    const text = '甲'.repeat(900);
    const chunks = buildMediaIndexChunks({
      segments: [],
      fullText: text,
      durationMs: 10_000,
      maxCharsPerChunk: 800,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startMs).toBe(0);
  });
});
