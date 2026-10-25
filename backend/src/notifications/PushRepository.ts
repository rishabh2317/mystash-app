import type { BegunDelivery } from './domain/pushContent';
import type { ActorProfile } from './domain/types';
import type { PushOutcome } from './providers/types';

export type PushResultInput = {
  deliveryId: string;
  attemptNo: number;
  outcome: PushOutcome;
  providerMessageId: string | null;
  latencyMs: number;
};

export type RecordPushResultsSummary = {
  recorded: number;
  applied: number;
  duplicates: number;
  ignored: number;
  registrationsInvalidated: number;
};

export type ClaimedReceipt = { receiptToken: string; attemptId: string; providerMessageId: string };

export type ReceiptResultInput = { attemptId: string; outcome: PushOutcome | null };

export type RecordReceiptsSummary = {
  ok: number;
  errors: number;
  waiting: number;
  unavailable: number;
  registrationsInvalidated: number;
};

export type PushRegistrationInput = {
  installationId: string;
  provider: 'expo';
  token: string;
  platform: 'ios' | 'android';
  appVersion: string | null;
  appBuild: string | null;
  locale: string | null;
  timezone: string | null;
  osPermission: 'granted' | 'provisional' | 'denied' | 'undetermined';
  apnsEnvironment: 'sandbox' | 'production' | null;
};

export type RegisterPushResult = {
  registrationId: string;
  previousUserId: string | null;
  tokenMovedFromUserId: string | null;
  /** false = database predates the revocation migration; no credential was stored. */
  revocationStored: boolean;
};

export class RevocationUnavailableError extends Error {
  constructor() {
    super('push_revocation_unavailable');
    this.name = 'RevocationUnavailableError';
  }
}

export class InstallationConflictError extends Error {
  constructor() {
    super('installation_conflict');
    this.name = 'InstallationConflictError';
  }
}

/** Every method maps 1:1 onto a Phase 4 `notification_*` Postgres function. */
export interface PushRepository {
  claimDeliveries(
    provider: string,
    batch: number,
    leaseSeconds: number,
    maxClaims: number,
  ): Promise<{ dispatchToken: string; claimed: number } | null>;
  beginSend(dispatchToken: string, sendLeaseSeconds: number): Promise<BegunDelivery[]>;
  recordResults(dispatchToken: string, results: PushResultInput[]): Promise<RecordPushResultsSummary>;
  claimReceipts(provider: string, batch: number, leaseSeconds: number): Promise<ClaimedReceipt[]>;
  recordReceipts(receiptToken: string, results: ReceiptResultInput[]): Promise<RecordReceiptsSummary>;
  /** `revocationHash` is sha256 hex of the installation's revocation secret; the secret never reaches the DB. */
  register(userId: string, input: PushRegistrationInput, revocationHash: string): Promise<RegisterPushResult>;
  unregister(userId: string, installationId: string): Promise<number>;
  /** Credential-only unlink of one installation. Throws RevocationUnavailableError before the migration. */
  revokeInstallation(installationId: string, revocationHash: string): Promise<boolean>;
  recordPushOpen(userId: string, notificationId: string, deliveryId: string, action: string | null): Promise<boolean>;
  getActiveActorProfiles(ids: string[]): Promise<ActorProfile[]>;
}
