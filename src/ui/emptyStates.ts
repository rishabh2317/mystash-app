/** Copy and local artwork shared by the landing empty states. */
export const EMPTY_STATES = {
  find: {
    artwork: require('@/assets/images/find_empty_state.png'),
    title: 'Save what inspires you',
    body: 'Find products and places from videos, links and photos.',
    action: 'Sign in to Find',
    secondaryAction: 'Explore Mystash',
  },
  collections: {
    artwork: require('@/assets/images/profile_collections_empty_state.png'),
    title: 'Your story starts here',
    body: 'Create your first collection to share what you love.',
    action: 'Create a collection',
    secondaryAction: 'Explore creators',
  },
  settings: {
    artwork: require('@/assets/images/settings_empty_state.png'),
    title: 'Make Mystash yours',
    body: 'Sign in to manage your account, privacy and preferences.',
    action: 'Sign in',
  },
} as const;
