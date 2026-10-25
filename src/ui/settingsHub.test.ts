import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  SETTINGS_COPY,
  settingsAppearanceValue,
  settingsCreatorStatusLabel,
  settingsCurateCopy,
  settingsHandleLabel,
  settingsIdentityDisplayName,
  settingsRowShowsChevron,
} from './settingsHub';

const ROOT = process.cwd();

describe('settings hub', () => {
  it('keeps real destinations and drops dummy account rows', () => {
    const src = readFileSync(join(ROOT, 'app/settings/index.tsx'), 'utf8');
    assert.match(src, /from '@\/components\/settings\/SettingsRow'/);
    assert.match(src, /from '@\/components\/settings\/SettingsSection'/);
    assert.match(src, /SettingsIdentityHeader/);
    assert.doesNotMatch(src, /from '@\/components\/profile\/ProfileRow'/);
    assert.doesNotMatch(src, /#A855F7|#C084FC|rgba\(168,85,247/);
    assert.match(src, /router\.push\('\/analytics'\)/);
    assert.match(src, /router\.push\(`\/creator\/\$\{encodeURIComponent\(profileHandle\)\}`\)/);
    assert.match(src, /SETTINGS_COPY\.publicProfileValue/);
    assert.match(src, /SETTINGS_COPY\.shoppingCountry/);
    assert.match(src, /toggleTheme/);
    assert.match(src, /signOut/);
    assert.match(src, /\/settings\/edit-profile/);
    assert.match(src, /\/settings\/creator-onboarding/);
    assert.doesNotMatch(src, /SETTINGS_COPY\.plan|Mystash Pro Beta|Visa ••••/);
    assert.doesNotMatch(src, /shipping|notificationsValue|privacyValue|mystash\.ai|@mystash_app/);
    assert.doesNotMatch(src, /router\.push\('\/cart'\)/);
    assert.equal(SETTINGS_COPY.publicProfileValue, 'View as others see you');
  });

  it('only shows a chevron when the row has a real action', () => {
    assert.equal(settingsRowShowsChevron({ variant: 'navigation', hasAction: true }), true);
    assert.equal(settingsRowShowsChevron({ variant: 'highlighted', hasAction: true }), true);
    assert.equal(settingsRowShowsChevron({ variant: 'value', hasAction: false }), false);
    assert.equal(settingsRowShowsChevron({ variant: 'navigation', hasAction: false }), false);
    assert.equal(settingsRowShowsChevron({ variant: 'toggle', hasAction: true }), false);
  });

  it('maps theme and creator status from real state', () => {
    assert.equal(settingsAppearanceValue(true), SETTINGS_COPY.appearanceLight);
    assert.equal(settingsAppearanceValue(false), SETTINGS_COPY.appearanceDark);
    assert.equal(settingsCreatorStatusLabel('ACTIVE'), 'On');
    assert.equal(settingsCurateCopy('ACTIVE').title, SETTINGS_COPY.creatorMode);
    assert.equal(settingsCurateCopy('NONE').title, SETTINGS_COPY.becomeCreator);
    assert.equal(settingsHandleLabel('rama'), '@rama');
    assert.equal(
      settingsIdentityDisplayName({
        displayName: 'rama',
        username: 'rama',
        fullName: 'Mega Star',
      }),
      'Mega Star',
    );
    assert.equal(
      settingsIdentityDisplayName({
        displayName: 'Mega Star',
        username: 'rama',
        fullName: null,
      }),
      'Mega Star',
    );
  });
});
