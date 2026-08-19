import type { Express, Request, Response } from 'express';
import { createSupabaseAdmin, createSupabaseUserClient } from '../supabase';
import { CartServiceError, createCartService } from './factory';
import type { CartItemSource, RemoveCartItemReason } from './domain/types';

async function requireUserId(req: Request, res: Response): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth) {
    res.status(401).json({ error: 'Missing authorization' });
    return null;
  }
  try {
    const {
      data: { user },
    } = await createSupabaseUserClient(auth).auth.getUser();
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    return user.id;
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

function mapItemJson(item: {
  cartItemId: string;
  catalogProductId: string;
  addedAt: string;
  source: CartItemSource | null;
  availability: string;
  product: unknown;
}) {
  return {
    cartItemId: item.cartItemId,
    catalogProductId: item.catalogProductId,
    addedAt: item.addedAt,
    source: item.source,
    availability: item.availability,
    product: item.product,
  };
}

export function registerCartRoutes(app: Express): void {
  const admin = createSupabaseAdmin();
  const cart = createCartService(admin);

  app.get('/cart', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;
      const view = await cart.getCart(userId);
      res.json({
        items: view.items.map(mapItemJson),
        itemCount: view.itemCount,
      });
    } catch (e) {
      if (e instanceof CartServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/cart/items', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;

      const body = req.body as {
        catalogProductId?: string;
        catalog_product_id?: string;
        source?: CartItemSource;
        userId?: string;
        user_id?: string;
      };

      // Never trust client userId.
      if (body.userId != null || body.user_id != null) {
        res.status(400).json({ error: 'userId must not be supplied by client' });
        return;
      }

      const catalogProductId = body.catalogProductId ?? body.catalog_product_id;
      if (!catalogProductId || typeof catalogProductId !== 'string') {
        res.status(400).json({ error: 'catalogProductId required' });
        return;
      }

      const result = await cart.addItem(userId, {
        catalogProductId,
        source: body.source ?? null,
      });

      res.status(result.created ? 201 : 200).json({
        ok: true,
        created: result.created,
        item: {
          cartItemId: result.item.id,
          catalogProductId: result.item.catalogProductId,
          addedAt: result.item.addedAt,
          source: {
            collectionId: result.item.sourceCollectionId,
            creatorId: result.item.sourceCreatorId,
            collectionProductTagId: result.item.sourceCollectionProductTagId,
            surface: result.item.sourceSurface,
          },
        },
      });
    } catch (e) {
      if (e instanceof CartServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/cart/items/:catalogProductId', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;

      const reasonRaw = typeof req.query.reason === 'string' ? req.query.reason : 'user_remove';
      const reason: RemoveCartItemReason =
        reasonRaw === 'purchase_confirmed' ? 'purchase_confirmed' : 'user_remove';

      const result = await cart.removeItem(userId, req.params.catalogProductId, reason);
      res.status(204).send();
      void result;
    } catch (e) {
      if (e instanceof CartServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
