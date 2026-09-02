import type { Express, Request, Response } from 'express';
import { createSupabaseUserClient } from '../supabase';
import {
  getSharedSearchService,
  SearchServiceError,
} from './factory';
import { createSearchEventConsumer } from './eventConsumer';

async function optionalUserId(req: Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth) return null;
  try {
    const {
      data: { user },
    } = await createSupabaseUserClient(auth).auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Search HTTP surface — blended query, autocomplete, telemetry, optional Recs candidates.
 * Indexing is primarily event-driven via SearchEventConsumer; admin upserts for bootstrap/dev.
 */
export function registerSearchRoutes(app: Express): void {
  const search = getSharedSearchService();
  const consumer = createSearchEventConsumer(search);

  app.get('/search', async (req, res) => {
    try {
      const q = String(req.query.q ?? '');
      const userId = await optionalUserId(req);
      const presentation =
        req.query.presentation === 'typed' ? 'typed' : 'unified';
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor = req.query.cursor ? String(req.query.cursor) : null;

      const filters: {
        creatorId?: string;
        brand?: string;
        category?: string;
        verifiedOnly?: boolean;
        recentlyPublished?: boolean;
        popular?: boolean;
        priceMin?: number;
        priceMax?: number;
      } = {};
      if (req.query.creator_id) filters.creatorId = String(req.query.creator_id);
      if (req.query.brand) filters.brand = String(req.query.brand);
      if (req.query.category) filters.category = String(req.query.category);
      if (req.query.verified === '1' || req.query.verified === 'true') {
        filters.verifiedOnly = true;
      }
      if (req.query.recent === '1' || req.query.recent === 'true') {
        filters.recentlyPublished = true;
      }
      if (req.query.popular === '1' || req.query.popular === 'true') {
        filters.popular = true;
      }
      if (req.query.price_min != null) {
        const n = Number(req.query.price_min);
        if (Number.isFinite(n)) filters.priceMin = n;
      }
      if (req.query.price_max != null) {
        const n = Number(req.query.price_max);
        if (Number.isFinite(n)) filters.priceMax = n;
      }

      const result = await search.search({
        q,
        userId,
        presentation,
        limit,
        cursor,
        filters: Object.keys(filters).length ? filters : undefined,
        lexicalOnly: req.query.lexical_only === '1',
      });
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get('/search/autocomplete', async (req, res) => {
    try {
      const q = String(req.query.q ?? '');
      const userId = await optionalUserId(req);
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const result = await search.autocomplete({ q, userId, limit });
      res.json(result);
    } catch (e) {
      sendError(res, e);
    }
  });

  /** Search-owned click telemetry — does not invent Engagement SoT. */
  app.post('/search/telemetry/click', async (req, res) => {
    try {
      const userId = await optionalUserId(req);
      const body = req.body as {
        query?: string;
        anonymous_id?: string;
        clicked_id?: string;
        clicked_entity_type?: 'collection' | 'creator' | 'product';
      };
      if (!body.query || !body.clicked_id || !body.clicked_entity_type) {
        res.status(400).json({
          error: 'query, clicked_id, clicked_entity_type required',
        });
        return;
      }
      search.recordClick({
        query: body.query,
        userId,
        anonymousId: body.anonymous_id ?? null,
        clickedId: body.clicked_id,
        clickedEntityType: body.clicked_entity_type,
      });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  /**
   * One-way candidates for Recommendations.
   * Normal Search does not depend on Recs.
   */
  app.get('/search/candidates', async (req, res) => {
    try {
      const q = String(req.query.q ?? '');
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const candidates = await search.candidatesForRecommendations({ q, limit });
      res.json({ query: q, candidates });
    } catch (e) {
      sendError(res, e);
    }
  });

  /**
   * Dev/bootstrap indexing — not a write-domain SoT.
   * Prefer event consumers in production.
   */
  app.post('/search/index/collection', async (req, res) => {
    try {
      await consumer.onCollectionPublishedOrUpdated(req.body);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/search/index/creator', async (req, res) => {
    try {
      await consumer.onCreatorUpdated(req.body);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post('/search/index/product', async (req, res) => {
    try {
      await consumer.onProductUpsert(req.body);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete('/search/index/:entityType/:id', async (req, res) => {
    try {
      const entityType = req.params.entityType as 'collection' | 'creator' | 'product';
      if (!['collection', 'creator', 'product'].includes(entityType)) {
        res.status(400).json({ error: 'entityType must be collection|creator|product' });
        return;
      }
      await search.deleteEntity(entityType, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });
}

function sendError(res: Response, e: unknown): void {
  if (e instanceof SearchServiceError) {
    res.status(e.statusCode).json({ error: e.message });
    return;
  }
  res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
}
