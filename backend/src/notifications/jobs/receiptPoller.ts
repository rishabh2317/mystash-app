import { logger } from '../../logger';
import { RECEIPT_POLICY } from '../domain/pushPolicy';
import type { PushRepository } from '../PushRepository';
import type { PushProvider } from '../providers/types';

export type ReceiptPollerStats = { lastPollAt: string | null; lastError: string | null };

/** On a transport failure nothing is recorded; the claim lease expires and the batch is re-polled. */
export async function runReceiptPollOnce(repo: PushRepository, provider: PushProvider): Promise<number> {
  if (provider.receiptMode !== 'async' || !provider.fetchReceipts) return 0;
  const claimed = await repo.claimReceipts(provider.name, RECEIPT_POLICY.claimBatch, RECEIPT_POLICY.leaseSeconds);
  if (claimed.length === 0) return 0;

  const receipts = await provider.fetchReceipts(claimed.map((c) => c.providerMessageId));
  const summary = await repo.recordReceipts(
    claimed[0].receiptToken,
    claimed.map((c) => ({ attemptId: c.attemptId, outcome: receipts.get(c.providerMessageId) ?? null })),
  );
  logger.info({ provider: provider.name, checked: claimed.length, ...summary }, 'notification.push.receipts');
  return claimed.length;
}

export type ReceiptPollerHandle = { stop(): Promise<void>; stats(): ReceiptPollerStats };

export function startReceiptPoller(repo: PushRepository, provider: PushProvider): ReceiptPollerHandle {
  const stats: ReceiptPollerStats = { lastPollAt: null, lastError: null };
  let busy: Promise<void> | null = null;

  const tick = () => {
    if (busy) return;
    busy = (async () => {
      try {
        let checked: number;
        do {
          checked = await runReceiptPollOnce(repo, provider);
        } while (checked >= RECEIPT_POLICY.claimBatch);
        stats.lastPollAt = new Date().toISOString();
        stats.lastError = null;
      } catch (err) {
        stats.lastError = ((err as Error).message ?? 'unknown').slice(0, 200);
        logger.warn({ message: stats.lastError }, 'notification.push.receipts_failed');
      } finally {
        busy = null;
      }
    })();
  };

  const timer = setInterval(tick, RECEIPT_POLICY.pollIntervalMs);
  tick();
  return {
    async stop() {
      clearInterval(timer);
      await busy;
    },
    stats: () => ({ ...stats }),
  };
}
