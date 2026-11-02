import type { Express } from 'express';
import { createSupabaseAdmin } from '../../supabase';
import { sendAuthError } from '../../auth/requireAuth';
import { getEnv } from '../../env';
import { logger } from '../../logger';
import { getBullmqCommandRedis } from '../../workers/redisConnection';
import { supabaseUserImportAuthenticator } from '../routes';
import { parseIntent, ShareError, uuid } from './contracts';
import { ShareAcceptanceService, shareAcceptanceStore } from './service';

export const shareFlag = (name: string) => getEnv(name) === 'true';
export function registerShareAcceptanceRoutes(app: Express): void {
  const enabled = () => shareFlag('SHARE_ACCEPT_ENABLED');
  const intentEnabled = () => enabled() && shareFlag('SHARE_INTENT_ENABLED');
  const store = shareAcceptanceStore(createSupabaseAdmin());
  const authenticate = supabaseUserImportAuthenticator();
  const service = new ShareAcceptanceService(store, async userId => {
    try {
      const redis = getBullmqCommandRedis();
      // Per-account cross-replica throttling. No user content enters Redis.
      return Number(await redis.eval(`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`,
        1, `share:accept:${userId}`)) <= 60;
    } catch { throw new ShareError('share_capacity_unavailable', 503); }
  }, intentEnabled);
  app.post('/imports/accept', async (req, res) => {
    if (!enabled()) { res.status(503).json({ error: 'share_unavailable' }); return; }
    try {
      const auth = await authenticate(req);
      if (!auth) { res.status(401).json({ error: 'authentication_required' }); return; }
      const reply = await service.accept(auth.userId, req.body);
      logger.info({ event: 'share.accepted', captureId: req.body.clientCaptureId, importId: reply.importId,
        replayed: reply.replayed }, 'share.accepted');
      res.status(reply.created && !reply.replayed ? 201 : 200).json(reply);
    } catch (error) {
      if (sendAuthError(res, error)) return;
      const safe = error instanceof ShareError ? error : new ShareError('share_unavailable', 503);
      if ([429, 503].includes(safe.status)) res.setHeader('Retry-After', '60');
      logger.warn({ event: 'share.accept.failed', code: safe.code }, 'share.accept.failed');
      res.status(safe.status).json({ error: safe.code });
    }
  });
  app.patch('/imports/:importId/intent', async (req, res) => {
    if (!intentEnabled()) { res.status(503).json({ error: 'intent_unavailable' }); return; }
    try {
      const auth = await authenticate(req);
      if (!auth) { res.status(401).json({ error: 'authentication_required' }); return; }
      const id = String(req.params.importId);
      if (!uuid.test(id) || !Number.isSafeInteger(req.body?.expectedRevision) || req.body.expectedRevision < 0) throw new ShareError('invalid_revision');
      const revision = await store.updateIntent(auth.userId, id, parseIntent(req.body.intent), req.body.expectedRevision);
      res.json({ revision });
    } catch (error) {
      if (sendAuthError(res, error)) return;
      const safe = error instanceof ShareError ? error : new ShareError('intent_unavailable', 503);
      res.status(safe.status).json({ error: safe.code });
    }
  });
  app.get('/imports/:importId/intent', async (req, res) => {
    if (!intentEnabled()) { res.status(503).json({ error: 'intent_unavailable' }); return; }
    try {
      const auth = await authenticate(req);
      if (!auth) { res.status(401).json({error:'authentication_required'}); return; }
      const id=String(req.params.importId);
      if(!uuid.test(id)){res.status(404).json({error:'import_not_found'});return;}
      const {data,error}=await createSupabaseAdmin().from('user_imports').select('interest_kind,interest_note,intent_revision')
        .eq('id',id).eq('user_id',auth.userId).is('hidden_at',null).maybeSingle();
      if(error)throw new ShareError('intent_unavailable',503);
      if(!data){res.status(404).json({error:'import_not_found'});return;}
      res.json({kind:data.interest_kind,note:data.interest_note,revision:data.intent_revision});
    } catch(error){if(sendAuthError(res,error))return;res.status(503).json({error:'intent_unavailable'});}
  });
}
