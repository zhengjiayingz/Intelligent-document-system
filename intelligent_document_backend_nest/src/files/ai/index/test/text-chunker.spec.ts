import { chunkText } from '@/files/ai/index/service/text-chunker';

describe('text-chunker', () => {
  it('空文本应返回空数组', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('短于 chunkSize 的文本应只有 1 块', () => {
    const text = 'a'.repeat(500);
    const chunks = chunkText(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ index: 0, content: text });
  });

  it('2000 字文本应切成 3 块（800 / overlap 100）', () => {
    const text = 'x'.repeat(2000);
    const chunks = chunkText(text, { chunkSize: 800, overlap: 100 });

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.content).toHaveLength(800);
    expect(chunks[1]?.content).toHaveLength(800);
    expect(chunks[2]?.content).toHaveLength(600);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('相邻块应有 overlap 重叠', () => {
    const text = Array.from({ length: 2000 }, (_, i) => String(i % 10)).join(
      '',
    );
    const chunks = chunkText(text, { chunkSize: 800, overlap: 100 });

    const tailOfFirst = chunks[0]?.content.slice(-100);
    const headOfSecond = chunks[1]?.content.slice(0, 100);
    expect(tailOfFirst).toBe(headOfSecond);
  });

  it('超出 maxChunks 时应截断并 warn', () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const text = 'y'.repeat(5000);
    const chunks = chunkText(text, {
      chunkSize: 800,
      overlap: 100,
      maxChunks: 2,
    });

    expect(chunks).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[text-chunker]'),
    );

    warnSpy.mockRestore();
  });

  it('非法参数应抛错', () => {
    expect(() => chunkText('abc', { chunkSize: 0 })).toThrow(
      'chunkSize 必须大于 0',
    );
    expect(() => chunkText('abc', { chunkSize: 100, overlap: 100 })).toThrow(
      'overlap 必须满足 0 <= overlap < chunkSize',
    );
  });

  it('含 emoji 时不应在码点中间切开（避免 Prisma hex escape 错误）', () => {
    // 😀 = 1 code point, 2 UTF-16 code units
    const emoji = '😀';
    const text = emoji.repeat(10);
    const chunks = chunkText(text, { chunkSize: 3, overlap: 1 });
    for (const c of chunks) {
      // 每块应为完整码点拼接，不应含孤立代理
      expect(() => JSON.stringify(c.content)).not.toThrow();
      for (const ch of c.content) {
        const cp = ch.codePointAt(0)!;
        expect(cp < 0xd800 || cp > 0xdfff).toBe(true);
      }
    }
    expect(chunks[0]?.content).toBe(emoji.repeat(3));
  });
});
