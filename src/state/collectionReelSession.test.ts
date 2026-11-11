import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionReelSession, getCollectionReelSession, mergeCollectionReelRefs, collectionReelLoopRows, collectionReelLoopTarget } from './collectionReelSession';
import { collectionTilePressPath } from '../ui/collectionLayout';
import { createCollectionReelPageLoader } from '../services/collectionReelPages';
import type { CollectionViewModel } from '../types/collection';

const refs = ['latest','middle','oldest'].map(collectionId=>({collectionId,heroThumbnailUrl:null}));
test('entry snapshots preserve source order, tapped identity, and independent nested sessions',()=>{
  const first = createCollectionReelSession('middle',{collections:refs});
  const next = createCollectionReelSession('creator-reel',{collections:[{collectionId:'creator-reel'}],source:{kind:'creator',creatorId:'creator'},nextCursor:'page2'});
  assert.deepEqual(getCollectionReelSession(first)?.collections,refs);
  assert.equal(getCollectionReelSession(first)?.startCollectionId,'middle');
  assert.equal(getCollectionReelSession(next)?.nextCursor,'page2');
  assert.equal(getCollectionReelSession(first)?.source.kind,'snapshot');
  const path=collectionTilePressPath('middle',{collections:refs});
  assert.match(path,/^\/reel\/middle\?session=reels-\d+$/);
  assert.equal(collectionTilePressPath('direct'),'/reel/direct');
});
test('source refs dedupe across pages and preserve real query cursors',()=>{
  assert.deepEqual(mergeCollectionReelRefs(refs,[{collectionId:'middle'},{collectionId:'last'},{collectionId:' '}]).map(r=>r.collectionId),['latest','middle','oldest','last']);
  const id=createCollectionReelSession('latest',{collections:refs,nextCursor:'',source:{kind:'creator',creatorId:'creator'}});
  assert.equal(getCollectionReelSession(id)?.nextCursor,'');
});
test('loop sentinel appears only after true source exhaustion and resets only after the last swipe',()=>{
  assert.deepEqual(collectionReelLoopRows(refs,'page2'),refs);
  assert.equal(collectionReelLoopTarget(3,3,'page2'),null);
  assert.deepEqual(collectionReelLoopRows(refs,null),[...refs,refs[0]]);
  assert.equal(collectionReelLoopTarget(3,3,null),0);
  assert.equal(collectionReelLoopTarget(2,3,null),null);
  assert.deepEqual(collectionReelLoopRows([],null),[]);
  assert.deepEqual(collectionReelLoopRows([refs[0]],null),[refs[0]]);
});
test('creator, saved, and ranked search pagination use only their source transport',async()=>{
  const calls: unknown[]=[];
  const loader=createCollectionReelPageLoader({
    creator:async(id,options)=>{calls.push(['creator',id,options]);return {collections:[{collectionId:'creator-next'} as CollectionViewModel],nextCursor:'third'};},
    saved:async()=>{calls.push(['saved']);return ['saved1','saved2'];},
    search:async(options)=>{calls.push(['search',options]);return {results:[],nextCursor:null};},
  });
  assert.equal((await loader({kind:'creator',creatorId:'specific-creator'},'second')).nextCursor,'third');
  assert.deepEqual(calls[0],['creator','specific-creator',{limit:20,cursor:'second'}]);
  await loader({kind:'creator',creatorId:'specific-creator'},'');
  assert.deepEqual(calls[1],['creator','specific-creator',{limit:20,cursor:null}]);
  assert.deepEqual((await loader({kind:'saved'},'')).collections.map(r=>r.collectionId),['saved1','saved2']);
  await loader({kind:'search',query:'camera',entityType:'collection'},'ranked-page');
  assert.deepEqual(calls[3],['search',{q:'camera',entityType:'collection',presentation:'unified',limit:20,cursor:'ranked-page'}]);
  await loader({kind:'snapshot'},'');assert.equal(calls.length,4);
});
test('pagination errors are surfaced to the host without pretending the source ended',async()=>{
  const loader=createCollectionReelPageLoader({creator:async()=>{throw Error('offline');},saved:async()=>[],search:async()=>({results:[],nextCursor:null})});
  await assert.rejects(loader({kind:'creator',creatorId:'creator'},'second'),/offline/);
});
