import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRetryFindSaving, findDetailRows, findDetailStatus, findPlaceDestination } from './findDetail';
import { feedShopPresentation, shoppableProductOffers } from './feedShop';
import { findFixture, findDetailFixture } from './findTestFixtures';

test('Find detail status distinguishes pending, progressive, saved, empty and failure without claiming premature success', () => {
  const item=findFixture();
  item.outcome={...item.outcome,result:'pending',extractionActive:false,foundProducts:0,foundPlaces:0,savedProducts:0,savedPlaces:0,stashSync:'pending'};
  item.outcome.canRetrySaving=true;
  assert.equal(canRetryFindSaving(item),false);
  assert.match(findDetailStatus(item).label,/got your Find/);
  assert.equal(findDetailStatus(item).tone,'queued');
  item.outcome.extractionActive=true;
  assert.equal(findDetailStatus(item).tone,'working');
  assert.match(findDetailStatus(item).label,/see what/);
  item.outcome.foundPlaces=1;
  assert.match(findDetailStatus(item).label,/spotted/);
  item.outcome.extractionActive=false;item.outcome.result='found';
  assert.match(findDetailStatus(item).label,/ready/);
  item.outcome.stashSync='complete';
  assert.doesNotMatch(findDetailStatus(item).message,/Stash/);
  item.outcome.savedPlaces=1;
  assert.match(findDetailStatus(item).message,/saved finds/);
  assert.equal(findDetailStatus(item).tone,'success');
  item.outcome={...item.outcome,result:'empty',foundPlaces:0,savedPlaces:0};
  assert.match(findDetailStatus(item).label,/Nothing/);
  item.outcome={...item.outcome,result:'failed'};
  assert.match(findDetailStatus(item).label,/snag/);
  assert.equal(findDetailStatus(item).tone,'error');
  item.outcome.stashSync='failed';
  assert.equal(canRetryFindSaving(item),true);
  item.outcome.canRetrySaving=false;
  assert.equal(canRetryFindSaving(item),false);
});
test('place destinations require matching attribution or canonical identity', () => {
  const place={kind:'unresolved' as const,id:'lead',name:'Cafe',locationContext:null,uncertainty:'unconfirmed' as const,destination:{kind:'google_search' as const,query:'Cafe',url:'https://www.google.com/search?q=Cafe'},image:null,sources:[{userImportId:'import-a',contentSourceId:'source',contentSourcePlaceId:'result',addedAt:'2026-01-01'}]};
  assert.equal(findPlaceDestination([place],'import-a','result')?.url,place.destination.url);
  assert.equal(findPlaceDestination([place],'import-b','result'),null);
  assert.equal(findPlaceDestination([{...place,destination:{...place.destination,url:'javascript:alert(1)'}}],'import-a','result'),null);
});
test('existing shopping presentation still filters non-purchasable offers', () => {
  assert.equal(feedShopPresentation(0),'fallback');assert.equal(feedShopPresentation(1),'direct');assert.equal(feedShopPresentation(2),'sheet');
  assert.deepEqual(shoppableProductOffers([{id:'1',merchant:'A',price:null,currency:null,availability:null,action:'buy'},{id:'2',merchant:'B',price:null,currency:null,availability:null,action:'none'}]).map(offer=>offer.id),['1']);
});
test('catalog shopping preserves discovered and similar identities without promoting suggestions', () => {
  const detail=findDetailFixture(); const rows=findDetailRows(detail);
  assert.equal(rows[0].catalogProductId,detail.products[0].catalogProductId);
  const similar=rows.find(row=>row.membership?.kind==='suggestion');
  assert.equal(similar?.catalogProductId,null);
  assert.match(similar?.subtitle ?? '',/Similar product/);
  assert.equal(rows.find(row=>row.key.startsWith('place:'))?.membership?.kind,'places');
  detail.products[0]={...detail.products[0],catalogProductId:null,discoveredProductId:'discovered-id',identityKey:'d:discovered-id'};
  const discovered=findDetailRows(detail)[0];
  assert.equal(discovered.openProductId,'discovered-id');
  assert.equal(discovered.catalogProductId,null);
  detail.products[0]={...detail.products[0],identityKey:null,matchKind:'unable_to_identify'};
  assert.equal(findDetailRows(detail)[0].openProductId,null);
});
