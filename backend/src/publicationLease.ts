import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { importWorkFetch } from './user-import/workContext';

export class PublicationLeaseError extends Error {
  constructor(message: string, readonly statusCode = 409) { super(message); }
}

type LeaseOptions = {
  attemptId?: string;
  transport?: typeof fetch;
  /** Tests explicitly drive renewal without a real timer. */
  heartbeat?: boolean;
};

/** Private token is sent only by this request's Supabase client. DB statement
 * guards serialize every mutation against takeover; expiry alone is not a lock. */
export async function acquirePublicationLease(admin: SupabaseClient, ingestId: string, userId: string, options: LeaseOptions = {}) {
  const attemptId = options.attemptId ?? randomUUID();
  const { data, error } = await admin.rpc('publication_claim', {
    p_ingest_id: ingestId, p_user_id: userId, p_attempt_id: attemptId,
  }).abortSignal(AbortSignal.timeout(15_000));
  if (error) {
    if (error.code === 'P0002') throw new PublicationLeaseError('Ingest not found', 404);
    if (error.code === '55P03') throw new PublicationLeaseError('This draft is already being finalized. Retry the same draft.');
    // Fail closed if the migration is absent or the database cannot be reached.
    throw new PublicationLeaseError('Publication is temporarily unavailable. Your draft is retained; retry later.', 503);
  }
  if (data !== true) throw new PublicationLeaseError('This draft is already being finalized. Wait, then retry the same draft.');

  const controller = new AbortController();
  let stopped = false;
  let renewal: Promise<void> | null = null;
  const transport = options.transport ?? importWorkFetch;
  const renew = (): Promise<void> => {
    if (stopped || controller.signal.aborted) return Promise.resolve();
    if (renewal) return renewal;
    renewal = (async () => {
      try {
        const result = await admin.rpc('publication_renew', { p_ingest_id: ingestId, p_attempt_id: attemptId })
          .abortSignal(AbortSignal.timeout(15_000));
        if (result.error || result.data !== true) controller.abort(new PublicationLeaseError('Publication ownership changed. Retry the same draft.'));
      } catch {
        controller.abort(new PublicationLeaseError('Publication ownership could not be renewed. Retry the same draft.'));
      }
    })().finally(() => { renewal = null; });
    return renewal;
  };
  const timer = options.heartbeat === false ? null : setInterval(() => { void renew(); }, 30_000);
  timer?.unref();

  const scopedFetch: typeof fetch = (input, init) => {
    controller.signal.throwIfAborted();
    if (stopped) throw new PublicationLeaseError('Publication request already ended.');
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-mystash-publish-ingest', ingestId);
    headers.set('x-mystash-publish-attempt', attemptId);
    return transport(input, { ...init, headers,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000), ...(init?.signal ? [init.signal] : [])]) });
  };

  return {
    fetch: scopedFetch,
    renew,
    async release() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      // Abort abandoned/late fetches before letting a successor claim the draft.
      controller.abort(new PublicationLeaseError('Publication request already ended.'));
      await renewal;
      const result = await admin.rpc('publication_release', { p_ingest_id: ingestId, p_attempt_id: attemptId })
        .abortSignal(AbortSignal.timeout(15_000));
      if (result.error) throw new PublicationLeaseError('Publication lease release failed; it will expire safely.', 503);
    },
  };
}

export type PublicationLease = Awaited<ReturnType<typeof acquirePublicationLease>>;
