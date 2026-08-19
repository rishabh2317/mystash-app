import type { AccountStatus, CreatorStatus } from './types';

const ACCOUNT_TRANSITIONS: Record<AccountStatus, readonly AccountStatus[]> = {
  CREATED: ['ACTIVE', 'DELETED', 'ARCHIVED'],
  ACTIVE: ['SUSPENDED', 'DELETED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'DELETED', 'ARCHIVED'],
  DELETED: ['ACTIVE'],
  ARCHIVED: ['ACTIVE', 'DELETED'],
};

const CREATOR_TRANSITIONS: Record<CreatorStatus, readonly CreatorStatus[]> = {
  NONE: ['ONBOARDING'],
  ONBOARDING: ['ACTIVE', 'NONE'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
};

export function canTransitionAccount(from: AccountStatus, to: AccountStatus): boolean {
  if (from === to) return true;
  return ACCOUNT_TRANSITIONS[from].includes(to);
}

export function assertAccountTransition(from: AccountStatus, to: AccountStatus): void {
  if (!canTransitionAccount(from, to)) {
    throw new Error(`Invalid account_status transition: ${from} → ${to}`);
  }
}

export function canTransitionCreator(from: CreatorStatus, to: CreatorStatus): boolean {
  if (from === to) return true;
  return CREATOR_TRANSITIONS[from].includes(to);
}

export function assertCreatorTransition(from: CreatorStatus, to: CreatorStatus): void {
  if (!canTransitionCreator(from, to)) {
    throw new Error(`Invalid creator_status transition: ${from} → ${to}`);
  }
}
