const EMBEDDING_BATCH_SIZE = 32;

function resolveEmbeddingApiKey(): string {
  const value =
    process.env.AI_EMBEDDING_API_KEY?.trim() || process.env.AI_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing environment variable: AI_API_KEY');
  }
  return value;
}

function getEmbeddingConfig(): {
  apiKey: string;
  baseURL: string;
  model: string;
} {
  const baseURL = (
    process.env.AI_EMBEDDING_BASE_URL?.trim() ||
    process.env.AI_BASE_URL?.trim() ||
    'https://api.deepseek.com'
  ).replace(/\/$/, '');
  return {
    apiKey: resolveEmbeddingApiKey(),
    baseURL,
    model: process.env.AI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
  };
}

type EmbeddingsResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string };
};

async function parseEmbeddingsResponse(
  res: Response,
): Promise<EmbeddingsResponse> {
  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error(
      `Embedding API 返回了空响应（HTTP ${res.status}）。DeepSeek 不支持 Embedding，请配置 AI_EMBEDDING_BASE_URL 为 OpenAI 兼容的 Embedding 服务`,
    );
  }
  try {
    return JSON.parse(raw) as EmbeddingsResponse;
  } catch {
    const preview = raw.slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(
      `Embedding API 返回了非 JSON 响应（HTTP ${res.status}）：${preview}`,
    );
  }
}

async function requestEmbeddings(input: string[]): Promise<number[][]> {
  const { apiKey, baseURL, model } = getEmbeddingConfig();

  const res = await fetch(`${baseURL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input }),
  });

  const json = await parseEmbeddingsResponse(res);

  if (!res.ok) {
    const detail =
      json.error?.message ||
      (typeof (json as { message?: unknown }).message === 'string'
        ? (json as { message: string }).message
        : '');
    throw new Error(
      detail
        ? `Embedding API failed: ${res.status} — ${detail}`
        : `Embedding API failed: ${res.status}`,
    );
  }

  const rows = json.data ?? [];
  if (rows.length !== input.length) {
    throw new Error('Embedding API 返回数量与输入不一致');
  }

  return rows
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((row) => {
      if (!Array.isArray(row.embedding) || row.embedding.length === 0) {
        throw new Error('Embedding API 返回了空向量');
      }
      return row.embedding;
    });
}

/** 单条文本 → 向量（用户提问时用） */
export async function embedOne(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Embedding 输入不能为空');
  }
  const [embedding] = await requestEmbeddings([trimmed]);
  return embedding;
}

/** 批量文本 → 向量（索引切块时用，每批最多 32 条） */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const normalized = texts.map((t) => t.trim());
  if (normalized.some((t) => !t)) {
    throw new Error('Embedding 输入不能为空');
  }

  const results: number[][] = [];
  for (let i = 0; i < normalized.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = normalized.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchEmbeddings = await requestEmbeddings(batch);
    results.push(...batchEmbeddings);
  }

  return results;
}
