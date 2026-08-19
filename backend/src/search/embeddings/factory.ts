import { getEnv } from '../../env';
import type { EmbeddingPort } from './EmbeddingPort';
import { LocalEmbeddingProvider } from './LocalEmbeddingProvider';
import { OpenAIEmbeddingProvider } from './OpenAIEmbeddingProvider';

/**
 * EMBEDDING_PROVIDER=local | openai
 * Default: local (no paid API required for development).
 */
export function createEmbeddingPort(provider?: string): EmbeddingPort {
  const kind = (provider ?? getEnv('EMBEDDING_PROVIDER') ?? 'local').toLowerCase();
  if (kind === 'openai') {
    return new OpenAIEmbeddingProvider();
  }
  return new LocalEmbeddingProvider();
}

export type { EmbeddingPort } from './EmbeddingPort';
export { EmbeddingError } from './EmbeddingPort';
export { LocalEmbeddingProvider } from './LocalEmbeddingProvider';
export { OpenAIEmbeddingProvider } from './OpenAIEmbeddingProvider';
