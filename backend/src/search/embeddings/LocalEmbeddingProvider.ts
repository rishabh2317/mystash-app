import { createHash } from 'node:crypto';
import type { EmbedInput, EmbedResult, EmbeddingPort } from './EmbeddingPort';

/**
 * Deterministic local embedding for development/tests.
 * Feature-hash bag-of-tokens → fixed-dim unit vector.
 * Not a production semantic model — swap via EmbeddingPort after Mystash offline benchmark.
 */
export class LocalEmbeddingProvider implements EmbeddingPort {
  readonly modelId = 'local-feature-hash';
  readonly version = 'v1';
  readonly dimension: number;

  constructor(dimension = 384) {
    this.dimension = dimension;
  }

  async embedQuery(text: string): Promise<EmbedResult> {
    return this.embedOne(text);
  }

  async embedDocuments(inputs: EmbedInput[]): Promise<EmbedResult[]> {
    return inputs.map((i) => this.embedOne(i.text));
  }

  private embedOne(text: string): EmbedResult {
    const vec = new Array<number>(this.dimension).fill(0);
    const tokens = tokenize(text);
    for (const tok of tokens) {
      const h = createHash('sha256').update(tok).digest();
      const idx = h.readUInt32BE(0) % this.dimension;
      const sign = h[4]! & 1 ? 1 : -1;
      vec[idx]! += sign;
    }
    // lightly bias with bigrams
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]}_${tokens[i + 1]}`;
      const h = createHash('sha256').update(bigram).digest();
      const idx = h.readUInt32BE(0) % this.dimension;
      const sign = h[4]! & 1 ? 1 : -1;
      vec[idx]! += 0.5 * sign;
    }
    normalizeInPlace(vec);
    return {
      embedding: vec,
      modelId: this.modelId,
      version: this.version,
      dimension: this.dimension,
    };
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeInPlace(v: number[]): void {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
}
