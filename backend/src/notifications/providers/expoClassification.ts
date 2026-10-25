import { outcome, type PushOutcome } from './types';

/** Expo asks for at least a short backoff on per-device rate limiting. */
export const DEVICE_RATE_LIMIT_MIN_BACKOFF_MS = 60_000;

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type ExpoReceipt =
  | { status: 'ok' }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type ExpoRequestError = { code?: string; message?: string };

/** Receipt-style `details.error` values (also used for ticket errors other than DeviceNotRegistered). */
export function classifyExpoDetailsError(error: string | undefined, message?: string): PushOutcome {
  switch (error) {
    case 'DeviceNotRegistered':
      return outcome('permanent_token', 'device_unregistered', { providerCode: error, providerMessage: message });
    case 'MessageTooBig':
      return outcome('permanent_message', 'payload_too_large', { providerCode: error, providerMessage: message });
    case 'MessageRateExceeded':
      return outcome('retryable', 'device_rate_limited', {
        providerCode: error,
        providerMessage: message,
        retryAfterMs: DEVICE_RATE_LIMIT_MIN_BACKOFF_MS,
      });
    case 'MismatchSenderId':
      return outcome('provider_config', 'sender_mismatch', { providerCode: error, providerMessage: message });
    case 'InvalidCredentials':
      return outcome('provider_config', 'credentials_invalid', { providerCode: error, providerMessage: message });
    default:
      return outcome('permanent_message', 'unknown', { providerCode: error ?? null, providerMessage: message });
  }
}

export function classifyExpoTicket(ticket: ExpoTicket | undefined): PushOutcome {
  if (!ticket || typeof ticket !== 'object') return outcome('ambiguous', 'response_mismatch');
  if (ticket.status === 'ok') return outcome('accepted', 'ok');
  return classifyExpoDetailsError(ticket.details?.error, ticket.message);
}

export function classifyExpoReceipt(receipt: ExpoReceipt): PushOutcome {
  if (receipt.status === 'ok') return outcome('accepted', 'ok');
  return classifyExpoDetailsError(receipt.details?.error, receipt.message);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

/** Whole-request failure (non-200, or an `errors[]` body): applies to every message in the batch. */
export function classifyExpoRequestFailure(
  httpStatus: number,
  errors: ExpoRequestError[] | undefined,
  retryAfterHeader: string | null = null,
): PushOutcome {
  const first = errors?.[0];
  const code = first?.code ?? `HTTP_${httpStatus}`;
  const extra = {
    providerCode: code,
    providerMessage: first?.message ?? null,
    httpStatus,
    retryAfterMs: parseRetryAfter(retryAfterHeader),
  };
  if (httpStatus === 429 || code === 'TOO_MANY_REQUESTS') return outcome('retryable', 'rate_limited', extra);
  if (httpStatus >= 500) return outcome('retryable', 'provider_unavailable', extra);
  if (code === 'UNAUTHORIZED' || httpStatus === 401 || httpStatus === 403) {
    return outcome('provider_config', 'auth_rejected', extra);
  }
  return outcome('permanent_message', 'request_malformed', extra);
}
