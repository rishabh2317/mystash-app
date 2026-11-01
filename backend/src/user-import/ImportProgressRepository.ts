import { EXTRACTION_CONTEXT_VERSION, USER_IMPORT_PLACE_CACHE_VERSION, getPipelineConfig } from '../config/pipelineConfig';
import { randomUUID } from 'node:crypto';
import { ImportWorkBusyError, StaleImportWorkError, importWorkContext } from './workContext';
import type { SupabaseClient } from '@supabase/supabase-js';

export function importExtractionVersion(): string {
  const config = getPipelineConfig();
  return [config.pipelineVersion, config.providerVersion, EXTRACTION_CONTEXT_VERSION, USER_IMPORT_PLACE_CACHE_VERSION, 'progressive-places-m2'].join('/');
}

export type ImportBranchStatus = 'running' | 'complete' | 'failed';
export type ImportProgress = {
  attemptId: string;
  evidenceComplete?: boolean;
  extractionVersion: string;
  startedAt: string;
  products: ImportBranchStatus;
  places: ImportBranchStatus;
};

/** User-import reporting only. Does not own extraction, source lifecycle, or entities. */
export interface ImportProgressRepository {
  begin(sourceId: string): Promise<ImportProgress>;
  claim?(sourceId: string): Promise<{ progress: ImportProgress; previous: ImportProgress | null } | null>;
  completeEvidence?(sourceId: string, attemptId: string): Promise<void>;
  renew?(sourceId: string, attemptId: string): Promise<boolean>;
  release?(sourceId: string, attemptId: string): Promise<void>;
  isCurrent?(sourceId: string, attemptId: string): Promise<boolean>;
  owns?(sourceId: string, attemptId: string): boolean;
  get(sourceId: string): Promise<ImportProgress | null>;
  finish(sourceId: string, attemptId: string, branch: 'products' | 'places', status: ImportBranchStatus): Promise<void>;
}

export class SupabaseImportProgressRepository implements ImportProgressRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async claim(sourceId: string) {
    const { data, error } = await this.admin.rpc('import_work_claim', {
      p_source_id: sourceId, p_attempt_id: randomUUID(), p_version: importExtractionVersion(),
    }).abortSignal(AbortSignal.timeout(25_000));
    if (error) throw new Error(error.message);
    const map = (r: Record<string, string>): ImportProgress => ({ attemptId: r.attempt_id,
      extractionVersion: r.extraction_version, startedAt: r.started_at, evidenceComplete: r.evidence_complete === 'true' || (r.evidence_complete as unknown) === true,
      products: r.product_status as ImportBranchStatus, places: r.place_status as ImportBranchStatus });
    return data ? { progress: map(data.progress), previous: data.previous ? map(data.previous) : null } : null;
  }
  async completeEvidence(sourceId: string, attemptId: string) {
    const { error } = await this.admin.from('content_source_import_progress').update({ evidence_complete: true })
      .eq('content_source_id', sourceId).eq('attempt_id', attemptId);
    if (error) throw new Error(error.message);
  }
  async renew(sourceId: string, attemptId: string) {
    const { data, error } = await this.admin.rpc('import_work_renew', { p_source_id: sourceId, p_attempt_id: attemptId })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) throw new Error(error.message);
    return data === true;
  }
  async isCurrent(sourceId: string, attemptId: string) {
    const { data, error } = await this.admin.rpc('import_work_current', { p_source_id: sourceId, p_attempt_id: attemptId })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) throw new Error(error.message);
    return data === true;
  }
  async release(sourceId: string, attemptId: string) {
    const { error } = await this.admin.rpc('import_work_release', { p_source_id: sourceId, p_attempt_id: attemptId })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) throw new Error(error.message);
  }

  async begin(sourceId: string): Promise<ImportProgress> {
    const row: ImportProgress = {
      attemptId: randomUUID(), evidenceComplete: false, extractionVersion: importExtractionVersion(), startedAt: new Date().toISOString(), products: 'running', places: 'running',
    };
    const { error } = await this.admin.from('content_source_import_progress').upsert({
      content_source_id: sourceId, attempt_id: row.attemptId, started_at: row.startedAt, extraction_version: row.extractionVersion,
      product_status: row.products, place_status: row.places, evidence_complete: false,
    }, { onConflict: 'content_source_id' });
    if (error) throw new Error(`Could not start import reporting: ${error.message}`);
    return row;
  }

  async get(sourceId: string): Promise<ImportProgress | null> {
    const { data, error } = await this.admin.from('content_source_import_progress')
      .select('attempt_id, started_at, extraction_version, product_status, place_status, evidence_complete').eq('content_source_id', sourceId).maybeSingle();
    if (error) throw new Error(`Could not read import reporting: ${error.message}`);
    return data ? {
      attemptId: data.attempt_id, startedAt: data.started_at, extractionVersion: data.extraction_version, evidenceComplete: data.evidence_complete === true,
      products: data.product_status, places: data.place_status,
    } : null;
  }

  async finish(sourceId: string, attemptId: string, branch: 'products' | 'places', status: ImportBranchStatus): Promise<void> {
    const { error } = await this.admin.from('content_source_import_progress')
      .update({ [branch === 'products' ? 'product_status' : 'place_status']: status })
      .eq('content_source_id', sourceId).eq('attempt_id', attemptId);
    if (error) throw new Error(`Could not finish import reporting: ${error.message}`);
  }
}

export class InMemoryImportProgressRepository implements ImportProgressRepository {
  private rows = new Map<string, ImportProgress>();
  private leases = new Map<string, { id: string; until: number }>();
  constructor(private readonly nowMs: () => number = () => Date.now()) {}
  async claim(sourceId: string) {
    const lease = this.leases.get(sourceId);
    if (lease && lease.until > this.nowMs()) return null;
    const previous = this.rows.get(sourceId) ? { ...this.rows.get(sourceId)! } : null;
    const progress: ImportProgress = { attemptId: randomUUID(), startedAt: new Date(this.nowMs()).toISOString(),
      extractionVersion: importExtractionVersion(), evidenceComplete: false, products: 'running', places: 'running' };
    this.rows.set(sourceId, progress);
    this.leases.set(sourceId, { id: progress.attemptId, until: this.nowMs() + 60_000 });
    return { progress, previous };
  }
  owns(sourceId: string, attemptId: string) {
    const lease = this.leases.get(sourceId);
    return lease?.id === attemptId && lease.until > this.nowMs();
  }
  async isCurrent(sourceId: string, attemptId: string) { return this.owns(sourceId, attemptId); }
  async completeEvidence(sourceId: string, attemptId: string) {
    const row = this.rows.get(sourceId);
    if (row?.attemptId === attemptId) row.evidenceComplete = true;
  }
  async renew(sourceId: string, attemptId: string) {
    if (!this.owns(sourceId, attemptId)) return false;
    this.leases.set(sourceId, { id: attemptId, until: this.nowMs() + 60_000 });
    return true;
  }
  async release(sourceId: string, attemptId: string) {
    if (this.leases.get(sourceId)?.id === attemptId) this.leases.delete(sourceId);
  }
  async begin(sourceId: string): Promise<ImportProgress> {
    const row: ImportProgress = {
      attemptId: randomUUID(), evidenceComplete: false, extractionVersion: importExtractionVersion(), startedAt: new Date().toISOString(), products: 'running', places: 'running',
    };
    this.rows.set(sourceId, row);
    return { ...row };
  }
  async get(sourceId: string): Promise<ImportProgress | null> {
    const row = this.rows.get(sourceId);
    return row ? { ...row } : null;
  }
  async finish(sourceId: string, attemptId: string, branch: 'products' | 'places', status: ImportBranchStatus): Promise<void> {
    const row = this.rows.get(sourceId);
    if (row?.attemptId === attemptId) row[branch] = status;
  }
}

/** Own the lease across every entity write. Heartbeats use their own bounded RPC;
 * cancellation stops queued work, and SQL guards reject already-in-flight stale writes. */
export async function runImportWork<T>(repository: ImportProgressRepository, sourceId: string,
  task: (progress: ImportProgress, previous: ImportProgress | null) => Promise<T>, timeoutMs = 180_000): Promise<T> {
  const previous = repository.claim ? null : await repository.get(sourceId);
  const claimed = repository.claim ? await repository.claim(sourceId)
    : { progress: await repository.begin(sourceId), previous };
  if (!claimed) throw new ImportWorkBusyError();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('Import work deadline exceeded')), timeoutMs);
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing || controller.signal.aborted || !repository.renew) return;
    renewing = true;
    void repository.renew(sourceId, claimed.progress.attemptId).then((ok) => {
      if (!ok) controller.abort(new StaleImportWorkError());
    }, () => controller.abort(new StaleImportWorkError())).finally(() => { renewing = false; });
  }, 15_000);
  try {
    return await importWorkContext.run({ sourceId, attemptId: claimed.progress.attemptId, signal: controller.signal,
      placeSearches: new Map(),
      owns: repository.owns ? () => repository.owns!(sourceId, claimed.progress.attemptId) : undefined },
    () => task(claimed.progress, claimed.previous));
  } finally {
    clearTimeout(deadline);
    clearInterval(heartbeat);
    controller.abort(new StaleImportWorkError());
    await repository.release?.(sourceId, claimed.progress.attemptId);
  }
}
