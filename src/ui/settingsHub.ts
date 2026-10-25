import type { CreatorStatus } from '@/src/types/creator';

export const SETTINGS_COPY = {
  title: 'Settings',
  subtitle: 'Your profile, creator identity, and preferences.',
  profile: 'Profile',
  creator: 'Creator',
  preferences: 'Preferences',
  account: 'Account',
  connectedAccounts: 'Connected accounts',
  connectedAccountsHint: 'Link Instagram or YouTube to sync your library in Create.',
  connectedYouTube: 'YouTube',
  connectedInstagram: 'Instagram',
  connectedNotConnected: 'Not connected',
  connectedConnect: 'Connect',
  connectedDisconnect: 'Disconnect',
  connectedReauth: 'Re-auth',
  connectedCheck: 'Check connection',
  session: 'Session',
  appearance: 'Appearance',
  appearanceHint: 'Light or dark canvas',
  appearanceLight: 'Light',
  appearanceDark: 'Dark',
  analytics: 'Analytics',
  analyticsHint: 'See how people find your collections',
  publicProfile: 'View public profile',
  publicProfileValue: 'View as others see you',
  email: 'Email',
  username: 'Username',
  usernameHint: 'Your account identifier. It cannot be changed here.',
  displayName: 'Display name',
  displayNameHint: 'The name shown on your public profile.',
  displayNamePlaceholder: 'Your public name',
  bio: 'Bio',
  bioHint: 'A short line about what you create.',
  bioPlaceholder: 'What you share on Mystash',
  editProfile: 'Edit profile',
  changePhoto: 'Change photo',
  shoppingCountry: 'Shopping country',
  shoppingCountryHint: 'Used for merchant prices and Buy links',
  shoppingCountryUseLocation: 'Use my location',
  shoppingCountryManual: 'Manual',
  shoppingCountryAuto: 'From location',
  signOut: 'Sign out',
  signInPrompt: 'Sign in from Profile to manage settings.',
  goToProfile: 'Go to Profile',
  creatorMode: 'Creator mode',
  becomeCreator: 'Become a creator',
  becomeCreatorHint: 'Publish collections and see how they perform.',
  finishCreatorSetup: 'Finish creator setup',
  finishCreatorSetupHint: 'Complete onboarding to activate Creator Studio.',
  creatorActiveHint: 'You can publish collections and view analytics.',
  creatorSuspended: 'Creator suspended',
  creatorSuspendedHint: 'Collection creation is blocked until privileges are reinstated.',
  onboardingTitle: 'Become a creator on Mystash',
  onboardingStepProfile: 'Your creator profile',
  onboardingStepSocial: 'Social presence',
  onboardingProfileWhy: 'Shown on your public profile so shoppers know who you are.',
  onboardingSocialWhy: 'Connect accounts you already use. We never ask for platform IDs.',
  onboardingSocialLater:
    'You can connect Instagram or YouTube later from Settings when linking is available.',
  onboardingPrimary: 'Become a creator',
  onboardingFinish: 'Finish setup',
  onboardingSecondary: 'Not now',
  onboardingContinue: 'Continue',
  onboardingBack: 'Back',
} as const;

export const SHOPPING_COUNTRY_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'IN', label: 'India' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'SG', label: 'Singapore' },
];

export function settingsShoppingCountryValue(input: {
  country: string | null | undefined;
  countrySource: 'location' | 'manual' | null | undefined;
}): string {
  const code = input.country?.trim().toUpperCase();
  if (!code) return 'Not set';
  const option = SHOPPING_COUNTRY_OPTIONS.find((row) => row.code === code);
  const label = option?.label ?? code;
  if (input.countrySource === 'manual') return `${label} · ${SETTINGS_COPY.shoppingCountryManual}`;
  if (input.countrySource === 'location') return `${label} · ${SETTINGS_COPY.shoppingCountryAuto}`;
  return label;
}

export function settingsAppearanceValue(isLight: boolean): string {
  return isLight ? SETTINGS_COPY.appearanceLight : SETTINGS_COPY.appearanceDark;
}

export function settingsCreatorStatusLabel(status: CreatorStatus | undefined): string {
  switch (status) {
    case 'ACTIVE':
      return 'On';
    case 'ONBOARDING':
      return 'Setup in progress';
    case 'SUSPENDED':
      return 'Suspended';
    case 'NONE':
      return 'Off';
    default:
      return 'Loading…';
  }
}

export function settingsCurateCopy(status: CreatorStatus | undefined): {
  title: string;
  subtitle: string;
} {
  if (status === 'ACTIVE') {
    return {
      title: SETTINGS_COPY.creatorMode,
      subtitle: SETTINGS_COPY.creatorActiveHint,
    };
  }
  if (status === 'ONBOARDING') {
    return {
      title: SETTINGS_COPY.finishCreatorSetup,
      subtitle: SETTINGS_COPY.finishCreatorSetupHint,
    };
  }
  if (status === 'SUSPENDED') {
    return {
      title: SETTINGS_COPY.creatorSuspended,
      subtitle: SETTINGS_COPY.creatorSuspendedHint,
    };
  }
  return {
    title: SETTINGS_COPY.becomeCreator,
    subtitle: SETTINGS_COPY.becomeCreatorHint,
  };
}

/** Chevron only when the row actually navigates or toggles. */
export function settingsRowShowsChevron(input: {
  variant: 'navigation' | 'value' | 'toggle' | 'highlighted' | 'destructive';
  hasAction: boolean;
}): boolean {
  if (!input.hasAction) return false;
  return input.variant === 'navigation' || input.variant === 'highlighted';
}

export function settingsHandleLabel(username: string | null | undefined): string {
  const handle = username?.trim().replace(/^@/, '');
  return handle ? `@${handle}` : '';
}

function bareIdentity(value: string | null | undefined): string {
  return value?.trim().replace(/^@/, '').toLowerCase() ?? '';
}

/** Display name for the settings header — never the @username, which has its own line. */
export function settingsIdentityDisplayName(input: {
  displayName: string | null | undefined;
  username: string | null | undefined;
  fullName: string | null | undefined;
}): string {
  const handle = bareIdentity(input.username);
  for (const candidate of [input.displayName, input.fullName]) {
    const name = candidate?.trim();
    if (!name) continue;
    if (handle && bareIdentity(name) === handle) continue;
    return name;
  }
  return 'Your profile';
}
