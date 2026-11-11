import assert from 'node:assert/strict';
import {test} from 'node:test';
import {performance} from 'node:perf_hooks';
import {CountryOfferService,type CountryOfferProduct,type CountryOfferCachePort} from './CountryOfferService';
import {countrySuitability,rankCountryOffers} from './countrySuitability';
import {listStoredShoppingDestinations,findStoredShoppingDestination,shoppingOfferId} from './storedDestinations';
import {resolveCountryCode} from '../merchant-pricing/country';
import {readMerchantPageEvidence} from '../pipeline/merchantPageEvidence';
import {resolveMerchantRegion} from '../merchant-pricing/MerchantRegionResolver';
import {ShoppingResolver} from './ShoppingResolver';
import {AffiliateService} from './AffiliateService';
import {InMemoryCatalogRepository} from '../catalog/InMemoryCatalogRepository';
import {CatalogService} from '../catalog/CatalogService';
import {ProductPageService} from '../product-page/ProductPageService';
import {emptyRelatedMediaPort} from '../product-page/relatedMedia';
import {TavilyEnrichedPdpSearchStrategy} from '../product-intelligence/search/TavilyEnrichedPdpSearchStrategy';
import {MerchantEnrichmentService} from '../product-intelligence/enrichment/MerchantEnrichmentService';
import {pdpSearchHintsAls} from '../product-intelligence/search/pdpSearchHints';
import type {MerchantEvidenceInput} from '../product-intelligence/verification/merchantEvidence';

const source={name:'Tune Beam 2',model:'Tune Beam 2',brand:'JBL',merchant:null,merchantUrl:'https://www.amazon.com/dp/B0EXAMPLE1',preferredShoppingUrl:null,price:null,currency:null,metadata:{}};
const product:CountryOfferProduct={id:'fixture-product',kind:'catalog',name:source.name,brand:source.brand,model:source.model,category:'electronics',metadata:{},source};
const evidence=(country='IN',model='Tune Beam 2'):MerchantEvidenceInput=>({url:`https://www.amazon.${country==='IN'?'in':'com'}/dp/B0EXAMPLE1`,pageRead:'NOT_ATTEMPTED',discovery:{provider:'fixture',title:`JBL ${model}`}});
function cache(){
  let metadata:Record<string,any>={};let claims=0,writes=0;const checked=new Set<string>();
  const port:CountryOfferCachePort={async claim(_product,country){claims++;const claimed=!checked.has(country);checked.add(country);return {claimed,metadata,token:'lease'};},async complete(_product,country,evidence){writes++;metadata={...metadata,shopping_country_offers:{...metadata.shopping_country_offers,[country]:{checkedAt:Date.now(),evidence}}};return metadata;}};
  return {port,get metadata(){return metadata;},get claims(){return claims;},get writes(){return writes;}};
}
test('country policy prefers explicit choice, saved country, locale, then backend default',()=>{
  assert.equal(resolveCountryCode({explicit:'GB',profile:'IN',deviceLocale:'en-US'}),'GB');
  assert.equal(resolveCountryCode({profile:'IN',deviceLocale:'en-US'}),'IN');
  assert.equal(resolveCountryCode({deviceLocale:'de-DE'}),'DE');
  assert.equal(resolveCountryCode({deviceLocale:'not-a-region'}),resolveCountryCode({}));
});
test('suitability uses merchant availability evidence, including local .com and worldwide shipping',()=>{
  assert.equal(countrySuitability('https://native-shop.com/p','IN',{merchantCountry:'IN'}),0);
  assert.equal(countrySuitability('https://foreign-shop.com/p','IN',{merchantCountry:'US',availableCountries:['IN']}),1);
  assert.equal(countrySuitability('https://global-shop.com/p','IN',{shipsWorldwide:true}),1);
  assert.equal(countrySuitability('https://unknown.in/p','IN'),2,'a suffix alone is not availability evidence');
  assert.equal(countrySuitability('https://native-shop.com/p','IN',{merchantCountry:'IN',excludedCountries:['IN']}),4);
  const offers=[{url:'https://www.walmart.com/ip/p/123'},{url:'https://unknown.in/p'},{url:'https://www.flipkart.com/p/p/itm123'}];
  assert.equal(rankCountryOffers(offers,'IN')[0].url,offers[2].url);
  assert.equal(rankCountryOffers(offers,'US')[0].url,offers[0].url);
  assert.equal(rankCountryOffers(offers,'IN').length,3,'international fallback offers are retained');
});
test('existing Product JSON-LD supplies shipping evidence without additional page or AI calls',()=>{
  const html=`<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Tune Beam 2',countryOfOrigin:'CN',offers:{eligibleRegion:{'@type':'Country',name:'India'},shippingDetails:[{shippingDestination:{'@type':'DefinedRegion',addressCountry:'IN'}},{shippingDestination:{addressCountry:'GB'}}]}})}</script>`;
  const facts=readMerchantPageEvidence(html,'https://native-shop.com/products/tune-beam-2');
  assert.deepEqual(facts.countryAvailability?.availableCountries,['IN','GB']);
  assert.ok(!facts.countryAvailability?.availableCountries?.includes('CN'),'manufacturing origin is not shipping availability');
});
test('a qualified local offer skips cache writes and all discovery',async()=>{
  const db=cache();let calls=0;const service=new CountryOfferService(db.port,async()=>{calls++;return [];});
  const local={...source,merchantUrl:'https://www.amazon.in/dp/B0EXAMPLE1'};
  const start=performance.now();await service.resolve({...product,source:local},'IN');
  assert.equal(calls,0);assert.equal(db.claims,0);assert.equal(db.writes,0);
  console.log(JSON.stringify({scenario:'qualified-local-cache',providerCalls:calls,aiCalls:0,tavilyCalls:0,elapsedMs:+(performance.now()-start).toFixed(2)}));
});
test('same-country concurrent requests share discovery; two countries share identity but keep separate offers',async()=>{
  const db=cache();const countries:string[]=[];
  const service=new CountryOfferService(db.port,async(_query,country)=>{countries.push(country);await new Promise(resolve=>setTimeout(resolve,20));return [evidence(country)];});
  const start=performance.now();const results=await Promise.all([service.resolve(product,'IN'),service.resolve(product,'IN')]);
  assert.equal(countries.length,1);assert.equal(db.writes,1);assert.deepEqual(results[0],results[1]);
  // A different user importing the same source gets the already shared identity.
  const second={...product,metadata:db.metadata,source:{...source,metadata:db.metadata}};
  await service.resolve(second,'US');assert.equal(countries.length,1,'existing US offer already fits the second user');
  await service.resolve(second,'GB');assert.deepEqual(countries,['IN','GB']);
  assert.ok(db.metadata.shopping_country_offers.IN&&db.metadata.shopping_country_offers.GB);
  assert.equal(product.id,second.id);assert.equal(product.name,second.name);
  console.log(JSON.stringify({scenario:'missing-local-concurrent',refreshes:1,aiCalls:0,tavilyCalls:0,elapsedMs:+(performance.now()-start).toFixed(2)}));
});
test('negative results and wrong variants do not repeatedly call providers or replace fallback offers',async()=>{
  const db=cache();let calls=0;
  const service=new CountryOfferService(db.port,async()=>{calls++;return [evidence('IN','Tune Beam 3')];});
  await service.resolve(product,'IN');
  assert.deepEqual(db.metadata.shopping_country_offers.IN.evidence,[],'wrong generation is rejected before ranking');
  await service.resolve({...product,metadata:db.metadata,source:{...source,metadata:db.metadata}},'IN');
  assert.equal(calls,1);assert.equal(db.writes,1);
  const offers=listStoredShoppingDestinations({...source,metadata:db.metadata},'IN');
  assert.equal(offers[0].url,source.merchantUrl,'valid international fallback survives an empty local search');
});
test('a changed shopping country re-ranks stored offers without modifying identity or calling discovery',()=>{
  const sameSource={...source,metadata:{shopping_candidates:[{url:'https://www.amazon.com/dp/B0EXAMPLE1'},{url:'https://www.amazon.in/dp/B0EXAMPLE1'}]}};
  const indian=listStoredShoppingDestinations(sameSource,'IN'),american=listStoredShoppingDestinations(sameSource,'US');
  assert.match(indian[0].url,/amazon\.in/);assert.match(american[0].url,/amazon\.com/);
  assert.equal(findStoredShoppingDestination(sameSource,indian[0].offerId)?.url,indian[0].url);
});
test('cached regional offers are durably redirectable and stale variants are revalidated',async()=>{
  const db=cache();const service=new CountryOfferService(db.port,async()=>[evidence()]);
  const metadata=await service.resolve(product,'IN');
  const fresh={...source,metadata};const offers=listStoredShoppingDestinations(fresh,'IN');
  assert.match(offers[0].url,/amazon\.in/);
  assert.equal(findStoredShoppingDestination(fresh,offers[0].offerId)?.url,offers[0].url);
  const changed={...fresh,name:'Tune Beam 3',model:'Tune Beam 3'};
  assert.ok(!listStoredShoppingDestinations(changed,'IN').some(o=>/amazon\.in/.test(o.url)));
});
test('missing durable cache prevents paid discovery and prevents unpersisted offer IDs',async()=>{
  let calls=0;const service=new CountryOfferService({async claim(){throw Error('migration missing');},async complete(){throw Error('unexpected');}},async()=>{calls++;return [evidence()];});
  assert.deepEqual(await service.resolve(product,'IN'),product.metadata);assert.equal(calls,0);
});
test('Product Pages rank for each viewer and preserve one shared product identity',async()=>{
  const catalog=new CatalogService(new InMemoryCatalogRepository());
  const row=await catalog.createFromResolve({name:'Tune Beam 2',brand:'JBL',model:'Tune Beam 2',normalizedName:'tune beam 2',canonicalSlug:'fixture-tune-beam-2',category:'electronics',verificationStatus:'VERIFIED',verificationSource:'fixture',verificationVersion:'1',metadata:{shopping_candidates:[{url:'https://www.amazon.com/dp/B0EXAMPLE1'},{url:'https://www.amazon.in/dp/B0EXAMPLE1'}]}});
  const page=new ProductPageService({resolveActiveProduct:id=>catalog.resolveActiveProduct(id)},{async getById(){return null;}},{async getById(){return null;},async listBoundSourceIds(){return [];}},{canShopCatalog:()=>true},emptyRelatedMediaPort);
  const india=await page.getPage(row.id,{country:'IN'}),usa=await page.getPage(row.id,{country:'US'});
  assert.equal(india.productId,usa.productId);assert.equal(india.title,usa.title);
  assert.equal(india.offers[0].id,shoppingOfferId('https://www.amazon.in/dp/B0EXAMPLE1'));
  assert.equal(usa.offers[0].id,shoppingOfferId('https://www.amazon.com/dp/B0EXAMPLE1'));
});
test('affiliate tracking and explicit regional URLs remain intact',async()=>{
  const catalog=new CatalogService(new InMemoryCatalogRepository());
  const affiliate='https://www.amazon.com/dp/B0EXAMPLE1?tag=original-20&ascsubtag=campaign';
  const row=await catalog.createFromResolve({name:'Tune Beam 2',normalizedName:'tune beam 2',canonicalSlug:'fixture-affiliate',brand:'JBL',model:'Tune Beam 2',category:'electronics',verificationStatus:'VERIFIED',verificationSource:'fixture',verificationVersion:'1',preferredShoppingUrl:affiliate,metadata:{shopping_candidates:[{url:affiliate},{url:'https://www.amazon.in/dp/B0EXAMPLE1'}]}});
  const resolver=new ShoppingResolver(new AffiliateService({enabled:false,provider:'none'}));
  const chosen=resolver.resolve(row,{offerId:shoppingOfferId(affiliate),country:'IN'});
  assert.equal(chosen?.url,affiliate,'an explicit offer is never silently replaced by another merchant');
  assert.equal(resolveMerchantRegion({url:affiliate},'IN').url,affiliate,'no domain rewriting');
});
test('regional discovery has no enrichment calls and stops when its preferred marketplace supplies a valid local offer',async()=>{
  const queries:string[]=[];let enrichments=0;
  const strategy=new TavilyEnrichedPdpSearchStrategy({name:'fixture',async search(query){queries.push(query);return {kind:'Succeeded',provider:'fixture',candidates:[{merchantUrl:evidence().url,merchant:'Amazon',title:'JBL Tune Beam 2',score:1,image:null}]};}},new MerchantEnrichmentService({name:'forbidden',async extract(){enrichments++;throw Error('unnecessary enrichment');}}),'fixture','fixture',3);
  await pdpSearchHintsAls.run({name:'Tune Beam 2',brand:'JBL',model:'Tune Beam 2',category:'electronics'},()=>strategy.discoverMerchantEvidence('JBL Tune Beam 2','IN'));
  assert.equal(queries.length,1);assert.equal(enrichments,0);
});
test('a local discovery miss gets one bounded fallback and no Tavily/image calls',async()=>{
  const queries:string[]=[];
  const strategy=new TavilyEnrichedPdpSearchStrategy({name:'fixture',async search(query){queries.push(query);return {kind:'Succeeded',provider:'fixture',candidates:[]};}},new MerchantEnrichmentService({name:'forbidden',async extract(){throw Error('unnecessary enrichment');}}),'fixture','fixture',3);
  assert.deepEqual(await strategy.discoverMerchantEvidence('JBL Tune Beam 2','IN'),[]);
  assert.equal(queries.length,2);assert.match(queries[1],/shipping to IN/);
});
test('slow discovery does not block the Product Page beyond its wait budget; background offers remain redirectable',async()=>{
  const db=cache();let release:()=>void=()=>{};let calls=0;
  const service=new CountryOfferService(db.port,async()=>{calls++;await new Promise<void>(resolve=>{release=resolve;});return [evidence()];},5);
  const start=performance.now();const first=await service.resolve(product,'IN');
  assert.deepEqual(first,product.metadata);assert.ok(performance.now()-start<200);assert.equal(service.isPending('catalog',product.id,'IN'),true);
  release();for(let i=0;i<30&&service.isPending('catalog',product.id,'IN');i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(service.isPending('catalog',product.id,'IN'),false);assert.equal(calls,1);
  const next=await service.resolve(product,'IN');
  assert.ok(listStoredShoppingDestinations({...source,metadata:next},'IN').some(o=>/amazon\.in/.test(o.url)));
  assert.equal(calls,1);
});
test('stored laptop specifications constrain regional discovery before country ranking',async()=>{
  const db=cache();
  const service=new CountryOfferService(db.port,async()=>[{url:'https://www.lenovo.com/products/thinkpad-x1-carbon',pageRead:'READ',page:{title:'Lenovo ThinkPad X1 Carbon 32GB RAM 1TB SSD',brand:'Lenovo',model:'X1 Carbon',variantContext:'32GB RAM 1TB SSD'},countryAvailability:{availableCountries:['IN']}}]);
  const metadata={specifications:{RAM:'16GB',Storage:'512GB'}};
  const laptop={...product,name:'ThinkPad X1 Carbon',brand:'Lenovo',model:'X1 Carbon',category:'laptops',metadata,source:{...source,name:'ThinkPad X1 Carbon',brand:'Lenovo',model:'X1 Carbon',metadata}};
  await service.resolve(laptop,'IN');assert.deepEqual(db.metadata.shopping_country_offers.IN.evidence,[]);
});
test('a cached untagged offer cannot replace an equivalent existing affiliate-tracked URL',()=>{
  const tagged='https://www.amazon.in/dp/B0EXAMPLE1?tag=original-21&ascsubtag=campaign';
  const same={...source,merchantUrl:tagged,metadata:{shopping_country_offers:{IN:{evidence:[evidence()]}}}};
  const offers=listStoredShoppingDestinations(same,'IN');
  assert.equal(offers.length,1);assert.equal(offers[0].url,tagged);
  assert.equal(findStoredShoppingDestination(same,offers[0].offerId)?.url,tagged);
});
