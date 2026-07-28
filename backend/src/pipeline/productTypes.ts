export type ExtractedProduct = {
  externalId: string;
  name: string;
  price: string;
  currency: string;
  merchantUrl: string;
  image?: string;
  confidence: number;
  /** Optional cue time from the model (e.g. "1:23"). Not persisted to DB. */
  timestamp?: string;
};
