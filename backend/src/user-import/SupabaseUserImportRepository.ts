import type { SupabaseClient } from '@supabase/supabase-js';
import type { InsertUserImportRow, UserImportRecord, UserImportStatus } from './domain/types';
import type { UserImportRepository } from './UserImportRepository';

type UserImportRow = {
  id: string;
  user_id: string;
  raw_input: string;
  source_url: string;
  normalized_url: string;
  dedupe_key: string;
  platform: string;
  content_source_id: string | null;
  status: string;
  timed_out_at: string | null;
  attempt_started_at?: string | null;
  hidden_at?: string | null;
  created_at: string;
  updated_at: string;
  schema_version: number;
};

function mapRow(row: UserImportRow): UserImportRecord {
  return {
    id: row.id,
    userId: row.user_id,
    rawInput: row.raw_input,
    sourceUrl: row.source_url,
    normalizedUrl: row.normalized_url,
    dedupeKey: row.dedupe_key,
    platform: row.platform,
    contentSourceId: row.content_source_id,
    status: row.status as UserImportStatus,
    timedOutAt: row.timed_out_at ?? null,
    attemptStartedAt: row.attempt_started_at ?? null,
    hiddenAt: row.hidden_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schemaVersion: row.schema_version,
  };
}

export class SupabaseUserImportRepository implements UserImportRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async findByUserAndDedupeKey(
    userId: string,
    dedupeKey: string,
  ): Promise<UserImportRecord | null> {
    const { data, error } = await this.admin
      .from('user_imports')
      .select('*')
      .eq('user_id', userId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as UserImportRow) : null;
  }

  async findById(id: string): Promise<UserImportRecord | null> {
    const { data, error } = await this.admin
      .from('user_imports')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as UserImportRow) : null;
  }

  async insert(row: InsertUserImportRow): Promise<UserImportRecord> {
    const { data, error } = await this.admin
      .from('user_imports')
      .insert({
        user_id: row.userId,
        raw_input: row.rawInput,
        source_url: row.sourceUrl,
        normalized_url: row.normalizedUrl,
        dedupe_key: row.dedupeKey,
        platform: row.platform,
        content_source_id: row.contentSourceId,
        status: row.status,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data as UserImportRow);
  }

  async listByUser(userId: string, limit = 20): Promise<UserImportRecord[]> {
    const { data, error } = await this.admin
      .from('user_imports')
      .select('*')
      .eq('user_id', userId)
      .is('hidden_at', null)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, limit));
    if (error) throw error;
    return ((data ?? []) as UserImportRow[]).map(mapRow);
  }

  async listByContentSourceId(contentSourceId: string): Promise<UserImportRecord[]> {
    const { data, error } = await this.admin
      .from('user_imports')
      .select('*')
      .eq('content_source_id', contentSourceId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as UserImportRow[]).map(mapRow);
  }

  async markTimedOut(id: string, timedOutAt: string, expectedStartedAt?: string | null): Promise<UserImportRecord | null> {
    let query = this.admin
      .from('user_imports')
      .update({
        timed_out_at: timedOutAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .is('timed_out_at', null);
    if (expectedStartedAt !== undefined) {
      query = expectedStartedAt === null ? query.is('attempt_started_at', null) : query.eq('attempt_started_at', expectedStartedAt);
    }
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    if (data) return mapRow(data as UserImportRow);
    return this.findById(id);
  }

  async clearTimedOut(id: string): Promise<UserImportRecord | null> {
    const { data, error } = await this.admin
      .from('user_imports')
      .update({
        timed_out_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .not('timed_out_at', 'is', null)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (data) return mapRow(data as UserImportRow);
    return this.findById(id);
  }

  async restart(id: string, startedAt: string): Promise<UserImportRecord | null> {
    const { data, error } = await this.admin.from('user_imports')
      .update({ timed_out_at: null, attempt_started_at: startedAt, hidden_at: null, updated_at: startedAt })
      .eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as UserImportRow) : null;
  }

  async deleteForUser(id: string, userId: string): Promise<boolean> {
    const { data, error } = await this.admin
      .from('user_imports')
      .update({ hidden_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
}
