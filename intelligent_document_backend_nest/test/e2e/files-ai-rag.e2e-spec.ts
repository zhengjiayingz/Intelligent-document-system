jest.mock('@/files/ai/index/provider/embedding.provider', () => ({
  embedOne: jest.fn().mockResolvedValue([1, 0]),
  embedMany: jest.fn().mockImplementation(async (texts: string[]) =>
    texts.map(() => [1, 0]),
  ),
}));

jest.mock('@/files/ai/index/service/document-index-queue.service', () => ({
  DocumentIndexQueueService: class MockDocumentIndexQueueService {
    async enqueueDocumentIndex() {
      return { id: 'mock-document-index-job' };
    }

    async removeDocumentIndexJob() {
      /* noop */
    }

    async onModuleDestroy() {
      /* noop */
    }
  },
}));

import request from 'supertest';
import { apiMessage } from '../helpers/api-response';
import { createE2eApp, E2eApp } from '../helpers/app-bootstrap';
import { loginAndGetTokens } from '../helpers/auth.helper';
import {
  getUserId,
  seedPdfFile,
  seedReadyDocumentIndex,
  seedTextFile,
} from '../helpers/files.helper';
import { MOCK_AI_STREAM_TEXT } from '../setup-e2e';

describe('Files AI RAG (e2e)', () => {
  let app: E2eApp;

  beforeEach(async () => {
    app = await createE2eApp();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('POST /api/files/:id/ai/rag-ask 无 Token 应返回 401', async () => {
    const res = await request(app.getHttpServer()).post(
      '/api/files/1/ai/rag-ask',
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/files/:id/ai/rag-ask 文件不存在应返回 404', async () => {
    const { accessToken } = await loginAndGetTokens(app);

    const res = await request(app.getHttpServer())
      .post('/api/files/999999999/ai/rag-ask')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ question: '这篇文档讲了什么？' });

    expect(res.status).toBe(404);
    const body = apiMessage(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/文件不存在/);
  });

  it('POST /api/files/:id/ai/rag-ask 未索引应返回 409', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'rag not indexed',
      `rag-no-index-${Date.now()}.txt`,
    );

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/rag-ask`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ question: '这篇文档讲了什么？' });

    expect(res.status).toBe(409);
    const body = apiMessage(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/请先建立索引/);
  });

  it('POST /api/files/:id/ai/rag-ask 缺 question 应返回 400 JSON', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'rag empty question',
      `rag-empty-q-${Date.now()}.txt`,
    );
    await seedReadyDocumentIndex(app, userFile.id, [
      { content: '测试片段', embedding: [1, 0] },
    ]);

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/rag-ask`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
    const body = apiMessage(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/问题不能为空/);
  });

  it('POST /api/files/:id/ai/rag-ask 索引 ready 后应返回 text/plain 流式响应', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const content = `rag stream ${Date.now()}`;
    const { userFile } = await seedTextFile(
      app,
      userId,
      content,
      `rag-stream-${Date.now()}.txt`,
    );
    await seedReadyDocumentIndex(app, userFile.id, [
      { content, embedding: [1, 0] },
      { content: '无关片段', embedding: [0, 1] },
    ]);

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/rag-ask`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ question: '总结这篇文档' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain(MOCK_AI_STREAM_TEXT);
  });

  it('POST /api/files/:id/ai/rag-ask PDF 索引 ready 后应返回 text/plain 流式响应', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const content = `pdf rag stream ${Date.now()}`;
    const { userFile } = await seedPdfFile(
      app,
      userId,
      undefined,
      `rag-pdf-${Date.now()}.pdf`,
    );
    await seedReadyDocumentIndex(app, userFile.id, [
      { content, embedding: [1, 0] },
      { content: '无关 PDF 片段', embedding: [0, 1] },
    ]);

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/rag-ask`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ question: '总结这篇 PDF' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain(MOCK_AI_STREAM_TEXT);
  });

  it('POST /api/files/:id/ai/rag-ask 对话历史格式无效应返回 400', async () => {
    const { accessToken, username } = await loginAndGetTokens(app);
    const userId = await getUserId(app, username);
    const { userFile } = await seedTextFile(
      app,
      userId,
      'rag bad messages',
      `rag-bad-msg-${Date.now()}.txt`,
    );
    await seedReadyDocumentIndex(app, userFile.id, [
      { content: '测试片段', embedding: [1, 0] },
    ]);

    const res = await request(app.getHttpServer())
      .post(`/api/files/${userFile.id}/ai/rag-ask`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        question: '这篇文档讲了什么？',
        messages: [{ role: 'system', content: 'invalid role' }],
      });

    expect(res.status).toBe(400);
    const body = apiMessage(res.body);
    expect(body.message).toMatch(/对话历史/);
  });
});
