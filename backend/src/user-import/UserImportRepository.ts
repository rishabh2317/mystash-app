import type { InsertUserImportRow, UserImportRecord } from './domain/types';

export type UserImportRepository = {
  findByUserAndDedupeKey(userId: string, dedupeKey: string): Promise<UserImportRecord | null>;
  insert(row: InsertUserImportRow): Promise<UserImportRecord>;
  listByUser(userId: string, limit?: number): Promise<UserImportRecord[]>;
  /** Submissions that reference a global source — Phase 4 fans a shared result into each Bag. */
  listByContentSourceId(contentSourceId: string): Promise<UserImportRecord[]>;
};
