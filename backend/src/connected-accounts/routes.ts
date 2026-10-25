import type { Express, Request, Response } from 'express';
import { requireAuthUser } from '../auth/requireAuth';
import { createSupabaseAdmin } from '../supabase';
import { createUserService } from '../user/factory';
import { logger } from '../logger';
import {
  ConnectedAccountServiceError,
  createConnectedAccountService,
} from './factory';
import type { ConnectedAccountProvider, OAuthSurface } from './domain/types';
import { isConnectedAccountProviderEnabled } from './config';

async function requireUser(req: Request, res: Response) {
  return requireAuthUser(req, res, { requireVerifiedEmail: true });
}

function handleError(res: Response, e: unknown): void {
  if (e instanceof ConnectedAccountServiceError) {
    res.status(e.statusCode).json({ error: e.message });
    return;
  }
  logger.error(e);
  res.status(500).json({ error: e instanceof Error ? e.message : 'Server error' });
}

function parseProvider(raw: string): ConnectedAccountProvider | null {
  if (raw === 'youtube' || raw === 'instagram') return raw;
  return null;
}

function parseSurface(raw: unknown): OAuthSurface {
  return raw === 'web' ? 'web' : 'native';
}

function firstQuery(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export function registerConnectedAccountRoutes(app: Express): void {
  app.get('/connected-accounts/:provider/oauth/callback', async (req, res) => {
    const provider = parseProvider(String(req.params.provider ?? ''));
    if (!provider) {
      res.status(400).type('text').send('Invalid provider');
      return;
    }
    try {
      const admin = createSupabaseAdmin();
      const svc = createConnectedAccountService(admin);
      const result = await svc.finishOAuthRedirect({
        provider,
        code: firstQuery(req.query.code),
        state: firstQuery(req.query.state),
        oauthError: firstQuery(req.query.error),
      });
      res.redirect(302, result.redirectUrl);
    } catch (e) {
      if (e instanceof ConnectedAccountServiceError) {
        logger.error({ provider, status: e.statusCode }, 'connected account oauth callback rejected');
        res.status(e.statusCode).type('text').send(e.statusCode === 400 ? 'Invalid OAuth state' : e.message);
        return;
      }
      logger.error({ provider }, 'connected account oauth callback failed');
      res.status(500).type('text').send('OAuth callback failed');
    }
  });

  app.get('/users/me/connected-accounts', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const userSvc = createUserService(createSupabaseAdmin());
      await userSvc.ensureFromAuth(user);
      const svc = createConnectedAccountService(createSupabaseAdmin());
      const accounts = await svc.listForUser(user.id);
      res.json({
        accounts,
        providers: {
          youtube: { linkingEnabled: isConnectedAccountProviderEnabled('youtube') },
          instagram: { linkingEnabled: isConnectedAccountProviderEnabled('instagram') },
        },
      });
    } catch (e) {
      handleError(res, e);
    }
  });

  app.post('/users/me/connected-accounts/:provider/oauth/start', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const provider = parseProvider(String(req.params.provider ?? ''));
      if (!provider) {
        res.status(400).json({ error: 'Invalid provider' });
        return;
      }
      const userSvc = createUserService(createSupabaseAdmin());
      await userSvc.ensureFromAuth(user);
      const svc = createConnectedAccountService(createSupabaseAdmin());
      const started = await svc.startOAuth(user.id, provider, parseSurface(req.body?.surface));
      res.json(started);
    } catch (e) {
      handleError(res, e);
    }
  });

  app.post('/users/me/connected-accounts/:provider/oauth/complete', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const provider = parseProvider(String(req.params.provider ?? ''));
      if (!provider) {
        res.status(400).json({ error: 'Invalid provider' });
        return;
      }
      const body = req.body as { code?: string; state?: string };
      if (!body.code?.trim() || !body.state?.trim()) {
        res.status(400).json({ error: 'code and state are required' });
        return;
      }
      const userSvc = createUserService(createSupabaseAdmin());
      await userSvc.ensureFromAuth(user);
      const svc = createConnectedAccountService(createSupabaseAdmin());
      const account = await svc.completeOAuth(user.id, provider, {
        code: body.code.trim(),
        state: body.state.trim(),
      });
      res.json({ account });
    } catch (e) {
      handleError(res, e);
    }
  });

  app.post('/users/me/connected-accounts/:id/disconnect', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const id = String(req.params.id ?? '');
      const userSvc = createUserService(createSupabaseAdmin());
      await userSvc.ensureFromAuth(user);
      const svc = createConnectedAccountService(createSupabaseAdmin());
      const account = await svc.disconnect(user.id, id);
      res.json({ account });
    } catch (e) {
      handleError(res, e);
    }
  });

  app.post('/users/me/connected-accounts/:id/reauth', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const id = String(req.params.id ?? '');
      const userSvc = createUserService(createSupabaseAdmin());
      await userSvc.ensureFromAuth(user);
      const svc = createConnectedAccountService(createSupabaseAdmin());
      const started = await svc.startReauth(user.id, id, parseSurface(req.body?.surface));
      res.json(started);
    } catch (e) {
      handleError(res, e);
    }
  });

  app.post('/users/me/connected-accounts/:id/health', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const id = String(req.params.id ?? '');
      const userSvc = createUserService(createSupabaseAdmin());
      await userSvc.ensureFromAuth(user);
      const svc = createConnectedAccountService(createSupabaseAdmin());
      const account = await svc.healthCheck(user.id, id);
      res.json({ account });
    } catch (e) {
      handleError(res, e);
    }
  });
}
