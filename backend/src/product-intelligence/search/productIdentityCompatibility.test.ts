import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessProductIdentityCompatibility,
  isProductIdentityCompatible,
  merchantBrandAfterHint,
} from './productIdentityCompatibility';
import { identityExpectationForSearch } from './pdpSearchHints';

const zara = {
  brand: 'Zara',
  name: 'Satin Midi Dress in Olive',
  category: 'fashion',
};

describe('product identity compatibility', () => {
  it('rejects a NEUDIS Amazon PDP for a Zara satin midi dress', () => {
    const result = assessProductIdentityCompatibility(zara, {
      title: 'NEUDIS Women Solid Satin Cowl Neck Sheath Dress',
      merchantUrl: 'https://www.amazon.in/NEUDIS-Sheath-Dresses-Length-Sleeveless/dp/B0BQRMD35B',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'brand_conflict');
  });

  it('rejects the same PDP when the title echoes the requested product but the slug names NEUDIS', () => {
    const result = assessProductIdentityCompatibility(zara, {
      title: 'Zara Satin Midi Dress in Olive',
      merchantUrl: 'https://www.amazon.in/NEUDIS-Sheath-Dresses-Length-Sleeveless/dp/B0BQRMD35B',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'brand_conflict');
  });

  it('accepts a Zara Amazon PDP whose title and slug name Zara', () => {
    const result = assessProductIdentityCompatibility(zara, {
      title: 'Zara Satin Midi Dress in Olive',
      merchantUrl: 'https://www.amazon.in/Zara-Satin-Midi-Dress-Olive/dp/B0ZARA1',
      brand: 'Zara',
    });
    assert.equal(result.ok, true);
  });

  it('does not copy a Zara brand hint onto a NEUDIS page', () => {
    assert.equal(
      merchantBrandAfterHint({
        title: 'NEUDIS Women Solid Satin Cowl Neck Sheath Dress',
        brandHint: 'Zara',
        productName: 'Satin Midi Dress in Olive',
        merchantUrl: 'https://www.amazon.in/NEUDIS-Sheath-Dresses-Length-Sleeveless/dp/B0BQRMD35B',
      }),
      null,
    );
    assert.equal(
      merchantBrandAfterHint({
        extractedBrand: 'NEUDIS',
        title: 'Satin Midi Dress',
        brandHint: 'Zara',
        productName: 'Satin Midi Dress in Olive',
      }),
      'NEUDIS',
    );
  });

  it('rejects WH-1000XM4 when WH-1000XM5 was requested', () => {
    const result = assessProductIdentityCompatibility(
      { brand: 'Sony', name: 'WH-1000XM5', model: 'WH-1000XM5', category: 'headphones' },
      {
        title: 'Sony WH-1000XM4 Wireless Headphones',
        merchantUrl: 'https://www.amazon.com/Sony-WH-1000XM4/dp/B0XM4',
        brand: 'Sony',
      },
    );
    assert.equal(result.ok, false);
    assert.ok(result.reason === 'model_missing' || result.reason === 'model_conflict');
  });

  it('rejects Olive vs Black when both sides name a color', () => {
    const result = assessProductIdentityCompatibility(zara, {
      title: 'Zara Satin Midi Dress in Black',
      brand: 'Zara',
      merchantUrl: 'https://www.zara.com/in/en/satin-midi-dress-p1.html',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'color_conflict');
  });

  it('rejects Dress vs Sneaker', () => {
    const result = assessProductIdentityCompatibility(
      { brand: 'Nike', name: 'Running Dress', category: 'fashion' },
      {
        title: 'Nike Running Sneaker',
        brand: 'Nike',
        merchantUrl: 'https://www.nike.com/running-sneaker',
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'type_conflict');
  });

  it('does not treat Bose as a conflicting brand when the request is empty', () => {
    const result = assessProductIdentityCompatibility(
      {},
      {
        title:
          'Bose New SoundLink Max Portable Speaker, Large Waterproof Bluetooth Speaker, Black',
        brand: 'Bose',
        merchantUrl:
          'https://www.amazon.in/Bose-SoundLink-Portable-Waterproof-Bluetooth/dp/B0D1CSN1QR',
      },
    );
    assert.equal(result.ok, true);
  });

  it('accepts the Bose SoundLink Max Amazon PDP for the search query', () => {
    const result = assessProductIdentityCompatibility(
      { name: 'Bose Soundlink Max' },
      {
        title:
          'Bose New SoundLink Max Portable Speaker, Large Waterproof Bluetooth Speaker, Black',
        brand: 'Bose',
        merchantUrl:
          'https://www.amazon.in/Bose-SoundLink-Portable-Waterproof-Bluetooth/dp/B0D1CSN1QR',
      },
    );
    assert.equal(result.ok, true);
  });

  it('does not treat a newsroom path token as a foreign brand', () => {
    const result = assessProductIdentityCompatibility(
      { brand: 'Adidas', name: 'Hyperboost Edge KI4392', category: 'shoes' },
      {
        title: 'Adidas Hyperboost Edge release',
        brand: 'Adidas',
        merchantUrl: 'https://about.adidas.com/en/newsroom/releases/hyperboost-edge',
      },
    );
    assert.equal(result.ok, true);
  });

  it('rejects grey joggers for black jeans', () => {
    const result = assessProductIdentityCompatibility(
      { brand: "Levi's", name: "Levi's 501 Black Jeans", category: 'fashion' },
      {
        title: "Levi's Grey Jogger",
        brand: "Levi's",
        merchantUrl: 'https://www.myntra.com/grey-jogger/p/itm123',
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'color_conflict');
  });

  it('keeps a populated identity expectation ahead of the raw search query', () => {
    const hints = identityExpectationForSearch(
      { brand: 'Adidas', name: 'Hyperboost Edge', model: 'KI4392', category: 'shoes' },
      'adidas hyperboost newsroom query',
    );
    assert.equal(hints.name, 'Hyperboost Edge');
    assert.equal(hints.brand, 'Adidas');
    assert.equal(hints.model, 'KI4392');
    assert.equal(hints.category, 'shoes');
    assert.deepEqual(identityExpectationForSearch({}, 'sony xm5'), {
      brand: null,
      name: 'sony xm5',
      model: null,
      category: null,
    });
  });

  it('does not treat a Samsung marketplace slug word as a second brand', () => {
    const result = assessProductIdentityCompatibility(
      { brand: 'Samsung', name: 'Galaxy S26 Ultra', category: 'electronics' },
      {
        title: 'Samsung Galaxy S26 Ultra',
        brand: 'Samsung',
        merchantUrl:
          'https://www.amazon.com/Samsung-Unlocked-Smartphone-Charging-Warranty/dp/B0G4SW3XXP',
      },
    );
    assert.equal(result.ok, true);
  });
});

describe('recorded Creator compound-model regression', () => {
  const expected = { brand: 'Sg', name: 'Kungfu Pandya Bat', model: 'Kungfu Pandya', category: 'sports' };
  const candidate = { brand: 'SG', title: 'SG Kung Fu Pandya Cricket Bat (2026)',
    merchantUrl: 'https://bestcricketstore.com/product/sg-kung-fu-pandya-cricket-bat/' };
  it('accepts spacing/hyphen equivalents in either direction without changing the requested identity', () => {
    assert.equal(assessProductIdentityCompatibility(expected, candidate).ok, true);
    assert.equal(assessProductIdentityCompatibility({ ...expected, model: 'Kung Fu Pandya' },
      { ...candidate, title: 'SG Kungfu Pandya Cricket Bat', merchantUrl: null }).ok, true);
    assert.equal(assessProductIdentityCompatibility(expected,
      { ...candidate, title: 'SG Kung-Fu Pandya Cricket Bat', merchantUrl: null }).ok, true);
    assert.equal(expected.model, 'Kungfu Pandya');
  });
  it('still requires every model token and rejects spelling changes and intervening words', () => {
    for (const title of ['SG Kung Fu Cricket Bat', 'SG Kungfuu Pandya Bat', 'SG Kung Willow Fu Pandya Bat']) {
      assert.equal(assessProductIdentityCompatibility(expected, { brand: 'SG', title }).ok, false, title);
    }
  });
  it('never manufactures compounds across fields or URL segments', () => {
    assert.equal(assessProductIdentityCompatibility(expected,
      { brand: 'SG', title: 'SG Fu Pandya Bat', model: 'Kung' }).ok, false);
    assert.equal(assessProductIdentityCompatibility(expected,
      { brand: 'SG', title: 'SG Pandya Bat', merchantUrl: 'https://shop.test/kung/fu-pandya' }).ok, false);
  });
  it('does not relax explicit brand, numeric model, color or product-type gates', () => {
    assert.equal(assessProductIdentityCompatibility(expected, { ...candidate, brand: 'MRF' }).reason, 'brand_conflict');
    assert.equal(assessProductIdentityCompatibility({ ...expected, model: 'Kungfu Pandya 12' },
      { ...candidate, title: 'SG Kung Fu Pandya 13', merchantUrl: null }).ok, false);
    assert.equal(assessProductIdentityCompatibility({ ...expected, name: 'Kungfu Pandya Black Bat' },
      { ...candidate, title: 'SG Kung Fu Pandya White Bat' }).reason, 'color_conflict');
    assert.equal(assessProductIdentityCompatibility({ ...expected, name: 'Kungfu Pandya Dress', category: 'fashion' },
      { ...candidate, title: 'SG Kung Fu Pandya Shoe', merchantUrl: null }).reason, 'type_conflict');
  });
});

describe('explicit laptop variants remain hard identity gates', () => {
  const expected = { brand: 'Lenovo', name: 'ThinkPad X1 Carbon Gen 12 16GB RAM 1TB SSD', model: 'X1 Carbon', category: 'laptops' };
  it('accepts the requested generation and configuration and rejects older or ambiguous variants', () => {
    for (const name of ['Lenovo ThinkPad X1 Carbon Gen 11 16GB RAM 1TB SSD', 'Lenovo ThinkPad X1 Carbon Gen 12 8GB RAM 1TB SSD', 'Lenovo ThinkPad X1 Carbon Gen 12 16GB RAM 512GB SSD', 'Lenovo ThinkPad X1 Carbon']) {
      assert.equal(isProductIdentityCompatible(expected, { title: name }), false, name);
    }
    assert.equal(isProductIdentityCompatible(expected, { title: 'Lenovo ThinkPad X1 Carbon 12th Gen 16 GB RAM 1 TB SSD' }), true);
  });
  it('carries explicit processor/year from source context and does not infer unsupported generations', () => {
    assert.equal(isProductIdentityCompatible({ brand: 'HP', name: 'OmniBook X', category: 'laptop', variantContext: 'HP OmniBook X Snapdragon X Elite' }, { title: 'HP OmniBook X Snapdragon X Plus' }), false);
    assert.equal(isProductIdentityCompatible({ brand: 'HP', name: 'OmniBook X', category: 'laptop', variantContext: 'HP OmniBook X Snapdragon X Elite' }, { title: 'HP OmniBook X Intel Core Ultra 7' }), false);
    assert.equal(isProductIdentityCompatible({ brand: 'HP', name: 'OmniBook X', category: 'laptop', variantContext: 'HP OmniBook X Snapdragon X Elite' }, { title: 'HP OmniBook X Snapdragon X Elite' }), true);
    assert.equal(isProductIdentityCompatible({ brand: 'Lenovo', name: 'ThinkPad X1 Carbon', category: 'laptop', variantContext: '2026 Lenovo ThinkPad X1 Carbon' }, { title: 'Lenovo ThinkPad X1 Carbon Intel i7-1365U' }), false);
  });
  it('requires provided manufacturer identifiers and lets discovery defer missing details, never conflicts', () => {
    assert.equal(isProductIdentityCompatible({ brand: 'HP', name: 'OmniBook X', mpn: '14-fe0001', gtin: '1234567890123' }, { title: 'HP OmniBook X', mpn: '14-fe0002', gtin: '1234567890123' }), false);
    assert.equal(isProductIdentityCompatible({ brand: 'HP', name: 'OmniBook X', mpn: '14-fe0001', gtin: '1234567890123' }, { title: 'HP OmniBook X', mpn: '14-fe0001', gtin: '1234567890123' }), true);
    assert.equal(isProductIdentityCompatible(expected, { title: 'Lenovo ThinkPad X1 Carbon' }, { requireVariantSupport: false }), true);
    assert.equal(isProductIdentityCompatible(expected, { title: 'Lenovo ThinkPad X1 Carbon Gen 11' }, { requireVariantSupport: false }), false);
  });
});

describe('recorded Nov 9/10 official merchant routing regression', () => {
  it('does not read HP pdp or Lenovo laptops routing segments as a competing brand', () => {
    for (const row of [
      { brand: 'HP', name: 'Omnibook X', model: 'OmniBook X', title: 'HP OmniBook X | HP Official Store', url: 'https://www.hp.com/us-en/shop/pdp/hp-omnibook-x-laptop-ai-pc-14-fe000-14-9j1h6av-1' },
      { brand: 'Lenovo', name: 'Thinkpad X1 Carbon', model: 'X1 Carbon', title: 'ThinkPad X1 Carbon Gen 14 Aura Edition - Lenovo', url: 'https://www.lenovo.com/us/en/p/laptops/thinkpad/thinkpadx1/lenovo-thinkpad-x1-carbon-gen-14-aura-edition-14-inch-intel/len101t0159' },
    ]) {
      assert.equal(isProductIdentityCompatible(row, { title: row.title, merchantUrl: row.url }, { requireBrandSupport: false, requireVariantSupport: false }), true);
      assert.equal(isProductIdentityCompatible(row, { title: 'NEUDIS unrelated product', merchantUrl: row.url }), false);
    }
  });
});

it('accepts the recorded ThinkPad sub-brand only on Lenovo itself and for the requested line', () => {
  const expected = { brand: 'Lenovo', name: 'ThinkPad X1 Carbon', model: 'X1 Carbon', category: 'laptops' };
  const candidate = { title: 'ThinkPad X1 Carbon Gen 14 Aura Edition', brand: 'ThinkPad', merchantUrl: 'https://www.lenovo.com/us/en/p/laptops/thinkpad/thinkpadx1/product' };
  assert.equal(isProductIdentityCompatible(expected, candidate), true);
  for (const url of ['https://lenovo.evil.com/product/a','https://notlenovo.com/product/a','https://marketplace.example/product/a']) assert.equal(isProductIdentityCompatible(expected, { ...candidate, merchantUrl: url }), false);
  assert.equal(isProductIdentityCompatible(expected, { ...candidate, brand: 'Dell' }), false);
  assert.equal(isProductIdentityCompatible(expected, { ...candidate, brand: 'IdeaPad' }), false);
});

it('can establish a processor from product-scoped merchant facts without requiring it in the page title', () => {
  const expected = { brand: 'HP', name: 'OmniBook X', model: 'OmniBook X', category: 'laptops', variantContext: 'HP OmniBook X Snapdragon X Elite Laptop' };
  assert.equal(isProductIdentityCompatible(expected, { title: 'HP OmniBook X', merchantUrl: 'https://www.hp.com/shop/pdp/omnibook-x', variantContext: 'Powered by Qualcomm Snapdragon® X Elite.' }), true);
  assert.equal(isProductIdentityCompatible(expected, { title: 'HP OmniBook X', merchantUrl: 'https://www.hp.com/shop/pdp/omnibook-x', variantContext: 'Powered by Snapdragon X Plus.' }), false);
});
