/* Offline rendering of the real failure component, buttons and typography. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const web = require('react-native-web');
const ts = require('typescript');
const root = path.dirname(require.resolve('../package.json')), cache = new Map();
let tokens, scale = 1, actions = [], surfaces = [], tab='collections';
const react={...React,useState(initial){const real=React.useState(initial);return initial==='collections'?[tab,v=>{tab=v;}]:real;}};
const native = {...web,
  FlatList: props=>React.createElement(web.View,null,props.ListHeaderComponent,props.data.length?props.data.map((item,index)=>React.createElement(React.Fragment,{key:index},props.renderItem({item,index}))):props.ListEmptyComponent,props.ListFooterComponent),
  useWindowDimensions:()=>({width:390,height:844,fontScale:scale}),
  Image: props => {surfaces.push(props);return React.createElement('img',{src:props.source,alt:'',style:web.StyleSheet.flatten(props.style)});},
  View: props => {surfaces.push(props);return React.createElement(web.View,props);},
  Text: props => {const style=web.StyleSheet.flatten(props.style)??{};return React.createElement(web.Text,{...props,style:[style,{fontSize:style.fontSize*scale,lineHeight:style.lineHeight*scale}]});},
  Pressable: props => {actions.push(props);return React.createElement(web.Pressable,props);},
};
function load(file) {
  if (file.endsWith('.png')) return file;
  const filename=['.ts','.tsx'].map(ext=>file+ext).find(fs.existsSync)??file;
  if(cache.has(filename))return cache.get(filename).exports;
  const mod=new Module(filename,module);cache.set(filename,mod);
  mod.require=id=>{
    if(id==='react')return react;
    if(id==='react-native')return native;
    if(id==='@/components/status/SkeletonBlock'||id==='./SkeletonBlock')return {SkeletonBlock:()=>null};
    if(id==='@/src/hooks/useDiscoverCreators')return {useDiscoverCreators:()=>({items:[],loading:false})};
    if(id==='@/src/ui/usePrefersReducedMotion')return {usePrefersReducedMotion:()=>true};
    if(id==='@/components/profile/DiscoverCreatorsSection')return {DiscoverCreatorsSection:()=>null};
    if(id==='./PersonalProfileHeader')return {PersonalProfileHeader:()=>null};
    if(id==='@/components/collection/PublicCollectionTile')return {PublicCollectionTile:({collection})=>React.createElement(web.Text,null,collection.collectionId)};

    if(id==='@/contexts/ThemeContext')return {useThemeMode:()=>({tokens})};
    if(id==='@/src/theme/useThemeTokens')return {useThemeTokens:()=>tokens};
    if(id==='@expo/vector-icons')return {Ionicons:()=>null};
    if(id.startsWith('@/'))return load(path.join(root,id.slice(2)));
    if(id.startsWith('.'))return load(path.resolve(path.dirname(filename),id));
    return require(id);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
  return mod.exports;
}
const {IllustratedEmptyState}=load(path.join(root,'components/status/IllustratedEmptyState'));
const {SignedOutSettings}=load(path.join(root,'components/settings/SignedOutSettings'));
const {getThemeTokens}=load(path.join(root,'src/theme/tokens'));
const {EMPTY_STATES}=load(path.join(root,'src/ui/emptyStates'));
let checks=0;
for(const theme of ['titanium','nebula'])for(const width of [320,390,430])for(scale of [1,2]) {
  tokens=getThemeTokens(theme);
  for(const key of ['find','collections','settings']) {
    actions=[];surfaces=[];let primary=0,secondary=0;
    const copy=EMPTY_STATES[key];
    const html=renderToStaticMarkup(React.createElement(web.View,{style:{width}},React.createElement(IllustratedEmptyState,{...copy,variant:key==='collections'?'card':'page',onAction:()=>primary++,onSecondaryAction:()=>secondary++})));
    assert.ok(html.includes(copy.title)&&html.includes(copy.body));
    assert.equal(primary,0);assert.equal(secondary,0);
    const main=actions.find(a=>a.accessibilityLabel===copy.action);
    assert.ok(main);assert.ok(web.StyleSheet.flatten(main.style).minHeight>=48);
    assert.equal(web.StyleSheet.flatten(main.style).backgroundColor,tokens.color.primary);
    main.onPress();assert.equal(primary,1);
    if(copy.secondaryAction){actions.find(a=>a.accessibilityLabel===copy.secondaryAction).onPress();assert.equal(secondary,1);}
    const image=surfaces.find(p=>p.source===copy.artwork);
    assert.ok(image&&image.resizeMode==='contain'&&image.accessible===false);
    assert.ok(fs.existsSync(copy.artwork));
    assert.equal(surfaces[0].style.height,undefined,'content can grow for large text');checks++;
  }
  actions=[];let signIn=0,privacy=0,terms=0;
  const html=renderToStaticMarkup(React.createElement(SignedOutSettings,{onSignIn:()=>signIn++,onPrivacy:()=>privacy++,onTerms:()=>terms++}));
  assert.ok(html.includes('Make Mystash yours')&&html.includes('Legal &amp; privacy'));
  for(const label of ['Sign in','Privacy policy','Terms of service']) {
    const action=actions.find(a=>a.accessibilityLabel===label);assert.ok(action,label);action.onPress();
  }
  assert.deepEqual([signIn,privacy,terms],[1,1,1]);checks++;
}
const {PersonalProfile}=load(path.join(root,'components/profile/PersonalProfile'));
for(const theme of ['titanium','nebula']){
  tokens=getThemeTokens(theme);tab='collections';actions=[];let created=0,explored=0;
  const props={creator:{userId:'fixture',username:'fixture'},collections:[],saved:[],onCreateCollection:()=>created++,onExploreCreators:()=>explored++,onEditPress(){},onSharePress(){},onPressCollection(){},onPressStat(){}};
  let html=renderToStaticMarkup(React.createElement(PersonalProfile,props));
  assert.ok(html.includes('Your story starts here'));
  assert.equal(actions.filter(a=>a.accessibilityLabel==='Create a collection').length,1,'one collection CTA when empty');
  actions.find(a=>a.accessibilityLabel==='Create a collection').onPress();
  actions.find(a=>a.accessibilityLabel==='Explore creators').onPress();assert.deepEqual([created,explored],[1,1]);checks++;
  tab='saved';html=renderToStaticMarkup(React.createElement(PersonalProfile,props));
  assert.ok(html.includes('Nothing saved yet')&&!html.includes('Your story starts here'));checks++;
  tab='collections';html=renderToStaticMarkup(React.createElement(PersonalProfile,{...props,collections:[{collectionId:'loaded-collection'}]}));
  assert.ok(html.includes('loaded-collection')&&!html.includes('Your story starts here'));checks++;
}
console.log(JSON.stringify({passed:true,checks,themes:2,widths:[320,390,430],fontScales:[1,2],nativeExecution:false}));
