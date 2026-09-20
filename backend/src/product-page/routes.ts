import type { Express, Request, Response } from 'express';
import { logger } from '../logger';
import { createSupabaseAdmin } from '../supabase';
import { isValidCatalogProductId } from '../cart/domain/lifecycle';
import { createProductPageService, ProductPageServiceError } from './factory';
import type { ProductPageQuery } from './domain/types';

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function registerProductPageRoutes(app: Express): void {
  const service = createProductPageService(createSupabaseAdmin());

  app.get('/products/:id/page', async (req: Request, res: Response) => {
    try {
      const productId = String(req.params.id ?? '').trim();
      if (!isValidCatalogProductId(productId)) {
        res.status(400).json({ error: 'Product id is required' });
        return;
      }
      const query: ProductPageQuery = {
        contentSourceId: queryString(req.query.contentSourceId),
        userImportId: queryString(req.query.userImportId),
      };
      const page = await service.getPage(productId, query);
      res.json(page);
    } catch (e) {
      if (e instanceof ProductPageServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      logger.error(e);
      res.status(500).json({ error: 'Could not load this product' });
    }
  });
}
