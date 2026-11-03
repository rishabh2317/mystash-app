import NativeShare, { type NativePendingShare, type ShareSession } from '@/modules/mystash-share';
import type { Session } from '@supabase/supabase-js';
import { isAuthEmailVerified } from '@/src/auth/emailVerified';
export const nativeSharingEnabled = () => process.env.EXPO_PUBLIC_NATIVE_SHARE_ENABLED === 'true' && NativeShare !== null;
let generation = 0;
let serial: Promise<void> = Promise.resolve();
const listeners=new Set<()=>void>();
export function notifyPendingShares(){for(const listener of listeners)listener();}
export function subscribePendingShares(listener:()=>void):()=>void{listeners.add(listener);return()=>{listeners.delete(listener);};}
/** Only access tokens cross this boundary. Superseded identity writes are dropped. */
export function syncNativeShareSession(session: Session | null): Promise<void> {
  if (!nativeSharingEnabled()) return Promise.resolve();
  const version = ++generation;
  const apiBase = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL;
  const value: ShareSession | null = session && apiBase?.startsWith('https://') && isAuthEmailVerified(session.user)
    ? { accountId: session.user.id, accessToken: session.access_token, expiresAt: session.expires_at ?? 0, apiBase } : null;
  serial = serial.catch(() => undefined).then(async () => {
    if (version === generation) { await NativeShare!.syncSession(value);for(const listener of listeners)listener(); }
  });
  return serial;
}
export async function pendingNativeShares(accountId: string | null): Promise<NativePendingShare[]> {
  if (!nativeSharingEnabled()) return [];
  return (await NativeShare!.listPending(accountId)).map(record => ({ ...record,
    intent: typeof record.intent === 'string' ? JSON.parse(record.intent) : record.intent,
  })).sort((a,b) => b.createdAt-a.createdAt);
}
export const claimNativeShare = async (id: string, accountId: string) => { if (nativeSharingEnabled()) await NativeShare!.claim(id,accountId); };
export const discardNativeShare = async (id: string, accountId: string|null) => { if (nativeSharingEnabled()) await NativeShare!.discard(id,accountId); };
export const retryNativeShares = async (accountId:string) => { if (nativeSharingEnabled()) await NativeShare!.retry(accountId); };
