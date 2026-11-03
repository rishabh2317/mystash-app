/* Offline SSR and interaction adapters. No app/server, dotenv, providers or native build. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {Buffer}=require('node:buffer');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),web=require('react-native-web'),ts=require('typescript');
const root=path.dirname(require.resolve('../package.json')),cache=new Map(),output=process.env.FIND_RENDER_DIR;
let tokens,platform='ios',dimensions={width:390,height:844,fontScale:1,scale:1},actions=[],images=[],lists=[],navigation=[],apiCalls=[],overrideStates=null,stateIndex=0;
let signedIn=true,authLoading=false,history,detail,capture,params={};
const adapter={...React,useState(initial){const pair=React.useState(initial),index=stateIndex++;return overrideStates&&index<overrideStates.length?[overrideStates[index],()=>{}]:pair;}};
const native={...web,useWindowDimensions:()=>dimensions,Platform:{...web.Platform,OS:platform,select:choices=>choices[platform]??choices.default},
 Pressable:props=>{actions.push(props);return React.createElement(web.Pressable,props);},
 FlatList:props=>{lists.push(props);return React.createElement(web.FlatList,props);},
 Text:props=>{const flat=web.StyleSheet.flatten(props.style)??{};return React.createElement(web.Text,{...props,style:[props.style,props.allowFontScaling===false?null:{fontSize:flat.fontSize?flat.fontSize*dimensions.fontScale:undefined,lineHeight:flat.lineHeight?flat.lineHeight*dimensions.fontScale:undefined}]});},
 TextInput:props=>React.createElement(web.TextInput,props),Keyboard:{dismiss(){}},KeyboardAvoidingView:props=>React.createElement(web.View,{style:props.style},props.children)};
const router={push:value=>navigation.push(['push',value]),replace:value=>navigation.push(['replace',value]),back:()=>navigation.push(['back']),canGoBack:()=>false,setParams:value=>navigation.push(['params',value])};
const glyphs={'sparkles-outline':'✦','play-outline':'▷','search-outline':'⌕','layers-outline':'▱','bag-handle-outline':'♧','person-outline':'♙','notifications-outline':'♧','chevron-forward-outline':'›','arrow-back':'‹','arrow-back-outline':'‹','link-outline':'↗','scan-outline':'▣','camera-outline':'◎','film-outline':'▣','logo-youtube':'▷','alert-circle-outline':'!','ellipse-outline':'◌','image-outline':'▧','cube-outline':'◇','location-outline':'⌾'};
const api=new Proxy({}, {get:(_target,name)=>async(...args)=>{apiCalls.push([name,...args]);return name==='suggestions'?{products:[],places:[]}:{};}});
function Tabs(props){return React.createElement(web.View,{style:[props.screenOptions.tabBarStyle,{flexDirection:'row',alignItems:'center'}]},props.children);}
Tabs.Screen=function TabScreen(props){return props.options.href===null?null:React.createElement(web.View,{style:{flex:1,alignItems:'center',justifyContent:'center',gap:4}},props.options.tabBarIcon?.({color:tokens.color.text,focused:props.name==='find'}),React.createElement(web.Text,{style:{fontFamily:tokens.fontFamily.medium,fontSize:12,color:tokens.color.text}},props.options.title));};
function load(file){
 const filename=['.ts','.tsx'].map(ext=>file+ext).find(fs.existsSync)??file;
 if(cache.has(filename))return cache.get(filename).exports;
 const mod=new Module(filename,module);mod.filename=filename;cache.set(filename,mod);
 mod.require=id=>{
  if(id==='react')return adapter;
  if(id==='react-native')return native;
  if(id==='@/contexts/ThemeContext'||id==='@/src/theme/useThemeTokens')return{useThemeMode:()=>({tokens}),useThemeTokens:()=>tokens};
  if(id==='@/contexts/AuthContext')return{useAuth:()=>({user:signedIn?{id:'owner',email:'fixture@example.invalid'}:null,loading:authLoading})};
  if(id==='@/contexts/CartContext')return{useCartOptional:()=>({itemCount:7,refresh:async()=>{}})};
  if(id==='@/contexts/NotificationsContext')return{useNotificationsContext:()=>({enabled:true,unread:{unread:2,capped:false}})};
  if(id==='@/src/hooks/useFindHistory')return{useFindHistory:()=>({...history,refresh:async()=>{apiCalls.push(['refresh']);},loadMore:async()=>{apiCalls.push(['loadMore']);}})};
  if(id==='@/src/hooks/useFindDetail')return{useFindDetail:()=>({...detail,refresh:async()=>{apiCalls.push(['refreshDetail']);},run:async(_key,fn)=>{await fn();return true;}})};
  if(id==='@/src/hooks/useFindCapture')return{useFindCapture:()=>({...capture,setInput:value=>apiCalls.push(['input',value]),submit:async()=>{apiCalls.push(['submit']);},clearAck:()=>{}})};
  if(id==='@/src/services/findApi')return{findApi:api};
  if(id==='@/src/services/supabase'||id==='./supabase')return{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:transportOwner},access_token:'dummy'}}})}}};
  if(id==='@/components/search/NativePendingShares')return{NativePendingShares:()=>null};
  if(id==='@/src/hooks/useDiscoverCreators')return{useDiscoverCreators:()=>({items:[],loading:false})};
  if(id==='@/components/profile/PersonalProfileHeader')return{PersonalProfileHeader:()=>React.createElement(web.Text,null,'@fixture')};
  if(id==='@/components/profile/DiscoverCreatorsSection')return{DiscoverCreatorsSection:()=>null};
  if(id==='@/components/collection/PublicCollectionTile')return{PublicCollectionTile:()=>null};
  if(id==='@/components/haptic-tab')return{HapticTab:native.Pressable};
  if(id==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:platform==='ios'?47:24,bottom:platform==='ios'?34:24,left:0,right:0}),SafeAreaView:native.View};
  if(id==='expo-router')return{useRouter:()=>router,usePathname:()=>'/find',useLocalSearchParams:()=>params,useFocusEffect(){},Tabs,Redirect:props=>React.createElement(web.Text,null,`Redirect ${props.href}`),Stack:Object.assign(props=>React.createElement(web.View,null,props.children),{Screen:()=>null})};
  if(id==='@expo/vector-icons')return{Ionicons:props=>React.createElement('span',{'aria-hidden':true,style:{fontSize:props.size,color:props.color,lineHeight:1}},glyphs[props.name]??'◇')};
  if(id==='expo-image')return{Image:props=>{images.push(props);const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#b7c8bd"/><stop offset="1" stop-color="#6b837c"/></linearGradient></defs><rect width="500" height="400" fill="url(#a)"/><circle cx="410" cy="82" r="45" fill="#f2dcc0"/><path d="M0 360L150 110L250 260L340 170L500 390V400H0" fill="#294840"/><path d="M150 110L183 167L143 152L112 174Z" fill="#eef0e8"/><text x="30" y="370" fill="#edf0e9" font-family="sans-serif" font-size="22">Offline visual fixture</text></svg>`;return React.createElement('img',{src:`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,alt:'',style:{width:'100%',height:'100%',objectFit:'cover',position:'absolute',inset:0}});}};
  if(id==='react-native-reanimated')return{__esModule:true,default:{View:web.View},Easing:{inOut:x=>x,quad:()=>{}},useSharedValue:value=>({value}),useAnimatedStyle:()=>({}),withTiming:x=>x,withRepeat:x=>x};
  if(id==='@/src/ui/usePrefersReducedMotion')return{usePrefersReducedMotion:()=>true};
  if(id.startsWith('@/'))return load(path.join(root,id.slice(2)));
  if(id.startsWith('.'))return load(path.resolve(path.dirname(filename),id));
  return require(id);
 };
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText,filename);
 return mod.exports;
}
const {getThemeTokens}=load(path.join(root,'src/theme/tokens')),{findFixture,findDetailFixture}=load(path.join(root,'src/ui/findTestFixtures'));
const Dashboard=load(path.join(root,'app/(tabs)/find/index')).default,Detail=load(path.join(root,'app/(tabs)/find/[findId]')).default,Capture=load(path.join(root,'app/(tabs)/find/capture')).default;
const {AppTabBar}=load(path.join(root,'components/chrome/AppTabBar')),{FindImage}=load(path.join(root,'components/find/FindImage'));
const {PersonalProfile}=load(path.join(root,'components/profile/PersonalProfile'));
const baseHistory=()=>({owner:'owner',filter:'completed',items:Array.from({length:8},(_,i)=>({...findFixture(i+1),thumbnailUrl:i<2?'https://fixture.invalid/preview.jpg':null})),counts:{all:1205,processing:10,completed:1190,attention:5,saved:900},loaded:true,refreshing:false,loadingMore:false,cursor:'more',error:null,moreError:null});
function reset(){actions=[];images=[];lists=[];navigation=[];apiCalls=[];overrideStates=null;stateIndex=0;signedIn=true;authLoading=false;params={};history=baseHistory();detail={data:findDetailFixture(),loaded:true,refreshing:false,pending:null,error:null,actionError:null};capture={owner:'owner',input:'https://example.com/product',busy:false,error:null,ack:null};}
function render(Component,props={},withTabs=false){stateIndex=0;return renderToStaticMarkup(React.createElement(web.View,{style:{width:dimensions.width,height:dimensions.height,backgroundColor:tokens.color.canvasSoft}},React.createElement(Component,props),withTabs?React.createElement(AppTabBar):null));}
function save(name,body){if(!output)return;fs.mkdirSync(output,{recursive:true});const sheet=web.StyleSheet.getSheet();let fonts='';for(const [weight,face] of [['400','Regular'],['500','Medium'],['600','SemiBold'],['700','Bold']]){const font=path.join(root,`node_modules/@expo-google-fonts/inter/${weight}${face}/Inter_${weight}${face}.ttf`);if(fs.existsSync(font))fonts+=`@font-face{font-family:Inter_${weight}${face};src:url(file://${font})}`;}
 fs.writeFileSync(path.join(output,`${name}.html`),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fonts}${sheet.textContent}html,body{margin:0;background:${tokens.color.canvasSoft};width:100%;height:100%}</style></head><body>${body}<script>document.fonts.ready.then(()=>{const w=document.documentElement.clientWidth;const overflow=[];for(const e of document.querySelectorAll('div,span,input')){const r=e.getBoundingClientRect();if(r.width>0&&(r.left< -1||r.right>w+1)&&getComputedStyle(e).position!=='absolute')overflow.push({tag:e.tagName,text:e.textContent.slice(0,32),left:r.left,right:r.right});}document.body.dataset.horizontalOverflow=JSON.stringify(overflow.slice(0,8));});</script></body></html>`);}
let checks=0,transportOwner='owner';
const oldFetch=global.fetch,oldAbort=global.AbortController;global.AbortController=require('abort-controller').AbortController;global.fetch=async()=>{throw Error('Live network forbidden');};
async function main(){
 for(const theme of ['titanium','nebula'])for(const os of ['android','ios']){
  platform=os;native.Platform.OS=os;tokens=getThemeTokens(theme);
  for(const width of [320,390,430])for(const scale of [1,1.7]){
   dimensions={width,height:width===320?740:932,fontScale:scale,scale:1};reset();
   const html=render(Dashboard,{},true);
   for(const text of ['Your Finds','Recently Found','Completed 1190','Processing 10','Needs Attention 5','Creator']){if(text==='Creator')continue;assert.ok(html.includes(text),`${theme}/${os}/${width}: ${text}`);}
   assert.ok(!html.includes('Ready to review')&&!html.includes('Saved 900'));
   assert.equal(html.includes('Not available yet'),scale<=1.4);assert.ok(lists[0].onEndReached&&lists[0].onRefresh);
   const unavailable=actions.filter(action=>action.accessibilityLabel?.endsWith('Not available yet'));assert.equal(unavailable.length,scale<=1.4?2:0);assert.ok(unavailable.every(action=>action.disabled&&action.accessibilityState.disabled));
   actions.find(action=>action.accessibilityLabel==='Paste a URL to Find').onPress();assert.deepEqual(navigation.at(-1),['push','/(tabs)/find/capture']);
   actions.find(action=>action.accessibilityLabel==='Processing, 10 finds').onPress();assert.deepEqual(navigation.at(-1),['params',{filter:'processing'}]);
   checks+=8;
   if(width===390&&scale===1)save(`dashboard-${theme}-${os}`,html);
   if(width===320&&scale===1.7)save(`dashboard-large-${theme}-${os}`,html);
  }
  dimensions={width:390,height:932,fontScale:1,scale:1};
  for(const variant of ['loading','empty','processing','attention','error','signed-out']){
   reset();if(variant==='loading')history.loaded=false;
   if(variant==='empty'){history.items=[];history.counts={all:0,processing:0,completed:0,attention:0,saved:0};}
   if(variant==='processing'){params={filter:'processing'};history.filter='processing';history.items=[findFixture(2,'processing')];}
   if(variant==='attention'){params={filter:'attention'};history.filter='attention';history.items=[findFixture(3,'attention')];}
   if(variant==='error')history.error='Couldn’t refresh your Finds. Check your connection and try again.';
   if(variant==='signed-out')signedIn=false;
   const html=render(Dashboard);
   if(variant==='loading')assert.ok(html.includes('Loading your Finds')&&!html.includes('Your next find starts here'));
   if(variant==='empty')assert.ok(html.includes('Your next find starts here'));
   if(variant==='error')assert.ok(html.includes('Try refreshing')&&html.includes('A weekend'));
   if(variant==='signed-out')assert.ok(html.includes('Sign in to Find')&&!html.includes('A weekend'));
   checks++;
  }
  reset();params={findId:detail.data.id};
  let html=render(Detail,{},true);assert.ok(html.includes('Similar product'));assert.ok(html.includes('Restore to My Stash'));assert.ok(html.includes('Open original link'));
  actions.find(action=>action.accessibilityLabel==='Remove Everyday camera from My Stash').onPress();await Promise.resolve();assert.deepEqual(apiCalls.at(-1),['removeResult',detail.data.id,'products',detail.data.products[0].id,detail.data.products[0].identityKey]);
  checks+=4;save(`detail-${theme}-${os}`,html);
  for(const variant of ['processing','delayed','partial','empty','save-failure','error','missing']){
   reset();params={findId:detail.data.id};
   if(variant==='processing')detail.data.outcome={...findFixture(2,'processing').outcome};
   if(variant==='delayed')detail.data.outcome={...findFixture(2,'processing').outcome,delayed:true,category:'attention'};
   if(variant==='partial')detail.data.outcome={...findFixture(3,'attention').outcome};
   if(variant==='empty'){detail.data.outcome={...detail.data.outcome,result:'empty',foundProducts:0,foundPlaces:0,savedProducts:0,savedPlaces:0};detail.data.products=[];detail.data.places=[];detail.data.savedSuggestions=[];}
   if(variant==='save-failure')detail.data.outcome={...detail.data.outcome,stashSync:'failed',canRetrySaving:true};
   if(variant==='error')detail.error='Couldn’t refresh this find.';
   if(variant==='missing'){detail.data=null;detail.error='This find is no longer available.';}
   html=render(Detail);
   if(variant==='delayed')assert.ok(html.includes('Taking longer')&&!html.includes('Retry finding'));
   if(variant==='partial')assert.ok(html.includes('Partial results')&&html.includes('Retry finding'));
   if(variant==='save-failure')assert.ok(html.includes('Retry saving to My Stash'));
   if(variant==='empty')assert.ok(html.includes('No products or places to show'));
   if(variant==='error')assert.ok(html.includes('Refresh current status')&&html.includes('Everyday camera'));
   if(variant==='missing')assert.ok(!html.includes('Everyday camera'));
   checks++;
  }
  for(const variant of ['input','busy','accepted','duplicate','error','signed-out']){
   reset();if(variant==='busy')capture.busy=true;if(variant==='accepted'||variant==='duplicate')capture.ack={id:findFixture().id,created:variant==='accepted'};
   if(variant==='error')capture.error='Offline: receipt could not be confirmed';if(variant==='signed-out')signedIn=false;
   html=render(Capture,{},true);
   if(variant==='input')assert.ok(html.includes('Find from this link'));
   if(variant==='accepted')assert.ok(html.includes('Link received'));
   if(variant==='duplicate')assert.ok(html.includes('already in your Finds'));
   if(variant==='error')assert.ok(html.includes('https://example.com/product')&&html.includes('could not be confirmed'));
   if(variant==='signed-out')assert.ok(!html.includes('value="https://example.com/product"'));
   checks++;
   if(variant==='input')save(`capture-${theme}-${os}`,html);
  }
  dimensions={width:320,height:740,fontScale:1.7,scale:1};reset();params={findId:detail.data.id};html=render(Detail,{},true);assert.ok(html.includes('Restore to My Stash'));save(`detail-large-${theme}-${os}`,html);checks++;
  reset();html=render(Capture,{},true);assert.ok(html.includes('Find from this link'));save(`capture-large-${theme}-${os}`,html);checks++;
  dimensions={width:390,height:932,fontScale:1,scale:1};reset();html=render(PersonalProfile,{creator:{userId:'owner',username:'fixture'},collections:[],saved:[],onEditPress(){},onSharePress(){},onPressCollection(){},onPressStat(){},onCreateCollection:()=>router.push('/(tabs)/create')});
  assert.ok(html.indexOf('Creator Studio')>=0);actions.find(action=>action.accessibilityLabel==='Creator Studio').onPress();assert.deepEqual(navigation.at(-1),['push','/(tabs)/create']);checks++;
 }
 reset();tokens=getThemeTokens('titanium');overrideStates=['https://fixture.invalid/broken.jpg'];render(FindImage,{url:'https://fixture.invalid/broken.jpg',cacheKey:'broken',style:{width:80,height:80}});assert.equal(images.length,0);checks++;
 // Exercise actual capture and Stash transports with an injected existing-session boundary.
 process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL='https://fixture.invalid';transportOwner='B';
 const {submitUserImport}=load(path.join(root,'src/services/userImportApi')),{fetchCart}=load(path.join(root,'src/services/cartApi'));
 await assert.rejects(()=>submitUserImport('https://example.com/product','A'));await assert.rejects(()=>fetchCart('A'));
 transportOwner='A';global.fetch=async()=>{transportOwner='B';return new Response(JSON.stringify({importId:findFixture().id,created:true}));};
 await assert.rejects(()=>submitUserImport('https://example.com/product','A'));
 transportOwner='A';global.fetch=async()=>{transportOwner='B';return new Response(JSON.stringify({items:[],itemCount:0}));};await assert.rejects(()=>fetchCart('A'));checks+=4;
 transportOwner='A';global.fetch=async(_url,init)=>{assert.ok(init.signal instanceof require('abort-controller').AbortSignal);return Response.json({importId:findFixture().id,created:true,items:[],itemCount:0});};
 assert.equal((await submitUserImport('https://example.com/product','A')).created,true);assert.equal((await fetchCart('A')).itemCount,0);
 const {shareRequest}=load(path.join(root,'src/services/shareReviewApi'));assert.equal((await shareRequest('/history')).created,true);checks+=3;
 console.log(JSON.stringify({passed:true,checks,themes:2,platformAdapters:2,widths:[320,390,430],largeTypeAdapter:true,nativeAbortPolyfill:true,nativeExecution:false,artifacts:output??null}));
}
main().finally(()=>{global.fetch=oldFetch;global.AbortController=oldAbort;}).catch(error=>{console.error(error);process.exitCode=1;});
