import type { Express, Request, Response } from 'express';
import { logger } from '../logger';
import { createSupabaseAdmin, createSupabaseUserClient } from '../supabase';
import { createUserImportService } from './factory';
import { UserImportServiceError } from './UserImportService';
import type { ShareProgressItem, SubmitUserImportResult } from './domain/types';

export type UserImportAuthenticator = (req: Request) => Promise<{ userId: string } | null>;

export type UserImportHandlerDeps = {
  service: { submit(userId: string, input: { rawInput: string }): Promise<SubmitUserImportResult> };
  authenticate: UserImportAuthenticator;
};

export type UserImportListHandlerDeps = {
  service: { listRecent(userId: string): Promise<ShareProgressItem[]> };
  authenticate: UserImportAuthenticator;
};

export type UserImportRetryHandlerDeps = {
  service: { retry(userId: string, importId: string): Promise<{ id: string; status: string }> };
  authenticate: UserImportAuthenticator;
};

export type UserImportDeleteHandlerDeps = {
  service: { delete(userId: string, importId: string): Promise<void> };
  authenticate: UserImportAuthenticator;
};

/** Same Bearer-JWT pattern as Cart / User routes. */
export function supabaseUserImportAuthenticator(): UserImportAuthenticator {
  return async (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') return null;
    try {
      const {
        data: { user },
      } = await createSupabaseUserClient(authHeader).auth.getUser();
      return user ? { userId: user.id } : null;
    } catch {
      return null;
    }
  };
}

/**
 * POST /imports — accept a shared URL and acknowledge immediately.
 *
 * Authenticates, validates, get-or-creates the global content source, persists the
 * user-scoped import, and hands processing to the existing queue. It does not wait for fetch,
 * extraction, AI, or Product Intelligence. Idempotency reuses the Cart convention:
 * a unique constraint plus 201-created / 200-existing, so re-sharing is not an error.
 */
export function createUserImportHandler(deps: UserImportHandlerDeps) {
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

      const body = (req.body ?? {}) as {
        url?: unknown;
        text?: unknown;
        userId?: unknown;
        user_id?: unknown;
      };

      // Never trust a client-supplied user id.
      if (body.userId != null || body.user_id != null) {
        res.status(400).json({ error: 'userId must not be supplied by client' });
        return;
      }

      // A share can arrive as a bare URL (`url`) or as text containing one (`text`).
      const rawInput =
        typeof body.url === 'string' ? body.url : typeof body.text === 'string' ? body.text : null;
      if (rawInput === null) {
        res.status(400).json({ error: 'url required' });
        return;
      }

      const result = await deps.service.submit(auth.userId, { rawInput });
      res.status(result.created ? 201 : 200).json({
        importId: result.record.id,
        status: result.record.status,
        created: result.created,
      });
    } catch (e) {
      if (e instanceof UserImportServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      logger.error(e);
      res.status(500).json({ error: 'Could not accept the shared link' });
    }
  };
}

/**
 * GET /imports — recent share progress for Bag.
 * States are user-facing only; queue/resolver names stay off the wire.
 */
export function createUserImportListHandler(deps: UserImportListHandlerDeps) {
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
      const shares = await deps.service.listRecent(auth.userId);
      res.json({ shares });
    } catch (e) {
      if (e instanceof UserImportServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      logger.error(e);
      res.status(500).json({ error: 'Could not load your shares' });
    }
  };
}

export function createUserImportRetryHandler(deps: UserImportRetryHandlerDeps) {
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
      const importId = typeof req.params.importId === 'string' ? req.params.importId : '';
      const record = await deps.service.retry(auth.userId, importId);
      res.json({ importId: record.id, status: 'RECEIVED' });
    } catch (e) {
      if (e instanceof UserImportServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      logger.error(e);
      res.status(500).json({ error: 'Could not retry that link' });
    }
  };
}

export function createUserImportDeleteHandler(deps: UserImportDeleteHandlerDeps) {
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
      const importId = typeof req.params.importId === 'string' ? req.params.importId : '';
      await deps.service.delete(auth.userId, importId);
      res.status(204).send();
    } catch (e) {
      if (e instanceof UserImportServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      logger.error(e);
      res.status(500).json({ error: 'Could not delete that share' });
    }
  };
}

export function registerUserImportRoutes(app: Express): void {
  const service = createUserImportService(createSupabaseAdmin());
  const authenticate = supabaseUserImportAuthenticator();
  app.get('/imports', createUserImportListHandler({ service, authenticate }));
  app.post(
    '/imports',
    createUserImportHandler({
      service,
      authenticate,
    }),
  );
  app.post('/imports/:importId/retry', createUserImportRetryHandler({ service, authenticate }));
  app.delete('/imports/:importId', createUserImportDeleteHandler({ service, authenticate }));
}
