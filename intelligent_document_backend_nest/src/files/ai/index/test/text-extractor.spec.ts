import { Readable } from 'node:stream';
import archiver from 'archiver';
import type { StorageProvider } from '@/storage/types';
import { extractTextFromImage } from '@/files/ai/index/provider/vision.provider';

jest.mock('@/files/ai/index/utils/pdf-text.util', () => ({
  extractPdfTextWithPdfJs: jest.fn().mockResolvedValue(''),
}));

jest.mock('@/files/ai/index/utils/pdf-ocr.util', () => ({
  extractScannedPdfText: jest.fn(),
  PdfOcrPageLimitError: class PdfOcrPageLimitError extends Error {
    constructor(message?: string) {
      super(message ?? 'PDF 页数超过 OCR 上限');
      this.name = 'PdfOcrPageLimitError';
    }
  },
}));

jest.mock('@/files/ai/index/provider/vision.provider', () => ({
  extractTextFromImage: jest.fn().mockResolvedValue('OCR hello world'),
}));

import {
  EmptyDocxError,
  ScannedPdfError,
  UnsupportedDocumentFormatError,
  extractTextFromBuffer,
  extractTextFromStorage,
  extractTextFromStream,
  isIndexableAudio,
  isIndexableTextDocument,
  isIndexableVideo,
  softInsertEnglishSpaces,
} from '@/files/ai/index/service/text-extractor';
import { extractPdfTextWithPdfJs } from '@/files/ai/index/utils/pdf-text.util';
import { extractScannedPdfText } from '@/files/ai/index/utils/pdf-ocr.util';

const mockedExtractPdfTextWithPdfJs =
  extractPdfTextWithPdfJs as jest.MockedFunction<
    typeof extractPdfTextWithPdfJs
  >;

const mockedExtractScannedPdfText =
  extractScannedPdfText as jest.MockedFunction<typeof extractScannedPdfText>;

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
  'utf-8',
);

const mockedExtractTextFromImage = extractTextFromImage as jest.MockedFunction<
  typeof extractTextFromImage
>;

function buildMinimalDocx(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip');
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`;
    archive.append(xml, { name: 'word/document.xml' });
    void archive.finalize();
  });
}

/** 构造最小 mock，只实现 text-extractor 用到的 3 个方法 */
function createMockStorage(
  overrides: {
    exists?: jest.Mock;
    getReadStream?: jest.Mock;
  } = {},
) {
  const existsMock = overrides.exists ?? jest.fn().mockResolvedValue(true);
  const getReadStreamMock =
    overrides.getReadStream ??
    jest.fn().mockResolvedValue(Readable.from(['hello']));

  const storage: StorageProvider = {
    driver: 'local',
    putFromLocalFile: jest.fn(),
    exists: existsMock,
    getReadStream: getReadStreamMock,
    delete: jest.fn(),
  };

  return { storage, existsMock, getReadStreamMock };
}

describe('text-extractor', () => {
  beforeEach(() => {
    mockedExtractPdfTextWithPdfJs.mockReset();
    mockedExtractPdfTextWithPdfJs.mockResolvedValue('');
    mockedExtractScannedPdfText.mockReset();
    mockedExtractScannedPdfText.mockResolvedValue(
      '--- Page 1 ---\n扫描件 OCR 正文内容足够长用于通过长度校验',
    );
    mockedExtractTextFromImage.mockReset();
    mockedExtractTextFromImage.mockResolvedValue('OCR hello world');
  });

  describe('softInsertEnglishSpaces', () => {
    it('应在驼峰与标点后补空格', () => {
      const out = softInsertEnglishSpaces('saidHarry."Nearly,"saidRon');
      expect(out).toContain('said Harry');
      expect(out).toContain('said Ron');
      expect(out).toMatch(/Nearly/);
      expect(out).not.toContain('saidHarry');
      expect(out).not.toContain('saidRon');
    });
  });

  describe('isIndexableTextDocument', () => {
    it('允许 .txt + text/plain', () => {
      expect(
        isIndexableTextDocument({
          fileName: 'notes.txt',
          mimeType: 'text/plain',
        }),
      ).toBe(true);
    });

    it('允许 .md + text/markdown', () => {
      expect(
        isIndexableTextDocument({
          fileName: 'readme.md',
          mimeType: 'text/markdown',
        }),
      ).toBe(true);
    });

    it('允许 .txt + application/octet-stream（常见上传类型）', () => {
      expect(
        isIndexableTextDocument({
          fileName: 'raw.txt',
          mimeType: 'application/octet-stream',
        }),
      ).toBe(true);
    });

    it('扩展名与 MIME 不匹配时应拒绝', () => {
      expect(
        isIndexableTextDocument({
          fileName: 'notes.txt',
          mimeType: 'image/png',
        }),
      ).toBe(false);

      expect(
        isIndexableTextDocument({
          fileName: 'paper.pdf',
          mimeType: 'text/plain',
        }),
      ).toBe(false);
    });

    it('mime 为空时应拒绝', () => {
      expect(
        isIndexableTextDocument({
          fileName: 'notes.txt',
          mimeType: null,
        }),
      ).toBe(false);
    });

    it('允许 .pdf + application/pdf', () => {
      expect(
        isIndexableTextDocument({
          fileName: 'paper.pdf',
          mimeType: 'application/pdf',
        }),
      ).toBe(true);
    });

    it('允许 .docx + wordprocessingml MIME', () => {
      expect(
        isIndexableTextDocument({
          fileName: 'report.docx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ).toBe(true);
    });

    it('允许 .png / .jpg / .webp / .gif + 对应 image MIME', () => {
      expect(
        isIndexableTextDocument({
          fileName: 'slide.png',
          mimeType: 'image/png',
        }),
      ).toBe(true);
      expect(
        isIndexableTextDocument({
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
        }),
      ).toBe(true);
      expect(
        isIndexableTextDocument({
          fileName: 'shot.webp',
          mimeType: 'image/webp',
        }),
      ).toBe(true);
      expect(
        isIndexableTextDocument({
          fileName: 'anim.gif',
          mimeType: 'image/gif',
        }),
      ).toBe(true);
    });

    it('图片扩展名与 MIME 不匹配时应拒绝', () => {
      expect(
        isIndexableTextDocument({
          fileName: 'a.png',
          mimeType: 'text/plain',
        }),
      ).toBe(false);
    });
  });

  describe('extractTextFromBuffer', () => {
    it('应解码 UTF-8 文本', async () => {
      const text = await extractTextFromBuffer(
        Buffer.from('你好\nworld', 'utf8'),
        {
          fileName: 'a.txt',
          mimeType: 'text/plain',
        },
      );
      expect(text).toBe('你好\nworld');
    });

    it('应解码 GB18030/GBK 文本（与分块预览一致）', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const iconv = require('iconv-lite') as typeof import('iconv-lite');
      const buf = iconv.encode('你好\nHarry Potter', 'gb18030');
      const text = await extractTextFromBuffer(buf, {
        fileName: 'a.txt',
        mimeType: 'text/plain',
      });
      expect(text).toBe('你好\nHarry Potter');
    });

    it('格式不支持时应抛 UnsupportedDocumentFormatError', async () => {
      await expect(
        extractTextFromBuffer(Buffer.from('x'), {
          fileName: 'a.mp4',
          mimeType: 'video/mp4',
        }),
      ).rejects.toThrow(UnsupportedDocumentFormatError);
    });

    it('图片应走 OCR 并返回文本', async () => {
      const text = await extractTextFromBuffer(Buffer.from('fake-png'), {
        fileName: 'a.png',
        mimeType: 'image/png',
      });
      expect(text).toBe('OCR hello world');
      expect(mockedExtractTextFromImage).toHaveBeenCalledWith(
        Buffer.from('fake-png'),
        'image/png',
      );
    });

    it('OCR 空白结果应抛错', async () => {
      mockedExtractTextFromImage.mockResolvedValue('   ');
      await expect(
        extractTextFromBuffer(Buffer.from('x'), {
          fileName: 'blank.png',
          mimeType: 'image/png',
        }),
      ).rejects.toThrow(/未识别到可用文字/);
    });

    it('无法识别的乱码应抛 UnsupportedDocumentFormatError', async () => {
      await expect(
        extractTextFromBuffer(Buffer.from([0xff, 0xfe, 0xfd]), {
          fileName: 'a.txt',
          mimeType: 'text/plain',
        }),
      ).rejects.toThrow(UnsupportedDocumentFormatError);
    });

    it('无文字层 PDF 应 fallback 扫描 OCR', async () => {
      const text = await extractTextFromBuffer(MINIMAL_PDF, {
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      });
      expect(text).toContain('--- Page 1 ---');
      expect(text).toContain('扫描件 OCR');
      expect(mockedExtractScannedPdfText).toHaveBeenCalled();
    });

    it('PDF 坐标抽取有字时应返回带空格文本且不 OCR', async () => {
      mockedExtractPdfTextWithPdfJs.mockResolvedValue(
        'Harry Potter and the Philosophers Stone',
      );
      const text = await extractTextFromBuffer(MINIMAL_PDF, {
        fileName: 'lecture.pdf',
        mimeType: 'application/pdf',
      });
      expect(text).toContain('Harry Potter');
      expect(text).toContain(' ');
      expect(mockedExtractPdfTextWithPdfJs).toHaveBeenCalled();
      expect(mockedExtractScannedPdfText).not.toHaveBeenCalled();
    });

    it('PDF 文字层抽取抛错时应 fallback OCR', async () => {
      mockedExtractPdfTextWithPdfJs.mockRejectedValue(new Error('broken'));
      const text = await extractTextFromBuffer(MINIMAL_PDF, {
        fileName: 'bad.pdf',
        mimeType: 'application/pdf',
      });
      expect(text).toContain('扫描件 OCR');
      expect(mockedExtractScannedPdfText).toHaveBeenCalled();
    });

    it('扫描 OCR 仍失败时应抛 ScannedPdfError', async () => {
      mockedExtractScannedPdfText.mockRejectedValue(
        new Error('OCR 未识别到可用文字'),
      );
      await expect(
        extractTextFromBuffer(MINIMAL_PDF, {
          fileName: 'blank-scan.pdf',
          mimeType: 'application/pdf',
        }),
      ).rejects.toThrow(ScannedPdfError);
    });

    it('应解析 docx 正文', async () => {
      const buf = await buildMinimalDocx(
        'This Word document has enough characters for the indexer.',
      );
      const text = await extractTextFromBuffer(buf, {
        fileName: 'notes.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      expect(text).toContain('Word document');
    });

    it('过短 docx 应抛 EmptyDocxError', async () => {
      const buf = await buildMinimalDocx('tiny');
      await expect(
        extractTextFromBuffer(buf, {
          fileName: 'empty.docx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ).rejects.toThrow(EmptyDocxError);
    });
  });

  describe('extractTextFromStream', () => {
    it('应从 stream 拼接并解码文本', async () => {
      const stream = Readable.from(['# Title\n', 'content']);
      const text = await extractTextFromStream(stream, {
        fileName: 'a.md',
        mimeType: 'text/markdown',
      });
      expect(text).toBe('# Title\ncontent');
    });
  });

  describe('extractTextFromStorage', () => {
    it('应通过 StorageProvider 读取文件', async () => {
      const { storage, existsMock, getReadStreamMock } = createMockStorage({
        getReadStream: jest
          .fn()
          .mockResolvedValue(Readable.from(['line1\n', 'line2'])),
      });

      const text = await extractTextFromStorage(storage, {
        storedPath: 'uploads/readme.md',
        fileName: 'readme.md',
        mimeType: 'text/markdown',
      });

      expect(text).toBe('line1\nline2');
      expect(existsMock).toHaveBeenCalledWith('uploads/readme.md');
      expect(getReadStreamMock).toHaveBeenCalledWith('uploads/readme.md');
    });

    it('文件不存在时应抛错', async () => {
      const { storage, getReadStreamMock } = createMockStorage({
        exists: jest.fn().mockResolvedValue(false),
      });

      await expect(
        extractTextFromStorage(storage, {
          storedPath: 'uploads/missing.txt',
          fileName: 'missing.txt',
          mimeType: 'text/plain',
        }),
      ).rejects.toThrow('文件不存在或已被删除');

      expect(getReadStreamMock).not.toHaveBeenCalled();
    });

    it('格式不支持时不应读 storage', async () => {
      const { storage, existsMock } = createMockStorage();

      await expect(
        extractTextFromStorage(storage, {
          storedPath: 'uploads/a.mp4',
          fileName: 'a.mp4',
          mimeType: 'video/mp4',
        }),
      ).rejects.toThrow(UnsupportedDocumentFormatError);

      expect(existsMock).not.toHaveBeenCalled();
    });

    it('图片应通过 StorageProvider 读取并 OCR', async () => {
      const { storage, existsMock, getReadStreamMock } = createMockStorage({
        getReadStream: jest
          .fn()
          .mockResolvedValue(Readable.from([Buffer.from('img')])),
      });

      const text = await extractTextFromStorage(storage, {
        storedPath: 'uploads/a.png',
        fileName: 'a.png',
        mimeType: 'image/png',
      });

      expect(text).toBe('OCR hello world');
      expect(existsMock).toHaveBeenCalledWith('uploads/a.png');
      expect(getReadStreamMock).toHaveBeenCalledWith('uploads/a.png');
      expect(mockedExtractTextFromImage).toHaveBeenCalled();
    });

    it('扫描 PDF 应通过 StorageProvider 读取并 OCR', async () => {
      const { storage, existsMock, getReadStreamMock } = createMockStorage({
        getReadStream: jest
          .fn()
          .mockResolvedValue(Readable.from([MINIMAL_PDF])),
      });

      const text = await extractTextFromStorage(storage, {
        storedPath: 'uploads/scan.pdf',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      });

      expect(text).toContain('扫描件 OCR');
      expect(existsMock).toHaveBeenCalledWith('uploads/scan.pdf');
      expect(getReadStreamMock).toHaveBeenCalledWith('uploads/scan.pdf');
      expect(mockedExtractScannedPdfText).toHaveBeenCalled();
    });
  });
});

describe('isIndexableAudio', () => {
  it('接受 mp3 + audio/mpeg', () => {
    expect(
      isIndexableAudio({ fileName: 'a.mp3', mimeType: 'audio/mpeg' }),
    ).toBe(true);
  });
  it('拒绝 pdf', () => {
    expect(
      isIndexableAudio({ fileName: 'a.pdf', mimeType: 'application/pdf' }),
    ).toBe(false);
  });
});

describe('isIndexableVideo', () => {
  it('接受 mp4 + video/mp4', () => {
    expect(
      isIndexableVideo({ fileName: 'a.mp4', mimeType: 'video/mp4' }),
    ).toBe(true);
  });
  it('拒绝纯音频扩展名', () => {
    expect(
      isIndexableVideo({ fileName: 'a.mp3', mimeType: 'audio/mpeg' }),
    ).toBe(false);
  });
});
