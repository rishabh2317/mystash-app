const VALID_CURRENCY_CODES = new Set([
  'AED',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'IDR',
  'INR',
  'JPY',
  'KRW',
  'KWD',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'QAR',
  'SAR',
  'SEK',
  'SGD',
  'THB',
  'USD',
  'ZAR',
]);

const DOLLAR_CURRENCIES = new Set([
  'AUD',
  'CAD',
  'HKD',
  'MXN',
  'NZD',
  'SGD',
  'USD',
]);

export type CurrencyEvidenceSource =
  | 'raw_price_code'
  | 'raw_price_symbol'
  | 'reported_currency'
  | 'reported_currency_with_symbol'
  | 'currency_conflict'
  | 'none';

export type ParsedPriceEvidence = {
  rawPriceText: string | null;
  parsedAmount: number | null;
  parsedCurrency: string | null;
  detectedCurrencySource: CurrencyEvidenceSource;
};

function normalizedCurrency(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase() ?? '';
  return VALID_CURRENCY_CODES.has(code) ? code : null;
}

function parseAmount(raw: string): number | null {
  const numeric = raw.replace(/[^\d.,-]/g, '');
  if (!numeric || !/\d/.test(numeric)) return null;

  const lastComma = numeric.lastIndexOf(',');
  const lastDot = numeric.lastIndexOf('.');
  let normalized = numeric;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    normalized = normalized.replace(thousands, '').replace(decimal, '.');
  } else if (lastComma >= 0) {
    normalized = /,\d{1,2}$/.test(normalized)
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (lastDot >= 0 && !/\.\d{1,2}$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function inspectPriceEvidence(
  rawPriceText: string | null | undefined,
  reportedCurrency?: string | null,
): ParsedPriceEvidence {
  const raw = rawPriceText?.trim() || null;
  const amount = raw ? parseAmount(raw) : null;
  if (!raw || amount === null) {
    return {
      rawPriceText: raw,
      parsedAmount: null,
      parsedCurrency: null,
      detectedCurrencySource: 'none',
    };
  }

  const reported = normalizedCurrency(reportedCurrency);
  const rawCode = raw.toUpperCase().match(/\b[A-Z]{3}\b/)?.[0] ?? null;
  const explicitCode = rawCode && VALID_CURRENCY_CODES.has(rawCode) ? rawCode : null;
  if (explicitCode) {
    return {
      rawPriceText: raw,
      parsedAmount: amount,
      parsedCurrency: explicitCode,
      detectedCurrencySource:
        reported && reported !== explicitCode ? 'currency_conflict' : 'raw_price_code',
    };
  }

  const unambiguousSymbolCurrency = raw.includes('₹')
    ? 'INR'
    : raw.includes('£')
      ? 'GBP'
      : raw.includes('€')
        ? 'EUR'
        : null;
  if (unambiguousSymbolCurrency) {
    return {
      rawPriceText: raw,
      parsedAmount: amount,
      parsedCurrency: unambiguousSymbolCurrency,
      detectedCurrencySource:
        reported && reported !== unambiguousSymbolCurrency
          ? 'currency_conflict'
          : 'raw_price_symbol',
    };
  }

  if (raw.includes('$')) {
    return {
      rawPriceText: raw,
      parsedAmount: amount,
      parsedCurrency: reported && DOLLAR_CURRENCIES.has(reported) ? reported : null,
      detectedCurrencySource:
        reported && DOLLAR_CURRENCIES.has(reported)
          ? 'reported_currency_with_symbol'
          : reported
            ? 'currency_conflict'
            : 'none',
    };
  }

  if (raw.includes('¥')) {
    const yenOrYuan = reported === 'JPY' || reported === 'CNY' ? reported : null;
    return {
      rawPriceText: raw,
      parsedAmount: amount,
      parsedCurrency: yenOrYuan,
      detectedCurrencySource: yenOrYuan ? 'reported_currency_with_symbol' : 'none',
    };
  }

  return {
    rawPriceText: raw,
    parsedAmount: amount,
    parsedCurrency: reported,
    detectedCurrencySource: reported ? 'reported_currency' : 'none',
  };
}

export function sourceContainsRawPrice(
  sourceText: string,
  rawPriceText: string | null | undefined,
): boolean {
  const raw = rawPriceText?.trim();
  if (!raw) return false;
  return sourceText.replace(/\s+/g, '').includes(raw.replace(/\s+/g, ''));
}

export function detectPageLocale(sourceText: string): string | null {
  const htmlLang = sourceText.match(/<html[^>]+\blang=["']([a-z]{2}(?:[-_][A-Z]{2})?)/i)?.[1];
  const queryLang = sourceText.match(/[?&](?:language|locale)=([a-z]{2}(?:[-_][A-Z]{2})?)/i)?.[1];
  const locale = htmlLang ?? queryLang;
  return locale ? locale.replace('_', '-') : null;
}
