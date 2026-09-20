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
      .filter((row) => row.userId === userId)
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
}
