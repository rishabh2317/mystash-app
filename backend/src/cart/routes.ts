import type { Express, Request, Response } from 'express';
import { requireAuthUserId } from '../auth/requireAuth';
import { createSupabaseAdmin } from '../supabase';
import { CartServiceError, createCartService } from './factory';
import type { CartItemSource, RemoveCartItemReason } from './domain/types';
import { getEnv } from '../env';
import { logger } from '../logger';

export function sendCartRouteError(res: Response, error: unknown, route: string): void {
  if (error instanceof CartServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  logger.error({ route, errorType: error instanceof Error ? error.name : typeof error }, 'cart.route_failed');
  res.status(500).json({ error: 'Cart is temporarily unavailable' });
}

async function requireUserId(req: Request, res: Response): Promise<string | null> {
  return requireAuthUserId(req, res, { requireVerifiedEmail: true });
}

function mapItemJson(item: {
  cartItemId: string;
  catalogProductId: string | null;
  discoveredProductId: string | null;
  addedAt: string;
  source: CartItemSource | null;
  availability: string;
  product: unknown;
}) {
  return {
    cartItemId: item.cartItemId,
    catalogProductId: item.catalogProductId,
    discoveredProductId: item.discoveredProductId,
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
      if (getEnv('SHARE_SUGGESTIONS_ENABLED') === 'true') {
        const ids = [...new Set(view.items.map(i=>i.source?.userImportId).filter((id):id is string=>Boolean(id)))];
        for(let n=0;n<ids.length;n+=100){
          const reviews=await admin.from('user_import_product_reviews').select('import_id,product_id').eq('user_id',userId).eq('state','accepted').in('import_id',ids.slice(n,n+100));
          if(reviews.error)throw new Error('Share attribution unavailable');
          for(const item of view.items)if(item.source && reviews.data.some(r=>r.import_id===item.source?.userImportId && r.product_id===(item.catalogProductId??item.discoveredProductId)))item.source={...item.source,matchKind:'similar'};
        }
      }
      res.json({
        items: view.items.map(mapItemJson),
        itemCount: view.itemCount,
      });
    } catch (e) { sendCartRouteError(res, e, 'list'); }
  });

  app.post('/cart/items', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;

      const body = req.body as {
        catalogProductId?: string;
        catalog_product_id?: string;
        discoveredProductId?: string;
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
      const discoveredProductId = body.discoveredProductId;
      if ((!catalogProductId && !discoveredProductId) || (catalogProductId && discoveredProductId)
        || (catalogProductId != null && typeof catalogProductId !== 'string')
        || (discoveredProductId != null && typeof discoveredProductId !== 'string')) {
        res.status(400).json({ error: 'Provide one valid product identity' });
        return;
      }

      // Explicit user action. Never accept the internal automatic flag from a request body.
      const result = await cart.addItem(userId, {
        catalogProductId, discoveredProductId,
        source: body.source ?? null,
      });

      res.status(result.created ? 201 : 200).json({
        ok: true,
        created: result.created,
        item: {
          cartItemId: result.item.id,
          catalogProductId: result.item.catalogProductId,
          ...(result.item.discoveredProductId ? { discoveredProductId: result.item.discoveredProductId } : {}),
          addedAt: result.item.addedAt,
          source: {
            collectionId: result.item.sourceCollectionId,
            creatorId: result.item.sourceCreatorId,
            collectionProductTagId: result.item.sourceCollectionProductTagId,
            surface: result.item.sourceSurface,
          },
        },
      });
    } catch (e) { sendCartRouteError(res, e, 'add'); }
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
    } catch (e) { sendCartRouteError(res, e, 'remove'); }
  });
}
