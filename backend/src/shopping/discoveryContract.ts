export type DiscoveryDestination = {
  kind: 'official_search' | 'official_storefront' | 'google_search';
  label: string; url: string; query: string; country: string;
};
