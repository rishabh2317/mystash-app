import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {reportCount,trendGeometry,utcDateLabel} from './creatorReport';
describe('creator analytics chart data',()=>{
 it('preserves missing days as disconnected paths',()=>{
  const g=trendGeometry([1,2,null,0,3]);assert.equal(g.paths.length,2);assert.equal(g.points[2],null);
  assert.ok(g.paths.every(p=>p.startsWith('M')));assert.equal(g.max,3);
 });
 it('does not fabricate a trend for missing data',()=>{
  const g=trendGeometry([null,null]);assert.deepEqual(g.paths,[]);assert.equal(g.max,1);
 });
 it('keeps a known-zero observation on the baseline and singleton dots visible',()=>{
  const g=trendGeometry([0,null,1]);assert.equal(g.points[0]?.y,104);assert.equal(g.paths.length,2);
  assert.equal(trendGeometry([3]).points[0]?.x,8);
 });
 it('formats unknown and zero distinctly',()=>{assert.equal(reportCount(null),'—');assert.equal(reportCount(0),'0');});
 it('formats date-only labels in UTC',()=>{assert.ok(utcDateLabel('2026-03-08').includes('8'));});
});
