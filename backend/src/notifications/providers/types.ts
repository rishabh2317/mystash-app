export type PushOutcomeClass =
  | 'accepted'
  | 'retryable'
  | 'ambiguous'
  | 'permanent_token'
  | 'permanent_message'
  | 'provider_config';

export type PushOutcomeCode =
  | 'ok'
  | 'rate_limited'
  | 'device_rate_limited'
  | 'provider_unavailable'
  | 'network_unreachable'
  | 'timeout_after_send'
  | 'connection_reset'
  | 'response_mismatch'
  | 'worker_lost'
  | 'device_unregistered'
  | 'payload_too_large'
  | 'payload_invalid'
  | 'request_malformed'
  | 'credentials_invalid'
  | 'sender_mismatch'
  | 'auth_rejected'
  | 'unknown';

export interface PushOutcome {
  class: PushOutcomeClass;
  code: PushOutcomeCode;
  /** Raw provider code: 'DeviceNotRegistered', 'TOO_MANY_REQUESTS', 'HTTP_503', 'ECONNRESET'. */
  providerCode: string | null;
  /** Truncated to 500 chars; never contains a push token. */
  providerMessage: string | null;
  httpStatus: number | null;
  retryAfterMs: number | null;
}

export interface PushMessage {
  deliveryId: string;
  attemptNo: number;
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  collapseId: string;
  tag?: string;
  threadId?: string;
  channelId?: string;
  ttlSeconds: number;
  priority: 'normal' | 'high';
  badge?: number;
}

export interface SendResult {
  deliveryId: string;
  attemptNo: number;
  outcome: PushOutcome;
  providerMessageId: string | null;
  latencyMs: number;
}

export interface PushProvider {
  readonly name: 'expo' | 'apns' | 'fcm';
  readonly maxBatchSize: number;
  readonly receiptMode: 'async' | 'none';
  /** Exactly one result per input, in input order; never throws. */
  send(batch: PushMessage[], signal: AbortSignal): Promise<SendResult[]>;
  /** Missing id = receipt not available yet. Throws on transport failure (the batch is re-polled). */
  fetchReceipts?(ids: string[]): Promise<Map<string, PushOutcome>>;
}

const TOKEN_PATTERN = /(Exponent|Expo)PushToken\[[^\]]*\]/g;

/** Provider messages can echo tokens back; they are stored and logged only after this. */
export function redactProviderMessage(message: unknown): string | null {
  if (typeof message !== 'string' || !message) return null;
  return message.replace(TOKEN_PATTERN, '[redacted-token]').slice(0, 500);
}

export function outcome(
  cls: PushOutcomeClass,
  code: PushOutcomeCode,
  extra: Partial<Omit<PushOutcome, 'class' | 'code'>> = {},
): PushOutcome {
  return {
    class: cls,
    code,
    providerCode: extra.providerCode ?? null,
    providerMessage: redactProviderMessage(extra.providerMessage),
    httpStatus: extra.httpStatus ?? null,
    retryAfterMs: extra.retryAfterMs ?? null,
  };
}
