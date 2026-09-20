import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_SHARED_INPUT_LENGTH,
  normalizeSharedInput,
  userImportDedupeKey,
} from './sharedInput';
import { isPubliclyRoutableHost } from './hostSafety';

function expectOk(raw: unknown) {
  const result = normalizeSharedInput(raw);
  assert.equal(result.ok, true, `expected accept for ${String(raw)}`);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function expectRejection(raw: unknown, reason: string) {
  const result = normalizeSharedInput(raw);
  assert.equal(result.ok, false, `expected reject for ${String(raw)}`);
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.reason, reason);
}

describe('user import shared-input normalization', () => {
  it('accepts a raw Instagram reel URL and canonicalizes it', () => {
    const value = expectOk('https://www.instagram.com/reel/ABC123/');
    assert.equal(value.platform, 'instagram');
    assert.equal(value.normalizedUrl, 'https://www.instagram.com/reel/ABC123/');
    assert.equal(value.rawInput, 'https://www.instagram.com/reel/ABC123/');
  });

  it('accepts a raw YouTube Shorts URL and canonicalizes it to the watch form', () => {
    const value = expectOk('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    assert.equal(value.platform, 'youtube');
    assert.equal(value.normalizedUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('extracts the URL from surrounding text and preserves the raw input', () => {
    const value = expectOk('Check this out:\nhttps://www.youtube.com/shorts/dQw4w9WgXcQ');
    assert.equal(value.sourceUrl, 'https://www.youtube.com/shorts/dQw4w9WgXcQ');
    assert.equal(value.normalizedUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(value.rawInput, 'Check this out:\nhttps://www.youtube.com/shorts/dQw4w9WgXcQ');
  });

  it('trims whitespace and trailing prose punctuation around the URL', () => {
    const value = expectOk('   Loved this (https://shop.example.com/p/mug).   ');
    assert.equal(value.sourceUrl, 'https://shop.example.com/p/mug');
    assert.equal(value.rawInput, 'Loved this (https://shop.example.com/p/mug).');
  });

  it('strips tracking parameters using the existing canonicalization rules', () => {
    const value = expectOk('https://shop.example.com/p/mug?utm_source=ig&fbclid=xyz&size=large#reviews');
    assert.equal(value.normalizedUrl, 'https://shop.example.com/p/mug?size=large');
    assert.equal(value.platform, 'unknown');
  });

  it('accepts a non-video product URL (Phase 1 validates shape only)', () => {
    const value = expectOk('https://www.example.com/products/chair');
    assert.equal(value.platform, 'unknown');
    assert.equal(value.normalizedUrl, 'https://www.example.com/products/chair');
  });

  it('rejects empty and whitespace-only input', () => {
    expectRejection('', 'EMPTY_INPUT');
    expectRejection('   \n  ', 'EMPTY_INPUT');
    expectRejection(undefined, 'EMPTY_INPUT');
    expectRejection(42, 'EMPTY_INPUT');
  });

  it('rejects text with no link', () => {
    expectRejection('look at this reel', 'NO_URL_FOUND');
  });

  it('rejects unsupported schemes', () => {
    expectRejection('file:///etc/passwd', 'UNSUPPORTED_SCHEME');
    expectRejection('ftp://files.example.com/x', 'UNSUPPORTED_SCHEME');
    expectRejection('javascript:alert(1)', 'UNSUPPORTED_SCHEME');
    expectRejection('mailto:someone@example.com', 'UNSUPPORTED_SCHEME');
    expectRejection('intent://scan/#Intent;scheme=zxing;end', 'UNSUPPORTED_SCHEME');
  });

  it('rejects malformed URLs', () => {
    expectRejection('https://', 'NO_URL_FOUND');
    expectRejection('https://:8080/x', 'MALFORMED_URL');
  });

  it('rejects private, loopback and metadata destinations', () => {
    expectRejection('http://localhost:8787/imports', 'PRIVATE_DESTINATION');
    expectRejection('http://127.0.0.1/x', 'PRIVATE_DESTINATION');
    expectRejection('http://10.0.0.5/x', 'PRIVATE_DESTINATION');
    expectRejection('http://192.168.1.10/x', 'PRIVATE_DESTINATION');
    expectRejection('http://169.254.169.254/latest/meta-data', 'PRIVATE_DESTINATION');
    expectRejection('http://[::1]/x', 'PRIVATE_DESTINATION');
    expectRejection('http://router.lan/admin', 'PRIVATE_DESTINATION');
    expectRejection('http://intranet/admin', 'PRIVATE_DESTINATION');
    expectRejection('http://127.1/x', 'PRIVATE_DESTINATION');
  });

  it('rejects credentials embedded in the URL', () => {
    expectRejection('https://user:pass@shop.example.com/p/mug', 'CREDENTIALS_IN_URL');
  });

  it('rejects oversized payloads', () => {
    expectRejection(`https://shop.example.com/${'a'.repeat(MAX_SHARED_INPUT_LENGTH)}`, 'INPUT_TOO_LONG');
  });

  it('derives a stable dedupe key from the normalized URL only', () => {
    const a = expectOk('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    const b = expectOk('Watch: https://youtu.be/dQw4w9WgXcQ?si=track');
    assert.equal(a.normalizedUrl, b.normalizedUrl);
    assert.equal(userImportDedupeKey(a.normalizedUrl), userImportDedupeKey(b.normalizedUrl));
    assert.notEqual(
      userImportDedupeKey(a.normalizedUrl),
      userImportDedupeKey('https://www.example.com/other'),
    );
  });
});

describe('user import host safety', () => {
  it('allows public hosts and public dotted quads', () => {
    assert.equal(isPubliclyRoutableHost('www.instagram.com'), true);
    assert.equal(isPubliclyRoutableHost('shop.example.co.uk'), true);
    assert.equal(isPubliclyRoutableHost('93.184.216.34'), true);
  });

  it('blocks reserved names, private ranges and obfuscated numeric hosts', () => {
    assert.equal(isPubliclyRoutableHost('localhost'), false);
    assert.equal(isPubliclyRoutableHost('build.internal'), false);
    assert.equal(isPubliclyRoutableHost('172.16.4.4'), false);
    assert.equal(isPubliclyRoutableHost('100.64.0.1'), false);
    assert.equal(isPubliclyRoutableHost('0x7f.0.0.1'), false);
    assert.equal(isPubliclyRoutableHost('[fe80::1]'), false);
    assert.equal(isPubliclyRoutableHost('[2606:4700::1111]'), true);
  });
});
