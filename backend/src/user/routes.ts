import type { Express, Request, Response } from 'express';
import { createSupabaseAdmin, createSupabaseUserClient } from '../supabase';
import { createUserService, UserServiceError } from './factory';
import { logger } from '../logger';

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

function handleServiceError(res: Response, e: unknown): void {
  if (e instanceof UserServiceError) {
    res.status(e.statusCode).json({ error: e.message });
    return;
  }
  const msg = e instanceof Error ? e.message : 'Server error';
  if (/Invalid (account_status|creator_status) transition/i.test(msg)) {
    res.status(400).json({ error: msg });
    return;
  }
  logger.error(e);
  res.status(500).json({ error: msg });
}

export function registerUserRoutes(app: Express): void {
  app.post('/users/me/ensure', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const svc = createUserService(createSupabaseAdmin());
      const row = await svc.ensureFromAuth(user);
      res.json({ user: await svc.getSettings(row.id) });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.get('/users/me', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const svc = createUserService(createSupabaseAdmin());
      await svc.ensureFromAuth(user);
      const settings = await svc.getSettings(user.id);
      if (!settings) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({ user: settings });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.get('/users/by-username/:username', async (req, res) => {
    try {
      const svc = createUserService(createSupabaseAdmin());
      const username = String(req.params.username ?? '');
      const profile = await svc.getPublicProfile(username);
      if (profile) {
        res.json({ user: profile });
        return;
      }
      const redirectTo = await svc.resolveUsernameRedirect(username);
      if (redirectTo) {
        res.status(301).json({ redirect_to_username: redirectTo });
        return;
      }
      res.status(404).json({ error: 'User not found' });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.patch('/users/me/profile', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const svc = createUserService(createSupabaseAdmin());
      await svc.ensureFromAuth(user);
      const body = req.body as {
        display_name?: string | null;
        profile_photo_url?: string | null;
        bio?: string | null;
        website_url?: string | null;
        social_links?: Record<string, string>;
      };
      const updated = await svc.updateProfile(user.id, {
        displayName: body.display_name,
        profilePhotoUrl: body.profile_photo_url,
        bio: body.bio,
        websiteUrl: body.website_url,
        socialLinks: body.social_links,
      });
      res.json({ user: await svc.getSettings(updated.id) });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post('/users/me/username', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const svc = createUserService(createSupabaseAdmin());
      await svc.ensureFromAuth(user);
      const username = String((req.body as { username?: string }).username ?? '');
      const updated = await svc.changeUsername(user.id, username);
      res.json({ user: await svc.getSettings(updated.id) });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.patch('/users/me/locale', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const svc = createUserService(createSupabaseAdmin());
      await svc.ensureFromAuth(user);
      const body = req.body as {
        country?: string | null;
        language?: string | null;
        timezone?: string | null;
      };
      const updated = await svc.updateLocale(user.id, {
        country: body.country,
        language: body.language,
        timezone: body.timezone,
      });
      res.json({ user: await svc.getSettings(updated.id) });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post('/users/me/creator/start', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const svc = createUserService(createSupabaseAdmin());
      await svc.ensureFromAuth(user);
      const updated = await svc.startCreatorOnboarding(user.id);
      res.json({ user: await svc.getSettings(updated.id) });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post('/users/me/creator/complete', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const svc = createUserService(createSupabaseAdmin());
      await svc.ensureFromAuth(user);
      const updated = await svc.completeCreatorOnboarding(user.id);
      res.json({ user: await svc.getSettings(updated.id) });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post('/users/me/creator/abandon', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const svc = createUserService(createSupabaseAdmin());
      await svc.ensureFromAuth(user);
      const updated = await svc.abandonCreatorOnboarding(user.id);
      res.json({ user: await svc.getSettings(updated.id) });
    } catch (e) {
      handleServiceError(res, e);
    }
  });

  app.post('/users/me/delete', async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const svc = createUserService(createSupabaseAdmin());
      await svc.ensureFromAuth(user);
      await svc.deleteAccount(user.id);
      res.json({ ok: true });
    } catch (e) {
      handleServiceError(res, e);
    }
  });
}
