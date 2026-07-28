import OpenAI from 'openai';
import { getEnv } from '../env';

export function createOpenAIClient(): OpenAI {
  const key = getEnv('OPENAI_API_KEY');
  if (!key) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  return new OpenAI({ apiKey: key });
}

export function defaultOpenAiModel(): string {
  return getEnv('OPENAI_MODEL') ?? 'gpt-4o-mini';
}
