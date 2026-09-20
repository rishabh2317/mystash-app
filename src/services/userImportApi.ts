import { hydrateImportShares, type ImportShare } from '@/src/services/importShareMap';
import { supabase } from '@/src/services/supabase';

/**
 * User Import API client.
 * POST submits a shared link. GET returns Bag-facing share progress.
 */

export type UserImportStatus = 'RECEIVED';
export type { ImportShare, ImportShareState } from '@/src/services/importShareMap';
export { hydrateImportShares } from '@/src/services/importShareMap';

export type UserImportAcknowledgement = {
  importId: string;
  status: UserImportStatus;
  created: boolean;
};

export class UserImportApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'UserImportApiError';
  }
}

function importApiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new UserImportApiError('Mystash import service is not configured.', 500);
  }
  return base;
}

async function bearerToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new UserImportApiError('Not authenticated', 401);
  }
  return token;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // ignore
  }
  return `Import request failed (${res.status})`;
}

/** `sharedInput` is the raw shared payload: a URL, or text containing one. */
export async function submitUserImport(sharedInput: string): Promise<UserImportAcknowledgement> {
  const token = await bearerToken();
  const res = await fetch(`${importApiBase()}/imports`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text: sharedInput }),
  });

  if (!res.ok) throw new UserImportApiError(await readError(res), res.status);

  const body = (await res.json()) as {
    importId?: string;
    created?: boolean;
  };
  if (!body.importId) {
    throw new UserImportApiError('Import returned no id', 500);
  }
  return {
    importId: body.importId,
    status: 'RECEIVED',
    created: Boolean(body.created),
  };
}

/** Recent share progress for Bag. Queue / resolver names stay off this DTO. */
export async function fetchImportShares(): Promise<ImportShare[]> {
  const token = await bearerToken();
  const res = await fetch(`${importApiBase()}/imports`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new UserImportApiError(await readError(res), res.status);
  const body = (await res.json()) as { shares?: unknown };
  return hydrateImportShares(body.shares);
}
