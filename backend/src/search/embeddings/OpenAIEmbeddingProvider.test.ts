import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EmbeddingError } from './EmbeddingPort';
import { OpenAIEmbeddingProvider, type OpenAIEmbeddingsClient } from './OpenAIEmbeddingProvider';

describe('OpenAIEmbeddingProvider (mocked boundary)', () => {
  it('constructs request with model + dimensions and parses response', async () => {
    let seen: { model?: string; dimensions?: number; input?: string | string[] } = {};
    const client: OpenAIEmbeddingsClient = {
      embeddings: {
        async create(body) {
          seen = body;
          const n = Array.isArray(body.input) ? body.input.length : 1;
          return {
            data: Array.from({ length: n }, () => ({
              embedding: Array.from({ length: body.dimensions ?? 8 }, (_, i) => i * 0.01),
            })),
          };
        },
      },
    };
    const provider = new OpenAIEmbeddingProvider({
      client,
      model: 'text-embedding-3-small',
      dimension: 8,
    });
    const r = await provider.embedQuery('sony xm5');
    assert.equal(seen.model, 'text-embedding-3-small');
    assert.equal(seen.dimensions, 8);
    assert.equal(r.modelId, 'text-embedding-3-small');
    assert.equal(r.dimension, 8);
    assert.equal(r.embedding.length, 8);
  });

  it('batches documents', async () => {
    const client: OpenAIEmbeddingsClient = {
      embeddings: {
        async create(body) {
          const inputs = Array.isArray(body.input) ? body.input : [body.input];
          return {
            data: inputs.map(() => ({ embedding: [0.1, 0.2, 0.3, 0.4] })),
          };
        },
      },
    };
    const provider = new OpenAIEmbeddingProvider({ client, dimension: 4 });
    const out = await provider.embedDocuments([{ text: 'a' }, { text: 'b' }]);
    assert.equal(out.length, 2);
  });

  it('wraps provider errors', async () => {
    const client: OpenAIEmbeddingsClient = {
      embeddings: {
        async create() {
          throw new Error('rate limit');
        },
      },
    };
    const provider = new OpenAIEmbeddingProvider({ client, dimension: 4 });
    await assert.rejects(() => provider.embedQuery('x'), (e: unknown) => {
      assert.ok(e instanceof EmbeddingError);
      return true;
    });
  });

  it('requires api key when no injected client', () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      assert.throws(() => new OpenAIEmbeddingProvider(), /OPENAI_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});
