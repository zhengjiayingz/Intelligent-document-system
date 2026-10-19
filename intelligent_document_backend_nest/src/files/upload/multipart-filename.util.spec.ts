import { decodeMultipartFilename } from './multipart-filename.util';

describe('decodeMultipartFilename', () => {
  it('restores UTF-8 names that multer read as latin1', () => {
    const garbled = Buffer.from('密室笔记.txt', 'utf8').toString('latin1');
    expect(garbled).not.toBe('密室笔记.txt');
    expect(decodeMultipartFilename(garbled)).toBe('密室笔记.txt');
  });

  it('keeps an already-correct Unicode name', () => {
    expect(decodeMultipartFilename('密室笔记.txt')).toBe('密室笔记.txt');
  });

  it('keeps ASCII names', () => {
    expect(decodeMultipartFilename('notes.txt')).toBe('notes.txt');
  });
});
