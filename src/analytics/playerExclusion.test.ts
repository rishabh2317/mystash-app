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
 it('keeps the product page embed free of measurement',()=>{
  const source=readFileSync(resolve('components/product/ProductPage.tsx'),'utf8');
  const player=source.slice(source.indexOf('function FeaturedSourcePlayer'),source.indexOf('const styles ='));
  assert.doesNotMatch(player,/analytics|onMessage|setInterval|getCurrentTime|measureInWindow/);
 });
});
