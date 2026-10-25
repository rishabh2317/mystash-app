import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CreatorLibraryRepository,
  LibraryListItem,
  LibraryMembership,
  LibrarySyncState,
  LibrarySyncStatus,
} from './CreatorLibraryRepository';

type MembershipRow = {
  id: string;
  user_id: string;
  connected_account_id: string;
  content_source_id: string;
  availability: 'available' | 'unavailable';
  last_seen_at: string;
};

export class SupabaseCreatorLibraryRepository implements CreatorLibraryRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async upsertMembership(input: {
    userId: string;
    connectedAccountId: string;
    contentSourceId: string;
    availability: LibraryMembership['availability'];
    lastSeenAt: string;
  }): Promise<LibraryMembership> {
    const { data, error } = await this.admin
      .from('creator_library_memberships')
      .upsert(
        {
          user_id: input.userId,
          connected_account_id: input.connectedAccountId,
          content_source_id: input.contentSourceId,
          availability: input.availability,
          last_seen_at: input.lastSeenAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'connected_account_id,content_source_id' },
      )
      .select('*')
      .single();
    if (error) throw error;
    const row = data as MembershipRow;
    return {
      id: row.id,
      userId: row.user_id,
      connectedAccountId: row.connected_account_id,
      contentSourceId: row.content_source_id,
      availability: row.availability,
      lastSeenAt: row.last_seen_at,
    };
  }

  async markUnseenUnavailable(connectedAccountId: string, runStartedAt: string): Promise<number> {
    const { data, error } = await this.admin
      .from('creator_library_memberships')
      .update({ availability: 'unavailable', updated_at: new Date().toISOString() })
      .eq('connected_account_id', connectedAccountId)
      .lt('last_seen_at', runStartedAt)
      .neq('availability', 'unavailable')
      .select('id');
    if (error) throw error;
    return (data ?? []).length;
  }

  async userOwnsContentSource(userId: string, contentSourceId: string): Promise<boolean> {
    const { data, error } = await this.admin
      .from('creator_library_memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('content_source_id', contentSourceId)
      .limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async listForUser(userId: string, limit: number): Promise<LibraryListItem[]> {
    const { data, error } = await this.admin
      .from('creator_library_memberships')
      .select('id, content_source_id, availability, last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      id: string;
      content_source_id: string;
      availability: 'available' | 'unavailable';
    }>;
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.content_source_id);
    const { data: sources, error: sourceError } = await this.admin
      .from('content_sources')
      .select('id, platform, external_id, canonical_url, title, thumbnail_url, published_at')
      .in('id', ids);
    if (sourceError) throw sourceError;
    const byId = new Map(
      ((sources ?? []) as Array<{
        id: string;
        platform: string;
        external_id: string;
        canonical_url: string;
        title: string | null;
        thumbnail_url: string | null;
        published_at: string | null;
      }>).map((row) => [row.id, row]),
    );
    return rows.map((row) => {
      const source = byId.get(row.content_source_id);
      return {
        membershipId: row.id,
        contentSourceId: row.content_source_id,
        platform: source?.platform ?? 'youtube',
        externalId: source?.external_id ?? '',
        canonicalUrl: source?.canonical_url ?? '',
        title: source?.title ?? null,
        thumbnailUrl: source?.thumbnail_url ?? null,
        publishedAt: source?.published_at ?? null,
        availability: row.availability,
      };
    });
  }

  async getSyncState(connectedAccountId: string): Promise<LibrarySyncState> {
    const { data, error } = await this.admin
      .from('connected_accounts')
      .select('library_sync_status, library_sync_error, last_library_sync_at')
      .eq('id', connectedAccountId)
      .maybeSingle();
    if (error) throw error;
    const row = data as {
      library_sync_status?: LibrarySyncStatus;
      library_sync_error?: string | null;
      last_library_sync_at?: string | null;
    } | null;
    return {
      status: row?.library_sync_status ?? 'idle',
      error: row?.library_sync_error ?? null,
      lastSyncAt: row?.last_library_sync_at ?? null,
    };
  }

  async setSyncState(
    connectedAccountId: string,
    patch: { status: LibrarySyncStatus; error?: string | null; lastSyncAt?: string | null },
  ): Promise<void> {
    const body: Record<string, unknown> = {
      library_sync_status: patch.status,
      updated_at: new Date().toISOString(),
    };
    if (patch.error !== undefined) body.library_sync_error = patch.error;
    if (patch.lastSyncAt !== undefined) body.last_library_sync_at = patch.lastSyncAt;
    const { error } = await this.admin.from('connected_accounts').update(body).eq('id', connectedAccountId);
    if (error) throw error;
  }
}
