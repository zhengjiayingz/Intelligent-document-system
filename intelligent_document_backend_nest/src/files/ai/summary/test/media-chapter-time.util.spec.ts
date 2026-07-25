import {
  mapRatioChaptersToMediaChapters,
  MAX_CHAPTERS,
} from '@/files/ai/summary/utils/media-chapter-time.util';

describe('mapRatioChaptersToMediaChapters', () => {
  it('按比例映射毫秒并按 startRatio 排序编号', () => {
    const out = mapRatioChaptersToMediaChapters(
      [
        {
          title: '后段',
          summary: 'B',
          startRatio: 0.5,
          endRatio: 1,
        },
        {
          title: '前段',
          summary: 'A',
          startRatio: 0,
          endRatio: 0.5,
        },
      ],
      100_000,
    );
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('前段');
    expect(out[0].index).toBe(1);
    expect(out[0].startMs).toBe(0);
    expect(out[0].endMs).toBe(50_000);
    expect(out[1].title).toBe('后段');
    expect(out[1].startMs).toBe(50_000);
    expect(out[1].endMs).toBe(100_000);
  });

  it('endRatio <= startRatio 时自动拉开', () => {
    const out = mapRatioChaptersToMediaChapters(
      [{ title: 'x', summary: 'y', startRatio: 0.5, endRatio: 0.5 }],
      10_000,
    );
    expect(out[0].endRatio).toBeGreaterThan(out[0].startRatio);
    expect(out[0].endMs).toBeGreaterThan(out[0].startMs);
  });

  it('durationMs<=0 时时间为 0 仍保留章节', () => {
    const out = mapRatioChaptersToMediaChapters(
      [{ title: 'x', summary: 'y', startRatio: 0.2, endRatio: 0.4 }],
      0,
    );
    expect(out[0].startMs).toBe(0);
    expect(out[0].endMs).toBe(0);
    expect(out[0].title).toBe('x');
  });

  it(`最多保留 ${MAX_CHAPTERS} 段`, () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      title: `t${i}`,
      summary: `s${i}`,
      startRatio: i / 20,
      endRatio: (i + 1) / 20,
    }));
    expect(mapRatioChaptersToMediaChapters(many, 1000)).toHaveLength(
      MAX_CHAPTERS,
    );
  });
});
