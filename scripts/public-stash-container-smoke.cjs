/** Disposable, offline smoke check of the actual compiled Express entry and web export. */
const http=require('node:http'),assert=require('node:assert/strict'),path=require('node:path');
const stash='11111111-1111-4111-8111-111111111111';
let hidden=false;const calls=[];
const database=http.createServer((req,res)=>{let body='';req.on('data',part=>body+=part);req.on('end',()=>{const args=body?JSON.parse(body):{};calls.push(req.url);res.setHeader('content-type','application/json');
 if(req.method==='GET'&&req.url.startsWith('/_alias/')){const name=req.url.slice('/_alias/'.length)+'_v1';res.end(JSON.stringify({[name]:{aliases:{}}}));return;}
 if(req.method==='GET'&&/^\/mystash_search_.*_v1\/_mapping$/.test(req.url)){const name=req.url.split('/')[1];res.end(JSON.stringify({[name]:{mappings:{_meta:{embeddingModelId:'local-feature-hash',embeddingVersion:'v1',embeddingDimension:384,mappingVersion:2,generation:1}}}}));return;}
 if(req.url==='/rest/v1/rpc/find_schema_version'){res.end('5');return;}
 if(req.url==='/rest/v1/rpc/public_stash_read'&&!hidden&&args.p_public===stash){res.end(JSON.stringify({publicId:stash,curator:{username:'offline_fixture',avatarUrl:null},counts:{products:0,places:0},items:[]}));return;}
 res.statusCode=404;res.end(JSON.stringify({code:'P0002',message:'Unavailable'}));
});});
(async()=>{await new Promise(resolve=>database.listen(9900,'127.0.0.1',resolve));
Object.assign(process.env,{SUPABASE_URL:'http://127.0.0.1:9900',SUPABASE_SERVICE_ROLE_KEY:'offline-proof-key',SUPABASE_ANON_KEY:'offline-public-key',INGEST_WORKER_EMBEDDED:'false',PUBLIC_STASH_ENABLED:'true',NODE_ENV:'production',OPENSEARCH_URL:'http://127.0.0.1:9900',EMBEDDING_PROVIDER:'local',PORT:'8787'});
const {httpServer}=require(path.join(process.cwd(),'dist/index.js'));
try{
 const base='http://127.0.0.1:8787';
 let response=await fetch(base+'/');assert.equal(response.status,200);assert.match(await response.text(),/Our website is on its way/);
 response=await fetch(base+'/health');assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 response=await fetch(base+`/public-stashes/${stash}`);assert.equal(response.status,200);assert.equal((await response.json()).curator.username,'offline_fixture');
 response=await fetch(base+`/stash/${stash}`);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const html=await response.text();assert.match(html,/og:title/);assert.match(html,new RegExp(`https://mystash.in/stash/${stash}`));
 const asset=html.match(/src="([^"\s]+\.js)"/);assert.ok(asset);response=await fetch(base+asset[1]);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/immutable/);
 response=await fetch(base+'/cart');assert.equal(response.status,401);
 hidden=true;response=await fetch(base+`/stash/${stash}`);assert.equal(response.status,404);assert.ok(!(await response.text()).includes('offline_fixture'));
 response=await fetch(base+`/public-stashes/${stash}`);assert.equal(response.status,404);
 assert.ok(calls.every(value=>['/rest/v1/rpc/find_schema_version','/rest/v1/rpc/public_stash_read'].includes(value)||/^\/_alias\/mystash_search_/.test(value)||/^\/mystash_search_.*_v1\/_mapping$/.test(value)),JSON.stringify(calls));
 console.log('PASS: actual Express API, public JSON/HTML, metadata, static assets, existing cart auth, revocation; offline Node '+process.version);
}finally{await new Promise(resolve=>httpServer.close(resolve));await new Promise(resolve=>database.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;database.close();});
