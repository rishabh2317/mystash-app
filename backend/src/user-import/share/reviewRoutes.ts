import type { Express } from 'express';
import { createSupabaseAdmin } from '../../supabase';
import { supabaseUserImportAuthenticator } from '../routes';
import { sendAuthError } from '../../auth/requireAuth';
import { getEnv } from '../../env';
import { ShareError } from './contracts';
import { shareHistory } from './history';
import { createShareReviewService } from './reviewService';

/** Existing Share API paths, flags, response shapes and suggestion decisions stay intact. */
export function registerShareReviewRoutes(app: Express) {
  const db = createSupabaseAdmin(), auth = supabaseUserImportAuthenticator();
  const service = createShareReviewService(db);
  const enabled = () => getEnv('SHARE_ACCEPT_ENABLED') === 'true' && getEnv('SHARE_SUGGESTIONS_ENABLED') === 'true';
  const route = (handler: (userId: string, req: import('express').Request) => Promise<unknown>) => async (req: import('express').Request, res: import('express').Response) => {
    if (!enabled()) { res.status(503).json({ error: 'share_review_unavailable' }); return; }
    try {
      const user = await auth(req); if (!user) { res.status(401).json({ error: 'authentication_required' }); return; }
      res.json(await handler(user.userId, req));
    } catch (e) {
      if (sendAuthError(res, e)) return;
      const safe = e instanceof ShareError ? e : new ShareError('share_review_unavailable', 503);
      res.status(safe.status).json({ error: safe.code });
    }
  };
  app.get('/imports/history', route((user, req) => shareHistory(db, user, req.query.cursor, req.query.limit)));
  app.get('/imports/:importId/review', route((user, req) => service.detail(user, String(req.params.importId))));
  app.post('/imports/:importId/review', route((user, req) => service.decide(user, String(req.params.importId), req.body)));
}
