import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  SETTINGS_COPY,
  settingsAppearanceValue,
  settingsCreatorStatusLabel,
  settingsCurateCopy,
  settingsRowShowsChevron,
} from './settingsHub';

const ROOT = process.cwd();

describe('settings hub', () => {
  it('keeps real destinations and drops per-row card chrome', () => {
    const src = readFileSync(join(ROOT, 'app/settings.tsx'), 'utf8');
    assert.match(src, /from '@\/components\/settings\/SettingsRow'/);
    assert.match(src, /from '@\/components\/settings\/SettingsSection'/);
    assert.doesNotMatch(src, /from '@\/components\/profile\/ProfileRow'/);
    assert.doesNotMatch(src, /#A855F7|#C084FC|rgba\(168,85,247/);
    assert.match(src, /router\.push\('\/\(tabs\)\/create'\)/);
    assert.equal(SETTINGS_COPY.publicProfileValue, 'View as others see you');
    assert.match(src, /router\.push\('\/analytics'\)/);
    assert.match(src, /router\.push\('\/cart'\)/);
    assert.match(src, /router\.push\(`\/creator\/\$\{encodeURIComponent\(profileHandle\)\}`\)/);
    assert.match(src, /SETTINGS_COPY\.publicProfileValue/);
    assert.match(src, /SETTINGS_COPY\.shoppingCountry/);
    assert.match(src, /toggleTheme/);
    assert.match(src, /signOut/);
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
    assert.equal(settingsCreatorStatusLabel('ACTIVE'), 'ACTIVE creator');
    assert.equal(settingsCurateCopy('ACTIVE').title, 'Curate collection');
    assert.equal(settingsCurateCopy('NONE').title, 'Become a creator');
  });
});
