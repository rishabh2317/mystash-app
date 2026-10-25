export type LibraryAvailability = 'available' | 'unavailable';

export type LibrarySyncStatus = 'idle' | 'running' | 'failed';

export type LibraryMembership = {
  id: string;
  userId: string;
  connectedAccountId: string;
  contentSourceId: string;
  availability: LibraryAvailability;
  lastSeenAt: string;
};

export type LibraryListItem = {
  membershipId: string;
  contentSourceId: string;
  platform: string;
  externalId: string;
  canonicalUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  availability: LibraryAvailability;
};

export type LibrarySyncState = {
  status: LibrarySyncStatus;
  error: string | null;
  lastSyncAt: string | null;
};

export interface CreatorLibraryRepository {
  upsertMembership(input: {
    userId: string;
    connectedAccountId: string;
    contentSourceId: string;
    availability: LibraryAvailability;
    lastSeenAt: string;
  }): Promise<LibraryMembership>;
  markUnseenUnavailable(connectedAccountId: string, runStartedAt: string): Promise<number>;
  listForUser(userId: string, limit: number): Promise<LibraryListItem[]>;
  userOwnsContentSource(userId: string, contentSourceId: string): Promise<boolean>;
  getSyncState(connectedAccountId: string): Promise<LibrarySyncState>;
  setSyncState(
    connectedAccountId: string,
    patch: { status: LibrarySyncStatus; error?: string | null; lastSyncAt?: string | null },
  ): Promise<void>;
}
