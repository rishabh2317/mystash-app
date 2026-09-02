import { getEnv } from '../../env';

/** Default for AI Review + Google Search grounding (new Google AI keys). */
export const DEFAULT_AI_REVIEW_MODEL = 'gemini-3.5-flash-lite';

/**
 * Models that return HTTP 404 for new Google AI API keys.
 * @see https://ai.google.dev/gemini-api/docs/models
 */
const DEPRECATED_MODEL_FALLBACK: Record<string, string> = {
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-flash': 'gemini-3.6-flash',
  'gemini-2.0-flash': 'gemini-3.6-flash',
};

export function resolveAiReviewModel(): string {
  const configured = getEnv('GEMINI_AI_REVIEW_MODEL')?.trim();
  if (!configured) return DEFAULT_AI_REVIEW_MODEL;
  return DEPRECATED_MODEL_FALLBACK[configured] ?? configured;
}

export function isDeprecatedAiReviewModel(model: string): boolean {
  return model in DEPRECATED_MODEL_FALLBACK;
}

export function recommendedModelForDeprecated(model: string): string | null {
  return DEPRECATED_MODEL_FALLBACK[model] ?? null;
}
