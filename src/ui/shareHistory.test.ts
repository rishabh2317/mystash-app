import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeShareHistory} from './shareHistory';
import type {ImportShare} from '@/src/services/importShareMap';
const share=(id:string,createdAt:string,productCount=0)=>({importId:id,createdAt,productCount} as ImportShare);
test('head polling retains older loaded pages and preserves newest-first order',()=>{
 const old=share('old','2026-10-01T00:00:00Z'),head=share('head','2026-11-01T00:00:00Z');
 const next=mergeShareHistory([head,old],[{...head,productCount:2},share('new','2026-11-02T00:00:00Z')]);
 assert.deepEqual(next.map(s=>s.importId),['new','head','old']);assert.equal(next[1].productCount,2);
});
test('late pagination responses cannot replace refreshed head results',()=>{
 const current=share('same','2026-11-01T00:00:00Z',3),stale={...current,productCount:0};
 assert.equal(mergeShareHistory([current],[stale],true)[0].productCount,3);
});
