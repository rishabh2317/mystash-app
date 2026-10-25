import { randomUUID } from 'node:crypto';
import type { ContentSourceRecord } from '../content-source/domain/types';
import type {
  CreatorLibraryRepository,
  LibraryListItem,
  LibraryMembership,
  LibrarySyncState,
  LibrarySyncStatus,
} from './CreatorLibraryRepository';

export class InMemoryCreatorLibraryRepository implements CreatorLibraryRepository {
  memberships = new Map<string, LibraryMembership>();
  sync = new Map<string, LibrarySyncState>();
  constructor(private readonly sources: Map<string, ContentSourceRecord>) {}

  async upsertMembership(input: {
    userId: string;
    connectedAccountId: string;
    contentSourceId: string;
    availability: LibraryMembership['availability'];
    lastSeenAt: string;
  }): Promise<LibraryMembership> {
    const existing = [...this.memberships.values()].find(
      (row) =>
        row.connectedAccountId === input.connectedAccountId &&
        row.contentSourceId === input.contentSourceId,
    );
    if (existing) {
      const next = { ...existing, availability: input.availability, lastSeenAt: input.lastSeenAt };
      this.memberships.set(existing.id, next);
      return next;
    }
    const row: LibraryMembership = { id: randomUUID(), ...input };
    this.memberships.set(row.id, row);
    return row;
  }

  async markUnseenUnavailable(connectedAccountId: string, runStartedAt: string): Promise<number> {
    let count = 0;
    for (const [id, row] of this.memberships) {
      if (row.connectedAccountId !== connectedAccountId) continue;
      if (row.lastSeenAt < runStartedAt && row.availability !== 'unavailable') {
        this.memberships.set(id, { ...row, availability: 'unavailable' });
        count += 1;
      }
    }
    return count;
  }

  async userOwnsContentSource(userId: string, contentSourceId: string): Promise<boolean> {
    return [...this.memberships.values()].some(
      (row) => row.userId === userId && row.contentSourceId === contentSourceId,
    );
  }

  async listForUser(userId: string, limit: number): Promise<LibraryListItem[]> {
    return [...this.memberships.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, limit)
      .map((row) => {
        const source = this.sources.get(row.contentSourceId);
        return {
          membershipId: row.id,
          contentSourceId: row.contentSourceId,
          platform: source?.platform ?? 'youtube',
          externalId: source?.externalId ?? '',
          canonicalUrl: source?.canonicalUrl ?? '',
          title: source?.title ?? null,
          thumbnailUrl: source?.thumbnailUrl ?? null,
          publishedAt: source?.publishedAt ?? null,
          availability: row.availability,
        };
      });
  }

  async getSyncState(connectedAccountId: string): Promise<LibrarySyncState> {
    return (
      this.sync.get(connectedAccountId) ?? { status: 'idle', error: null, lastSyncAt: null }
    );
  }

  async setSyncState(
    connectedAccountId: string,
    patch: { status: LibrarySyncStatus; error?: string | null; lastSyncAt?: string | null },
  ): Promise<void> {
    const prev = await this.getSyncState(connectedAccountId);
    this.sync.set(connectedAccountId, {
      status: patch.status,
      error: patch.error === undefined ? prev.error : patch.error,
      lastSyncAt: patch.lastSyncAt === undefined ? prev.lastSyncAt : patch.lastSyncAt,
    });
  }
}
