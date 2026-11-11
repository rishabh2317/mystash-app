import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectStudioProductLinks } from './createProductLinks';

const fields = (values: string[]) => values.map((value, id) => ({ id, value }));
for (const count of [1, 2, 5]) test(`collects ${count} product URLs in one batch`, () => {
  const values = Array.from({ length: count }, (_, i) => ` https://shop.example/product/${i}?affiliate=keep-${i} `);
  const result = collectStudioProductLinks(fields(values));
  assert.equal(result.valid, true);
  assert.deepEqual(result.urls, values.map(value => value.trim()));
});
test('ignores optional blanks and submits normalized duplicates only once', () => {
  const result = collectStudioProductLinks(fields([' https://SHOP.example/p?ref=affiliate#details ', '', '   ', 'https://shop.example/p?ref=affiliate']));
  assert.equal(result.valid, true);
  assert.deepEqual(result.urls, ['https://shop.example/p?ref=affiliate']);
  assert.deepEqual(result.duplicates, [3]);
});
test('a nonempty invalid field blocks the whole batch and identifies only that field', () => {
  for (const value of ['not a url', 'ftp://shop.example/p', 'javascript:alert(1)', 'https://']) {
    const result = collectStudioProductLinks([{ id: 4, value: 'https://shop.example/valid' }, { id: 8, value }]);
    assert.equal(result.valid, false);
    assert.deepEqual(Object.keys(result.errors), ['8']);
  }
  assert.equal(collectStudioProductLinks(fields(['', ' '])).valid, false);
  assert.equal(collectStudioProductLinks(fields(Array.from({ length: 6 }, (_, i) => `https://shop.example/${i}`))).valid, false);
});
