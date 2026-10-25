import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dropProductsMatchingKeptPlaces,
  productIsKeptPlace,
} from './dropProductsMatchingKeptPlaces';

function place(
  name: string,
  extra: { locality?: string | null; city?: string | null } = {},
) {
  return {
    name,
    locality: extra.locality ?? null,
    city: extra.city ?? null,
    region: null,
    country: null,
    mentionedAddress: null,
  };
}

describe('dropProductsMatchingKeptPlaces', () => {
  it('drops a named hotel that also appears as a kept place', () => {
    const products = [{ name: 'Fairfield by Marriott Airport Hotel Mumbai' }, { name: 'Sony WH-1000XM5' }];
    const places = [place('Fairfield by Marriott Airport Hotel Mumbai', { city: 'Mumbai' })];
    assert.deepEqual(
      dropProductsMatchingKeptPlaces(products, places).map((row) => row.name),
      ['Sony WH-1000XM5'],
    );
  });

  it('drops a named restaurant that also appears as a kept place', () => {
    const products = [{ name: 'Cafe de Flore' }, { name: 'Ceramic Mug' }];
    const places = [place('Cafe de Flore', { city: 'Paris' })];
    assert.deepEqual(
      dropProductsMatchingKeptPlaces(products, places).map((row) => row.name),
      ['Ceramic Mug'],
    );
  });

  it('drops a named attraction that also appears as a kept place', () => {
    const products = [{ name: 'Eiffel Tower' }, { name: 'Road Bicycle' }];
    const places = [place('Eiffel Tower', { city: 'Paris' })];
    assert.deepEqual(
      dropProductsMatchingKeptPlaces(products, places).map((row) => row.name),
      ['Road Bicycle'],
    );
  });

  it('drops the same venue when names differ only by location or venue flavour', () => {
    const products = [{ name: 'Naptapgo Japanese Pod' }];
    const places = [place('Naptapgo Noida Sector 63', { city: 'Noida', locality: 'Sector 63' })];
    assert.equal(dropProductsMatchingKeptPlaces(products, places).length, 0);
    assert.equal(
      productIsKeptPlace('Assanja Hobbit House', place('Assanja Hobbit House')),
      true,
    );
  });

  it('keeps merchandise named after a venue', () => {
    const products = [{ name: 'Potato Head T-shirt' }, { name: 'Potato Head Mug' }];
    const places = [place('Potato Head', { locality: 'Seminyak' })];
    assert.deepEqual(
      dropProductsMatchingKeptPlaces(products, places).map((row) => row.name),
      ['Potato Head T-shirt', 'Potato Head Mug'],
    );
  });

  it('keeps an unrelated product next to a venue', () => {
    const products = [{ name: 'Sony WH-1000XM5' }];
    const places = [place('Fairfield by Marriott Airport Hotel Mumbai', { city: 'Mumbai' })];
    assert.equal(dropProductsMatchingKeptPlaces(products, places).length, 1);
  });

  it('leaves products unchanged when there is a place and no overlapping product', () => {
    const products = [{ name: 'Ceramic Mug' }];
    const places = [place('Tanah Lot')];
    assert.deepEqual(dropProductsMatchingKeptPlaces(products, places), products);
  });

  it('does not use a discarded generic place type to drop a product', () => {
    const products = [{ name: 'Hotel in Bali' }, { name: 'Cafe Mug' }];
    const places = [place('Hotel', { locality: 'Bali' }), place('Cafe')];
    assert.deepEqual(
      dropProductsMatchingKeptPlaces(products, places).map((row) => row.name),
      ['Hotel in Bali', 'Cafe Mug'],
    );
  });

  it('keeps a product when identity equivalence is uncertain', () => {
    const products = [{ name: 'Marriott Bonvoy Gift Card' }];
    const places = [place('Fairfield by Marriott Airport Hotel Mumbai', { city: 'Mumbai' })];
    assert.equal(dropProductsMatchingKeptPlaces(products, places).length, 1);
  });
});
