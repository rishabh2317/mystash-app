import type { InsertUserImportRow, UserImportRecord } from './domain/types';

export type UserImportRepository = {
  findByUserAndDedupeKey(userId: string, dedupeKey: string): Promise<UserImportRecord | null>;
  findById(id: string): Promise<UserImportRecord | null>;
  insert(row: InsertUserImportRow): Promise<UserImportRecord>;
  listByUser(userId: string, limit?: number): Promise<UserImportRecord[]>;
  /** Submissions that reference a global source — Phase 4 fans a shared result into each Bag. */
  listByContentSourceId(contentSourceId: string): Promise<UserImportRecord[]>;
  /**
   * Freeze user-facing progress at couldnt_finish. Idempotent.
   * Does not touch content_sources.
   */
  markTimedOut(id: string, timedOutAt: string, expectedStartedAt?: string | null): Promise<UserImportRecord | null>;
  /** Clears timeout so a deliberate re-share can look again. */
  clearTimedOut(id: string): Promise<UserImportRecord | null>;
  /** Restart the user-facing clock and restore hidden history on deliberate re-share. */
  restart(id: string, startedAt: string): Promise<UserImportRecord | null>;
  /** Soft-delete user history only — never touches content_sources. */
  deleteForUser(id: string, userId: string): Promise<boolean>;
};
