import assert from 'node:assert/strict';
import {test} from 'node:test';
import {queuePublicPhoto} from './photoQueue';
test('public photos have at most four active requests and cancelled queued work never runs',async()=>{
 let current=0,peak=0,finished=0;
 await new Promise<void>(resolve=>{for(let i=0;i<12;i++)queuePublicPhoto(async()=>{current++;peak=Math.max(peak,current);await new Promise<void>(done=>setTimeout(done,1));current--;finished++;if(finished===12)resolve();});});
 assert.equal(peak,4);assert.equal(finished,12);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 for(let i=0;i<4;i++)queuePublicPhoto(async()=>{await gate;});
 let ran=false;const cancel=queuePublicPhoto(async()=>{ran=true;});cancel();release();
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(ran,false);
});
