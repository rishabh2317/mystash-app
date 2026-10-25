import { outcome, type PushMessage, type PushOutcome, type PushProvider, type SendResult } from './types';

/** Deterministic provider for tests and load runs; never touches the network. */
export class FakePushProvider implements PushProvider {
  readonly name = 'expo' as const;
  readonly maxBatchSize = 100;
  readonly receiptMode = 'async' as const;
  readonly sent: PushMessage[][] = [];
  readonly receipts = new Map<string, PushOutcome>();
  private sequence = 0;

  constructor(private readonly decide: (m: PushMessage) => PushOutcome = () => outcome('accepted', 'ok')) {}

  async send(batch: PushMessage[]): Promise<SendResult[]> {
    this.sent.push(batch);
    return batch.map((m) => {
      const o = this.decide(m);
      return {
        deliveryId: m.deliveryId,
        attemptNo: m.attemptNo,
        outcome: o,
        providerMessageId: o.class === 'accepted' ? `fake-ticket-${(this.sequence += 1)}` : null,
        latencyMs: 1,
      };
    });
  }

  async fetchReceipts(ids: string[]): Promise<Map<string, PushOutcome>> {
    const found = new Map<string, PushOutcome>();
    for (const id of ids) {
      const receipt = this.receipts.get(id);
      if (receipt) found.set(id, receipt);
    }
    return found;
  }
}
