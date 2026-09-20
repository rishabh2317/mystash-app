import type { CreatorStatus } from '@/src/types/creator';

export const SETTINGS_COPY = {
  title: 'Settings & Analytics',
  subtitle: 'Account, creator tools, and how Mystash looks.',
  creator: 'Creator',
  account: 'Account',
  preferences: 'Preferences',
  social: 'Social',
  session: 'Session',
  appearance: 'Appearance',
  appearanceHint: 'Manage how Mystash looks',
  appearanceLight: 'Light',
  appearanceDark: 'Dark',
  notifications: 'Notifications',
  notificationsValue: 'Push + Email enabled',
  privacy: 'Privacy',
  privacyValue: 'Manage data & permissions',
  analytics: 'Analytics',
  analyticsHint: 'Views, followers, saves, and more',
  publicProfile: 'Public profile',
  publicProfileValue: 'View as others see you',
  profile: 'Profile',
  email: 'Email',
  creatorStatus: 'Creator status',
  plan: 'Plan',
  planValue: 'Mystash Pro Beta',
  payment: 'Payment',
  paymentValue: 'Visa •••• 2189 (placeholder)',
  shipping: 'Shipping address',
  shippingValue: 'Add primary address',
  bag: 'Bag',
  signOut: 'Sign out',
  signInPrompt: 'Sign in from Profile to manage settings.',
  goToProfile: 'Go to Profile',
} as const;

export function settingsAppearanceValue(isLight: boolean): string {
  return isLight ? SETTINGS_COPY.appearanceLight : SETTINGS_COPY.appearanceDark;
}

export function settingsCreatorStatusLabel(status: CreatorStatus | undefined): string {
  switch (status) {
    case 'ACTIVE':
      return 'ACTIVE creator';
    case 'ONBOARDING':
      return 'Onboarding in progress';
    case 'SUSPENDED':
      return 'Creator suspended';
    case 'NONE':
      return 'Shopper (not a creator)';
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
      title: 'Curate collection',
      subtitle: 'Paste a reel URL, review AI picks, publish to the feed',
    };
  }
  if (status === 'ONBOARDING') {
    return {
      title: 'Finish creator setup',
      subtitle: 'Complete onboarding on the Create tab to activate Collections.',
    };
  }
  if (status === 'SUSPENDED') {
    return {
      title: 'Creator suspended',
      subtitle: 'Collection creation is blocked until creator privileges are reinstated.',
    };
  }
  return {
    title: 'Become a creator',
    subtitle: 'Activate your creator account on the Create tab to ingest Collections.',
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
