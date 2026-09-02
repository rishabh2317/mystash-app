import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createProductAiReviewService } from './jobs/productAiReviewQueue';

export function registerProductAiReviewRoutes(app: Express, admin: SupabaseClient): void {
  const service = createProductAiReviewService(admin);

  app.get('/products/:id/ai-review', async (req: Request, res: Response) => {
    try {
      const productId = String(req.params.id ?? '').trim();
      if (!productId) {
        res.status(400).json({ error: 'Product id is required' });
        return;
      }

      const outcome = await service.getAiReview(productId);
      if (outcome.kind === 'not_found') {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      res.status(outcome.httpStatus).json(outcome.body);
    } catch (e) {
      res.status(500).json({
        status: 'unavailable',
        catalogProductId: String(req.params.id ?? ''),
        reason: 'server_error',
        message: 'Could not load AI Review right now.',
      });
    }
  });
}
