import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { classifyTransportError } from './classifyTransport';
import { classifyExpoDetailsError, classifyExpoRequestFailure, classifyExpoTicket } from './expoClassification';
import { ExpoPushProvider, toExpoMessage } from './ExpoPushProvider';
import { redactProviderMessage, type PushMessage } from './types';

const TOKEN = 'ExponentPushToken[abcdefghijklmnop123456]';
const ACCESS = 'test-access-token-not-real';

function message(i: number, overrides: Partial<PushMessage> = {}): PushMessage {
  return {
    deliveryId: String(i),
    attemptNo: 1,
    token: TOKEN,
    title: 'New follower',
    body: 'Ana followed you.',
    data: { v: 1, nid: 'n', did: String(i), type: 'creator.followed', link: '/notifications' },
    collapseId: `n-${i}`,
    ttlSeconds: 3600,
    priority: 'normal',
    ...overrides,
  };
}

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function sentBody(call: Call): unknown {
  const raw = Buffer.from(call.init.body as Uint8Array);
  const headers = call.init.headers as Record<string, string>;
  return JSON.parse((headers['Content-Encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8'));
}

const signal = () => AbortSignal.timeout(5_000);

describe('Expo outcome classification', () => {
  const rows: [string, string, string][] = [
    ['DeviceNotRegistered', 'permanent_token', 'device_unregistered'],
    ['MessageTooBig', 'permanent_message', 'payload_too_large'],
    ['MessageRateExceeded', 'retryable', 'device_rate_limited'],
    ['MismatchSenderId', 'provider_config', 'sender_mismatch'],
    ['InvalidCredentials', 'provider_config', 'credentials_invalid'],
    ['SomethingNew', 'permanent_message', 'unknown'],
  ];
  for (const [error, cls, code] of rows) {
    it(`details.error ${error} -> ${cls}/${code}`, () => {
      const o = classifyExpoDetailsError(error);
      assert.equal(o.class, cls);
      assert.equal(o.code, code);
    });
  }

  it('device rate limit carries a minimum backoff', () => {
    assert.equal(classifyExpoDetailsError('MessageRateExceeded').retryAfterMs, 60_000);
  });

  it('request-level failures', () => {
    assert.deepEqual(pick(classifyExpoRequestFailure(429, undefined, '7')), ['retryable', 'rate_limited', 7000]);
    assert.deepEqual(pick(classifyExpoRequestFailure(400, [{ code: 'TOO_MANY_REQUESTS' }])), ['retryable', 'rate_limited', null]);
    assert.deepEqual(pick(classifyExpoRequestFailure(503, undefined)), ['retryable', 'provider_unavailable', null]);
    assert.deepEqual(pick(classifyExpoRequestFailure(401, undefined)), ['provider_config', 'auth_rejected', null]);
    assert.deepEqual(pick(classifyExpoRequestFailure(400, [{ code: 'UNAUTHORIZED' }])), ['provider_config', 'auth_rejected', null]);
    assert.deepEqual(pick(classifyExpoRequestFailure(400, [{ code: 'VALIDATION_ERROR' }])), [
      'permanent_message',
      'request_malformed',
      null,
    ]);
  });

  it('a missing ticket is ambiguous', () => {
    assert.equal(classifyExpoTicket(undefined).class, 'ambiguous');
  });

  it('transport: connect failures are retryable, post-write failures ambiguous', () => {
    const connect = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    assert.equal(classifyTransportError(connect, 'after_write').class, 'retryable');
    const reset = Object.assign(new Error('socket'), { cause: { code: 'ECONNRESET' } });
    assert.deepEqual(pick(classifyTransportError(reset, 'after_write')), ['ambiguous', 'connection_reset', null]);
    const abort = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    assert.deepEqual(pick(classifyTransportError(abort, 'after_write')), ['ambiguous', 'timeout_after_send', null]);
    assert.equal(classifyTransportError(new Error('weird'), 'after_write').class, 'ambiguous');
  });

  it('redacts push tokens from provider messages', () => {
    const redacted = redactProviderMessage(`"${TOKEN}" is not a registered push notification recipient`);
    assert.ok(redacted && !redacted.includes('abcdefghijklmnop'));
    assert.ok(redacted.includes('[redacted-token]'));
  });
});

function pick(o: { class: string; code: string; retryAfterMs: number | null }) {
  return [o.class, o.code, o.retryAfterMs];
}

describe('ExpoPushProvider', () => {
  it('requires an access token', () => {
    assert.throws(() => new ExpoPushProvider({ accessToken: '' }));
  });

  it('sends with the Bearer access token and maps tickets in order', async () => {
    const { impl, calls } = fakeFetch(() =>
      json(200, {
        data: [
          { status: 'ok', id: 'ticket-1' },
          {
            status: 'error',
            message: `${TOKEN} is not a registered push notification recipient`,
            details: { error: 'DeviceNotRegistered' },
          },
        ],
      }),
    );
    const provider = new ExpoPushProvider({ accessToken: ACCESS, fetchImpl: impl });
    const results = await provider.send([message(1), message(2)], signal());

    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${ACCESS}`);
    assert.equal(calls[0].url, 'https://exp.host/--/api/v2/push/send');
    const body = sentBody(calls[0]) as Record<string, unknown>[];
    assert.equal(body[0].to, TOKEN);
    assert.equal(body[0].ttl, 3600);
    assert.equal(body[0].collapseId, 'n-1');

    assert.equal(results[0].outcome.class, 'accepted');
    assert.equal(results[0].providerMessageId, 'ticket-1');
    assert.equal(results[1].outcome.class, 'permanent_token');
    assert.equal(results[1].providerMessageId, null);
    assert.ok(!results[1].outcome.providerMessage?.includes('abcdefghijklmnop'));
  });

  it('gzips bodies larger than 1 KiB', async () => {
    const { impl, calls } = fakeFetch(() => json(200, { data: Array.from({ length: 20 }, () => ({ status: 'ok', id: 'x' })) }));
    const provider = new ExpoPushProvider({ accessToken: ACCESS, fetchImpl: impl });
    await provider.send(Array.from({ length: 20 }, (_, i) => message(i)), signal());
    assert.equal((calls[0].init.headers as Record<string, string>)['Content-Encoding'], 'gzip');
    assert.equal((sentBody(calls[0]) as unknown[]).length, 20);
  });

  it('applies a whole-request failure to every message', async () => {
    const { impl } = fakeFetch(() => json(429, { errors: [{ code: 'TOO_MANY_REQUESTS' }] }, { 'retry-after': '3' }));
    const results = await new ExpoPushProvider({ accessToken: ACCESS, fetchImpl: impl }).send(
      [message(1), message(2)],
      signal(),
    );
    assert.deepEqual(
      results.map((r) => [r.outcome.class, r.outcome.code, r.outcome.retryAfterMs]),
      [
        ['retryable', 'rate_limited', 3000],
        ['retryable', 'rate_limited', 3000],
      ],
    );
  });

  it('treats 5xx as retryable and 401 as provider configuration', async () => {
    const five = fakeFetch(() => new Response('bad gateway', { status: 502 }));
    const r5 = await new ExpoPushProvider({ accessToken: ACCESS, fetchImpl: five.impl }).send([message(1)], signal());
    assert.equal(r5[0].outcome.code, 'provider_unavailable');
    const auth = fakeFetch(() => json(401, { errors: [{ code: 'UNAUTHORIZED', message: 'bad token' }] }));
    const r4 = await new ExpoPushProvider({ accessToken: ACCESS, fetchImpl: auth.impl }).send([message(1)], signal());
    assert.equal(r4[0].outcome.class, 'provider_config');
  });

  it('ticket count mismatch is ambiguous, never accepted', async () => {
    const { impl } = fakeFetch(() => json(200, { data: [{ status: 'ok', id: 'only-one' }] }));
    const results = await new ExpoPushProvider({ accessToken: ACCESS, fetchImpl: impl }).send(
      [message(1), message(2)],
      signal(),
    );
    assert.ok(results.every((r) => r.outcome.code === 'response_mismatch' && r.providerMessageId === null));
  });

  it('a reset after write is ambiguous for the whole batch', async () => {
    const { impl } = fakeFetch(() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    });
    const results = await new ExpoPushProvider({ accessToken: ACCESS, fetchImpl: impl }).send([message(1)], signal());
    assert.equal(results[0].outcome.class, 'ambiguous');
  });

  it('fetches receipts in chunks of 1000 and throws on request failure', async () => {
    const { impl, calls } = fakeFetch((call) => {
      const ids = (sentBody(call) as { ids: string[] }).ids;
      return json(200, {
        data: Object.fromEntries(
          ids.map((id) => [id, id === 'r-5' ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }]),
        ),
      });
    });
    const provider = new ExpoPushProvider({ accessToken: ACCESS, fetchImpl: impl });
    const ids = Array.from({ length: 1500 }, (_, i) => `r-${i}`);
    const receipts = await provider.fetchReceipts(ids);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://exp.host/--/api/v2/push/getReceipts');
    assert.equal(receipts.size, 1500);
    assert.equal(receipts.get('r-5')?.class, 'permanent_token');

    const failing = fakeFetch(() => json(503, {}));
    await assert.rejects(new ExpoPushProvider({ accessToken: ACCESS, fetchImpl: failing.impl }).fetchReceipts(['a']));
  });

  it('toExpoMessage only sets optional fields when present', () => {
    const m = toExpoMessage(message(1));
    assert.equal('channelId' in m, false);
    assert.equal(toExpoMessage(message(1, { channelId: 'social' })).channelId, 'social');
  });
});
