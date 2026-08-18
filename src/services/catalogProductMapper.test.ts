import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { draftProductToViewModel } from './catalogProductMapper';
import type { DraftProduct } from '@/src/types/curation';

describe('draftProductToViewModel', () => {
  it('displays VERIFIED from a resolved draft without treating missing catalog join as UNRESOLVED', () => {
    const draft: DraftProduct = {
      id: 'p1',
      name: 'Ray-Ban Meta',
      price: '₹39,900.00',
      provider: 'amazon',
      affiliateUrl: '',
      catalogProductId: 'cat-1',
      resolutionStatus: 'VERIFIED',
      merchantUrl: 'https://amzn.in/d/08CvHpKL',
      brand: 'Ray-Ban',
    };
    const vm = draftProductToViewModel(draft);
    assert.equal(vm.verificationStatus, 'VERIFIED');
    assert.equal(vm.catalogProductId, 'cat-1');
  });

  it('shows RESOLVING, not UNRESOLVED, when resolution fields are missing from the client payload', () => {
    const draft: DraftProduct = {
      id: 'p1',
      name: 'Pending',
      price: '—',
      provider: 'manual',
      affiliateUrl: '',
    };
    const vm = draftProductToViewModel(draft);
    assert.equal(vm.verificationStatus, 'RESOLVING');
  });
});
