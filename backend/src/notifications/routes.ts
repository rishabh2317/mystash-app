import { timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { getEnv } from '../env';
import { logger } from '../logger';
import { rethrowUnverifiedEmail, sendAuthError } from '../auth/requireAuth';
import { assertEmailVerified } from '../auth/emailVerification';
import { createSupabaseAdmin, createSupabaseUserClient } from '../supabase';
import { createNotificationRepository, createPushRepository } from './factory';
import { PushService } from './PushService';
import { buildNotificationHealthReport } from './health';
import type { NotificationRepository } from './NotificationRepository';
import { NotificationService, NotificationServiceError } from './NotificationService';

export type NotificationAuthenticator = (req: Request) => Promise<{ userId: string } | null>;

export type NotificationHandlerDeps = {
  service: NotificationService;
  authenticate: NotificationAuthenticator;
  pushService?: PushService;
};

export function supabaseNotificationAuthenticator(): NotificationAuthenticator {
  return async (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') return null;
    try {
      const {
        data: { user },
      } = await createSupabaseUserClient(authHeader).auth.getUser();
      if (!user) return null;
      assertEmailVerified(user);
      return { userId: user.id };
    } catch (e) {
      rethrowUnverifiedEmail(e);
      return null;
    }
  };
}

type AuthedHandler = (userId: string, req: Request, res: Response) => Promise<void>;

/** User id always comes from the verified JWT, never from the request body. */
function authed(deps: NotificationHandlerDeps, handler: AuthedHandler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || typeof authHeader !== 'string') {
        res.status(401).json({ error: 'Missing authorization' });
        return;
      }
      const auth = await deps.authenticate(req);
      if (!auth) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await handler(auth.userId, req, res);
    } catch (e) {
      if (sendAuthError(res, e)) return;
      if (e instanceof NotificationServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      logger.error({ message: (e as Error).message?.slice(0, 200) }, 'notification.route_failed');
      res.status(500).json({ error: 'Server error' });
    }
  };
}

function queryString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export function createListNotificationsHandler(deps: NotificationHandlerDeps) {
  return authed(deps, async (userId, req, res) => {
    const limitRaw = queryString(req.query.limit);
    const page = await deps.service.listFeed(userId, {
      cursor: queryString(req.query.cursor),
      limit: limitRaw ? Number(limitRaw) : null,
      category: queryString(req.query.category),
    });
    res.json(page);
  });
}

export function createUnreadCountHandler(deps: NotificationHandlerDeps) {
  return authed(deps, async (userId, _req, res) => {
    res.json(await deps.service.unreadCount(userId));
  });
}

export function createMarkReadHandler(deps: NotificationHandlerDeps) {
  return authed(deps, async (userId, req, res) => {
    res.json(await deps.service.markRead(userId, (req.body ?? {}) as Record<string, unknown>));
  });
}

export function createMarkSeenHandler(deps: NotificationHandlerDeps) {
  return authed(deps, async (userId, req, res) => {
    res.json(await deps.service.markSeen(userId, (req.body ?? {}).upTo));
  });
}

export function createGetNotificationSettingsHandler(deps: NotificationHandlerDeps) {
  return authed(deps, async (userId, _req, res) => {
    res.json(await deps.service.getSettings(userId));
  });
}

export function createUpdateNotificationSettingsHandler(deps: NotificationHandlerDeps) {
  return authed(deps, async (userId, req, res) => {
    res.json(await deps.service.updateSettings(userId, (req.body ?? {}) as Record<string, unknown>));
  });
}

export function createRecordOpenHandler(deps: NotificationHandlerDeps) {
  return authed(deps, async (userId, req, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (deps.pushService && body.deliveryId != null) {
      const tracked = await deps.pushService.recordPushOpen(userId, id, body.deliveryId, body.action);
      if (tracked) {
        res.json({ ok: true });
        return;
      }
    }
    await deps.service.recordOpen(userId, id);
    res.json({ ok: true });
  });
}

function installationIdParam(req: Request): string {
  return typeof req.params.installationId === 'string' ? req.params.installationId : '';
}

export function createRegisterPushHandler(deps: NotificationHandlerDeps & { pushService: PushService }) {
  return authed(deps, async (userId, req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await deps.pushService.register(userId, installationIdParam(req), body);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ registrationId: result.registrationId, revocationCredential: result.revocationCredential });
  });
}

/**
 * Unauthenticated by design: used after sign-out, when no session exists. The body's
 * credential is the only authority and reaches only the installation in the path.
 */
export function createRevokePushHandler(pushService: PushService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(await pushService.revoke(installationIdParam(req), body.credential));
    } catch (e) {
      if (e instanceof NotificationServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      logger.error({ message: (e as Error).message?.slice(0, 200) }, 'notification.route_failed');
      res.status(500).json({ error: 'Server error' });
    }
  };
}

export function createUnregisterPushHandler(deps: NotificationHandlerDeps & { pushService: PushService }) {
  return authed(deps, async (userId, req, res) => {
    res.json(await deps.pushService.unregister(userId, installationIdParam(req)));
  });
}

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function operatorSecret(): string | undefined {
  return getEnv('NOTIFICATIONS_OPERATOR_SECRET') ?? getEnv('NOTIFICATIONS_HEALTH_SECRET');
}

function requireOperatorSecret(req: Request, res: Response): boolean {
  const expected = operatorSecret();
  const provided = req.headers['x-notifications-operator-secret'];
  if (!expected || typeof provided !== 'string' || !secretMatches(provided, expected)) {
    res.status(404).json({ error: 'Not found' });
    return false;
  }
  return true;
}

/** Internal only: 404 unless NOTIFICATIONS_HEALTH_SECRET is configured and presented. */
export function createNotificationHealthHandler(repo: NotificationRepository) {
  return async (req: Request, res: Response): Promise<void> => {
    const expected = getEnv('NOTIFICATIONS_HEALTH_SECRET');
    const provided = req.headers['x-notifications-health-secret'];
    if (!expected || typeof provided !== 'string' || !secretMatches(provided, expected)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    try {
      const report = await buildNotificationHealthReport(repo);
      res.status(report.status === 'ok' ? 200 : 503).json(report);
    } catch (e) {
      logger.error({ message: (e as Error).message?.slice(0, 200) }, 'notification.health_failed');
      res.status(503).json({ status: 'degraded', reasons: ['db_unavailable'] });
    }
  };
}

export function createCreateCampaignHandler(deps: Pick<NotificationHandlerDeps, 'service'>) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireOperatorSecret(req, res)) return;
    try {
      const campaign = await deps.service.createCampaign((req.body ?? {}) as Record<string, unknown>);
      res.status(201).json(campaign);
    } catch (e) {
      if (e instanceof NotificationServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      logger.error({ message: (e as Error).message?.slice(0, 200) }, 'notification.campaign_failed');
      res.status(500).json({ error: 'Server error' });
    }
  };
}

export function createGetCampaignHandler(deps: Pick<NotificationHandlerDeps, 'service'>) {
  return async (req: Request, res: Response): Promise<void> => {
    if (!requireOperatorSecret(req, res)) return;
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : '';
      res.json(await deps.service.getCampaign(id));
    } catch (e) {
      if (e instanceof NotificationServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      logger.error({ message: (e as Error).message?.slice(0, 200) }, 'notification.campaign_failed');
      res.status(500).json({ error: 'Server error' });
    }
  };
}

export function registerNotificationRoutes(app: Express): void {
  const admin = createSupabaseAdmin();
  const repo = createNotificationRepository(admin);
  const deps = {
    service: new NotificationService(repo),
    authenticate: supabaseNotificationAuthenticator(),
    pushService: new PushService(createPushRepository(admin)),
  };
  app.get('/users/me/notifications', createListNotificationsHandler(deps));
  app.get('/users/me/notifications/unread-count', createUnreadCountHandler(deps));
  app.post('/users/me/notifications/read', createMarkReadHandler(deps));
  app.post('/users/me/notifications/seen', createMarkSeenHandler(deps));
  app.get('/users/me/notification-settings', createGetNotificationSettingsHandler(deps));
  app.put('/users/me/notification-settings', createUpdateNotificationSettingsHandler(deps));
  app.post('/users/me/notifications/:id/opened', createRecordOpenHandler(deps));
  // Registration is accepted whether or not push delivery is enabled; it requires the Phase 4 migration.
  app.put('/users/me/push-registrations/:installationId', createRegisterPushHandler(deps));
  app.delete('/users/me/push-registrations/:installationId', createUnregisterPushHandler(deps));
  app.post('/push-registrations/:installationId/revoke', createRevokePushHandler(deps.pushService));
  app.get('/health/notifications', createNotificationHealthHandler(repo));
  app.post('/internal/notifications/campaigns', createCreateCampaignHandler(deps));
  app.get('/internal/notifications/campaigns/:id', createGetCampaignHandler(deps));
}
