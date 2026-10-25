import type { CreatorStatus } from '@/src/types/creator';

export type CreatorOnboardingStep = 'profile' | 'social';

/** Matches `UserService` BIO_MAX — keep in sync if the server cap changes. */
export const CREATOR_ONBOARDING_BIO_MAX = 500;

export function creatorOnboardingInitialStep(
  status: CreatorStatus | null | undefined,
): CreatorOnboardingStep {
  return status === 'ONBOARDING' ? 'social' : 'profile';
}

export function creatorOnboardingStepLabel(step: CreatorOnboardingStep): string {
  return step === 'profile' ? '1 of 2' : '2 of 2';
}

export function creatorOnboardingNeedsStart(status: CreatorStatus | null | undefined): boolean {
  return status === 'NONE';
}

export function creatorOnboardingIsActive(status: CreatorStatus | null | undefined): boolean {
  return status === 'ACTIVE';
}
