import type { GeminiReviewGenerateResult, GeminiReviewGenerator } from '../GeminiAiReviewGenerator';
import type { ProductIdentityContext } from './types';

export type GeminiFailureCode = Extract<
  GeminiReviewGenerateResult,
  { ok: false }
>['code'];

const TRANSIENT_CODES = new Set<GeminiFailureCode>(['api_error', 'timeout']);
const OUTPUT_CODES = new Set<GeminiFailureCode>(['empty_response', 'parse_failed']);
const NO_RETRY_CODES = new Set<GeminiFailureCode>([
  'config_missing',
  'insufficient_evidence',
  'validation_failed',
]);

export const TRANSIENT_MAX_ATTEMPTS = 3;
export const OUTPUT_MAX_ATTEMPTS = 2;

export function maxAttemptsForFailureCode(code: GeminiFailureCode): number {
  if (TRANSIENT_CODES.has(code)) return TRANSIENT_MAX_ATTEMPTS;
  if (OUTPUT_CODES.has(code)) return OUTPUT_MAX_ATTEMPTS;
  if (NO_RETRY_CODES.has(code)) return 1;
  return 1;
}

export function isRetryableFailureCode(code: GeminiFailureCode): boolean {
  return maxAttemptsForFailureCode(code) > 1;
}

export function isTransientFailureCode(code: GeminiFailureCode): boolean {
  return TRANSIENT_CODES.has(code);
}

export function isRetryEligibleApiReason(code: string | null | undefined): boolean {
  if (!code) return false;
  return code === 'api_error' || code === 'timeout' || code === 'empty_response' || code === 'parse_failed';
}

export function backoffDelayMs(attempt: number, code: GeminiFailureCode): number {
  const base = TRANSIENT_CODES.has(code) ? 1_000 : 500;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), 30_000);
}

export async function executeGenerationWithRetries(
  generator: GeminiReviewGenerator,
  identity: ProductIdentityContext,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<GeminiReviewGenerateResult> {
  let attempt = 0;

  while (true) {
    attempt += 1;
    const result = await generator.generate(identity);
    if (result.ok) return result;

    const maxAttempts = maxAttemptsForFailureCode(result.code);
    if (attempt >= maxAttempts || !isRetryableFailureCode(result.code)) {
      return result;
    }

    await sleep(backoffDelayMs(attempt, result.code));
  }
}
