import type { SearchTelemetryEvent } from './domain/types';
import { ingestLog } from '../pipeline/ingestLog';

/**
 * Search telemetry — Search-owned, ≠ Engagement behavioral facts.
 */
export class SearchTelemetryStore {
  private events: SearchTelemetryEvent[] = [];
  private recentByUser = new Map<string, string[]>();
  private trending = new Map<string, number>();
  private readonly maxRecent = 20;
  private readonly maxEvents = 10_000;

  record(event: SearchTelemetryEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();

    ingestLog('info', 'SearchTelemetry', {
      svc: 'search',
      domain: 'search',
      eventType: event.eventType,
      query: event.query,
      intent: event.intent,
      retrievalMode: event.retrievalMode,
      latencyMs: event.latencyMs,
      zero: event.eventType === 'zero_result',
    });

    if (event.eventType === 'query' && event.query) {
      const q = event.query.toLowerCase();
      this.trending.set(q, (this.trending.get(q) ?? 0) + 1);
      const uid = event.userId;
      if (uid) {
        const list = this.recentByUser.get(uid) ?? [];
        const next = [event.query, ...list.filter((x) => x !== event.query)].slice(
          0,
          this.maxRecent,
        );
        this.recentByUser.set(uid, next);
      }
    }
  }

  recentSearches(userId: string): string[] {
    return this.recentByUser.get(userId) ?? [];
  }

  /** Privacy: clear per-user recent searches. */
  clearUserRecent(userId: string): void {
    this.recentByUser.delete(userId);
  }

  trendingQueries(limit: number): string[] {
    return [...this.trending.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([q]) => q);
  }

  /** Test helper */
  all(): SearchTelemetryEvent[] {
    return [...this.events];
  }
}
