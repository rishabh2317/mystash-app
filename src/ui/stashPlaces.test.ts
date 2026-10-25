import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { PlaceStashItem } from '@/src/types/placeStash';
import {
  DEFAULT_STASH_SEGMENT,
  PLACE_UNCERTAINTY_COPY,
  STASH_PLACES_COPY,
  STASH_SEGMENT,
  STASH_SEGMENT_TABS,
  hydratePlaceStashItem,
  hydratePlaceStashPage,
  partitionPlaceStashItems,
  pickPlaceStashImage,
  placeCardView,
  placeSearchUrl,
  placeStashItemKey,
  stashContentTab,
} from '@/src/ui/stashPlaces';

const ROOT = process.cwd();

const GOOGLE_SEARCH = {
  kind: 'google_search' as const,
  query: 'Potato Head Seminyak',
  url: 'https://www.google.com/search?q=Potato+Head+Seminyak',
};

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('Stash Products / Places tabs', () => {
  it('reuses ProfileContentTabs geometry for Products | Places', () => {
    assert.equal(DEFAULT_STASH_SEGMENT, STASH_SEGMENT.products);
    assert.deepEqual(
      STASH_SEGMENT_TABS.map((tab) => [tab.id, tab.label]),
      [
        ['products', 'Products'],
        ['places', 'Places'],
      ],
    );
    assert.equal(stashContentTab(STASH_SEGMENT.places, { selectedCategory: true }), STASH_SEGMENT.products);

    const stash = read('app/(tabs)/stash.tsx');
    const profile = read('components/profile/PersonalProfile.tsx');
    const tabs = read('components/profile/ProfileContentTabs.tsx');
    assert.match(stash, /from '@\/components\/profile\/ProfileContentTabs'/);
    assert.match(stash, /YourActivitySection/);
    assert.match(stash, /shareActivityLandingItems/);
    assert.match(stash, /<ProfileContentTabs tabs=\{STASH_SEGMENT_TABS\} active=\{stashTab\} onChange=\{onStashTabChange\} \/>/);
    const activityIdx = stash.indexOf('YourActivitySection');
    const tabsIdx = stash.indexOf('<ProfileContentTabs');
    assert.ok(activityIdx >= 0 && tabsIdx > activityIdx);
    assert.match(profile, /from '@\/components\/profile\/ProfileContentTabs'/);
    assert.match(tabs, /borderBottomColor: selected \? tokens\.color\.primary : 'transparent'/);
    assert.match(tabs, /minHeight: 40/);
    assert.doesNotMatch(stash, /StashSegmentSwitch/);
  });
});

describe('GET /places hydration', () => {
  it('loads mixed resolved and unresolved items from the list payload', () => {
    const page = hydratePlaceStashPage({
      itemCount: 2,
      items: [
        {
          kind: 'resolved',
          placeId: 'pl-1',
          name: 'Potato Head',
          category: 'Beach club',
          localityLabel: 'Seminyak',
          formattedAddress: 'Jl. Petitenget, Seminyak',
          latitude: -8.68,
          destination: GOOGLE_SEARCH,
          image: { kind: 'source', url: 'https://img.youtube.com/vi/abc/hqdefault.jpg' },
        },
        {
          kind: 'unresolved',
          leadId: 'lead-1',
          name: 'Cafe de Flore',
          locationContext: 'Paris',
          uncertainty: 'insufficient_detail',
          destination: {
            kind: 'google_search',
            query: 'Cafe de Flore Paris',
            url: 'https://www.google.com/search?q=Cafe+de+Flore+Paris',
          },
          image: { kind: 'frame', url: 'https://cdn.example/frame.jpg' },
        },
      ],
    });
    assert.equal(page.items.length, 2);
    assert.equal(placeStashItemKey(page.items[0]!), 'resolved:pl-1');
    assert.equal(placeStashItemKey(page.items[1]!), 'unresolved:lead-1');
    assert.equal(page.items[0]?.image?.kind, 'source');
    assert.equal(page.items[1]?.image?.kind, 'frame');
  });

  it('drops rows without a backend google_search destination URL', () => {
    const page = hydratePlaceStashPage({
      items: [
        { kind: 'resolved', placeId: 'x', name: 'X', destination: { kind: 'google_search', query: 'X', url: 'not-a-url' } },
      ],
    });
    assert.deepEqual(page.items, []);
  });

  it('fetchPlaces calls GET /places with a bearer token', () => {
    const api = read('src/services/placesApi.ts');
    assert.match(api, /\$\{apiBase\(\)\}\/places/);
    assert.match(api, /method: 'GET'/);
    assert.match(api, /Authorization: `Bearer \$\{token\}`/);
  });
});

describe('Places and Leads sections', () => {
  it('renders resolved places first, leads below, and hides empty sections', () => {
    const mixed: PlaceStashItem[] = [
      {
        kind: 'unresolved',
        id: 'lead-1',
        name: 'Cafe de Flore',
        locationContext: 'Paris',
        uncertainty: 'ambiguous',
        destination: GOOGLE_SEARCH,
        image: null,
      },
      {
        kind: 'resolved',
        id: 'pl-1',
        name: 'Potato Head',
        category: 'Beach club',
        localityLabel: 'Seminyak',
        formattedAddress: null,
        destination: GOOGLE_SEARCH,
        image: { kind: 'source', url: 'https://img.youtube.com/vi/abc/hqdefault.jpg' },
      },
    ];
    const grouped = partitionPlaceStashItems(mixed);
    assert.deepEqual(
      grouped.places.map((item) => item.id),
      ['pl-1'],
    );
    assert.deepEqual(
      grouped.leads.map((item) => item.id),
      ['lead-1'],
    );
    assert.equal(partitionPlaceStashItems([]).places.length, 0);
    assert.equal(partitionPlaceStashItems(grouped.places).leads.length, 0);

    const stash = read('app/(tabs)/stash.tsx');
    assert.match(stash, /STASH_PLACES_COPY\.placesSection/);
    assert.match(stash, /STASH_PLACES_COPY\.leadsSection/);
    assert.match(stash, /grouped\.places\.length > 0/);
    assert.match(stash, /grouped\.leads\.length > 0/);
    assert.equal(STASH_PLACES_COPY.placesSection, 'Places');
    assert.equal(STASH_PLACES_COPY.leadsSection, 'Leads');
  });
});

describe('PlaceCard states', () => {
  it('resolved cards show name, category, and locality without address or rating', () => {
    const item = hydratePlaceStashItem({
      kind: 'resolved',
      placeId: 'pl-1',
      name: 'Potato Head',
      category: 'Beach club',
      localityLabel: 'Seminyak',
      formattedAddress: 'Jl. Petitenget, Seminyak',
      destination: GOOGLE_SEARCH,
      image: { kind: 'provider', url: 'https://places.example/photo.jpg' },
    });
    assert.ok(item);
    const view = placeCardView(item!);
    assert.equal(view.name, 'Potato Head');
    assert.equal(view.category, 'Beach club');
    assert.equal(view.location, 'Seminyak');
    assert.equal(view.uncertainty, null);
    assert.equal(view.lead, false);
    assert.equal(view.imageUrl, 'https://places.example/photo.jpg');
    assert.equal('address' in view, false);
    assert.equal('rating' in view, false);
  });

  it('unresolved leads show extracted name, location, uncertainty, and source fallback image', () => {
    const item = hydratePlaceStashItem({
      kind: 'unresolved',
      leadId: 'lead-1',
      name: 'Cafe de Flore',
      locationContext: 'Paris',
      formattedAddress: '172 Bd Saint-Germain',
      latitude: 48.85,
      rating: 4.6,
      uncertainty: 'ambiguous',
      destination: {
        kind: 'google_search',
        query: 'Cafe de Flore Paris',
        url: 'https://www.google.com/search?q=Cafe+de+Flore+Paris',
      },
      image: { kind: 'source', url: 'https://img.youtube.com/vi/abc/hqdefault.jpg' },
    });
    assert.ok(item);
    if (item!.kind !== 'unresolved') return;
    assert.equal('formattedAddress' in item, false);
    const view = placeCardView(item);
    assert.equal(view.lead, true);
    assert.equal(view.category, null);
    assert.equal(view.location, 'Paris');
    assert.equal(view.uncertainty, PLACE_UNCERTAINTY_COPY.ambiguous);
    assert.equal(view.imageUrl, 'https://img.youtube.com/vi/abc/hqdefault.jpg');
  });

  it('PlaceCard is media-first with outlinePrimary Search on Google', () => {
    const card = read('components/place/PlaceCard.tsx');
    assert.match(card, /from 'expo-image'/);
    assert.match(card, /size="compact"/);
    assert.match(card, /variant="outlinePrimary"/);
    assert.match(card, /location-outline/);
    assert.doesNotMatch(card, /ProductCard|picsum|latitude|longitude|rating|MapView|WebView/);
  });
});

describe('image priority', () => {
  it('prefers provider, then source thumbnail, then a reel frame, and never fabricates', () => {
    assert.deepEqual(
      pickPlaceStashImage({
        itemKind: 'resolved',
        providerUrl: 'https://places.example/photo.jpg',
        sourceUrl: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
        frameUrl: 'https://cdn.example/frame.jpg',
      }),
      { url: 'https://places.example/photo.jpg', kind: 'provider' },
    );
    assert.deepEqual(
      pickPlaceStashImage({
        itemKind: 'resolved',
        sourceUrl: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
        frameUrl: 'https://cdn.example/frame.jpg',
      }),
      { url: 'https://img.youtube.com/vi/abc/hqdefault.jpg', kind: 'source' },
    );
    assert.deepEqual(
      pickPlaceStashImage({
        itemKind: 'unresolved',
        frameUrl: 'https://cdn.example/frame.jpg',
      }),
      { url: 'https://cdn.example/frame.jpg', kind: 'frame' },
    );
    assert.equal(pickPlaceStashImage({ itemKind: 'resolved' }), null);
  });

  it('unresolved leads ignore provider photos and use the source thumbnail or frame', () => {
    assert.deepEqual(
      pickPlaceStashImage({
        itemKind: 'unresolved',
        image: { kind: 'provider', url: 'https://places.example/invented.jpg' },
        sourceUrl: 'https://img.youtube.com/vi/abc/hqdefault.jpg',
      }),
      { url: 'https://img.youtube.com/vi/abc/hqdefault.jpg', kind: 'source' },
    );
    const dropped = hydratePlaceStashItem({
      kind: 'unresolved',
      leadId: 'lead-1',
      name: 'Cafe de Flore',
      destination: GOOGLE_SEARCH,
      image: { kind: 'provider', url: 'https://places.example/invented.jpg' },
    });
    assert.equal(dropped?.image, null);
  });
});

describe('Places CTA', () => {
  it('opens the backend-provided destination URL externally', () => {
    const item: PlaceStashItem = {
      kind: 'resolved',
      id: 'pl-1',
      name: 'Potato Head',
      category: null,
      localityLabel: null,
      formattedAddress: null,
      destination: GOOGLE_SEARCH,
      image: null,
    };
    assert.equal(placeSearchUrl(item), GOOGLE_SEARCH.url);
    const stash = read('app/(tabs)/stash.tsx');
    assert.match(stash, /Linking\.openURL\(url\)/);
    assert.doesNotMatch(stash, /WebView|MapView|expo-web-browser|maps\.google/);
    assert.doesNotMatch(stash, /google\.com\/search\?q=/);
  });
});

describe('Products Stash regression', () => {
  it('keeps the existing Products grid path when the Places tab is not selected', () => {
    const stash = read('app/(tabs)/stash.tsx');
    assert.match(stash, /StashCategoryCard/);
    assert.match(stash, /ProductCard/);
    assert.match(stash, /variant="related"/);
    assert.match(stash, /buildStashHome/);
    assert.match(stash, /Your products/);
    assert.match(stash, /renderRelatedGrid/);
    assert.match(stash, /Recently stashed/);
    assert.doesNotMatch(stash, /Ready to shop/);
    assert.doesNotMatch(stash, /BagItemCard/);
  });
});
