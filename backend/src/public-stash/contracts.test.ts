import assert from 'node:assert/strict';
import {test} from 'node:test';
import {itemInput,parsePage,version} from './contracts';
import {publicImageUrl} from './publicMedia';
import {validateEvent} from '../analytics/contracts';
const id='11111111-1111-4111-8111-111111111111';
test('public pagination binds cursors to both Stash and tab and caps page size',()=>{
 const cursor=Buffer.from(JSON.stringify({stash:id,tab:'products',id,time:'2026-11-17T00:00:00Z'})).toString('base64url');
 assert.equal(parsePage({cursor},id).after,id);assert.throws(()=>parsePage({cursor,tab:'places'},id));assert.throws(()=>parsePage({cursor},'other'));assert.throws(()=>parsePage({limit:51},id));assert.throws(()=>parsePage({cursor:'x'},id));
});
test('only typed canonical item identities and versions are admitted',()=>{
 assert.equal(itemInput({kind:'place',namespace:'place',itemId:id}).itemId,id);assert.throws(()=>itemInput({kind:'place',namespace:'catalog',itemId:id}));assert.throws(()=>version(-1));assert.throws(()=>version('0'));assert.throws(()=>itemInput({kind:'product',namespace:'catalog',itemId:'https://private.invalid'}));
});
test('public media excludes signed capabilities, private Storage and screenshots',()=>{
 for(const url of ['http://merchant.example/a.jpg','https://x.supabase.co/storage/v1/object/sign/catalog/a?token=secret','https://x.supabase.co/storage/v1/object/public/find-private-images/a.jpg','https://merchant.example/a.jpg?X-Amz-Signature=secret','https://example.com/ingest-frames/a.jpg'])assert.equal(publicImageUrl(url),null);
 assert.equal(publicImageUrl('https://merchant.example/product.jpg'),'https://merchant.example/product.jpg');
});
test('Stash measurement requires validated context and server-only save completion',()=>{
 const e={event_id:id,event_name:'stash.opened',schema_version:1,occurred_at:new Date().toISOString(),session_id:id,entity_type:'app',surface:'public_stash',platform:'web',app_version:'1.0.0',properties:{public_stash_id:id}};
 assert.equal(validateEvent(e,'client').event_name,'stash.opened');assert.throws(()=>validateEvent({...e,properties:{}},'client'));assert.throws(()=>validateEvent({...e,event_name:'stash.item_saved',entity_type:'place',entity_id:id},'client'));
});
