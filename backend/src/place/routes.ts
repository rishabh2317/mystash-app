import type { Express, Request, Response } from 'express';
import { rethrowUnverifiedEmail, sendAuthError } from '../auth/requireAuth';
import { assertEmailVerified } from '../auth/emailVerification';
import { createSupabaseAdmin, createSupabaseUserClient } from '../supabase';
import { PlaceService, PlacePageError, type PlacePageOptions } from './PlaceService';
import { SupabasePlaceRepository } from './SupabasePlaceRepository';
import { PlaceRepositoryError, type PlaceRepository } from './PlaceRepository';
import { uuid } from '../user-import/share/contracts';
import { logger } from '../logger';

export type PlaceAuthenticator = (req: Request) => Promise<{ userId: string } | null>;

export function supabasePlaceAuthenticator(): PlaceAuthenticator {
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

export function createPlaceListHandler(deps: {
  service: { listForUser(userId: string, page?: PlacePageOptions): Promise<{ items: unknown[]; itemCount: number; displayItemCount?: number; nextCursor?: string | null }> };
  authenticate: PlaceAuthenticator;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      res.status(401).json({ error: 'Missing authorization' });
      return;
    }
    try {
      const auth = await deps.authenticate(req);
      if (!auth) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const query = req.query ?? {};
      let page: PlacePageOptions | undefined;
      if (query.limit !== undefined || query.cursor !== undefined) {
        if (typeof query.limit !== 'string' || !/^\d{1,3}$/.test(query.limit) ||
          Number(query.limit) < 1 || Number(query.limit) > 100 ||
          (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 300))) {
          res.status(400).json({ error: 'Invalid Places pagination' }); return;
        }
        page = { limit: Number(query.limit), cursor: query.cursor as string | undefined };
      }
      const view = await deps.service.listForUser(auth.userId, page);
      res.json(view);
    } catch (e) {
      if (e instanceof PlacePageError) { res.status(400).json({ error: e.message }); return; }
      if (sendAuthError(res, e)) return;
      logger.error({ route: 'places.list', errorType: e instanceof Error ? e.name : typeof e }, 'place.route_failed');
      res.status(500).json({ error: 'Places are temporarily unavailable' });
    }
  };
}

export function registerPlaceRoutes(app: Express): void {
  const admin = createSupabaseAdmin();
  app.get(
    '/places',
    createPlaceListHandler({
      service: new PlaceService(new SupabasePlaceRepository(admin)),
      authenticate: supabasePlaceAuthenticator(),
    }),
  );
  const membership = (restore: boolean) => createPlaceMembershipHandler({ repository: new SupabasePlaceRepository(admin),
    authenticate: supabasePlaceAuthenticator(), restore });
  app.delete('/places/:saveId', membership(false));
  app.post('/places/:saveId/restore', membership(true));
}

/** Owner comes from the verified session; save redirects are resolved inside the transaction. */
export function createPlaceMembershipHandler(deps: {
  repository: Pick<PlaceRepository, 'setMembership'>; authenticate: PlaceAuthenticator;
  restore: boolean;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const auth = await deps.authenticate(req);
      if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const id = String(req.params.saveId);
      if (!uuid.test(id)) { res.status(404).json({ error: 'Place save not found' }); return; }
      await deps.repository.setMembership(auth.userId, id, deps.restore);
      res.json({ ok: true });
    } catch (error) {
      if (sendAuthError(res, error)) return;
      const status = error instanceof PlaceRepositoryError ? error.code === 'not_found' ? 404 : 409 : 503;
      if (!(error instanceof PlaceRepositoryError)) logger.error({ route: 'places.membership', errorType: error instanceof Error ? error.name : typeof error }, 'place.route_failed');
      res.status(status).json({ error: status === 404 ? 'Place save not found' : 'Place membership could not be changed' });
    }
  };
}
