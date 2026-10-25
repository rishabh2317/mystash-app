import { createHash, randomBytes } from 'node:crypto';
import { logger } from '../logger';
import { NotificationServiceError } from './NotificationService';
import {
  InstallationConflictError,
  RevocationUnavailableError,
  type PushRegistrationInput,
  type PushRepository,
  type RegisterPushResult,
} from './PushRepository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/;
const DELIVERY_ID_RE = /^[1-9][0-9]{0,18}$/;
const PLATFORMS = ['ios', 'android'] as const;
const PERMISSIONS = ['granted', 'provisional', 'denied', 'undetermined'] as const;
const APNS_ENVIRONMENTS = ['sandbox', 'production'] as const;
const ACTION_RE = /^[a-z][a-z0-9_.-]{0,39}$/;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function validTimezone(value: unknown): string | null {
  const tz = shortText(value, 64);
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** 32 random bytes, base64url without padding. */
const REVOCATION_CREDENTIAL_RE = /^[A-Za-z0-9_-]{43}$/;

export function newRevocationCredential(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRevocationCredential(credential: string): string {
  return createHash('sha256').update(credential, 'utf8').digest('hex');
}

export function isValidInstallationId(value: string): boolean {
  return UUID_RE.test(value);
}

export class PushService {
  constructor(private readonly repo: PushRepository) {}

  /**
   * `revocationCredential` is returned exactly once, to the registering device, and is never
   * stored or logged server-side (only its sha256). null = DB predates the revocation migration.
   */
  async register(
    userId: string,
    installationId: string,
    body: Record<string, unknown>,
  ): Promise<RegisterPushResult & { revocationCredential: string | null }> {
    if (!isValidInstallationId(installationId)) throw new NotificationServiceError('Invalid installation id');
    const provider = body.provider === undefined ? 'expo' : oneOf(body.provider, ['expo'] as const);
    if (!provider) throw new NotificationServiceError('Unsupported push provider');
    if (typeof body.token !== 'string' || !EXPO_TOKEN_RE.test(body.token)) {
      throw new NotificationServiceError('Invalid push token');
    }
    const platform = oneOf(body.platform, PLATFORMS);
    if (!platform) throw new NotificationServiceError('platform must be ios or android');
    const osPermission = oneOf(body.osPermission, PERMISSIONS);
    if (!osPermission) throw new NotificationServiceError('Invalid osPermission');
    const apnsEnvironment = body.apnsEnvironment == null ? null : oneOf(body.apnsEnvironment, APNS_ENVIRONMENTS);
    if (body.apnsEnvironment != null && !apnsEnvironment) throw new NotificationServiceError('Invalid apnsEnvironment');

    const input: PushRegistrationInput = {
      installationId: installationId.toLowerCase(),
      provider,
      token: body.token,
      platform,
      appVersion: shortText(body.appVersion, 32),
      appBuild: shortText(body.appBuild, 32),
      locale: shortText(body.locale, 35),
      timezone: validTimezone(body.timezone),
      osPermission,
      apnsEnvironment: platform === 'ios' ? apnsEnvironment : null,
    };
    const credential = newRevocationCredential();
    try {
      const result = await this.repo.register(userId, input, hashRevocationCredential(credential));
      if (result.previousUserId || result.tokenMovedFromUserId) {
        logger.info(
          { switchedAccount: Boolean(result.previousUserId), tokenMoved: Boolean(result.tokenMovedFromUserId) },
          'notification.push.registration_rebound',
        );
      }
      return { ...result, revocationCredential: result.revocationStored ? credential : null };
    } catch (err) {
      if (err instanceof InstallationConflictError) {
        throw new NotificationServiceError('Installation is registered to another account', 409);
      }
      throw err;
    }
  }

  /**
   * Credential-only unlink (no session): proves possession of one installation's secret and can
   * only unbind that installation from its current user. Mismatches return `revoked: false`.
   */
  async revoke(installationId: string, credential: unknown): Promise<{ revoked: boolean }> {
    if (!isValidInstallationId(installationId)) throw new NotificationServiceError('Invalid installation id');
    if (typeof credential !== 'string' || !REVOCATION_CREDENTIAL_RE.test(credential)) {
      throw new NotificationServiceError('Invalid revocation credential');
    }
    try {
      const revoked = await this.repo.revokeInstallation(installationId.toLowerCase(), hashRevocationCredential(credential));
      if (revoked) logger.info({}, 'notification.push.installation_revoked');
      return { revoked };
    } catch (err) {
      if (err instanceof RevocationUnavailableError) {
        throw new NotificationServiceError('Push revocation is not available yet', 503);
      }
      throw err;
    }
  }

  /** Idempotent: unlinking an installation that is not (or no longer) bound to the caller is a no-op. */
  async unregister(userId: string, installationId: string): Promise<{ unlinked: number }> {
    if (!isValidInstallationId(installationId)) throw new NotificationServiceError('Invalid installation id');
    return { unlinked: await this.repo.unregister(userId, installationId.toLowerCase()) };
  }

  /** false = delivery unknown or not the caller's; the caller falls back to a plain inbox open. */
  async recordPushOpen(userId: string, notificationId: string, deliveryId: unknown, action: unknown): Promise<boolean> {
    if (!UUID_RE.test(notificationId)) throw new NotificationServiceError('Notification not found', 404);
    const id = typeof deliveryId === 'number' ? String(deliveryId) : deliveryId;
    if (typeof id !== 'string' || !DELIVERY_ID_RE.test(id)) throw new NotificationServiceError('Invalid deliveryId');
    const act = action == null ? null : typeof action === 'string' && ACTION_RE.test(action) ? action : undefined;
    if (act === undefined) throw new NotificationServiceError('Invalid action');
    return this.repo.recordPushOpen(userId, notificationId, id, act);
  }
}
