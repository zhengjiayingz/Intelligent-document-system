import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  normalizeAsrSegments,
  transcribeFile,
} from '@/files/ai/index/provider/asr.provider';

type FetchMock = jest.MockedFunction<typeof fetch>;

describe('asr.provider', () => {
  const originalFetch = global.fetch;
  let fetchMock: FetchMock;
  let tmpFile: string;

  beforeEach(async () => {
    process.env.AI_ASR_BASE_URL = 'https://api.example.com/v1';
    process.env.AI_ASR_API_KEY = 'test-asr-key';
    process.env.AI_ASR_MODEL = 'FunAudioLLM/SenseVoiceSmall';
    fetchMock = jest.fn() as FetchMock;
    global.fetch = fetchMock;

    const dir = await mkdtemp(join(tmpdir(), 'asr-'));
    tmpFile = join(dir, 'sample.wav');
    await writeFile(tmpFile, Buffer.from('fake-wav'));
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
    try {
      await unlink(tmpFile);
    } catch {
      /* ignore */
    }
  });

  it('normalizeAsrSegments 把秒转成毫秒', () => {
    const segs = normalizeAsrSegments(
      [
        { text: '你好', start: 0.5, end: 1.2 },
        { text: '世界', start: 1.2, end: 2.0 },
      ],
      '',
    );
    expect(segs).toEqual([
      { text: '你好', startMs: 500, endMs: 1200 },
      { text: '世界', startMs: 1200, endMs: 2000 },
    ]);
  });

  it('normalizeAsrSegments 忽略非字符串 text，避免 [object Object]', () => {
    const segs = normalizeAsrSegments(
      [
        { text: { nested: true }, start: 0, end: 1 },
        { transcript: '可用', start: 1, end: 2 },
      ],
      '',
    );
    expect(segs).toEqual([{ text: '可用', startMs: 1000, endMs: 2000 }]);
  });

  it('成功时返回 text + segments', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            text: '你好世界',
            segments: [
              { text: '你好', start: 0, end: 0.6 },
              { text: '世界', start: 0.6, end: 1.2 },
            ],
          }),
        ),
    } as Response);

    const out = await transcribeFile(tmpFile);
    expect(out.text).toBe('你好世界');
    expect(out.segments).toHaveLength(2);
    expect(out.durationMs).toBe(0);
    expect(out.segments[0]).toEqual({
      text: '你好',
      startMs: 0,
      endMs: 600,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.com/v1/audio/transcriptions');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer test-asr-key');
  });

  it('HTTP 失败时抛错', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () =>
        Promise.resolve(JSON.stringify({ error: { message: 'bad key' } })),
    } as Response);

    await expect(transcribeFile(tmpFile)).rejects.toThrow(/bad key/);
  });
});
