import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  CREATOR_ONBOARDING_BIO_MAX,
  creatorOnboardingInitialStep,
  creatorOnboardingIsActive,
  creatorOnboardingNeedsStart,
  creatorOnboardingStepLabel,
} from './creatorOnboarding';

const ROOT = process.cwd();

describe('canonical creator onboarding', () => {
  it('resumes ONBOARDING on the social step and starts NONE on profile', () => {
    assert.equal(creatorOnboardingInitialStep('NONE'), 'profile');
    assert.equal(creatorOnboardingInitialStep('ONBOARDING'), 'social');
    assert.equal(creatorOnboardingInitialStep(null), 'profile');
    assert.equal(creatorOnboardingStepLabel('profile'), '1 of 2');
    assert.equal(creatorOnboardingStepLabel('social'), '2 of 2');
    assert.equal(creatorOnboardingNeedsStart('NONE'), true);
    assert.equal(creatorOnboardingNeedsStart('ONBOARDING'), false);
    assert.equal(creatorOnboardingIsActive('ACTIVE'), true);
    assert.equal(CREATOR_ONBOARDING_BIO_MAX, 500);
  });

  it('keeps the two-step form inside the redesigned Create card', () => {
    const panel = readFileSync(join(ROOT, 'components/creator/CreatorOnboardingPanel.tsx'), 'utf8');
    const hook = readFileSync(join(ROOT, 'src/hooks/useCreatorOnboarding.ts'), 'utf8');
    assert.match(panel, /creator_studio_video_hero\.png/);
    assert.match(panel, /creatorOnboardingStepLabel/);
    assert.match(panel, /SETTINGS_COPY\.onboardingStepProfile/);
    assert.match(panel, /SETTINGS_COPY\.onboardingStepSocial/);
    assert.match(panel, /SETTINGS_COPY\.displayName/);
    assert.match(panel, /SETTINGS_COPY\.bio/);
    assert.match(panel, /CREATOR_ONBOARDING_BIO_MAX/);
    assert.match(panel, /SETTINGS_COPY\.onboardingContinue/);
    assert.match(panel, /SETTINGS_COPY\.onboardingPrimary/);
    assert.match(panel, /SETTINGS_COPY\.onboardingSecondary/);
    assert.match(panel, /CREATE_COPY\.onboardingRefresh/);
    assert.doesNotMatch(panel, /activateCreatorAccount/);
    assert.doesNotMatch(hook, /activateCreatorAccount/);
    assert.match(hook, /startCreatorOnboarding/);
    assert.match(hook, /completeCreatorOnboarding/);
    assert.match(hook, /abandonCreatorOnboarding/);
    assert.match(hook, /creatorOnboardingNeedsStart/);
    assert.match(hook, /next\.creatorStatus !== 'ACTIVE'/);
  });

  it('routes Create, Products-only, and Settings through the shared panel', () => {
    const create = readFileSync(join(ROOT, 'app/(tabs)/create/index.tsx'), 'utf8');
    const manual = readFileSync(join(ROOT, 'app/(tabs)/create/manual.tsx'), 'utf8');
    const settings = readFileSync(join(ROOT, 'app/settings/creator-onboarding.tsx'), 'utf8');
    const hub = readFileSync(join(ROOT, 'app/settings/index.tsx'), 'utf8');
    const profile = readFileSync(join(ROOT, 'app/(tabs)/profile.tsx'), 'utf8');
    assert.match(create, /CreatorOnboardingPanel/);
    assert.match(manual, /CreatorOnboardingPanel/);
    assert.match(settings, /CreatorOnboardingPanel/);
    assert.doesNotMatch(create, /activateCreatorAccount/);
    assert.doesNotMatch(manual, /activateCreatorAccount/);
    assert.doesNotMatch(settings, /startCreatorOnboarding\(\)/);
    assert.match(settings, /router\.replace\('\/\(tabs\)\/create'\)/);
    assert.match(hub, /\/settings\/creator-onboarding/);
    assert.match(hub, /router\.push\('\/\(tabs\)\/create'\)/);
    assert.match(profile, /router\.push\('\/\(tabs\)\/create'/);
    assert.match(create, /meLoading && !me/);
    assert.match(manual, /meLoading && !me/);
  });

  it('does not start onboarding on Settings mount or abandon on Back', () => {
    const settings = readFileSync(join(ROOT, 'app/settings/creator-onboarding.tsx'), 'utf8');
    const hook = readFileSync(join(ROOT, 'src/hooks/useCreatorOnboarding.ts'), 'utf8');
    const panel = readFileSync(join(ROOT, 'components/creator/CreatorOnboardingPanel.tsx'), 'utf8');
    assert.doesNotMatch(settings, /startCreatorOnboarding/);
    assert.match(hook, /onContinueProfile/);
    assert.match(hook, /if \(creatorOnboardingNeedsStart\(next\.creatorStatus\)\)/);
    assert.match(panel, /setStep\('profile'\)/);
    assert.doesNotMatch(panel, /abandonCreatorOnboarding/);
    assert.match(hook, /onNotNow/);
    assert.match(hook, /abandonCreatorOnboarding/);
  });
});
