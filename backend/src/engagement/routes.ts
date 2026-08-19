import type { Express, Request, Response } from 'express';
import { createSupabaseAdmin, createSupabaseUserClient } from '../supabase';
import { createEngagementService, EngagementServiceError } from './factory';
import { randomUUID } from 'node:crypto';

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

export function registerEngagementRoutes(app: Express): void {
  const admin = createSupabaseAdmin();
  const engagement = createEngagementService(admin);

  /** Record a Collection view (Impression ≠ View). */
  app.post('/engagement/collections/:id/view', async (req, res) => {
    try {
      const userId = await optionalUserId(req);
      const body = req.body as {
        event_id?: string;
        anonymous_id?: string;
        creator_id?: string;
        surface?: string;
      };
      const eventId = body.event_id ?? randomUUID();
      if (!userId && !body.anonymous_id) {
        res.status(400).json({ error: 'anonymous_id required when unauthenticated' });
        return;
      }
      const fact = await engagement.recordCollectionView({
        eventId,
        collectionId: req.params.id,
        actorUserId: userId,
        anonymousId: body.anonymous_id ?? null,
        creatorId: body.creator_id ?? null,
        surface: body.surface ?? null,
      });
      res.json({ ok: true, event_id: fact.eventId, inserted: true });
    } catch (e) {
      if (e instanceof EngagementServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/engagement/collections/:id/impression', async (req, res) => {
    try {
      const userId = await optionalUserId(req);
      const body = req.body as {
        event_id?: string;
        anonymous_id?: string;
        creator_id?: string;
        surface?: string;
      };
      const eventId = body.event_id ?? randomUUID();
      if (!userId && !body.anonymous_id) {
        res.status(400).json({ error: 'anonymous_id required when unauthenticated' });
        return;
      }
      const fact = await engagement.recordCollectionImpression({
        eventId,
        collectionId: req.params.id,
        actorUserId: userId,
        anonymousId: body.anonymous_id ?? null,
        creatorId: body.creator_id ?? null,
        surface: body.surface ?? null,
      });
      res.json({ ok: true, event_id: fact.eventId });
    } catch (e) {
      if (e instanceof EngagementServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Record a Collection share (completed / sharedAction). */
  app.post('/engagement/collections/:id/share', async (req, res) => {
    try {
      const userId = await optionalUserId(req);
      const body = req.body as {
        event_id?: string;
        anonymous_id?: string;
        creator_id?: string;
        surface?: string;
      };
      const eventId = body.event_id ?? randomUUID();
      if (!userId && !body.anonymous_id) {
        res.status(400).json({ error: 'anonymous_id required when unauthenticated' });
        return;
      }
      const fact = await engagement.recordCollectionShare({
        eventId,
        collectionId: req.params.id,
        actorUserId: userId,
        anonymousId: body.anonymous_id ?? null,
        creatorId: body.creator_id ?? null,
        surface: body.surface ?? null,
      });
      res.json({ ok: true, event_id: fact.eventId });
    } catch (e) {
      if (e instanceof EngagementServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Record a Creator profile share (completed / sharedAction). */
  app.post('/engagement/creators/:id/share', async (req, res) => {
    try {
      const userId = await optionalUserId(req);
      const body = req.body as {
        event_id?: string;
        anonymous_id?: string;
        surface?: string;
      };
      const eventId = body.event_id ?? randomUUID();
      if (!userId && !body.anonymous_id) {
        res.status(400).json({ error: 'anonymous_id required when unauthenticated' });
        return;
      }
      const fact = await engagement.recordCreatorShare({
        eventId,
        creatorId: req.params.id,
        actorUserId: userId,
        anonymousId: body.anonymous_id ?? null,
        surface: body.surface ?? null,
      });
      res.json({ ok: true, event_id: fact.eventId });
    } catch (e) {
      if (e instanceof EngagementServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/engagement/collections/:id/save', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;
      const body = req.body as { event_id?: string; creator_id?: string };
      const edge = await engagement.saveCollection({
        eventId: body.event_id,
        userId,
        collectionId: req.params.id,
        creatorId: body.creator_id ?? null,
      });
      res.json({ ok: true, edge_id: edge.id, state: edge.state });
    } catch (e) {
      if (e instanceof EngagementServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/engagement/collections/:id/save', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;
      const body = (req.body ?? {}) as { event_id?: string };
      await engagement.unsaveCollection({
        eventId: body.event_id,
        userId,
        collectionId: req.params.id,
      });
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof EngagementServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/engagement/creators/:id/follow', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;
      const following = await engagement.isFollowing(userId, req.params.id);
      res.json({ following });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/engagement/creators/:id/follow', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;
      const body = req.body as { event_id?: string };
      const edge = await engagement.followCreator({
        eventId: body.event_id,
        userId,
        creatorId: req.params.id,
      });
      res.json({ ok: true, edge_id: edge.id, state: edge.state });
    } catch (e) {
      if (e instanceof EngagementServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/engagement/creators/:id/follow', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;
      const body = (req.body ?? {}) as { event_id?: string };
      await engagement.unfollowCreator({
        eventId: body.event_id,
        userId,
        creatorId: req.params.id,
      });
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof EngagementServiceError) {
        res.status(e.statusCode).json({ error: e.message });
        return;
      }
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/engagement/me/following', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;
      const edges = await engagement.listFollowing(userId);
      res.json({
        following: edges.map((e) => ({ creator_id: e.objectId, updated_at: e.updatedAt })),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/engagement/me/saves', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;
      const edges = await engagement.listSavedCollections(userId);
      res.json({
        saves: edges.map((e) => ({ collection_id: e.objectId, updated_at: e.updatedAt })),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * Creator-facing analytics summary from Engagement denorm mirrors
   * (Collection counter slots + User followers_count). Aggregates only.
   */
  app.get('/engagement/me/analytics', async (req, res) => {
    try {
      const userId = await requireUserId(req, res);
      if (!userId) return;

      const { data: userRow, error: userErr } = await admin
        .from('users')
        .select('followers_count')
        .eq('id', userId)
        .maybeSingle();
      if (userErr) {
        res.status(500).json({ error: userErr.message });
        return;
      }

      const { data: collections, error: colErr } = await admin
        .from('collections')
        .select('id, title, views_count, saves_count, shares_count, product_clicks_count')
        .eq('creator_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (colErr) {
        res.status(500).json({ error: colErr.message });
        return;
      }

      const rows = collections ?? [];
      let views = 0;
      let saves = 0;
      let shares = 0;
      let productRedirects = 0;
      const perCollection = rows.map((row) => {
        const v = Number(row.views_count) || 0;
        const s = Number(row.saves_count) || 0;
        const sh = Number(row.shares_count) || 0;
        const pr = Number(row.product_clicks_count) || 0;
        views += v;
        saves += s;
        shares += sh;
        productRedirects += pr;
        return {
          collection_id: String(row.id),
          title: (row.title as string | null) ?? null,
          views: v,
          saves: s,
          shares: sh,
          product_redirects: pr,
        };
      });

      res.json({
        totals: {
          views,
          followers: Number(userRow?.followers_count) || 0,
          saves,
          shares,
          product_redirects: productRedirects,
        },
        collections: perCollection,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
