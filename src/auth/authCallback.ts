import { formatAuthError } from './authErrors';

export type AuthCallbackParams = {
  code?: string;
  token_hash?: string;
  type?: string;
  error?: string;
  error_description?: string;
};

export type AuthCallbackClassification =
  | { kind: 'error'; message: string }
  | { kind: 'pkce'; code: string; recovery: boolean }
  | { kind: 'otp'; tokenHash: string; type: string; recovery: boolean }
  | { kind: 'none' };

export type AuthCallbackResult = {
  status: 'signed_in' | 'password_recovery' | 'error';
  message?: string;
  duplicate?: boolean;
};

type SessionLike = { user?: { id?: string } | null } | null;

export type AuthCallbackDeps = {
  getSession: () => Promise<{ session: SessionLike }>;
  exchangeCodeForSession: (
    code: string,
  ) => Promise<{ error: { message?: string; code?: string } | null; session: SessionLike }>;
  verifyOtp: (input: {
    token_hash: string;
    type: string;
  }) => Promise<{ error: { message?: string; code?: string } | null; session: SessionLike }>;
};

const OTP_TYPES = new Set([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

const inflight = new Map<string, Promise<AuthCallbackResult>>();
const completed = new Map<string, AuthCallbackResult>();

export function resetAuthCallbackExchangesForTests(): void {
  inflight.clear();
  completed.clear();
}

function remember(key: string, result: AuthCallbackResult): void {
  if (result.status === 'error') return;
  completed.set(key, result);
  while (completed.size > 32) {
    const oldest = completed.keys().next().value;
    if (!oldest) break;
    completed.delete(oldest);
  }
}

export function isRecoveryCallback(type: string | undefined): boolean {
  return type === 'recovery';
}

export function classifyAuthCallback(params: AuthCallbackParams): AuthCallbackClassification {
  const err = params.error_description || params.error;
  if (err) return { kind: 'error', message: formatAuthError({ message: err }, 'callback') };
  if (params.code) {
    return { kind: 'pkce', code: params.code, recovery: isRecoveryCallback(params.type) };
  }
  if (params.token_hash && params.type && OTP_TYPES.has(params.type)) {
    return {
      kind: 'otp',
      tokenHash: params.token_hash,
      type: params.type,
      recovery: isRecoveryCallback(params.type),
    };
  }
  return { kind: 'none' };
}

function finish(session: SessionLike, recovery: boolean): AuthCallbackResult {
  if (session?.user?.id) {
    return { status: recovery ? 'password_recovery' : 'signed_in' };
  }
  return { status: 'error', message: formatAuthError({ message: 'No session' }, 'callback') };
}

async function runOnce(
  key: string,
  work: () => Promise<AuthCallbackResult>,
): Promise<AuthCallbackResult> {
  const prior = completed.get(key);
  if (prior) return { ...prior, duplicate: true };

  const existing = inflight.get(key);
  if (existing) {
    const result = await existing;
    return { ...result, duplicate: true };
  }

  const run = work();
  inflight.set(key, run);
  try {
    const result = await run;
    remember(key, result);
    return result;
  } finally {
    inflight.delete(key);
  }
}

export async function completeAuthCallback(
  deps: AuthCallbackDeps,
  params: AuthCallbackParams,
): Promise<AuthCallbackResult> {
  const classified = classifyAuthCallback(params);
  if (classified.kind === 'error') {
    return { status: 'error', message: classified.message };
  }

  if (classified.kind === 'none') {
    const existing = await deps.getSession();
    if (existing.session?.user?.id) {
      return {
        status: isRecoveryCallback(params.type) ? 'password_recovery' : 'signed_in',
        duplicate: true,
      };
    }
    return { status: 'error', message: formatAuthError({ message: 'invalid link' }, 'callback') };
  }

  if (classified.kind === 'pkce') {
    return runOnce(`pkce:${classified.code}`, async () => {
      const exchanged = await deps.exchangeCodeForSession(classified.code);
      if (!exchanged.error) return finish(exchanged.session, classified.recovery);
      return { status: 'error', message: formatAuthError(exchanged.error, 'callback') };
    });
  }

  return runOnce(`otp:${classified.tokenHash}:${classified.type}`, async () => {
    const verified = await deps.verifyOtp({
      token_hash: classified.tokenHash,
      type: classified.type,
    });
    if (!verified.error) return finish(verified.session, classified.recovery);
    return { status: 'error', message: formatAuthError(verified.error, 'callback') };
  });
}

/** Query + hash params without logging values. */
export function getAuthParamsFromUrl(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const hash = url.includes('#') ? url.split('#')[1] : '';
  if (query) {
    new URLSearchParams(query).forEach((value, key) => {
      params[key] = value;
    });
  }
  if (hash) {
    new URLSearchParams(hash).forEach((value, key) => {
      params[key] = value;
    });
  }
  return params;
}
