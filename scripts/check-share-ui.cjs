/* Offline shared-code rendering only. No network, session, provider or Analytics clients. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),web=require('react-native-web'),ts=require('typescript');
const root=path.dirname(require.resolve('../package.json')),cache=new Map();
let tokens,states=[],index=0;
const adapter={...React,useState(initial){const real=React.useState(initial),i=index++;return i<states.length?[states[i],()=>{}]:real;}};
function load(file){
 const filename=['.ts','.tsx'].map(ext=>file+ext).find(fs.existsSync)??file;
 if(cache.has(filename))return cache.get(filename).exports;
 const mod=new Module(filename,module);mod.filename=filename;cache.set(filename,mod);
 mod.require=id=>{
  if(id==='react')return adapter;
  if(id==='react-native')return web;
  if(id==='@/contexts/AuthContext')return{useAuth:()=>({user:{id:'fixture-user'}})};
  if(id==='@/contexts/CartContext')return{useCart:()=>({refresh:async()=>{throw Error('Network forbidden');}})};
  if(id==='@/contexts/ThemeContext')return{useThemeMode:()=>({tokens})};
  if(id==='@/src/services/shareReviewApi')return{}; // Effects and actions are intentionally not executed by SSR.
  if(id==='@/components/place/PlaceSourceVideoModal')return{PlaceSourceVideoModal:()=>React.createElement('div',null,'Existing source viewer')};
  if(id==='expo-router')return{useRouter:()=>({push(){}})};
  if(id==='@expo/vector-icons')return{Ionicons:()=>null};
  if(id==='expo-image')return{Image:p=>React.createElement('img',{src:p.source.uri,alt:''})};
  if(id.startsWith('@/'))return load(path.join(root,id.slice(2)));
  if(id.startsWith('.'))return load(path.resolve(path.dirname(filename),id));
  return require(id);
 };
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,filename);
 return mod.exports;
}
const {getThemeTokens}=load(path.join(root,'src/theme/tokens'));
const {ShareImportDetails}=load(path.join(root,'components/search/ShareImportDetails'));
const env={...process.env};
process.env.EXPO_PUBLIC_SHARE_INTENT_ENABLED='true';process.env.EXPO_PUBLIC_SHARE_SUGGESTIONS_ENABLED='true';
const fetch=global.fetch;global.fetch=async()=>{throw Error('Network forbidden');};
let checks=0;
try{
 for(const mode of ['titanium','nebula'])for(const platform of ['android','ios']){
  tokens=getThemeTokens(mode);Object.defineProperty(web.Platform,'OS',{value:platform,configurable:true});
  const product={sourceProductId:'p',title:'Handbag',assessment:{kind:'similar',suggestions:[{key:'c',title:'Brown leather handbag',image:'https://fixture.invalid/bag.jpg',score:1}]},reviews:[]};
  states=[{kind:'place',note:'café',revision:1},[product],[{id:'place',name:'Café fixture'}],'fixture-user',null,false,false];index=0;
  const html=renderToStaticMarkup(React.createElement(ShareImportDetails,{importId:'import',sourceUrl:'https://youtu.be/ASkP2CRZOfc'}));
  for(const text of ['Similar product','Save to Products','Dismiss','Save interest','Café fixture','Source video'])assert.ok(html.includes(text),text);
  assert.ok(html.indexOf('Café fixture')<html.indexOf('Brown leather handbag'));
  states[3]='different-user';index=0;
  assert.equal(renderToStaticMarkup(React.createElement(ShareImportDetails,{importId:'import',sourceUrl:'https://youtu.be/ASkP2CRZOfc'})),'');
  states[3]='fixture-user';states[1]=[{...product,assessment:{kind:'unable_to_identify',suggestions:[]}}];index=0;
  assert.ok(renderToStaticMarkup(React.createElement(ShareImportDetails,{importId:'import',sourceUrl:'https://youtu.be/ASkP2CRZOfc'})).includes('Your video is still saved'));
  checks+=8;
 }
 console.log(JSON.stringify({passed:true,checks,themes:2,platformAdapters:2,nativeExecution:false}));
}finally{global.fetch=fetch;for(const key of ['EXPO_PUBLIC_SHARE_INTENT_ENABLED','EXPO_PUBLIC_SHARE_SUGGESTIONS_ENABLED'])if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key];}
