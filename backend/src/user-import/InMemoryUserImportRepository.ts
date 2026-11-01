import { randomUUID } from 'node:crypto';
import type { InsertUserImportRow, UserImportRecord } from './domain/types';
import type { UserImportRepository } from './UserImportRepository';

function now(): string {
  return new Date().toISOString();
}

export class InMemoryUserImportRepository implements UserImportRepository {
  imports = new Map<string, UserImportRecord>(); // id → record

  private byUserDedupe = new Map<string, string>(); // user|dedupeKey → id

  private key(userId: string, dedupeKey: string): string {
    return `${userId}|${dedupeKey}`;
  }

  async findByUserAndDedupeKey(
    userId: string,
    dedupeKey: string,
  ): Promise<UserImportRecord | null> {
    const id = this.byUserDedupe.get(this.key(userId, dedupeKey));
    if (!id) return null;
    return this.imports.get(id) ?? null;
  }

  async findById(id: string): Promise<UserImportRecord | null> {
    const row = this.imports.get(id);
    return row ? { ...row } : null;
  }

  async insert(row: InsertUserImportRow): Promise<UserImportRecord> {
    const key = this.key(row.userId, row.dedupeKey);
    if (this.byUserDedupe.has(key)) {
      const err = new Error('duplicate user import') as Error & { code?: string };
      err.code = '23505';
      throw err;
    }
    const ts = now();
    const record: UserImportRecord = {
      id: randomUUID(),
      userId: row.userId,
      rawInput: row.rawInput,
      sourceUrl: row.sourceUrl,
      normalizedUrl: row.normalizedUrl,
      dedupeKey: row.dedupeKey,
      platform: row.platform,
      contentSourceId: row.contentSourceId,
      status: row.status,
      timedOutAt: null,
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: 1,
    };
    this.imports.set(record.id, record);
    this.byUserDedupe.set(key, record.id);
    return { ...record };
  }

  async listByUser(userId: string, limit = 20): Promise<UserImportRecord[]> {
    return [...this.imports.values()]
      .filter((row) => row.userId === userId && !row.hiddenAt)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id.localeCompare(b.id)))
      .slice(0, Math.max(1, limit))
      .map((row) => ({ ...row }));
  }

  async listByContentSourceId(contentSourceId: string): Promise<UserImportRecord[]> {
    return [...this.imports.values()]
      .filter((row) => row.contentSourceId === contentSourceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }

  async markTimedOut(id: string, timedOutAt: string, expectedStartedAt?: string | null): Promise<UserImportRecord | null> {
    const row = this.imports.get(id);
    if (!row) return null;
    if (row.timedOutAt || (expectedStartedAt !== undefined && (row.attemptStartedAt ?? null) !== expectedStartedAt)) return { ...row };
    const next: UserImportRecord = {
      ...row,
      timedOutAt,
      updatedAt: now(),
    };
    this.imports.set(id, next);
    return { ...next };
  }

  async clearTimedOut(id: string): Promise<UserImportRecord | null> {
    const row = this.imports.get(id);
    if (!row) return null;
    if (!row.timedOutAt) return { ...row };
    const next: UserImportRecord = {
      ...row,
      timedOutAt: null,
      updatedAt: now(),
    };
    this.imports.set(id, next);
    return { ...next };
  }

  async restart(id: string, startedAt: string): Promise<UserImportRecord | null> {
    const row = this.imports.get(id);
    if (!row) return null;
    const next = { ...row, timedOutAt: null, hiddenAt: null, attemptStartedAt: startedAt, updatedAt: startedAt };
    this.imports.set(id, next);
    return { ...next };
  }

  async deleteForUser(id: string, userId: string): Promise<boolean> {
    const row = this.imports.get(id);
    if (!row || row.userId !== userId) return false;
    this.imports.set(id, { ...row, hiddenAt: now(), updatedAt: now() });
    return true;
  }
}
