import type { Express, Request, Response } from 'express';
import { rethrowUnverifiedEmail, sendAuthError } from '../auth/requireAuth';
import { assertEmailVerified } from '../auth/emailVerification';
import { createSupabaseAdmin, createSupabaseUserClient } from '../supabase';
import { PlaceService } from './PlaceService';
import { SupabasePlaceRepository } from './SupabasePlaceRepository';

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
  service: { listForUser(userId: string): Promise<{ items: unknown[]; itemCount: number }> };
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
      const view = await deps.service.listForUser(auth.userId);
      res.json({ items: view.items, itemCount: view.itemCount });
    } catch (e) {
      if (sendAuthError(res, e)) return;
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
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
}
