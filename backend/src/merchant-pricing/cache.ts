import type { LivePriceResult } from './types';

type CacheEntry = {
  expiresAt: number;
  value: LivePriceResult;
};

type InflightEntry = {
  promise: Promise<LivePriceResult>;
};

/**
 * Short-lived in-process cache + in-flight dedupe for live price fetches.
 * Does not write to Postgres.
 */
export class LivePriceCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, InflightEntry>();

  constructor(private readonly ttlMs: number) {}

  static key(parts: { productId: string; offerId: string; url: string; country: string }): string {
    return `${parts.productId}|${parts.offerId}|${parts.url}|${parts.country}`;
  }

  get(key: string, now = Date.now()): LivePriceResult | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: LivePriceResult, now = Date.now()): void {
    this.store.set(key, { value, expiresAt: now + this.ttlMs });
  }

  getInflight(key: string): Promise<LivePriceResult> | null {
    return this.inflight.get(key)?.promise ?? null;
  }

  setInflight(key: string, promise: Promise<LivePriceResult>): void {
    this.inflight.set(key, { promise });
    void promise.finally(() => {
      this.inflight.delete(key);
    });
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }
}
