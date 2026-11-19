/* global __dirname */
/** Public-browser action contracts; no network, real credentials, or native changes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const file=path.resolve(__dirname,'../public-web/components/editorialActions.ts'),mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;
const calls=[];let product={offers:[{id:'ordered-first',action:'none'},{id:'verified-offer',action:'buy'}]},country='IN';
mod.require=id=>{
 if(id==='@react-native-async-storage/async-storage')return {getItem:async()=>country};
 if(id.endsWith('/analytics/client'))return {analyticsHeaders:()=>({'x-test-analytics':'yes'})};
 if(id.endsWith('/ui/feedShop')){const helperFile=path.resolve(__dirname,'../src/ui/feedShop.ts'),helper=new Module(helperFile,module);helper._compile(ts.transpileModule(fs.readFileSync(helperFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,helperFile);return helper.exports;}
 if(id.endsWith('/newEventId'))return {newEventId:()=> 'test-event'};
 if(id.endsWith('/publicStashApi'))return {publicStashUrl:id=>`https://mystash.in/stash/${encodeURIComponent(id)}`,publicStashRequest:async(url,options)=>{calls.push({url,options});return url.includes('/page?')?product:{url:'https://verified.example/affiliate'};}};
 return require(id);
};
mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);
const {itemPath,collectionHeading,loadShopOptions,resolveShopOption,shareCollection}=mod.exports;
(async()=>{
 assert.equal(collectionHeading('sonam','  Sonam Kapoor '),'Sonam’s Stash');assert.equal(collectionHeading('sonam',null),'@sonam’s Stash');assert.equal(collectionHeading(undefined,''),'Public Stash');
 assert.equal(itemPath('stash','products',{id:'p',namespace:'catalog'},false),'/stash/stash/products/catalog/p');
 assert.equal(itemPath('stash','products',{id:'p',namespace:'discovered'},true),'/stash/stash/products/discovered/p?preview=1');
 assert.equal(itemPath('stash','places',{id:'p'},false),'/stash/stash/places/p');
 let options=await loadShopOptions('stash',{id:'p',namespace:'catalog'},'guest');
 assert.equal(options.presentation,'direct');assert.deepEqual(options.offers.map(row=>row.id),['verified-offer']);assert.equal(calls.length,1);
 assert.deepEqual(await resolveShopOption(options,'verified-offer'),{url:'https://verified.example/affiliate'});
 assert.match(calls[0].url,/country=IN/);assert.match(calls[1].url,/offerId=verified-offer/);assert.equal(calls[1].options.headers['x-mystash-outbound-id'],'test-event');
 let before=calls.length;assert.equal(await resolveShopOption(options,'invented-offer'),null);assert.equal(calls.length,before);
 product={offers:[{id:'one',action:'buy'},{id:'two',action:'listing'},{id:'inactive',action:'none'}]};calls.length=0;options=await loadShopOptions('stash',{id:'p'},'guest');assert.equal(options.presentation,'sheet');assert.deepEqual(options.offers.map(row=>row.id),['one','two']);assert.equal(calls.length,1);
 await resolveShopOption(options,'two');assert.match(calls[1].url,/offerId=two/);assert.doesNotMatch(calls[1].url,/offerId=one/);
 product={offers:[]};calls.length=0;options=await loadShopOptions('stash',{id:'p'},'guest');assert.equal(options.presentation,'fallback');assert.equal(await resolveShopOption(options),null);assert.equal(calls.length,1);
 product={offers:[],discovery:{kind:'search'}};country='bad-country';calls.length=0;options=await loadShopOptions('stash',{id:'p'},'guest');await resolveShopOption(options);assert.match(calls[1].url,/discovery=1/);assert.doesNotMatch(calls[0].url,/bad-country/);
 let copied=null,shared=null;const copy=async url=>{copied=url;};
 assert.equal(await shareCollection('stash','Title',undefined,copy),'Link copied.');assert.equal(copied,'https://mystash.in/stash/stash');
 copied=null;assert.equal(await shareCollection('stash','Title',async data=>{shared=data;},copy),'Shared.');assert.equal(shared.url,'https://mystash.in/stash/stash');assert.equal(copied,null);
 assert.equal(await shareCollection('stash','Title',async()=>{throw Error('Unsupported');},copy),'Link copied.');
 copied=null;assert.equal(await shareCollection('stash','Title',async()=>{const e=Error();e.name='AbortError';throw e;},copy),'');assert.equal(copied,null);
 assert.match(await shareCollection('stash','Title',undefined,async()=>{throw Error('Denied');}),/https:\/\/mystash.in\/stash\/stash/);
 const entry=fs.readFileSync(path.resolve(__dirname,'../public-web/app/stash/[publicId]/index.tsx'),'utf8');assert.match(entry,/public-web\/components\/PublicStashEditorial/);
 console.log('Editorial checks passed: identity routes, single/multiple offer presentation, explicit selected-offer redirects, discovery/no-offer fallbacks, country preference, outbound attribution, canonical sharing and copy/cancel/failure cases.');
})().catch(error=>{console.error(error);process.exitCode=1;});
