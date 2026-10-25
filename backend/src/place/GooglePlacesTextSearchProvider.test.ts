import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  GOOGLE_PLACES_FIELD_MASK,
  GOOGLE_PLACES_TEXT_SEARCH_URL,
  GooglePlacesTextSearchProvider,
  mapGooglePlacesTextSearchBody,
} from './GooglePlacesTextSearchProvider';
import { PLACE_SEARCH_CANDIDATE_CAP } from './PlaceSearchProvider';

describe('mapGooglePlacesTextSearchBody', () => {
  it('maps a Places Text Search place and caps the list', () => {
    const places = Array.from({ length: 8 }, (_, index) => ({
      id: `places/ChIJ-${index}`,
      displayName: { text: `Place ${index}` },
      formattedAddress: `${index} Example Street`,
      location: { latitude: index, longitude: index + 0.5 },
      types: ['point_of_interest', 'tourist_attraction'],
      googleMapsUri: `https://maps.google.com/?cid=${index}`,
      addressComponents: [
        { longText: 'Seminyak', types: ['neighborhood'] },
        { longText: 'Badung', types: ['locality'] },
        { longText: 'Bali', types: ['administrative_area_level_1'] },
        { longText: 'Indonesia', types: ['country'] },
      ],
    }));
    const candidates = mapGooglePlacesTextSearchBody({ places });
    assert.equal(candidates.length, PLACE_SEARCH_CANDIDATE_CAP);
    assert.equal(candidates[0]?.providerPlaceId, 'ChIJ-0');
    assert.equal(candidates[0]?.name, 'Place 0');
    assert.equal(candidates[0]?.locality, 'Seminyak');
    assert.equal(candidates[0]?.city, 'Badung');
    assert.equal(candidates[0]?.region, 'Bali');
    assert.equal(candidates[0]?.country, 'Indonesia');
    assert.equal(candidates[0]?.category, 'tourist attraction');
    assert.equal(candidates[0]?.latitude, 0);
    assert.equal(candidates[0]?.longitude, 0.5);
    assert.equal(candidates[0]?.mapsUrl, 'https://maps.google.com/?cid=0');
  });

  it('drops rows without an id or name', () => {
    assert.deepEqual(
      mapGooglePlacesTextSearchBody({
        places: [{ displayName: { text: 'Nameless' } }, { id: 'ChIJ-x' }],
      }),
      [],
    );
  });
});

describe('GooglePlacesTextSearchProvider', () => {
  it('does not call fetch without an API key', async () => {
    let called = 0;
    const provider = new GooglePlacesTextSearchProvider({
      apiKey: '',
      fetchImpl: async () => {
        called += 1;
        throw new Error('fetch must not be called');
      },
    });
    const attempt = await provider.search('Potato Head');
    assert.deepEqual(attempt, { ok: false, reason: 'provider_failed' });
    assert.equal(called, 0);
  });

  it('posts a text search and returns mapped candidates', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const provider = new GooglePlacesTextSearchProvider({
      apiKey: 'test-key',
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify({
            places: [
              {
                id: 'ChIJ-potato',
                displayName: { text: 'Potato Head' },
                formattedAddress: 'Seminyak, Bali',
                location: { latitude: -8.68, longitude: 115.15 },
                types: ['bar'],
                googleMapsUri: 'https://maps.google.com/?cid=potato',
                addressComponents: [{ longText: 'Seminyak', types: ['locality'] }],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    const attempt = await provider.search('Potato Head Seminyak');
    assert.equal(attempt.ok, true);
    if (!attempt.ok) return;
    assert.equal(attempt.candidates.length, 1);
    assert.equal(attempt.candidates[0]?.providerPlaceId, 'ChIJ-potato');
    assert.equal(attempt.candidates[0]?.city, 'Seminyak');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, GOOGLE_PLACES_TEXT_SEARCH_URL);
    const headers = new Headers(requests[0]?.init.headers);
    assert.equal(headers.get('X-Goog-Api-Key'), 'test-key');
    assert.equal(headers.get('X-Goog-FieldMask'), GOOGLE_PLACES_FIELD_MASK);
    assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
      textQuery: 'Potato Head Seminyak',
      maxResultCount: PLACE_SEARCH_CANDIDATE_CAP,
    });
  });

  it('treats a non-OK response as provider failure', async () => {
    const provider = new GooglePlacesTextSearchProvider({
      apiKey: 'test-key',
      fetchImpl: async () => new Response('nope', { status: 500 }),
    });
    assert.deepEqual(await provider.search('Tanah Lot'), { ok: false, reason: 'provider_failed' });
  });

  it('is not the product Serper search provider', () => {
    const src = [
      readFileSync(join(__dirname, 'GooglePlacesTextSearchProvider.ts'), 'utf8'),
      readFileSync(join(__dirname, 'PlaceResolver.ts'), 'utf8'),
      readFileSync(join(__dirname, 'PlaceSearchProvider.ts'), 'utf8'),
    ].join('\n');
    assert.doesNotMatch(src, /SerperSearchProvider|google\.serper\.dev/);
  });
});
