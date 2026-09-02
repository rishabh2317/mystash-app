import type { Express, Request, Response } from 'express';
import { createSupabaseAdmin, createSupabaseUserClient } from '../supabase';
import { createCollectionService, CollectionServiceError } from './factory';
import { ensureCollectionForIngest } from './ingestBridge';
import { detectPlatform } from '../pipeline/detect';
import { enqueueIngestPipeline } from '../workers/queue';
import { logger } from '../logger';
import { createUserService } from '../user/factory';
import {
  scheduleSearchCollectionProjection,
  scheduleSearchCollectionRemoval,
} from '../search/schedule';
import { pruneVideoProjectionIfNotPublic } from './videoProjectionSync';

async function requireUser(req: Request, res: Response) {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({ error: 'Missing authorization' });
    return null;
  }
  const userClient = createSupabaseUserClient(authHeader);
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();
  if (error || !user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

async function optionalUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  try {
    const userClient = createSupabaseUserClient(authHeader);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

function handleServiceError(res: Response, e: unknown): void {
  if (e instanceof CollectionServiceError) {
    res.status(e.statusCode).json({ error: e.message });
    return;
  }
  const code = (e as { statusCode?: number }).statusCode;
  if (code) {
    res.status(code).json({ error: (e as Error).message });
    return;
  }
  logger.error(e);
  res.status(500).json({ error: (e as Error).message ?? 'Server error' });
}

export function registerCollectionRoutes(app: Express): void {
  app.post('/collections', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      await createUserService(admin).ensureFromAuth(user);
      const svc = createCollectionService(admin);
      const body = req.body as {
        source_url?: string;
        title?: string;
        caption?: string;
        enqueue_ingest?: boolean;
      };

      const sourceUrl = body.source_url?.trim();
      if (sourceUrl) {
        let platform: string;
        try {
          platform = detectPlatform(new URL(sourceUrl).href);
        } catch {
          res.status(400).json({ error: 'Invalid source_url' });
          return;
        }
        if (platform === 'unknown') {
          res.status(400).json({ error: 'Unsupported platform' });
          return;
        }

        const { data: ingestRow, error: insErr } = await admin
          .from('ingest_requests')
          .insert({
            user_id: user.id,
            source_url: sourceUrl,
            platform,
            status: 'processing',
            stash_score: 4.5,
            video_title: body.title?.trim() || null,
          })
          .select('id')
          .single();
        if (insErr || !ingestRow) {
          res.status(500).json({ error: 'Could not create ingest', detail: insErr?.message });
          return;
        }
        const ingestId = String(ingestRow.id);
        const collectionId = await ensureCollectionForIngest(admin, {
          user: {
            id: user.id,
            email: user.email,
            user_metadata: user.user_metadata as Record<string, unknown>,
          },
          ingestId,
          sourceUrl,
          platform,
          title: body.title ?? null,
          originType: 'url_ingest',
          startProcessing: true,
        });

        if (body.enqueue_ingest !== false) {
          try {
            await enqueueIngestPipeline({
              ingestRequestId: ingestId,
              traceId: crypto.randomUUID(),
            });
          } catch (e) {
            logger.warn({ err: e, ingestId }, 'collections.create_enqueue_failed');
          }
        }

        const agg = await svc.getAggregate(collectionId);
        res.status(201).json({ collection: agg, ingestId });
        return;
      }

      const draft = await svc.createDraft({
        user: {
          id: user.id,
          email: user.email,
          user_metadata: user.user_metadata as Record<string, unknown>,
        },
        title: body.title ?? null,
        caption: body.caption ?? null,
        originType: 'manual_curation',
      });
      res.status(201).json({ collection: await svc.getAggregate(draft.id) });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  /**
   * Public list: published Collections for a creator (Creator Profile grid).
   * Must be registered before /collections/:id so "collections" isn't an id.
   */
  app.get('/collections', async (req, res) => {
    try {
      const creatorId =
        typeof req.query.creator_id === 'string' ? req.query.creator_id.trim() : '';
      if (!creatorId) {
        res.status(400).json({ error: 'creator_id is required' });
        return;
      }
      const limitRaw =
        typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const cursor =
        typeof req.query.cursor === 'string' ? req.query.cursor : null;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const result = await svc.listPublishedPublicByCreator(creatorId, {
        limit: limitRaw,
        cursor,
      });
      res.json(result);
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  /**
   * Public list: distinct catalog products tagged on a creator's published Collections.
   * Must be registered before /collections/:id.
   */
  app.get('/collections/products', async (req, res) => {
    try {
      const creatorId =
        typeof req.query.creator_id === 'string' ? req.query.creator_id.trim() : '';
      if (!creatorId) {
        res.status(400).json({ error: 'creator_id is required' });
        return;
      }
      const limitRaw =
        typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const cursor =
        typeof req.query.cursor === 'string' ? req.query.cursor : null;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const result = await svc.listPublishedProductsByCreator(creatorId, {
        limit: limitRaw,
        cursor,
      });
      res.json(result);
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.get('/collections/by-slug/:slug', async (req, res) => {
    try {
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const agg = await svc.getBySlug(String(req.params.slug));
      if (!agg) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }
      const userId = await optionalUserId(req);
      if (!svc.canRead(agg.collection, userId)) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }
      res.json(agg);
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.get('/collections/:id', async (req, res) => {
    try {
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const agg = await svc.getAggregate(String(req.params.id));
      if (!agg) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }
      const userId = await optionalUserId(req);
      if (!svc.canRead(agg.collection, userId)) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }
      res.json(agg);
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.patch('/collections/:id', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const body = req.body as {
        title?: string | null;
        caption?: string | null;
        language?: string | null;
        primary_locale?: string | null;
        recommendation_intent?: string | null;
        recommendation_intents_secondary?: string[];
        visibility?: 'public' | 'unlisted' | 'private';
      };
      const updated = await svc.updateContent({
        collectionId: String(req.params.id),
        userId: user.id,
        title: body.title,
        caption: body.caption,
        language: body.language,
        primaryLocale: body.primary_locale,
        recommendationIntent: body.recommendation_intent,
        recommendationIntentsSecondary: body.recommendation_intents_secondary,
        visibility: body.visibility,
      });
      await pruneVideoProjectionIfNotPublic(admin, updated);
      res.json({ collection: updated });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  const lifecyclePost =
    (
      action: (
        svc: ReturnType<typeof createCollectionService>,
        id: string,
        userId: string,
        body: Record<string, unknown>,
      ) => Promise<unknown>,
    ) =>
    async (req: Request, res: Response) => {
      try {
        const user = await requireUser(req, res);
        if (!user) return;
        const admin = createSupabaseAdmin();
        const svc = createCollectionService(admin);
        const result = await action(
          svc,
          String(req.params.id),
          user.id,
          (req.body ?? {}) as Record<string, unknown>,
        );
        if (
          result &&
          typeof result === 'object' &&
          'id' in result &&
          'status' in result &&
          'visibility' in result &&
          'moderationState' in result &&
          'deletedAt' in result
        ) {
          await pruneVideoProjectionIfNotPublic(
            admin,
            result as Parameters<typeof pruneVideoProjectionIfNotPublic>[1],
          );
        }
        res.json({ collection: result });
      } catch (e) {
        handleServiceError(res, e);
      }
    };

  app.post('/collections/:id/publish', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const body = (req.body ?? {}) as {
        visibility?: 'public' | 'unlisted' | 'private';
        include_external_ids?: string[];
      };
      const result = await svc.publish({
        collectionId: String(req.params.id),
        userId: user.id,
        user: {
          id: user.id,
          email: user.email,
          user_metadata: user.user_metadata as Record<string, unknown>,
        },
        visibility: body.visibility ?? 'public',
        includeExternalIds: Array.isArray(body.include_external_ids)
          ? body.include_external_ids
          : null,
      });
      await pruneVideoProjectionIfNotPublic(admin, result);
      scheduleSearchCollectionProjection(result);
      res.json({ collection: result });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post(
    '/collections/:id/reject',
    lifecyclePost(async (svc, id, userId) => {
      const updated = await svc.reject({ collectionId: id, userId });
      scheduleSearchCollectionRemoval(id);
      return updated;
    }),
  );
  app.post(
    '/collections/:id/unpublish',
    lifecyclePost(async (svc, id, userId) => {
      const updated = await svc.unpublish({ collectionId: id, userId });
      scheduleSearchCollectionRemoval(id);
      return updated;
    }),
  );
  app.post(
    '/collections/:id/republish',
    lifecyclePost(async (svc, id, userId, body) => {
      const updated = await svc.republish({
        collectionId: id,
        userId,
        visibility: body.visibility as 'public' | 'unlisted' | 'private' | undefined,
      });
      scheduleSearchCollectionProjection(updated);
      return updated;
    }),
  );
  app.post(
    '/collections/:id/archive',
    lifecyclePost(async (svc, id, userId) => {
      const updated = await svc.archive({ collectionId: id, userId });
      scheduleSearchCollectionRemoval(id);
      return updated;
    }),
  );
  app.post(
    '/collections/:id/restore',
    lifecyclePost(async (svc, id, userId) => {
      const updated = await svc.restore({ collectionId: id, userId });
      if (updated.searchEligible) {
        scheduleSearchCollectionProjection(updated);
      }
      return updated;
    }),
  );
  app.delete('/collections/:id', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const updated = await svc.softDelete({
        collectionId: String(req.params.id),
        userId: user.id,
      });
      await pruneVideoProjectionIfNotPublic(admin, updated);
      scheduleSearchCollectionRemoval(String(req.params.id));
      res.json({ collection: updated });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post('/collections/:id/media', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const body = req.body as {
        source_url?: string;
        embed_url?: string;
        thumbnail_url?: string;
        title?: string;
      };
      if (!body.source_url?.trim()) {
        res.status(400).json({ error: 'source_url required' });
        return;
      }
      const media = await svc.attachPrimaryExternalSource({
        collectionId: String(req.params.id),
        userId: user.id,
        sourceUrl: body.source_url.trim(),
        embedUrl: body.embed_url ?? null,
        thumbnailUrl: body.thumbnail_url ?? null,
        title: typeof body.title === 'string' ? body.title : null,
      });
      res.status(201).json({ media });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post('/collections/:id/tags', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const body = req.body as {
        name?: string;
        merchant_url?: string;
        catalog_product_id?: string;
        brand?: string;
        category?: string;
        image?: string;
        external_id?: string;
        confidence?: number;
        creator_note?: string;
      };
      if (!body.name?.trim()) {
        res.status(400).json({ error: 'name required' });
        return;
      }
      const tag = await svc.addTag({
        collectionId: String(req.params.id),
        userId: user.id,
        tag: {
          tagSource: 'manual',
          selectionSource: 'CREATOR_MANUAL',
          nameSnapshot: body.name.trim(),
          merchantUrl: body.merchant_url ?? null,
          catalogProductId: body.catalog_product_id ?? null,
          brandSnapshot: body.brand ?? null,
          categorySnapshot: body.category ?? null,
          imageSnapshot: body.image ?? null,
          externalId: body.external_id ?? null,
          confidence: body.confidence ?? 1,
          resolutionStatus: body.catalog_product_id ? 'UNVERIFIED' : 'UNRESOLVED',
          includeInPublish: true,
          creatorNote: body.creator_note ?? null,
        },
      });
      res.status(201).json({ tag });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post('/collections/:id/tags/:tagId/accept', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const tag = await svc.acceptTag({
        collectionId: String(req.params.id),
        userId: user.id,
        tagId: String(req.params.tagId),
      });
      res.json({ tag });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post('/collections/:id/tags/:tagId/reject', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const body = req.body as { reason?: string };
      const tag = await svc.rejectTag({
        collectionId: String(req.params.id),
        userId: user.id,
        tagId: String(req.params.tagId),
        reason: body.reason ?? null,
      });
      res.json({ tag });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.patch('/collections/:id/tags/:tagId', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      const body = req.body as {
        include_in_publish?: boolean;
        is_primary?: boolean;
        recommendation_strength?: 'PRIMARY' | 'SECONDARY';
        sort_order?: number;
        creator_note?: string | null;
      };
      const tag = await svc.updateTag({
        collectionId: String(req.params.id),
        userId: user.id,
        tagId: String(req.params.tagId),
        patch: {
          ...(body.include_in_publish !== undefined
            ? { includeInPublish: body.include_in_publish }
            : {}),
          ...(body.is_primary !== undefined ? { isPrimary: body.is_primary } : {}),
          ...(body.recommendation_strength !== undefined
            ? { recommendationStrength: body.recommendation_strength }
            : {}),
          ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
          ...(body.creator_note !== undefined ? { creatorNote: body.creator_note } : {}),
        },
      });
      res.json({ tag });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.delete('/collections/:id/tags/:tagId', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const admin = createSupabaseAdmin();
      const svc = createCollectionService(admin);
      await svc.removeTag({
        collectionId: String(req.params.id),
        userId: user.id,
        tagId: String(req.params.tagId),
      });
      res.json({ ok: true });
    } catch (e) {
      handleServiceError(res, e);
    }
  });
}
