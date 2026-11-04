import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FindScreenDetail } from '@/src/services/findClient';
import { findDetailFixture, findFixtureId } from '@/src/ui/findTestFixtures';
import { findActivityPreviews } from '@/src/ui/findDashboard';
import { createFindActivityPreviewController } from './findActivityPreviewController';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:Error)=>void;
  const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};}

test('Activity previews show at most three distinct identified results with a place when mixed',()=>{
  const detail=findDetailFixture();
  detail.products.push({...detail.products[0],id:findFixtureId(103)});
  detail.products.push({...detail.products[0],id:findFixtureId(104),identityKey:null,catalogProductId:null,matchKind:'unable_to_identify'});
  const rows=findActivityPreviews(detail);
  assert.deepEqual(rows.map(row=>row.title),['Everyday camera','Linen jacket','Corner café']);
  assert.deepEqual(rows.map(row=>row.note),['In My Stash','Removed from My Stash','In My Stash']);
  assert.equal(rows.length,3);
  detail.products=[];detail.savedSuggestions=[];
  assert.deepEqual(findActivityPreviews(detail).map(row=>row.kind),['place']);
});

test('Activity preview reads once per capture revision and ignores stale account responses',async()=>{
  const first=deferred<FindScreenDetail>(),second=deferred<FindScreenDetail>();
  const calls:{id:string;owner:string}[]=[];
  const controller=createFindActivityPreviewController({detail(id,owner){calls.push({id,owner});return calls.length===1?first.promise:second.promise;}});
  const id=findFixtureId(1);
  controller.configure('A',id,'revision-1',false,true);
  assert.equal(calls.length,0,'collapsed completed Activity does not prefetch detail');
  controller.configure('A',id,'revision-1',true,true);
  controller.configure('A',id,'revision-1',true,true);
  assert.equal(calls.length,1,'list filter rerenders cannot refetch Activity');
  controller.configure('B',id,'revision-1',true,true);
  assert.equal(controller.getState().items.length,0);
  first.resolve(findDetailFixture());await flush();
  assert.equal(controller.getState().owner,'B');assert.equal(controller.getState().items.length,0);
  second.resolve(findDetailFixture());await flush();
  assert.equal(controller.getState().items.length,3);
  controller.configure(null,null,'',false,false);
  assert.equal(controller.getState().items.length,0);
});

test('Activity preview failures remain recoverable and never retain stale result rows',async()=>{
  let calls=0;
  const controller=createFindActivityPreviewController({detail:async()=>{calls++;if(calls===2)throw Error('PRIVATE_CANARY');return findDetailFixture();}});
  const id=findFixtureId(1);
  controller.configure('A',id,'1',true,true);await flush();
  assert.equal(controller.getState().items.length,3);
  controller.configure('A',id,'2',true,true);
  assert.equal(controller.getState().items.length,0);
  await flush();
  assert.equal(controller.getState().error,true);
  assert.equal(controller.getState().items.length,0);
  controller.configure('A',id,'3',true,false);
  assert.equal(controller.getState().items.length,0);
});
