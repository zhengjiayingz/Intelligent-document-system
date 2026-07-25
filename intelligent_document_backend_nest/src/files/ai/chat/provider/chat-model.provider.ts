import { createOpenAI } from '@ai-sdk/openai';

function requireAiApiKey(): string {
  const value = process.env.AI_API_KEY?.trim();
  if (!value) {
    throw new Error('Missing environment variable: AI_API_KEY');
  }
  return value;
}

export function getChatModel() {
  const client = createOpenAI({
    apiKey: requireAiApiKey(),
    baseURL: process.env.AI_BASE_URL?.trim() || 'https://api.deepseek.com',
  });
  // 2026-07-24 起 deepseek-chat / deepseek-reasoner 已下线，须用 v4 显式模型名
  return client.chat(
    process.env.AI_MODEL?.trim() || 'deepseek-v4-flash',
  );
}
