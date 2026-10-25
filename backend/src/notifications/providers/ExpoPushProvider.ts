import { gzipSync } from 'node:zlib';
import { classifyTransportError } from './classifyTransport';
import {
  classifyExpoReceipt,
  classifyExpoRequestFailure,
  classifyExpoTicket,
  type ExpoReceipt,
  type ExpoRequestError,
  type ExpoTicket,
} from './expoClassification';
import { outcome, type PushMessage, type PushOutcome, type PushProvider, type SendResult } from './types';

export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

const EXPO_MAX_MESSAGES = 100;
const EXPO_MAX_RECEIPT_IDS = 1_000;
const GZIP_MIN_BYTES = 1_024;

export type ExpoPushProviderOptions = {
  /** Expo enhanced push security token. Server-side only; sent as `Authorization: Bearer`. */
  accessToken: string;
  fetchImpl?: typeof fetch;
  sendUrl?: string;
  receiptsUrl?: string;
  now?: () => number;
};

type ExpoSendBody = { data?: ExpoTicket[]; errors?: ExpoRequestError[] };
type ExpoReceiptsBody = { data?: Record<string, ExpoReceipt>; errors?: ExpoRequestError[] };

export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo' as const;
  readonly maxBatchSize = EXPO_MAX_MESSAGES;
  readonly receiptMode = 'async' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ExpoPushProviderOptions) {
    if (!options.accessToken) throw new Error('ExpoPushProvider requires an access token');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  private request(url: string, payload: unknown, signal: AbortSignal): Promise<Response> {
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.options.accessToken}`,
    };
    let body: Uint8Array = json;
    if (json.length > GZIP_MIN_BYTES) {
      body = gzipSync(json);
      headers['Content-Encoding'] = 'gzip';
    }
    return this.fetchImpl(url, { method: 'POST', headers, body: new Uint8Array(body), signal });
  }

  async send(batch: PushMessage[], signal: AbortSignal): Promise<SendResult[]> {
    if (batch.length === 0) return [];
    if (batch.length > EXPO_MAX_MESSAGES) throw new Error(`Expo batch exceeds ${EXPO_MAX_MESSAGES} messages`);
    const started = this.now();
    const fail = (o: PushOutcome): SendResult[] =>
      batch.map((m) => ({
        deliveryId: m.deliveryId,
        attemptNo: m.attemptNo,
        outcome: o,
        providerMessageId: null,
        latencyMs: this.now() - started,
      }));

    let response: Response;
    try {
      response = await this.request(this.options.sendUrl ?? EXPO_PUSH_SEND_URL, batch.map(toExpoMessage), signal);
    } catch (err) {
      return fail(classifyTransportError(err, 'after_write'));
    }

    let parsed: ExpoSendBody | null = null;
    try {
      parsed = (await response.json()) as ExpoSendBody;
    } catch (err) {
      if (response.status !== 200) {
        return fail(classifyExpoRequestFailure(response.status, undefined, response.headers.get('retry-after')));
      }
      return fail(classifyTransportError(err, 'after_write'));
    }

    if (response.status !== 200 || (parsed?.errors && parsed.errors.length > 0)) {
      return fail(classifyExpoRequestFailure(response.status, parsed?.errors, response.headers.get('retry-after')));
    }
    const tickets = Array.isArray(parsed?.data) ? parsed.data : null;
    if (!tickets || tickets.length !== batch.length) {
      return fail(outcome('ambiguous', 'response_mismatch', { httpStatus: response.status }));
    }

    const latencyMs = this.now() - started;
    return batch.map((m, i) => {
      const ticket = tickets[i];
      return {
        deliveryId: m.deliveryId,
        attemptNo: m.attemptNo,
        outcome: { ...classifyExpoTicket(ticket), httpStatus: response.status },
        providerMessageId: ticket?.status === 'ok' && typeof ticket.id === 'string' ? ticket.id : null,
        latencyMs,
      };
    });
  }

  async fetchReceipts(ids: string[]): Promise<Map<string, PushOutcome>> {
    const results = new Map<string, PushOutcome>();
    for (let i = 0; i < ids.length; i += EXPO_MAX_RECEIPT_IDS) {
      const chunk = ids.slice(i, i + EXPO_MAX_RECEIPT_IDS);
      const response = await this.request(
        this.options.receiptsUrl ?? EXPO_PUSH_RECEIPTS_URL,
        { ids: chunk },
        AbortSignal.timeout(30_000),
      );
      const parsed = (await response.json().catch(() => null)) as ExpoReceiptsBody | null;
      if (response.status !== 200 || !parsed || (parsed.errors && parsed.errors.length > 0)) {
        const failure = classifyExpoRequestFailure(response.status, parsed?.errors ?? undefined);
        throw new Error(`expo receipts request failed: ${failure.providerCode ?? failure.code}`);
      }
      for (const [id, receipt] of Object.entries(parsed.data ?? {})) {
        if (receipt && typeof receipt === 'object') results.set(id, classifyExpoReceipt(receipt));
      }
    }
    return results;
  }
}

/** Field names per Expo's message request format. */
export function toExpoMessage(m: PushMessage): Record<string, unknown> {
  const message: Record<string, unknown> = {
    to: m.token,
    title: m.title,
    body: m.body,
    data: m.data,
    ttl: m.ttlSeconds,
    priority: m.priority,
    collapseId: m.collapseId,
    sound: 'default',
  };
  if (m.tag) message.tag = m.tag;
  if (m.threadId) message.threadId = m.threadId;
  if (m.channelId) message.channelId = m.channelId;
  if (typeof m.badge === 'number') message.badge = m.badge;
  return message;
}
