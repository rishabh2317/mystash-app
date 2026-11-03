import type { Express, Request, Response } from 'express';
import { sendAuthError } from '../../auth/requireAuth';
import { createSupabaseAdmin } from '../../supabase';
import { getEnv } from '../../env';
import { supabaseUserImportAuthenticator, type UserImportAuthenticator } from '../routes';
import { createUserImportService } from '../factory';
import { UserImportServiceError, type UserImportService } from '../UserImportService';
import { parseIntent, ShareError } from '../share/contracts';
import { shareAcceptanceStore, type ShareAcceptanceStore } from '../share/service';
import { createShareReviewService } from '../share/reviewService';
import { FindQueryService, findId } from './queryService';

export type FindRouteDependencies = {
  authenticate: UserImportAuthenticator;
  queries: Pick<FindQueryService, 'list' | 'counts' | 'batch' | 'detail' | 'resultAction'>;
  imports: Pick<UserImportService, 'retry' | 'delete'>;
  intents: Pick<ShareAcceptanceStore, 'updateIntent'>;
  suggestions: ReturnType<typeof createShareReviewService>;
  suggestionsEnabled: () => boolean;
  intentEnabled: () => boolean;
};
function body(req: Request, allowed: string[]): Record<string, unknown> {
  const value = req.body ?? {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new ShareError('invalid_find_action');
  return value;
}

/** Find reads and membership actions have no dependency on capture or suggestion switches. */
export function registerFindHandlers(app: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>, deps: FindRouteDependencies): void {
  const route = (action: (userId: string, req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const auth = await deps.authenticate(req);
      if (!auth) { res.status(401).json({ error: 'authentication_required' }); return; }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(await action(auth.userId, req));
    } catch (error) {
      if (sendAuthError(res, error)) return;
      const status = error instanceof ShareError ? error.status : error instanceof UserImportServiceError ? error.statusCode : 503;
      res.status(status).json({ error: error instanceof ShareError ? error.code : status === 404 ? 'find_not_found' : status === 409 ? 'find_action_unavailable' : 'find_unavailable' });
    }
  };
  app.get('/finds', route((user, req) => deps.queries.list(user, req.query)));
  app.get('/finds/counts', route(user => deps.queries.counts(user)));
  app.post('/finds/batch', route((user, req) => deps.queries.batch(user, body(req, ['ids']).ids)));
  app.get('/finds/:findId', route(async (user, req) => {
    const detail=await deps.queries.detail(user, findId(req.params.findId));
    return {...detail,capabilities:{intent:deps.intentEnabled(),suggestions:deps.suggestionsEnabled()&&detail.sourceType!=='image'}};
  }));
  app.delete('/finds/:findId', route(async (user, req) => {
    body(req, []); const id=findId(req.params.findId),detail=await deps.queries.detail(user,id);
    await deps.imports.delete(user,id); return { ok: true,...(detail.sourceType==='image'?{mediaDeletion:'pending'}:{}) };
  }));
  app.post('/finds/:findId/retry', route(async (user, req) => {
    const { kind } = body(req, ['kind']);
    if (kind !== 'extraction' && kind !== 'saving') throw new ShareError('invalid_retry_kind');
    await deps.imports.retry(user, findId(req.params.findId), kind); return { ok: true, kind };
  }));
  for (const [segment, kind] of [['products', 'product'], ['places', 'place']] as const) {
    app.delete(`/finds/:findId/${segment}/:resultId`, route((user, req) => {
      const input = body(req, kind === 'product' ? ['expectedIdentity'] : []); return deps.queries.resultAction(user, findId(req.params.findId), kind, findId(req.params.resultId), false, input.expectedIdentity);
    }));
    app.post(`/finds/:findId/${segment}/:resultId/restore`, route((user, req) => {
      const input = body(req, kind === 'product' ? ['expectedIdentity'] : []); return deps.queries.resultAction(user, findId(req.params.findId), kind, findId(req.params.resultId), true, input.expectedIdentity);
    }));
  }
  const selected = (restore: boolean) => route((user, req) => {
    const input = body(req, ['expectedIdentity']);
    const candidate = req.params.candidateKey;
    if (typeof candidate !== 'string' || !/^[a-f0-9]{64}$/.test(candidate)) throw new ShareError('invalid_candidate');
    return deps.queries.resultAction(user, findId(req.params.findId), 'product', findId(req.params.resultId), restore, input.expectedIdentity, candidate);
  });
  app.delete('/finds/:findId/suggestions/:resultId/:candidateKey', selected(false));
  app.post('/finds/:findId/suggestions/:resultId/:candidateKey/restore', selected(true));
  app.patch('/finds/:findId/intent', route(async (user, req) => {
    if (!deps.intentEnabled()) throw new ShareError('intent_unavailable', 503);
    const input = body(req, ['intent', 'expectedRevision']);
    if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) throw new ShareError('invalid_revision');
    return { revision: await deps.intents.updateIntent(user, findId(req.params.findId), parseIntent(input.intent), Number(input.expectedRevision)) };
  }));
  app.get('/finds/:findId/suggestions', route((user, req) => {
    if (!deps.suggestionsEnabled()) throw new ShareError('suggestions_unavailable', 503);
    return deps.suggestions.detail(user, findId(req.params.findId));
  }));
  app.post('/finds/:findId/suggestions', route((user, req) => {
    if (!deps.suggestionsEnabled()) throw new ShareError('suggestions_unavailable', 503);
    return deps.suggestions.decide(user, findId(req.params.findId), body(req, ['sourceProductId', 'candidateKey', 'action']));
  }));
}
export function registerFindRoutes(app: Express): void {
  const db = createSupabaseAdmin();
  registerFindHandlers(app, { authenticate: supabaseUserImportAuthenticator(), queries: new FindQueryService(db),
    imports: createUserImportService(db), intents: shareAcceptanceStore(db), suggestions: createShareReviewService(db),
    suggestionsEnabled: () => getEnv('SHARE_SUGGESTIONS_ENABLED') === 'true',
    intentEnabled: () => getEnv('SHARE_INTENT_ENABLED') === 'true' });
}
