import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  calculateFileHash,
  concatenateFilesWithMd5,
} from '@/files/utils/file.utils';

describe('file.utils streaming hash / merge', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-utils-o11-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('calculateFileHash 与整文件 Buffer MD5 一致（多兆）', () => {
    const filePath = path.join(tmpDir, 'big.bin');
    const data = Buffer.alloc(3 * 1024 * 1024 + 17, 0x5a);
    fs.writeFileSync(filePath, data);
    const expected = crypto.createHash('md5').update(data).digest('hex');
    expect(calculateFileHash(filePath)).toBe(expected);
  });

  it('concatenateFilesWithMd5 拼接结果与哈希正确', async () => {
    const a = path.join(tmpDir, 'a.bin');
    const b = path.join(tmpDir, 'b.bin');
    const dest = path.join(tmpDir, 'out.bin');
    const partA = Buffer.from('hello-');
    const partB = Buffer.from('world');
    fs.writeFileSync(a, partA);
    fs.writeFileSync(b, partB);

    const md5 = await concatenateFilesWithMd5([a, b], dest);
    const merged = fs.readFileSync(dest);
    expect(merged.equals(Buffer.concat([partA, partB]))).toBe(true);
    expect(md5).toBe(crypto.createHash('md5').update(merged).digest('hex'));
    expect(calculateFileHash(dest)).toBe(md5);
  });

  it('concatenateFilesWithMd5 单文件等价于复制+hash', async () => {
    const src = path.join(tmpDir, 'one.bin');
    const dest = path.join(tmpDir, 'copy.bin');
    const data = Buffer.from('single-chunk-payload');
    fs.writeFileSync(src, data);
    const md5 = await concatenateFilesWithMd5([src], dest);
    expect(fs.readFileSync(dest).equals(data)).toBe(true);
    expect(md5).toBe(crypto.createHash('md5').update(data).digest('hex'));
  });
});
