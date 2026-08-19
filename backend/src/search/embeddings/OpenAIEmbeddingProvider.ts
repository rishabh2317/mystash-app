import OpenAI from 'openai';
import { EmbeddingError, type EmbedInput, type EmbedResult, type EmbeddingPort } from './EmbeddingPort';

export type OpenAIEmbeddingsClient = {
  embeddings: {
    create(body: {
      model: string;
      input: string | string[];
      dimensions?: number;
    }): Promise<{ data: Array<{ embedding: number[] }> }>;
  };
};

/**
 * Initial V1 embedding candidate — OpenAI text-embedding-3-small.
 * Not permanently frozen; final model after Mystash offline benchmark.
 * Injectable client for unit tests (no real API / no OPENAI_API_KEY in CI).
 */
export class OpenAIEmbeddingProvider implements EmbeddingPort {
  readonly modelId: string;
  readonly version = 'v1';
  readonly dimension: number;
  private readonly client: OpenAIEmbeddingsClient;

  constructor(opts?: {
    apiKey?: string;
    model?: string;
    dimension?: number;
    client?: OpenAIEmbeddingsClient;
  }) {
    this.modelId = opts?.model ?? 'text-embedding-3-small';
    this.dimension = opts?.dimension ?? 1536;
    if (opts?.client) {
      this.client = opts.client;
      return;
    }
    const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new EmbeddingError('OPENAI_API_KEY required for OpenAIEmbeddingProvider');
    }
    this.client = new OpenAI({ apiKey });
  }

  async embedQuery(text: string): Promise<EmbedResult> {
    const [r] = await this.embedDocuments([{ text }]);
    return r!;
  }

  async embedDocuments(inputs: EmbedInput[]): Promise<EmbedResult[]> {
    if (inputs.length === 0) return [];
    try {
      const res = await this.client.embeddings.create({
        model: this.modelId,
        input: inputs.map((i) => i.text.slice(0, 8000)),
        dimensions: this.dimension,
      });
      return res.data.map((d) => ({
        embedding: d.embedding,
        modelId: this.modelId,
        version: this.version,
        dimension: d.embedding.length,
      }));
    } catch (e) {
      throw new EmbeddingError('OpenAI embedding failed', e);
    }
  }
}
