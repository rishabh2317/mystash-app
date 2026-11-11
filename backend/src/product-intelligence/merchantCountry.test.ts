import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ingestMerchantCountry } from './merchantCountry';
import { resolveCountryCode } from '../merchant-pricing/country';
it('uses the ingest owner’s existing country preference for foreground and retry resolution', async () => {
  for (const country of ['IN', 'US', 'GB']) {
    const reads: unknown[][] = [];
    const chain = { select() { return chain; }, eq(...args: unknown[]) { reads.push(args); return chain; }, async maybeSingle() { return { data: { id: 'ingest-owner', country }, error: null }; } };
    const admin = { from(table: string) { assert.equal(table, 'users'); return chain; } } as unknown as SupabaseClient;
    assert.equal(await ingestMerchantCountry(admin, 'ingest-owner'), country);
    assert.deepEqual(reads, [['id', 'ingest-owner']]);
  }
});
it('uses the established Find/pricing default when the owner or preference is unavailable', async () => {
  const admin = { from() { throw Error('offline'); } } as unknown as SupabaseClient;
  assert.equal(await ingestMerchantCountry(admin, 'owner'), resolveCountryCode({}));
  assert.equal(await ingestMerchantCountry(admin, null), resolveCountryCode({}));
});

it('queued/retry country selection uses the saved locale only when the profile has no country',async()=>{
  let country:string|null=null;
  const chain={select(){return chain;},eq(){return chain;},async maybeSingle(){return {data:{id:'owner',country,extensions:{shoppingLocale:'en-GB'}},error:null};}};
  const admin={from(){return chain;}} as unknown as SupabaseClient;
  assert.equal(await ingestMerchantCountry(admin,'owner'),'GB');
  country='IN';assert.equal(await ingestMerchantCountry(admin,'owner'),'IN');
});
