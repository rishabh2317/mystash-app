import type { Express, Request, Response } from 'express';
import { requireAuthUser } from '../auth/requireAuth';
import { createSupabaseAdmin } from '../supabase';
import { createUserService } from '../user/factory';
import { logger } from '../logger';
import { CreatorLibraryServiceError, createCreatorLibraryService } from './CreatorLibraryService';
import { createLibraryProductService, LibraryProductServiceError } from './LibraryProductService';
import { createLibraryToCollectionService, LibraryToCollectionError } from './LibraryToCollectionService';

async function requireUser(req: Request, res: Response) {
  return requireAuthUser(req, res, { requireVerifiedEmail: true });
}

function handleError(res: Response, e: unknown): void {
  if (
    e instanceof CreatorLibraryServiceError ||
    e instanceof LibraryProductServiceError ||
    e instanceof LibraryToCollectionError
  ) {
    res.status(e.statusCode).json({ error: e.message });
    return;
  }
  logger.error(e);
  res.status(500).json({ error: e instanceof Error ? e.message : 'Server error' });
}

export function registerCreatorLibraryRoutes(app: Express): void {
  app.get('/users/me/library', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      await createUserService(createSupabaseAdmin()).ensureFromAuth(user);
      const limit = Number(req.query.limit ?? 30);
      const body = await createCreatorLibraryService(createSupabaseAdmin()).list(
        user.id,
        Number.isFinite(limit) ? limit : 30,
      );
      res.json(body);
    } catch (e) {
      handleError(res, e);
    }
  });

  app.post('/users/me/connected-accounts/:id/library/sync', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      await createUserService(createSupabaseAdmin()).ensureFromAuth(user);
      const queued = await createCreatorLibraryService(createSupabaseAdmin()).requestSync(
        user.id,
        String(req.params.id ?? ''),
      );
      res.status(202).json(queued);
    } catch (e) {
      handleError(res, e);
    }
  });

  app.get('/users/me/collections', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      await createUserService(createSupabaseAdmin()).ensureFromAuth(user);
      const collections = await createLibraryToCollectionService(createSupabaseAdmin()).listCollections(user.id);
      res.json({ collections });
    } catch (e) {
      handleError(res, e);
    }
  });

  app.post('/users/me/library/items/:contentSourceId/collections', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      await createUserService(createSupabaseAdmin()).ensureFromAuth(user);
      const body = (req.body ?? {}) as { collectionId?: string; title?: string };
      const result = await createLibraryToCollectionService(createSupabaseAdmin()).addLibraryItem({
        user: {
          id: user.id,
          email: user.email,
          user_metadata: user.user_metadata as Record<string, unknown>,
        },
        contentSourceId: String(req.params.contentSourceId ?? ''),
        collectionId: body.collectionId,
        title: body.title,
      });
      res.status(result.createdCollection ? 201 : 200).json(result);
    } catch (e) {
      handleError(res, e);
    }
  });

  app.get('/users/me/library/items/:contentSourceId/products', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      await createUserService(createSupabaseAdmin()).ensureFromAuth(user);
      const products = await createLibraryProductService(createSupabaseAdmin()).list(
        user.id,
        String(req.params.contentSourceId ?? ''),
      );
      res.json({ products });
    } catch (e) {
      handleError(res, e);
    }
  });

  app.post('/users/me/library/items/:contentSourceId/products', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      await createUserService(createSupabaseAdmin()).ensureFromAuth(user);
      const body = req.body as { catalogProductId?: string; discoveredProductId?: string };
      const result = await createLibraryProductService(createSupabaseAdmin()).attach(
        user.id,
        String(req.params.contentSourceId ?? ''),
        {
          catalogProductId: body.catalogProductId,
          discoveredProductId: body.discoveredProductId,
        },
      );
      res.status(result.created ? 201 : 200).json(result);
    } catch (e) {
      handleError(res, e);
    }
  });

  app.delete('/users/me/library/items/:contentSourceId/products/:productId', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      await createUserService(createSupabaseAdmin()).ensureFromAuth(user);
      await createLibraryProductService(createSupabaseAdmin()).remove(
        user.id,
        String(req.params.contentSourceId ?? ''),
        String(req.params.productId ?? ''),
      );
      res.json({ ok: true });
    } catch (e) {
      handleError(res, e);
    }
  });
}
