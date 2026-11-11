/* Real country-cache module with offline auth, storage and location adapters. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.dirname(require.resolve('../package.json')),modules=new Map();
let owner='A',pendingRead=null,permission='denied',releasePermission=null,writes=[];
const profiles={A:{country:'IN',countrySource:'manual',shoppingLocale:'en-US'},B:{country:'US',countrySource:'manual',shoppingLocale:'en-US'}};
const api={
  async fetchMe(){const requested=owner;if(pendingRead){const wait=pendingRead;pendingRead=null;await wait;}return {...profiles[requested]};},
  async ensureMe(){return {...profiles[owner]};},
  async updateMyLocale(patch){writes.push({owner,patch});return {...profiles[owner],...patch};},
  async updateMyCommerceCountry(patch){writes.push({owner,patch});profiles[owner]={...profiles[owner],country:patch.country,countrySource:patch.source};return {user:{...profiles[owner]},changed:true};},
};
function load(file){
  const filename=['.ts','.tsx'].map(ext=>file+ext).find(fs.existsSync)??file;
  if(modules.has(filename))return modules.get(filename).exports;
  const mod=new Module(filename,module);modules.set(filename,mod);
  mod.require=id=>{
    if(id==='@react-native-async-storage/async-storage')return {getItem:async()=> '1',setItem:async()=>{}};
    if(id==='@/src/services/userApi')return api;
    if(id==='@/src/services/commerceCountry/location')return {getForegroundPermissionState:async()=>permission,requestForegroundLocationPermission:async()=>{await new Promise(resolve=>{releasePermission=resolve;});return 'granted';},detectCountryFromLocation:async()=>({country:'GB'})};
    if(id.startsWith('@/'))return load(path.join(root,id.slice(2)));
    return require(id);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
  return mod.exports;
}
const country=load(path.join(root,'src/services/commerceCountry/index'));
(async()=>{
  country.setCommerceCountryOwner('A');assert.equal((await country.getCommerceCountry()).country,'IN');
  let release;country.clearCommerceCountryCache();pendingRead=new Promise(resolve=>{release=resolve;});
  const old=country.getCommerceCountry();
  owner='B';country.setCommerceCountryOwner('B');assert.equal(country.getCachedCommerceCountry(),null);
  assert.equal((await country.getCommerceCountry()).country,'US');release();await old;
  assert.equal(country.getCachedCommerceCountry().country,'US','old account response cannot repopulate the active cache');
  country.clearCommerceCountryCache();pendingRead=new Promise(resolve=>{release=resolve;});
  const stale=country.getCommerceCountry();await country.setManualCommerceCountry('CA');release();await stale;
  assert.equal(country.getCachedCommerceCountry().country,'CA','manual choice wins over an older profile read');
  const automatic=country.enableAutomaticCommerceLocation();
  for(let i=0;i<10&&!releasePermission;i++)await Promise.resolve();assert.ok(releasePermission);
  owner='A';country.setCommerceCountryOwner('A');releasePermission();await automatic;
  assert.equal(writes.filter(w=>w.patch.source==='location').length,0,'permission response from another account cannot set its location');
  assert.equal((await country.getCommerceCountry()).country,'IN');
  console.log(JSON.stringify({passed:true,checks:8,networkCalls:0,nativeExecution:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
