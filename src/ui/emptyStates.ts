/** Copy and local artwork shared by the landing empty states.
 * Visible bounds exclude near-transparent PNG export noise (alpha < 8/255).
 * The original assets stay intact; sizing uses the same helper as signup. */
export const EMPTY_STATES = {
  find: {
    artwork: require('@/assets/images/find_empty_state.png'),
    artworkBounds: {width:1448,height:1086,visLeft:221,visTop:125,visWidth:1000,visHeight:809},
    title: 'Save what inspires you',
    body: 'Find products and places from videos, links and photos.',
    action: 'Sign in to Find',
    secondaryAction: 'Explore Mystash',
  },
  collections: {
    artwork: require('@/assets/images/profile_collections_empty_state.png'),
    artworkBounds: {width:1312,height:1199,visLeft:136,visTop:122,visWidth:1035,visHeight:973},
    title: 'Your story starts here',
    body: 'Create your first collection to share what you love.',
    action: 'Create a collection',
    secondaryAction: 'Explore creators',
  },
  settings: {
    artwork: require('@/assets/images/settings_empty_state.png'),
    artworkBounds: {width:1312,height:1199,visLeft:182,visTop:200,visWidth:897,visHeight:801},
    title: 'Make Mystash yours',
    body: 'Sign in to manage your account, privacy and preferences.',
    action: 'Sign in',
  },
} as const;
