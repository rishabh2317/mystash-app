import assert from 'node:assert/strict';
import {test} from 'node:test';
import {discoveryDestination} from './discoveryDestination';
const evidence={attributes:[{attribute:'brand',value:'ZARA',origin:'source_text'}]};
test('Zara title evidence generates an official country search, never an exact offer',()=>{
 const d=discoveryDestination({name:'Black Mini Dress',brand:'ZARA',country:'IN',evidence})!;
 assert.equal(d.kind,'official_search');const url=new URL(d.url);
 assert.equal(url.origin+url.pathname,'https://www.zara.com/in/en/search');assert.equal(url.searchParams.get('searchTerm'),'Black Mini Dress');
 assert.equal('price' in d,false);assert.equal('availability' in d,false);
});
test('country changes select explicit verified templates; unsupported countries never invent a regional URL',()=>{
 assert.match(discoveryDestination({name:'Black mini dress',brand:'ZARA',country:'US',evidence})!.url,/zara.com\/us\/en\/search/);
 assert.equal(discoveryDestination({name:'Black mini dress',brand:'ZARA',country:'NZ',evidence})!.kind,'google_search');
});
test('official homepage is available without pretending merchant search is supported',()=>{
 const d=discoveryDestination({name:'Wireless headphones',brand:'Apple',country:'IN',evidence:{attributes:[{attribute:'brandText',value:'Apple',origin:'observed'}]}})!;
 assert.equal(d.kind,'official_storefront');assert.equal(d.url,'https://www.apple.com/in/');
});
test('unknown or unsupported brand evidence falls back to an encoded Google query without guessing domains',()=>{
 const d=discoveryDestination({name:'Black mini dress',brand:'Unknown Brand',country:'IN'})!;
 assert.equal(d.kind,'google_search');assert.equal(new URL(d.url).searchParams.get('q'),'Unknown Brand Black mini dress');
 assert.equal(discoveryDestination({name:'Black mini dress',brand:'ZARA',country:'IN'})!.kind,'google_search');
 assert.match(new URL(discoveryDestination({name:'ZARA black mini dress',brand:'ZARA',country:'IN'})!.url).searchParams.get('q')!,/black mini dress/);
});
test('insufficient descriptions and URL-like inputs do not produce useless search actions',()=>{
 for(const name of ['', 'Unknown', 'Clothing (type unconfirmed)', 'ZARA item', 'Product', 'ZARA','https://evil.test/path']) assert.equal(discoveryDestination({name,brand:'ZARA',country:'IN',evidence}),null,name);
});

test('ambiguous brand words cannot send food descriptions to an unrelated official store',()=>{
 const d=discoveryDestination({name:'Green apple juice',brand:'Apple',country:'IN',evidence:{attributes:[{attribute:'brand',value:'Apple',origin:'source_text'}]}})!;
 assert.equal(d.kind,'google_search');
});

test('URL-like or private-contact brand metadata is never forwarded into an outbound search query',()=>{
 for(const brand of ['https://storage.example.test/private-image?token=secret','someone@example.test']) {
  const d=discoveryDestination({name:'Black mini dress',brand,country:'IN'})!;
  assert.equal(new URL(d.url).searchParams.get('q'),'Black mini dress');
 }
});
