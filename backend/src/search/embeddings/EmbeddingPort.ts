export type EmbedInput = {
  text: string;
  id?: string;
};

export type EmbedResult = {
  embedding: number[];
  modelId: string;
  version: string;
  dimension: number;
};

/**
 * EmbeddingPort — FROZEN abstraction.
 * Hosted API and local/self-hosted implementations both satisfy this.
 * Search domain must not know which provider is wired.
 */
export type EmbeddingPort = {
  readonly modelId: string;
  readonly version: string;
  readonly dimension: number;
  embedQuery(text: string): Promise<EmbedResult>;
  embedDocuments(inputs: EmbedInput[]): Promise<EmbedResult[]>;
};

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}
