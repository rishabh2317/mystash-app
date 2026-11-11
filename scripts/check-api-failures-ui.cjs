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
let tokens, scale = 1, actions = [], surfaces = [];
const native = {...web,
  View: props => {surfaces.push(props);return React.createElement(web.View,props);},
  Text: props => {const style=web.StyleSheet.flatten(props.style)??{};return React.createElement(web.Text,{...props,style:[style,{fontSize:style.fontSize*scale,lineHeight:style.lineHeight*scale}]});},
  Pressable: props => {actions.push(props);return React.createElement(web.Pressable,props);},
};
function load(file) {
  const filename=['.ts','.tsx'].map(ext=>file+ext).find(fs.existsSync)??file;
  if(cache.has(filename))return cache.get(filename).exports;
  const mod=new Module(filename,module);cache.set(filename,mod);
  mod.require=id=>{
    if(id==='react-native')return native;
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
const {FailureState}=load(path.join(root,'components/status/FailureState'));
const {getThemeTokens}=load(path.join(root,'src/theme/tokens'));
const {API_FAILURE_COPY}=load(path.join(root,'src/ui/apiFailure'));
let checks=0,retries=0;
for(const theme of ['titanium','nebula'])for(const width of [320,390])for(scale of [1,2])for(const variant of ['page','inline','immersive']) {
  tokens=getThemeTokens(theme);actions=[];surfaces=[];
  const html=renderToStaticMarkup(React.createElement(web.View,{style:{width}},
    variant==='inline'?React.createElement(web.Text,null,'Previously loaded content'):null,
    React.createElement(FailureState,{error:Error('User API Error (502)'),variant,onRetry:()=>retries++})));
  assert.ok(html.includes(API_FAILURE_COPY.service.title));
  assert.ok(html.includes('Try again')&&!html.includes('502')&&!html.includes('User API'));
  assert.ok(html.includes('role="alert"')&&html.includes('aria-live="polite"'));
  if(variant==='inline')assert.ok(html.includes('Previously loaded content'));
  const action=actions.find(a=>a.accessibilityLabel==='Try again');
  assert.ok(action);assert.ok(web.StyleSheet.flatten(action.style).minHeight>=48);
  assert.equal(actions.length,1);assert.equal(retries,checks);
  action.onPress();assert.equal(retries,checks+1);
  const failureSurface=surfaces.find(p=>p.accessibilityRole==='alert');
  assert.equal(failureSurface.style.height,undefined,'failure surfaces grow with text');
  checks++;
}
for(const error of [{status:401},{status:403},{status:404},'Failed to fetch',{status:504},'Use at least 8 characters.']) {
  actions=[];
  const html=renderToStaticMarkup(React.createElement(FailureState,{error,variant:'inline'}));
  assert.ok(html.includes('role="alert"'));assert.equal(actions.length,0);checks++;
}
actions=[];
renderToStaticMarkup(React.createElement(FailureState,{error:{status:502},pending:true,onRetry:()=>retries++}));
assert.equal(actions[0].disabled,true);checks++;
console.log(JSON.stringify({passed:true,checks,themes:2,widths:[320,390],fontScales:[1,2],nativeExecution:false}));
