import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectPageLocale,
  inspectPriceEvidence,
  sourceContainsRawPrice,
} from './CommercePriceEvidence';

describe('CommercePriceEvidence', () => {
  it('keeps an explicit USD amount and currency together', () => {
    const evidence = inspectPriceEvidence('$1,137.00', 'USD');

    assert.equal(evidence.parsedAmount, 1137);
    assert.equal(evidence.parsedCurrency, 'USD');
    assert.equal(evidence.detectedCurrencySource, 'reported_currency_with_symbol');
  });

  it('does not combine a dollar amount with reported INR', () => {
    const evidence = inspectPriceEvidence('$1,137.00', 'INR');

    assert.equal(evidence.parsedAmount, 1137);
    assert.equal(evidence.parsedCurrency, null);
    assert.equal(evidence.detectedCurrencySource, 'currency_conflict');
  });

  it('trusts an unambiguous raw symbol over a conflicting currency field', () => {
    const evidence = inspectPriceEvidence('₹1,00,000', 'USD');

    assert.equal(evidence.parsedAmount, 100000);
    assert.equal(evidence.parsedCurrency, 'INR');
    assert.equal(evidence.detectedCurrencySource, 'currency_conflict');
  });

  it('requires the AI price text to be present in source content', () => {
    const source =
      'displayPrice: \"$1,137.00\", priceAmount: 1137.00, currencyCode: \"USD\"';

    assert.equal(sourceContainsRawPrice(source, '$1,137.00'), true);
    assert.equal(sourceContainsRawPrice(source, '₹1,137.00'), false);
  });

  it('extracts a page locale only when present', () => {
    assert.equal(detectPageLocale('<html lang=\"en-US\">'), 'en-US');
    assert.equal(detectPageLocale('https://example.com/item?language=en_US'), 'en-US');
    assert.equal(detectPageLocale('plain merchant content'), null);
  });
});
