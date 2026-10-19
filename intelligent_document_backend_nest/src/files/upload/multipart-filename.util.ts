/**
 * Busboy/Multer 默认把 multipart 文件名按 latin1 解读。
 * 浏览器实际发的是 UTF-8，中文会变成「笔记」→「ç¬”è®°」这类乱码。
 * 已是 Unicode（码点 > 0xFF）则原样返回，避免二次解码。
 */
export function decodeMultipartFilename(name: string): string {
  if (!name) return name;
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 0xff) return name;
  }
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  if (decoded.includes('\uFFFD')) return name;
  return decoded;
}

export function applyDecodedOriginalName(file: {
  originalname?: string;
}): void {
  if (!file.originalname) return;
  file.originalname = decodeMultipartFilename(file.originalname);
}
