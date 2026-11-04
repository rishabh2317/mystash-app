import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourceCollageSlots} from './stashSourceCollage';
import type {FindSourceSummary} from '@/src/services/findClient';
const base:FindSourceSummary={id:'capture',createdAt:'2026-11-04T00:00:00Z',title:'Fixture',sourceType:'image',savedProducts:0,savedPlaces:0,images:[]};
test('source collage counts distinct saved items, retains missing imagery and shows exact overflow',()=>{
  for(const count of [1,2,3,4,5,6,9]){
    const slots=sourceCollageSlots({...base,savedProducts:count-1,savedPlaces:1,images:['https://fixture.invalid/one.jpg',null]});
    assert.equal(slots.length,Math.min(count,4));
    assert.equal(slots[0].image,'https://fixture.invalid/one.jpg');
    if(count>1)assert.equal(slots[1].image,null);
    assert.equal(slots.at(-1)?.more,count>4?count-3:0);
  }
});
