import { requireOptionalNativeModule } from 'expo-modules-core';
export type NativeShareIntent = { kind: 'product' | 'place' | 'both' | null; note: string | null };
export type NativePendingShare = { id: string; url: string; owner: string | null; state: string;
  createdAt: number; intent?: NativeShareIntent; importId?: string };
export type ShareSession = { accountId: string; accessToken: string; expiresAt: number; apiBase: string };
export type ShareNativeModule = {
  syncSession(session: ShareSession | null): Promise<void>;
  listPending(expectedAccountId: string | null): Promise<NativePendingShare[]>;
  claim(id: string, expectedAccountId: string): Promise<void>;
  discard(id: string, expectedAccountId: string | null): Promise<void>;
  retry(expectedAccountId: string): Promise<void>;
};
export default requireOptionalNativeModule<ShareNativeModule>('MystashShare');
