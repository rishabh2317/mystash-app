import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectedAccountProvider, OAuthSurface } from './domain/types';
import { getOAuthStateSecret } from './config';

const STATE_TTL_MS = 15 * 60 * 1000;

export type OAuthStatePayload = {
  userId: string;
  provider: ConnectedAccountProvider;
  nonce: string;
  surface: OAuthSurface;
  exp: number;
};

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthStateError';
  }
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function createOAuthState(
  input: { userId: string; provider: ConnectedAccountProvider; nonce: string; surface: OAuthSurface },
  nowMs = Date.now(),
  secret = getOAuthStateSecret(),
): string {
  if (!secret) {
    throw new OAuthStateError('OAuth state secret is not configured');
  }
  if (input.surface !== 'native' && input.surface !== 'web') {
    throw new OAuthStateError('Invalid OAuth surface');
  }
  const payload: OAuthStatePayload = {
    userId: input.userId,
    provider: input.provider,
    nonce: input.nonce,
    surface: input.surface,
    exp: nowMs + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function parseOAuthState(
  state: string,
  opts?: { nowMs?: number; secret?: string; expectUserId?: string; expectProvider?: ConnectedAccountProvider },
): OAuthStatePayload {
  const secret = opts?.secret ?? getOAuthStateSecret();
  if (!secret) {
    throw new OAuthStateError('OAuth state secret is not configured');
  }
  const parts = state.split('.');
  if (parts.length !== 2) {
    throw new OAuthStateError('Invalid OAuth state');
  }
  const [body, sig] = parts;
  const expected = sign(body!, secret);
  const a = Buffer.from(sig!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new OAuthStateError('Invalid OAuth state signature');
  }
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as OAuthStatePayload;
  } catch {
    throw new OAuthStateError('Invalid OAuth state payload');
  }
  if (payload.surface !== 'native' && payload.surface !== 'web') {
    throw new OAuthStateError('Invalid OAuth surface');
  }
  const nowMs = opts?.nowMs ?? Date.now();
  if (!payload.exp || payload.exp < nowMs) {
    throw new OAuthStateError('OAuth state expired');
  }
  if (opts?.expectUserId && payload.userId !== opts.expectUserId) {
    throw new OAuthStateError('OAuth state user mismatch');
  }
  if (opts?.expectProvider && payload.provider !== opts.expectProvider) {
    throw new OAuthStateError('OAuth state provider mismatch');
  }
  return payload;
}
