import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MAX_SHARED_INPUT_LENGTH,
  SHARE_IMPORT_COPY,
  extractSharedLink,
  sharedLinkMessage,
  sharedTextFromImportParams,
} from '@/src/ui/shareImport';

/** Tests run from the repo root (see the Phase 1 doc for the command). */
const ROOT = process.cwd();

function expectLink(raw: string | null | undefined, url: string) {
  const result = extractSharedLink(raw);
  assert.equal(result.ok, true, `expected accept for ${String(raw)}`);
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.url, url);
  return result;
}

function expectRejection(raw: string | null | undefined, reason: string) {
  const result = extractSharedLink(raw);
  assert.equal(result.ok, false, `expected reject for ${String(raw)}`);
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.reason, reason);
}

describe('share capture link extraction', () => {
  it('accepts a raw Instagram reel URL', () => {
    expectLink('https://www.instagram.com/reel/ABC123/', 'https://www.instagram.com/reel/ABC123/');
  });

  it('accepts a raw YouTube Shorts URL', () => {
    expectLink(
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    );
  });

  it('extracts a link out of shared text and keeps the raw payload', () => {
    const result = expectLink(
      'Check this out:\nhttps://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    );
    assert.equal(result.rawInput, 'Check this out:\nhttps://www.youtube.com/shorts/dQw4w9WgXcQ');
  });

  it('tolerates whitespace and trailing punctuation around the link', () => {
    expectLink('   https://shop.example.com/p/mug   ', 'https://shop.example.com/p/mug');
    expectLink('loved it (https://shop.example.com/p/mug).', 'https://shop.example.com/p/mug');
  });

  it('rejects empty input', () => {
    expectRejection('', 'EMPTY_INPUT');
    expectRejection('    ', 'EMPTY_INPUT');
    expectRejection(null, 'EMPTY_INPUT');
    expectRejection(undefined, 'EMPTY_INPUT');
  });

  it('rejects text with no link', () => {
    expectRejection('saw something nice today', 'NO_URL_FOUND');
  });

  it('rejects malformed links', () => {
    expectRejection('https://', 'NO_URL_FOUND');
    expectRejection('http:// spaced.example.com', 'NO_URL_FOUND');
    expectRejection('https://:8080/x', 'MALFORMED_URL');
  });

  it('rejects unsupported schemes', () => {
    expectRejection('file:///sdcard/secret.txt', 'UNSUPPORTED_SCHEME');
    expectRejection('ftp://files.example.com/x', 'UNSUPPORTED_SCHEME');
    expectRejection('javascript:alert(1)', 'UNSUPPORTED_SCHEME');
    expectRejection('content://media/external/images/1', 'UNSUPPORTED_SCHEME');
  });

  it('rejects private and loopback destinations', () => {
    expectRejection('http://localhost:8787/imports', 'PRIVATE_DESTINATION');
    expectRejection('http://192.168.0.2/admin', 'PRIVATE_DESTINATION');
    expectRejection('http://169.254.169.254/latest', 'PRIVATE_DESTINATION');
    expectRejection('http://printer.local/status', 'PRIVATE_DESTINATION');
  });

  it('rejects oversized shares', () => {
    expectRejection(`https://shop.example.com/${'a'.repeat(MAX_SHARED_INPUT_LENGTH)}`, 'INPUT_TOO_LONG');
  });

  it('reads the shared payload from deep-link params', () => {
    assert.equal(sharedTextFromImportParams({ text: ' https://a.example.com/x ' }), 'https://a.example.com/x');
    assert.equal(sharedTextFromImportParams({ text: ['first', 'second'] }), 'first');
    assert.equal(sharedTextFromImportParams({ url: 'https://b.example.com' }), 'https://b.example.com');
    assert.equal(sharedTextFromImportParams({}), null);
    assert.equal(sharedTextFromImportParams({ text: '   ' }), null);
  });

  it('every rejection has user-facing copy', () => {
    for (const reason of [
      'EMPTY_INPUT',
      'INPUT_TOO_LONG',
      'NO_URL_FOUND',
      'UNSUPPORTED_SCHEME',
      'MALFORMED_URL',
      'PRIVATE_DESTINATION',
    ] as const) {
      assert.ok(sharedLinkMessage(reason).length > 0);
    }
  });
});

describe('share capture acknowledgement surface', () => {
  it('acknowledges receipt without claiming the product was identified or saved', () => {
    assert.equal(SHARE_IMPORT_COPY.acknowledgement, 'Got it — Mystash received your link.');
    for (const copy of Object.values(SHARE_IMPORT_COPY)) {
      assert.doesNotMatch(copy, /bag|saved to mystash|verified|confidence|processing|product/i);
    }
  });

  it('shows no product, Bag, verification or processing state on the import screen', () => {
    const screen = readFileSync(join(ROOT, 'app/import.tsx'), 'utf8');
    const code = screen
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');

    assert.match(code, /submitUserImport/);
    assert.match(code, /SHARE_IMPORT_COPY\.acknowledgement/);
    assert.match(code, /BAG_COPY\.view/);
    assert.match(code, /replace\('\/cart'\)/);
    assert.doesNotMatch(code, /VerificationBadge|verificationStatus|confidence/i);
    assert.doesNotMatch(code, /ProductCard|ProductDetailsSheet|catalogProductId/);
    assert.doesNotMatch(code, /useCart|addCartItem|cartApi/);
  });

  it('routes the share deep link through the existing expo-router stack', () => {
    const layout = readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8');
    assert.match(layout, /<Stack\.Screen name="import"/);
  });

  it('keeps the share target declared in Expo config so prebuild regenerates it', () => {
    const appConfig = readFileSync(join(ROOT, 'app.json'), 'utf8');
    assert.match(appConfig, /withAndroidShareIntent/);
  });
});
