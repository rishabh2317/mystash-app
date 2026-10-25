export const PENDING_CONFIRMATION_EMAIL_KEY = 'mystash.auth.pendingConfirmationEmail';
export const PASSWORD_RECOVERY_PENDING_KEY = 'mystash.auth.passwordRecoveryPending';
export const RESEND_LAST_SENT_KEY = 'mystash.auth.resendLastSentAt';

export type PendingAuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export async function readPendingConfirmationEmail(storage: PendingAuthStorage): Promise<string | null> {
  const value = await storage.getItem(PENDING_CONFIRMATION_EMAIL_KEY);
  return value?.trim() || null;
}

export async function writePendingConfirmationEmail(
  storage: PendingAuthStorage,
  email: string,
): Promise<void> {
  await storage.setItem(PENDING_CONFIRMATION_EMAIL_KEY, email.trim().toLowerCase());
}

export async function clearPendingConfirmationEmail(storage: PendingAuthStorage): Promise<void> {
  await storage.removeItem(PENDING_CONFIRMATION_EMAIL_KEY);
  await storage.removeItem(RESEND_LAST_SENT_KEY);
}

export async function readPasswordRecoveryPending(storage: PendingAuthStorage): Promise<boolean> {
  return (await storage.getItem(PASSWORD_RECOVERY_PENDING_KEY)) === '1';
}

export async function writePasswordRecoveryPending(
  storage: PendingAuthStorage,
  pending: boolean,
): Promise<void> {
  if (pending) await storage.setItem(PASSWORD_RECOVERY_PENDING_KEY, '1');
  else await storage.removeItem(PASSWORD_RECOVERY_PENDING_KEY);
}
