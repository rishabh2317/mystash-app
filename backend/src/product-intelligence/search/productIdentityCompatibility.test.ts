import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessProductIdentityCompatibility,
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
