export const RESEND_COOLDOWN_MS = 60_000;

export function resendCooldownRemaining(lastSentAt: number | null, now = Date.now()): number {
  if (lastSentAt == null) return 0;
  return Math.max(0, lastSentAt + RESEND_COOLDOWN_MS - now);
}

export function canResendConfirmation(lastSentAt: number | null, now = Date.now()): boolean {
  return resendCooldownRemaining(lastSentAt, now) === 0;
}
