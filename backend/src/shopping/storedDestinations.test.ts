import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findStoredShoppingDestination,
  isUnavailableAvailability,
  listStoredShoppingDestinations,
  shoppingOfferId,
  userFacingAvailability,
  type StoredShoppingSource,
} from './storedDestinations';

function source(partial: Partial<StoredShoppingSource> = {}): StoredShoppingSource {
  return {
    merchant: 'Sony Store',
    merchantUrl: 'https://www.sony.com/headphones',
    preferredShoppingUrl: null,
    price: '39990',
    currency: 'INR',
    brand: 'Sony',
    metadata: {},
    catalogProductId: null,
    ...partial,
  };
}

describe('stored shopping destinations', () => {
  it('projects one stored merchant without inventing extras', () => {
    const rows = listStoredShoppingDestinations(source());
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.url, 'https://www.sony.com/headphones');
    assert.equal(rows[0]?.price, '39990');
    assert.equal(rows[0]?.currency, 'INR');
    assert.equal(rows[0]?.merchant, 'Sony Store');
  });

  it('projects multiple shopping candidates and keeps per-row prices', () => {
    const rows = listStoredShoppingDestinations(
      source({
        metadata: {
          shopping_candidates: [
            {
              url: 'https://www.amazon.in/dp/XM5',
              merchant: 'Amazon',
              price: '34990',
              currency: 'INR',
              shoppingProvider: 'amazon',
            },
            {
              url: 'https://www.flipkart.com/sony-xm5/p/itm',
              merchant: 'Flipkart',
              price: '35499',
              currency: 'INR',
              shoppingProvider: 'flipkart',
            },
            {
              url: 'https://www.croma.com/sony-xm5',
              merchant: 'Croma',
              price: '36999',
              currency: 'INR',
            },
            {
              url: 'https://www.sony.com/headphones',
              merchant: 'Sony',
              price: '39990',
              currency: 'INR',
            },
          ],
        },
      }),
    );
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((row) => [row.merchant, row.price, row.currency]),
      [
        ['Amazon', '34990', 'INR'],
        ['Flipkart', '35499', 'INR'],
        ['Croma', '36999', 'INR'],
        ['Sony', '39990', 'INR'],
      ],
    );
    assert.equal(
      rows[0]?.offerId,
      shoppingOfferId('https://www.amazon.in/dp/XM5'),
    );
  });

  it('returns no destinations when every URL is missing or unsafe', () => {
    assert.deepEqual(
      listStoredShoppingDestinations(
        source({
          merchantUrl: 'javascript:alert(1)',
          preferredShoppingUrl: 'file:///tmp/p',
          metadata: { shopping_candidates: [{ url: 'not-a-url' }] },
        }),
      ),
      [],
    );
  });

  it('keeps different currencies that already exist on stored rows', () => {
    const rows = listStoredShoppingDestinations(
      source({
        price: null,
        currency: null,
        merchantUrl: null,
        metadata: {
          shopping_candidates: [
            { url: 'https://www.amazon.com/dp/XM5', price: '348', currency: 'USD' },
            { url: 'https://www.amazon.in/dp/XM5', price: '34990', currency: 'INR' },
          ],
        },
      }),
    );
    assert.equal(rows[0]?.currency, 'USD');
    assert.equal(rows[1]?.currency, 'INR');
  });

  it('does not copy the primary price onto a different merchant', () => {
    const rows = listStoredShoppingDestinations(
      source({
        merchantUrl: 'https://www.sony.com/headphones',
        price: '39990',
        currency: 'INR',
        metadata: {
          shopping_candidates: [
            { url: 'https://www.amazon.in/dp/XM5', shoppingProvider: 'amazon' },
            { url: 'https://www.sony.com/headphones' },
          ],
        },
      }),
    );
    const amazon = rows.find((row) => /amazon/i.test(row.url));
    const sony = rows.find((row) => /sony/i.test(row.url));
    assert.equal(amazon?.price, null);
    assert.equal(sony?.price, '39990');
  });

  it('treats out-of-stock copy as unavailable and leaves last-verified off the row', () => {
    assert.equal(isUnavailableAvailability('OutOfStock'), true);
    assert.equal(isUnavailableAvailability('In stock'), false);
    assert.equal(userFacingAvailability('OutOfStock'), 'Out of stock');
    const rows = listStoredShoppingDestinations(
      source({
        metadata: {
          offer: {
            merchant: 'Amazon',
            merchantUrl: 'https://www.amazon.in/dp/XM5',
            price: '34990',
            currency: 'INR',
            availability: 'OutOfStock',
          },
        },
      }),
    );
    const amazon = rows.find((row) => /amazon/i.test(row.url));
    assert.equal(amazon?.availability, 'OutOfStock');
    assert.equal(JSON.stringify(amazon).includes('lastVerified'), false);
  });

  it('looks up a destination by opaque offer id only', () => {
    const src = source();
    const [only] = listStoredShoppingDestinations(src);
    assert.ok(only);
    assert.equal(findStoredShoppingDestination(src, only.offerId)?.url, only.url);
    assert.equal(findStoredShoppingDestination(src, 'not-an-offer'), null);
  });
});
