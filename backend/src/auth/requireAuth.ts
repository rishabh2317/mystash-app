import type { User } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import { createSupabaseUserClient } from '../supabase';
import {
  EMAIL_NOT_VERIFIED,
  UNVERIFIED_EMAIL_MESSAGE,
  UnverifiedEmailError,
  isAuthEmailVerified,
} from './emailVerification';

export function sendUnverifiedEmail(res: Response): void {
  res.status(403).json({ error: UNVERIFIED_EMAIL_MESSAGE, code: EMAIL_NOT_VERIFIED });
}

export function sendAuthError(res: Response, error: unknown): boolean {
  if (error instanceof UnverifiedEmailError) {
    sendUnverifiedEmail(res);
    return true;
  }
  return false;
}

/** Authenticators must not map verification failure to a generic 401. */
export function rethrowUnverifiedEmail(error: unknown): void {
  if (error instanceof UnverifiedEmailError) throw error;
}

export async function requireAuthUser(
  req: Request,
  res: Response,
  options: { requireVerifiedEmail?: boolean } = {},
): Promise<User | null> {
  const requireVerifiedEmail = options.requireVerifiedEmail !== false;
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({ error: 'Missing authorization' });
    return null;
  }
  try {
    const {
      data: { user },
      error,
    } = await createSupabaseUserClient(authHeader).auth.getUser();
    if (error || !user) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    if (requireVerifiedEmail && !isAuthEmailVerified(user)) {
      sendUnverifiedEmail(res);
      return null;
    }
    return user;
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

export async function requireAuthUserId(
  req: Request,
  res: Response,
  options: { requireVerifiedEmail?: boolean } = {},
): Promise<string | null> {
  const user = await requireAuthUser(req, res, options);
  return user?.id ?? null;
}

/** Guest-style identity: unverified sessions are treated as anonymous. */
export async function optionalVerifiedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') return null;
  try {
    const {
      data: { user },
    } = await createSupabaseUserClient(authHeader).auth.getUser();
    if (!user || !isAuthEmailVerified(user)) return null;
    return user.id;
  } catch {
    return null;
  }
}
