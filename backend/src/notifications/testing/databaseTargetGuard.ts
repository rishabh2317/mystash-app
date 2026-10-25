/**
 * Guards for commands that write to a database (integration tests, smoke tests).
 * Production must never be targeted; destructive resets only ever run locally.
 */

/** Project refs that are production unless overridden. Matches the ref used by `supabase:link`. */
const DEFAULT_PRODUCTION_REFS = ['womdeohfpvzmhomgqwig'];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal', 'kong']);

export type DatabaseTarget = 'local' | 'staging';

export class UnsafeDatabaseTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDatabaseTargetError';
  }
}

function productionRefs(env: NodeJS.ProcessEnv): string[] {
  const extra = (env.SUPABASE_PRODUCTION_PROJECT_REFS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_PRODUCTION_REFS, ...extra];
}

export function isLocalSupabaseUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isProductionSupabaseUrl(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (env.SUPABASE_PRODUCTION_URL) {
    try {
      if (new URL(env.SUPABASE_PRODUCTION_URL).hostname.toLowerCase() === host) return true;
    } catch {
      /* ignore malformed override */
    }
  }
  return productionRefs(env).some((ref) => host === `${ref}.supabase.co` || host.startsWith(`${ref}.`));
}

/**
 * Local is the default. Staging must be requested explicitly and is still refused if the URL
 * is a known production project or the process itself runs with NODE_ENV=production.
 */
export function assertSafeTestTarget(
  url: string,
  target: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseTarget {
  if (env.NODE_ENV === 'production') {
    throw new UnsafeDatabaseTargetError('Refusing to run database tests with NODE_ENV=production');
  }
  if (isProductionSupabaseUrl(url, env)) {
    throw new UnsafeDatabaseTargetError('Refusing to target production Supabase (or an unparseable URL)');
  }
  const resolved = (target ?? 'local').trim().toLowerCase();
  if (resolved === 'local') {
    if (!isLocalSupabaseUrl(url)) {
      throw new UnsafeDatabaseTargetError(
        'Target is local but the URL is not a local Supabase stack; set NOTIFICATIONS_TEST_TARGET=staging for staging',
      );
    }
    return 'local';
  }
  if (resolved === 'staging') {
    if (isLocalSupabaseUrl(url)) {
      throw new UnsafeDatabaseTargetError('Target is staging but the URL is local');
    }
    return 'staging';
  }
  throw new UnsafeDatabaseTargetError(`Unknown database target "${resolved}" (expected local or staging)`);
}
