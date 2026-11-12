import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it} from 'node:test';
describe('third-party players stay outside analytics',()=>{
 it('contains no analytics hooks, observers or player-position measurement',()=>{
  for(const path of ['components/YouTubeReelItem.tsx','components/InstagramReelItem.tsx','components/collection/CollectionMediaReference.tsx','src/utils/youtubeWebViewEmbed.ts']){
   const source=readFileSync(resolve(path),'utf8');
   assert.doesNotMatch(source,/analytics\/|useWatchMeasurement|youtubeMeasurementScript|getCurrentTime|mystash\.watch|mystashMeasure/);
  }
 });
 it('uses the existing source player without adding embed measurement',()=>{
  const source=readFileSync(resolve('components/product/ProductPage.tsx'),'utf8');
  assert.match(source,/PlaceSourceVideoModal/);
  assert.doesNotMatch(source,/FeaturedSourcePlayer|WebView/);
  const player=readFileSync(resolve('components/place/PlaceSourceVideoModal.tsx'),'utf8');
  assert.doesNotMatch(player,/analytics|onMessage|setInterval|getCurrentTime|measureInWindow/);
 });
});
