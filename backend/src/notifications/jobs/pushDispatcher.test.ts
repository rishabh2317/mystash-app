import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BegunDelivery } from '../domain/pushContent';
import type { ActorProfile } from '../domain/types';
import { FakePushProvider } from '../providers/FakePushProvider';
import { outcome } from '../providers/types';
import type {
  ClaimedReceipt,
  PushRepository,
  PushResultInput,
  ReceiptResultInput,
} from '../PushRepository';
import { runDispatchOnce } from './pushDispatcher';
import { runReceiptPollOnce } from './receiptPoller';

const NOW = Date.parse('2026-10-12T12:00:00Z');

function begun(id: number, overrides: Partial<BegunDelivery> = {}): BegunDelivery {
  return {
    deliveryId: String(id),
    attemptNo: 1,
    provider: 'expo',
    token: `ExponentPushToken[t${id}]`,
    tokenFingerprint: '0123456789abcdef',
    platform: 'android',
    notificationId: '33333333-3333-4333-8333-333333333333',
    type: 'ingest.failed',
    category: 'task',
    title: 'We couldn’t finish finding products',
    body: 'x',
    deepLink: '/notifications',
    groupKey: null,
    actorCount: 0,
    sampleActorIds: [],
    sendDeadline: new Date(NOW + 60_000).toISOString(),
    ...overrides,
  };
}

class FakePushRepo implements PushRepository {
  claim: { dispatchToken: string; claimed: number } | null = { dispatchToken: 'dt-1', claimed: 0 };
  begun: BegunDelivery[] = [];
  recorded: { token: string; results: PushResultInput[] }[] = [];
  receiptClaims: ClaimedReceipt[] = [];
  recordedReceipts: { token: string; results: ReceiptResultInput[] }[] = [];
  actorLookups: string[][] = [];

  async claimDeliveries() {
    return this.claim;
  }
  async beginSend() {
    return this.begun;
  }
  async recordResults(token: string, results: PushResultInput[]) {
    this.recorded.push({ token, results });
    return { recorded: results.length, applied: results.length, duplicates: 0, ignored: 0, registrationsInvalidated: 0 };
  }
  async claimReceipts() {
    return this.receiptClaims;
  }
  async recordReceipts(token: string, results: ReceiptResultInput[]) {
    this.recordedReceipts.push({ token, results });
    return { ok: 0, errors: 0, waiting: 0, unavailable: 0, registrationsInvalidated: 0 };
  }
  async register(): Promise<never> {
    throw new Error('unused');
  }
  async unregister() {
    return 0;
  }
  async revokeInstallation() {
    return false;
  }
  async recordPushOpen() {
    return false;
  }
  async getActiveActorProfiles(ids: string[]): Promise<ActorProfile[]> {
    this.actorLookups.push(ids);
    return [];
  }
}

describe('push dispatcher', () => {
  it('does nothing when there is nothing to claim', async () => {
    const repo = new FakePushRepo();
    repo.claim = null;
    const provider = new FakePushProvider();
    assert.equal(await runDispatchOnce(repo, provider, () => NOW), 0);
    assert.equal(provider.sent.length, 0);
    assert.equal(repo.recorded.length, 0);
  });

  it('records exactly one result per begun delivery under the same dispatch token', async () => {
    const repo = new FakePushRepo();
    repo.claim = { dispatchToken: 'dt-1', claimed: 3 };
    repo.begun = [begun(1), begun(2), begun(3)];
    const provider = new FakePushProvider((m) =>
      m.deliveryId === '2' ? outcome('permanent_token', 'device_unregistered') : outcome('accepted', 'ok'),
    );
    assert.equal(await runDispatchOnce(repo, provider, () => NOW), 3);
    assert.equal(provider.sent[0].length, 3);
    assert.equal(repo.recorded.length, 1);
    assert.equal(repo.recorded[0].token, 'dt-1');
    assert.deepEqual(
      repo.recorded[0].results.map((r) => [r.deliveryId, r.outcome.class]),
      [
        ['1', 'accepted'],
        ['2', 'permanent_token'],
        ['3', 'accepted'],
      ],
    );
    assert.equal(repo.actorLookups.length, 0, 'task pushes do not load actor profiles');
  });

  it('oversized messages fail locally without reaching the provider', async () => {
    const repo = new FakePushRepo();
    repo.claim = { dispatchToken: 'dt-1', claimed: 2 };
    repo.begun = [begun(1, { title: 'T'.repeat(5000) }), begun(2)];
    const provider = new FakePushProvider();
    await runDispatchOnce(repo, provider, () => NOW);
    assert.deepEqual(
      provider.sent[0].map((m) => m.deliveryId),
      ['2'],
    );
    const local = repo.recorded[0].results.find((r) => r.deliveryId === '1')!;
    assert.equal(local.outcome.code, 'payload_too_large');
  });

  it('a provider that throws or drops results yields ambiguous outcomes, never accepted', async () => {
    const repo = new FakePushRepo();
    repo.claim = { dispatchToken: 'dt-1', claimed: 2 };
    repo.begun = [begun(1), begun(2)];
    const throwing = new FakePushProvider();
    throwing.send = async () => {
      throw new Error('boom');
    };
    await runDispatchOnce(repo, throwing, () => NOW);
    assert.ok(repo.recorded[0].results.every((r) => r.outcome.class === 'ambiguous'));
  });

  it('a batch fully suppressed at begin records nothing but reports the claim', async () => {
    const repo = new FakePushRepo();
    repo.claim = { dispatchToken: 'dt-1', claimed: 5 };
    repo.begun = [];
    const provider = new FakePushProvider();
    assert.equal(await runDispatchOnce(repo, provider, () => NOW), 5);
    assert.equal(provider.sent.length, 0);
    assert.equal(repo.recorded.length, 0);
  });

  it('social pushes load only active actor profiles', async () => {
    const repo = new FakePushRepo();
    repo.claim = { dispatchToken: 'dt-1', claimed: 1 };
    repo.begun = [
      begun(1, { category: 'social', type: 'creator.followed', sampleActorIds: ['a1', 'a2'], actorCount: 2 }),
    ];
    const provider = new FakePushProvider();
    await runDispatchOnce(repo, provider, () => NOW);
    assert.deepEqual(repo.actorLookups, [['a1', 'a2']]);
    assert.equal(provider.sent[0][0].body, '2 people followed you.');
  });
});

describe('receipt poller', () => {
  it('records found receipts and leaves missing ones pending', async () => {
    const repo = new FakePushRepo();
    repo.receiptClaims = [
      { receiptToken: 'rt-1', attemptId: '10', providerMessageId: 'ticket-a' },
      { receiptToken: 'rt-1', attemptId: '11', providerMessageId: 'ticket-b' },
    ];
    const provider = new FakePushProvider();
    provider.receipts.set('ticket-a', outcome('permanent_token', 'device_unregistered'));
    assert.equal(await runReceiptPollOnce(repo, provider), 2);
    assert.equal(repo.recordedReceipts[0].token, 'rt-1');
    assert.deepEqual(
      repo.recordedReceipts[0].results.map((r) => [r.attemptId, r.outcome?.class ?? null]),
      [
        ['10', 'permanent_token'],
        ['11', null],
      ],
    );
  });

  it('records nothing when the receipt request fails (the claim lease expires and is re-polled)', async () => {
    const repo = new FakePushRepo();
    repo.receiptClaims = [{ receiptToken: 'rt-1', attemptId: '10', providerMessageId: 'ticket-a' }];
    const provider = new FakePushProvider();
    provider.fetchReceipts = async () => {
      throw new Error('expo receipts request failed: HTTP_503');
    };
    await assert.rejects(runReceiptPollOnce(repo, provider));
    assert.equal(repo.recordedReceipts.length, 0);
  });
});
