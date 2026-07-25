jest.mock('@/files/ai/index/service/document-index-queue.service', () => ({
  DocumentIndexQueueService: class MockDocumentIndexQueueService {
    enqueueDocumentIndex() {
      return Promise.resolve({ id: 'mock-document-index-job' });
    }

    removeDocumentIndexJob() {
      return Promise.resolve();
    }

    async onModuleDestroy() {
      /* noop */
    }
  },
}));

import request from 'supertest';
import { PrismaService } from '@/prisma/prisma.service';
import { apiBody, apiMessage } from '../helpers/api-response';
import { createE2eApp, E2eApp } from '../helpers/app-bootstrap';
import { loginAndGetTokens } from '../helpers/auth.helper';
import {
  getUserId,
  seedBinaryFile,
  seedFolder,
  seedImageFile,
  seedPdfFile,
  seedReadyDocumentIndex,
  seedTextFile,
  seedWordFile,
} from '../helpers/files.helper';

const INDEX_BODY = { summaryGenre: 'novel' as const };

describe('Files AI Index (e2e)', () => {
  let app: E2eApp;

  beforeEach(async () => {
    app = await createE2eApp();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /api/files/:id/ai/index/status 无 Token 应返回 401', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/files/1/ai/index/status',
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/files/:id/ai/index/status 文件不存在应返回 404', async () => {
    const { accessToken } = await loginAndGetTokens(app);

    const res = await request(app.getHttpServer())
      .get('/api/files/999999999/ai/index/status')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    const msgBody = apiMessage(res.body);
    expect(msgBody.message).toMatch(/文件不存在/);
  });

  it('GET /api/files/:id/ai/index/status 无记录应返回 status=none', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'index status none',
      `index-none-${Date.now()}.txt`,
    );

    const res = await request(app.getHttpServer())
      .get(`/api/files/${userFile.id}/ai/index/status`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(apiBody(res.body)).toMatchObject({
      success: true,
      data: { status: 'none', chunkCount: 0 },
    });
  });

  it('GET /api/files/:id/ai/index/status ready 应返回 chunkCount 与 summaryGenre', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'index status ready',
      `index-ready-${Date.now()}.txt`,
    );
    await seedReadyDocumentIndex(app, userFile.id, [
      { content: 'chunk-a', embedding: [1, 0] },
      { content: 'chunk-b', embedding: [0.9, 0.1] },
    ]);

    const res = await request(app.getHttpServer())
      .get(`/api/files/${userFile.id}/ai/index/status`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(apiBody(res.body)).toMatchObject({
      data: {
        status: 'ready',
        chunkCount: 2,
        progress: 100,
        summaryGenre: 'novel',
      },
    });
  });

  it('POST /api/files/:id/ai/index 无 Token 应返回 401', async () => {
    const res = await request(app.getHttpServer()).post(
      '/api/files/1/ai/index',
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/files/:id/ai/index 文件不存在应返回 404', async () => {
    const { accessToken } = await loginAndGetTokens(app);

    const res = await request(app.getHttpServer())
      .post('/api/files/999999999/ai/index')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);

    expect(res.status).toBe(404);
  });

  it('POST /api/files/:id/ai/index 缺少 summaryGenre 应返回 400', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'index missing genre',
      `index-no-genre-${Date.now()}.txt`,
    );

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
    const msgBody = apiMessage(res.body);
    expect(msgBody.message).toMatch(/summaryGenre/);
  });

  it('POST /api/files/:id/ai/index 文件夹应返回 400', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const folder = await seedFolder(app, userId, `folder-${Date.now()}`);

    const res = await request(app.getHttpServer())
      .post(`/api/files/${folder.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);

    expect(res.status).toBe(400);
    const msgBody = apiMessage(res.body);
    expect(msgBody.message).toMatch(/文件夹不支持索引/);
  });

  it('POST /api/files/:id/ai/index 非可索引格式（如 exe）应返回 400', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedBinaryFile(
      app,
      userId,
      'fake-binary',
      `not-indexable-${Date.now()}.exe`,
      'application/octet-stream',
    );
    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);
    expect(res.status).toBe(400);
    const msgBody = apiMessage(res.body);
    expect(msgBody.message).toMatch(/仅支持/);
  });
  it('POST /api/files/:id/ai/index 图片首次触发应返回 pending', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedImageFile(
      app,
      userId,
      `index-img-${Date.now()}.png`,
    );
    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);
    expect(res.status).toBe(201);
    expect(apiBody(res.body)).toMatchObject({
      success: true,
      data: {
        status: 'pending',
        progress: 0,
        summaryGenre: 'novel',
      },
    });
  });

  it('POST /api/files/:id/ai/index PDF 扩展名与 MIME 不匹配应返回 400', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedBinaryFile(
      app,
      userId,
      '%PDF-1.4 mismatch',
      `mismatch-${Date.now()}.pdf`,
      'text/plain',
    );

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);

    expect(res.status).toBe(400);
    const msgBody = apiMessage(res.body);
    expect(msgBody.message).toMatch(/仅支持 UTF-8/);
  });

  it('POST /api/files/:id/ai/index docx 首次触发应返回 pending', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedWordFile(
      app,
      userId,
      undefined,
      `index-docx-${Date.now()}.docx`,
    );

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);

    expect(res.status).toBe(201);
    expect(apiBody(res.body)).toMatchObject({
      success: true,
      data: {
        status: 'pending',
        progress: 0,
        summaryGenre: 'novel',
      },
    });
  });

  it('POST /api/files/:id/ai/index PDF 首次触发应返回 pending', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedPdfFile(
      app,
      userId,
      undefined,
      `index-pdf-${Date.now()}.pdf`,
    );

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);

    expect(res.status).toBe(201);
    expect(apiBody(res.body)).toMatchObject({
      success: true,
      data: {
        status: 'pending',
        progress: 0,
        summaryGenre: 'novel',
      },
    });
  });

  it('POST /api/files/:id/ai/index 首次触发应返回 pending', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'index trigger first',
      `index-first-${Date.now()}.txt`,
    );

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);

    expect(res.status).toBe(201);
    expect(apiBody(res.body)).toMatchObject({
      success: true,
      data: {
        status: 'pending',
        progress: 0,
        summaryGenre: 'novel',
      },
    });
  });

  it('POST /api/files/:id/ai/index 进行中应返回 409', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'index pending conflict',
      `index-conflict-${Date.now()}.txt`,
    );
    const prisma = app.get(PrismaService);
    await prisma.documentIndexJob.create({
      data: {
        userFileId: userFile.id,
        mode: 'general',
        summaryGenre: 'novel',
        status: 'embedding',
        progress: 60,
        progressMsg: '正在生成向量',
        chunkCount: 3,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);

    expect(res.status).toBe(409);
    const msgBody = apiMessage(res.body);
    expect(msgBody.message).toMatch(/索引任务进行中/);
  });

  it('POST /api/files/:id/ai/index ready 且文档未更新应返回 409', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'index unchanged',
      `index-unchanged-${Date.now()}.txt`,
    );
    await seedReadyDocumentIndex(app, userFile.id, [
      { content: 'stable chunk', embedding: [1, 0] },
    ]);

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);

    expect(res.status).toBe(409);
    const msgBody = apiMessage(res.body);
    expect(msgBody.message).toMatch(/文档未更新/);
  });

  it('POST /api/files/:id/ai/index ready 且 force 应允许强制 reindex', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'index force reindex',
      `index-force-${Date.now()}.txt`,
    );
    await seedReadyDocumentIndex(app, userFile.id, [
      { content: 'stable chunk', embedding: [1, 0] },
    ]);
    const prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...INDEX_BODY, force: true });

    expect(res.status).toBe(201);
    expect(apiBody(res.body)).toMatchObject({
      data: { status: 'pending', summaryGenre: 'novel' },
    });

    const chunkCount = await prisma.documentChunk.count({
      where: { userFileId: userFile.id },
    });
    expect(chunkCount).toBe(0);
  });

  it('POST /api/files/:id/ai/index ready 且文档已更新应允许重新索引并清空旧 chunks', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'index reindex chunks',
      `index-reindex-${Date.now()}.txt`,
    );
    await seedReadyDocumentIndex(
      app,
      userFile.id,
      [{ content: 'old chunk', embedding: [1, 0] }],
      { indexedFileHash: 'stale-file-hash' },
    );
    const prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/index`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(INDEX_BODY);

    expect(res.status).toBe(201);
    expect(apiBody(res.body)).toMatchObject({
      data: { status: 'pending' },
    });

    const chunkCount = await prisma.documentChunk.count({
      where: { userFileId: userFile.id },
    });
    expect(chunkCount).toBe(0);
  });
});
