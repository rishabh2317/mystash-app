/* Offline SSR and interaction adapters. No app/server, dotenv, providers or native build. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const {Buffer}=require('node:buffer');
global.__DEV__=false;
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),web=require('react-native-web'),ts=require('typescript');
const root=path.dirname(require.resolve('../package.json')),cache=new Map(),output=process.env.FIND_RENDER_DIR;
let tokens,platform='ios',dimensions={width:390,height:844,fontScale:1,scale:1},actions=[],images=[],lists=[],navigation=[],apiCalls=[],keyboardAvoiders=[],overrideStates=null,stateIndex=0,clipboardReads=0,clipboardSupported=true;
let signedIn=true,authLoading=false,history,detail,capture,params={},imageSupported=true,imageResult=null;
const adapter={...React,useState(initial){const pair=React.useState(initial),index=stateIndex++;return overrideStates&&index<overrideStates.length?[overrideStates[index],()=>{}]:pair;}};
const native={...web,useWindowDimensions:()=>dimensions,Platform:{...web.Platform,OS:platform,select:choices=>choices[platform]??choices.default},
 Pressable:props=>{actions.push(props);return React.createElement(web.Pressable,props);},
 FlatList:props=>{lists.push(props);return React.createElement(web.FlatList,props);},
 Text:props=>{const flat=web.StyleSheet.flatten(props.style)??{};return React.createElement(web.Text,{...props,style:[props.style,props.allowFontScaling===false?null:{fontSize:flat.fontSize?flat.fontSize*dimensions.fontScale:undefined,lineHeight:flat.lineHeight?flat.lineHeight*dimensions.fontScale:undefined}]});},
 TextInput:props=>React.createElement(web.TextInput,props),Modal:props=>props.visible?React.createElement(web.View,{style:{position:'absolute',zIndex:100,top:0,bottom:0,left:0,right:0}},props.children):null,Keyboard:{dismiss(){}},KeyboardAvoidingView:props=>{keyboardAvoiders.push(props);return React.createElement(web.View,{style:props.style},props.children);}};
const router={push:value=>navigation.push(['push',value]),replace:value=>navigation.push(['replace',value]),back:()=>navigation.push(['back']),canGoBack:()=>false,setParams:value=>navigation.push(['params',value])};
const glyphs={'sparkles-outline':'✦','play-outline':'▷','search-outline':'⌕','layers-outline':'▱','bag-handle-outline':'♧','person-outline':'♙','notifications-outline':'♧','chevron-forward-outline':'›','arrow-back':'‹','arrow-back-outline':'‹','link-outline':'↗','scan-outline':'▣','camera-outline':'◎','film-outline':'▣','logo-youtube':'▷','alert-circle-outline':'!','ellipse-outline':'◌','image-outline':'▧','cube-outline':'◇','location-outline':'⌾'};
const api=new Proxy({}, {get:(_target,name)=>async(...args)=>{apiCalls.push([name,...args]);return name==='suggestions'?{products:[],places:[]}:{};}});
function Tabs(props){return React.createElement(web.View,{style:[props.screenOptions.tabBarStyle,{flexDirection:'row',alignItems:'center'}]},props.children);}
Tabs.Screen=function TabScreen(props){if(props.options.href===null)return null;const focused=props.name==='find';const children=React.createElement(React.Fragment,null,props.options.tabBarIcon?.({color:tokens.color.text,focused}),React.createElement(web.Text,{style:{fontFamily:tokens.fontFamily.medium,fontSize:12,color:tokens.color.text}},props.options.title));return props.options.tabBarButton?props.options.tabBarButton({'aria-selected':focused,style:{flex:1},children}):React.createElement(web.View,{style:{flex:1,alignItems:'center',justifyContent:'center',gap:4}},children);};
function load(file){
 const filename=['.ts','.tsx'].map(ext=>file+ext).find(fs.existsSync)??file;
 if(cache.has(filename))return cache.get(filename).exports;
 const mod=new Module(filename,module);mod.filename=filename;cache.set(filename,mod);
 mod.require=id=>{
  if(id==='react')return adapter;
  if(id==='react-native')return native;
  if(id==='@/contexts/ThemeContext'||id==='@/src/theme/useThemeTokens')return{useThemeMode:()=>({tokens}),useThemeTokens:()=>tokens};
  if(id==='@/contexts/AuthContext')return{useAuth:()=>({user:signedIn?{id:'owner',email:'fixture@example.invalid'}:null,session:signedIn?{user:{id:'owner'},access_token:'FIXTURE_PRIVATE_TOKEN'}:null,loading:authLoading})};
  if(id==='@/contexts/CartContext')return{useCartOptional:()=>({itemCount:7,refresh:async()=>{}})};
  if(id==='@/contexts/NotificationsContext')return{useNotificationsContext:()=>({enabled:true,unread:{unread:2,capped:false}})};
  if(id==='@/src/hooks/useFindHistory')return{useFindHistory:(filter,options)=>({...history,items:options?.supplemental?history.items.filter(item=>item.outcome.category===filter):history.items,refresh:async()=>{apiCalls.push(['refresh']);},loadMore:async()=>{apiCalls.push(['loadMore']);}})};
  if(id==='@/src/hooks/useFindDetail')return{useFindDetail:()=>({...detail,refresh:async()=>{apiCalls.push(['refreshDetail']);},run:async(_key,fn)=>{await fn();return true;}})};
  if(id==='@/src/hooks/useFindCapture')return{useFindCapture:()=>({...capture,setInput:value=>apiCalls.push(['input',value]),submit:async()=>{apiCalls.push(['submit']);},clearAck:()=>{}})};
  if(id==='@/src/hooks/useFindImageCapture')return{useFindImageCapture:()=>({supported:imageSupported,busy:false,result:imageResult,capture:async origin=>apiCalls.push(['imageCapture',origin]),openSettings:async()=>apiCalls.push(['settings'])})};
  if(id==='@/src/services/captureRuntime')return{imageOutbox:{list:async()=>[],remove:async()=>{}},retryImageCaptures:async()=>{}};
  if(id==='@/src/services/nativeShare')return{subscribePendingShares:()=>()=>{},notifyPendingShares(){}};
  if(id==='@/src/services/findApi')return{findApi:api};
  if(id==='@/src/services/creatorReportApi')return{getCreatorReport:async()=>{throw Error('Network forbidden');}};
  if(id==='@/src/services/engagementApi')return{EngagementApiError:class EngagementApiError extends Error{},getMyCreatorAnalytics:async()=>null};
  if(id==='@/src/analytics/findMeasurement')return{observeFind(){}};
  if(id==='@/src/analytics/client')return{enqueueObservation(){},analyticsSnapshot:()=>({enabled:false})};
  if(id==='expo-modules-core')return{requireOptionalNativeModule:()=>clipboardSupported?({getStringAsync:async()=>{clipboardReads++;return 'https://example.com/item';}}):null};
  if(id==='@/src/analytics/hooks')return{useQualifiedExposure:()=>({current:null}),useMeasuredOpen(){}};
  if(id==='@/src/services/supabase'||id==='./supabase')return{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:transportOwner},access_token:'dummy'}}})}}};
  if(id==='@/components/search/NativePendingShares')return{NativePendingShares:()=>null};
  if(id==='@/components/feed/FeedProductSheet')return{FeedProductSheet:()=>null};
  if(id==='@/components/place/PlaceSourceVideoModal')return{PlaceSourceVideoModal:()=>null};
  if(id==='expo-linear-gradient')return{LinearGradient:props=>React.createElement(web.View,{style:props.style},props.children)};
  if(id==='expo-haptics')return{impactAsync:async()=>{},notificationAsync:async()=>{},selectionAsync:async()=>{},ImpactFeedbackStyle:{Light:'light'},NotificationFeedbackType:{Success:'success'}};
  if(id==='@/src/services/placesApi')return{fetchAllPlaces:async()=>({items:[]})};
  if(id==='@/src/hooks/useDiscoverCreators')return{useDiscoverCreators:()=>({items:[],loading:false})};
  if(id==='@/components/profile/ProfileIdentityHeader')return{ProfileIdentityHeader:props=>React.createElement(web.View,null,props.statsSlot,props.action)};
  if(id==='@/components/profile/ProfileStatsStrip')return{ProfileStatsStrip:()=>null};
  if(id==='@/components/profile/DiscoverCreatorsSection')return{DiscoverCreatorsSection:()=>React.createElement(web.Text,null,'Discover creators fixture')};
  if(id==='@/components/collection/PublicCollectionTile')return{PublicCollectionTile:()=>null};
  if(id==='@/components/haptic-tab')return{HapticTab:native.Pressable};
  if(id==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:platform==='ios'?47:24,bottom:platform==='ios'?34:24,left:0,right:0}),SafeAreaView:native.View};
  if(id==='expo-router')return{useRouter:()=>router,usePathname:()=>'/find',useLocalSearchParams:()=>params,useFocusEffect(){},Tabs,Redirect:props=>React.createElement(web.Text,null,`Redirect ${props.href}`),Stack:Object.assign(props=>React.createElement(web.View,null,props.children),{Screen:()=>null})};
  if(id==='@expo/vector-icons')return{Ionicons:props=>React.createElement('span',{'aria-hidden':true,style:{fontSize:props.size,color:props.color,lineHeight:1}},glyphs[props.name]??'◇')};
  if(id==='react-native-svg'){const element=name=>props=>React.createElement(name,props,props.children);return{__esModule:true,default:element('svg'),Circle:element('circle'),Defs:element('defs'),RadialGradient:element('radialGradient'),Stop:element('stop')};}
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
const CreatorAnalyticsScreen=load(path.join(root,'components/analytics/CreatorAnalyticsScreen')).default;
const {SearchResultsTabs}=load(path.join(root,'components/search/SearchResultsTabs'));
const PrivacyScreen=load(path.join(root,'app/settings/privacy')).default;
const {PendingImageCaptures}=load(path.join(root,'components/find/PendingImageCaptures'));
const SourceScreen=load(path.join(root,'app/stash/source/[sourceId]')).default;
const {FindPasteSheet}=load(path.join(root,'components/find/FindPasteSheet'));
const {FindActivity,FindActivityPreviewRows}=load(path.join(root,'components/find/FindActivity'));
const {findActivityPreviews}=load(path.join(root,'src/ui/findDashboard'));
const baseHistory=()=>({owner:'owner',filter:'completed',source:'all',items:Array.from({length:8},(_,i)=>({...findFixture(i+1),thumbnailUrl:i<2?'https://fixture.invalid/preview.jpg':null})),counts:{all:1205,processing:10,completed:1190,attention:5,saved:900},loaded:true,refreshing:false,loadingMore:false,cursor:'more',error:null,moreError:null});
function reset(){actions=[];images=[];lists=[];navigation=[];apiCalls=[];keyboardAvoiders=[];overrideStates=null;stateIndex=0;signedIn=true;authLoading=false;params={};history=baseHistory();detail={data:findDetailFixture(),loaded:true,refreshing:false,pending:null,error:null,actionError:null};capture={owner:'owner',input:'https://example.com/product',busy:false,error:null,ack:null};}
function render(Component,props={},withTabs=false){stateIndex=0;return renderToStaticMarkup(React.createElement(web.View,{style:{width:dimensions.width,height:dimensions.height,backgroundColor:tokens.color.canvasSoft}},React.createElement(Component,props),withTabs?React.createElement(AppTabBar):null));}
function save(name,body){if(!output)return;fs.mkdirSync(output,{recursive:true});const sheet=web.StyleSheet.getSheet();let fonts='';for(const [weight,face] of [['400','Regular'],['500','Medium'],['600','SemiBold'],['700','Bold']]){const font=path.join(root,`node_modules/@expo-google-fonts/inter/${weight}${face}/Inter_${weight}${face}.ttf`);if(fs.existsSync(font))fonts+=`@font-face{font-family:Inter_${weight}${face};src:url(file://${font})}`;}
 fs.writeFileSync(path.join(output,`${name}.html`),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fonts}${sheet.textContent}html,body{margin:0;background:${tokens.color.canvasSoft};width:100%;height:100%}</style></head><body>${body}<script>document.fonts.ready.then(()=>{const w=document.documentElement.clientWidth;const overflow=[];for(const e of document.querySelectorAll('div,span,input')){const r=e.getBoundingClientRect();if(r.width>0&&(r.left< -1||r.right>w+1)&&getComputedStyle(e).position!=='absolute')overflow.push({tag:e.tagName,text:e.textContent.slice(0,32),left:r.left,right:r.right});}document.body.dataset.horizontalOverflow=JSON.stringify(overflow.slice(0,8));});</script></body></html>`);}
let checks=0,transportOwner='owner';
const oldFetch=global.fetch,oldAbort=global.AbortController;global.AbortController=require('abort-controller').AbortController;global.fetch=async()=>{throw Error('Live network forbidden');};
async function main(){
 process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL='https://fixture.invalid';
 for(const theme of ['titanium','nebula'])for(const os of ['android','ios']){
  platform=os;native.Platform.OS=os;tokens=getThemeTokens(theme);
  for(const width of [320,360,390,414,430])for(const scale of [1,1.7]){
   dimensions={width,height:width===320?740:932,fontScale:scale,scale:1};reset();
   const html=render(Dashboard,{},true);
   const selectedTab=actions.find(action=>action['aria-selected']===true);assert.ok(selectedTab, 'Find tab is selected');assert.ok(html.includes('findOrb'), 'Selected Find tab renders its dimensional surface');
   for(const text of ['Your Finds','Your Activity','All Finds','Completed','Processing','Needs Attention','1190','10','5'])assert.ok(html.includes(text),`${theme}/${os}/${width}: ${text}`);
   const statusButtons=['Processing, 10 finds','Completed, 1190 finds','Needs Attention, 5 finds'].map(label=>actions.find(action=>action.accessibilityLabel===label));
   assert.ok(statusButtons.every(Boolean),`${theme}/${os}/${width}: all status buttons render`);
   for(const button of statusButtons){const style=web.StyleSheet.flatten(typeof button.style==='function'?button.style({pressed:false}):button.style);assert.ok(style.minHeight>=44);}
   assert.ok((width-2*tokens.space.md-2*tokens.space.xs)/3>=80,`${theme}/${os}/${width}: filter width remains usable`);
   assert.ok(!html.includes('Recently Found'));
   assert.ok(!html.includes('Ready to review')&&!html.includes('Saved 900'));
   assert.equal(html.includes('Not available yet'),false);assert.ok(lists[0].onEndReached&&lists[0].onRefresh);
   const gallery=actions.find(action=>action.accessibilityLabel==='Choose a screenshot or photo to Find'),camera=actions.find(action=>action.accessibilityLabel==='Take a photo to Find');assert.ok(gallery&&!gallery.disabled&&camera&&!camera.disabled);
   gallery.onPress();camera.onPress();assert.deepEqual(apiCalls.slice(-2),[['imageCapture','gallery'],['imageCapture','camera']]);
   const beforeNavigation=navigation.length;actions.find(action=>action.accessibilityLabel==='Paste a URL to Find').onPress();assert.equal(navigation.length,beforeNavigation);
   actions.find(action=>action.accessibilityLabel==='Processing, 10 finds').onPress();assert.deepEqual(navigation.at(-1),['params',{filter:'processing'}]);
   checks+=8;
   if(width===390&&scale===1)save(`dashboard-${theme}-${os}`,html);
   if(width===320&&scale===1)save(`dashboard-narrow-${theme}-${os}`,html);
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
  reset();params={filter:'processing'};history.filter='processing';history.items=[];history.counts.processing=0;save(`dashboard-processing-empty-${theme}-${os}`,render(Dashboard,{},true));
  reset();const live=findFixture(2,'processing');let activityOpens=0;let activityHtml=render(FindActivity,{item:live,owner:'owner',onOpen(){activityOpens++;},onRetry(){},busy:false,error:null});assert.equal(actions.find(a=>a.accessibilityState?.expanded!==undefined).accessibilityState.expanded,true);assert.ok(activityHtml.includes('Products: 2 found, still looking')&&activityHtml.includes('Places: 1 found')&&activityHtml.includes('View Find'));actions.find(a=>a.accessibilityLabel==='View Find').onPress();assert.equal(activityOpens,1);
  reset();const done=findFixture(1);activityHtml=render(FindActivity,{item:done,owner:'owner',onOpen(){},onRetry(){},busy:false,error:null});assert.equal(actions.find(a=>a.accessibilityState?.expanded!==undefined).accessibilityState.expanded,false);assert.ok(activityHtml.includes('View Find'));checks+=4;
  reset();const previewHtml=render(FindActivityPreviewRows,{rows:findActivityPreviews(findDetailFixture()),onOpen(){}});assert.ok(previewHtml.includes('Everyday camera')&&previewHtml.includes('Linen jacket')&&previewHtml.includes('Corner café'));assert.equal(actions.filter(a=>a.accessibilityLabel?.startsWith('View ')&&a.accessibilityLabel?.endsWith(' in Find')).length,3);checks+=2;
  reset();history.items=[findFixture(2,'processing'),...history.items];save(`dashboard-active-${theme}-${os}`,render(Dashboard,{},true));
  reset();clipboardReads=0;capture.input='';const sheetCapture={...capture,setInput:value=>apiCalls.push(['pasteInput',value]),submit:async()=>{apiCalls.push(['sheetSubmit']);}};
  let sheet=render(FindPasteSheet,{visible:true,owner:'owner',authLoading:false,capture:sheetCapture,onClose(){},onSignIn(){}});
  assert.equal(keyboardAvoiders.at(-1).behavior,'padding');assert.equal(keyboardAvoiders.at(-1).enabled,os==='ios');
  assert.equal(clipboardReads,0);assert.ok(sheet.includes('Automatically saved to your Stash'));assert.ok(actions.find(a=>a.accessibilityLabel==='Find it ✨').disabled);
  actions.find(a=>a.accessibilityLabel==='Paste link from clipboard').onPress();await Promise.resolve();await Promise.resolve();assert.equal(clipboardReads,1);assert.deepEqual(apiCalls.at(-1),['pasteInput','https://example.com/item']);
  reset();sheetCapture.input='https://example.com/item';sheet=render(FindPasteSheet,{visible:true,owner:'owner',authLoading:false,capture:sheetCapture,onClose(){},onSignIn(){}});assert.ok(actions.some(a=>a.accessibilityLabel==='Paste link from clipboard'));assert.ok(sheet.includes('Paste link'));assert.equal(actions.find(a=>a.accessibilityLabel==='Find it ✨').disabled,false);save(`paste-sheet-${theme}-${os}`,render(()=>React.createElement(React.Fragment,null,React.createElement(Dashboard),React.createElement(AppTabBar),React.createElement(FindPasteSheet,{visible:true,owner:'owner',authLoading:false,capture:sheetCapture,onClose(){},onSignIn(){}}))));checks+=5;
  if(theme==='titanium'&&os==='android'){clipboardSupported=false;cache.delete(path.join(root,'components/find/FindPasteSheet.tsx'));const LegacySheet=load(path.join(root,'components/find/FindPasteSheet')).FindPasteSheet;reset();sheetCapture.input='';render(LegacySheet,{visible:true,owner:'owner',authLoading:false,capture:sheetCapture,onClose(){},onSignIn(){}});assert.ok(!actions.some(a=>a.accessibilityLabel==='Paste link from clipboard'));clipboardSupported=true;checks++;}
  reset();params={findId:detail.data.id};
  let html=render(Detail,{},true);assert.ok(html.includes('Similar product'));assert.ok(html.includes('Restore to My Stash'));assert.ok(html.includes('Open original link'));assert.ok(actions.some(action=>action.accessibilityLabel==='Buy now, Everyday camera'));assert.ok(actions.some(action=>action.accessibilityLabel==='View product Everyday camera'));assert.ok(actions.some(action=>action.accessibilityLabel==='View Corner café on Google'));
  actions.find(action=>action.accessibilityLabel==='View product Everyday camera').onPress();const target=navigation.at(-1);assert.equal(target[0],'push');assert.ok(target[1].includes(detail.data.products[0].catalogProductId));
  actions.find(action=>action.accessibilityLabel==='View product Everyday camera image').onPress();assert.deepEqual(navigation.at(-1),target);
  actions.find(action=>action.accessibilityLabel==='Remove Everyday camera from My Stash').onPress();await Promise.resolve();assert.deepEqual(apiCalls.at(-1),['removeResult',detail.data.id,'products',detail.data.products[0].id,detail.data.products[0].identityKey]);
  checks+=4;save(`detail-${theme}-${os}`,html);
  for(const variant of ['processing','delayed','partial','empty','save-pending','save-failure','error','missing']){
  reset();params={findId:detail.data.id};
   if(variant==='processing')detail.data.outcome={...findFixture(2,'processing').outcome};
   if(variant==='delayed')detail.data.outcome={...findFixture(2,'processing').outcome,delayed:true,category:'attention'};
   if(variant==='partial')detail.data.outcome={...findFixture(3,'attention').outcome};
   if(variant==='empty'){detail.data.outcome={...detail.data.outcome,result:'empty',foundProducts:0,foundPlaces:0,savedProducts:0,savedPlaces:0};detail.data.products=[];detail.data.places=[];detail.data.savedSuggestions=[];}
   if(variant==='save-failure')detail.data.outcome={...detail.data.outcome,stashSync:'failed',canRetrySaving:true};
   if(variant==='save-pending')detail.data.outcome={...detail.data.outcome,stashSync:'pending',canRetrySaving:true};
   if(variant==='error')detail.error='Couldn’t refresh this find.';
   if(variant==='missing'){detail.data=null;detail.error='This find is no longer available.';}
   html=render(Detail);
   if(variant==='delayed')assert.ok(html.includes('taking a little longer')&&!html.includes('Retry finding'));
   if(variant==='partial')assert.ok(html.includes('Some finds are here')&&html.includes('Retry finding'));
   if(variant==='save-failure')assert.ok(html.includes('Retry saving to My Stash'));
   if(variant==='save-pending')assert.ok(!html.includes('Retry saving to My Stash'));
   if(variant==='empty')assert.ok(html.includes('No products or places to show'));
   if(variant==='error')assert.ok(html.includes('Refresh current status')&&html.includes('Everyday camera'));
   if(variant==='missing')assert.ok(!html.includes('Everyday camera'));
   checks++;
  }
  for(const variant of ['input','busy','accepted','duplicate','queued','permission','error','signed-out']){
   reset();if(variant==='busy')capture.busy=true;if(variant==='accepted'||variant==='duplicate')capture.ack={id:findFixture().id,created:variant==='accepted'};
   if(variant==='error')capture.error='Offline: receipt could not be confirmed';if(variant==='signed-out')signedIn=false;
   if(variant==='queued')capture.ack={id:findFixture().id,created:true,local:true};
   imageResult=variant==='permission'?{queued:false,message:'Allow camera access to take a photo.',settings:true}:null;
   html=render(Capture,{},true);
   if(variant==='input')assert.ok(html.includes('Find from this link'));
   if(variant==='accepted')assert.ok(html.includes('Link received'));
   if(variant==='duplicate')assert.ok(html.includes('already in your Finds'));
   if(variant==='queued')assert.ok(html.includes('Link securely queued')&&html.includes('View your Finds'));
   if(variant==='permission')assert.ok(html.includes('Open Settings')&&html.includes('Allow camera access'));
   if(variant==='error')assert.ok(html.includes('https://example.com/product')&&html.includes('could not be confirmed'));
   if(variant==='signed-out')assert.ok(!html.includes('value="https://example.com/product"'));
   checks++;
   if(variant==='input')save(`capture-${theme}-${os}`,html);
  }
  imageResult=null;
  reset();detail.data.sourceType='image';detail.data.sourceUrl=null;detail.data.privateMedia={state:'available',original:'/finds/fixture/media/original',thumbnail:'/finds/fixture/media/thumbnail'};params={findId:detail.data.id};html=render(Detail);
  assert.ok(html.includes('View original')&&!html.includes('Open original link'));assert.ok(images.some(image=>image.cachePolicy==='none'&&image.source.headers?.Authorization==='Bearer FIXTURE_PRIVATE_TOKEN'));checks+=2;
  reset();imageSupported=false;html=render(Dashboard,{},true);assert.ok(html.includes('Not available yet'));
  const unavailable=actions.filter(action=>action.accessibilityLabel?.endsWith('Not available yet'));
  assert.equal(unavailable.length,2);assert.ok(unavailable.every(action=>action.disabled));
  for(const action of unavailable){
   const layout=typeof action.style==='function'?action.style({pressed:false}):action.style;
   assert.equal(layout.flexDirection,'column');assert.equal(layout.minWidth,0);
   assert.ok(action.children.some(child=>child?.props?.style?.width==='100%'));
  }
  if(theme==='titanium'&&os==='android')save('dashboard-unsupported-titanium-android',html);
  imageSupported=true;checks+=5;
  for(const state of ['pending','uploading','needs_auth','needs_review','accepted']){
   reset();overrideStates=[{owner:'owner',rows:[{id:'local',owner:'owner',origin:'gallery',state,importId:state==='accepted'?findFixture().id:undefined}]},null,false,5];html=render(PendingImageCaptures);
   assert.ok(html.includes('Images on this device'));assert.ok(!html.includes('Completed 1190'));if(state==='uploading')assert.ok(actions.filter(a=>a.accessibilityLabel==='Try sending pending images').every(a=>a.disabled));if(state==='accepted')assert.ok(html.includes('Open Find'));checks++;
  }
  reset();overrideStates=[{owner:'other',rows:[{id:'private',origin:'camera',state:'pending'}]},null,false,5];html=render(PendingImageCaptures);assert.ok(!html.includes('Camera photo'));checks++;
  dimensions={width:320,height:740,fontScale:1,scale:1};reset();detail.data.products[0].title='Professional wireless noise cancelling over ear headphones with long descriptive name';params={findId:detail.data.id};html=render(Detail,{},true);assert.ok(actions.some(action=>action.accessibilityLabel==='View product Professional wireless noise cancelling over ear headphones with long descriptive name'));save(`detail-narrow-${theme}-${os}`,html);checks++;
  dimensions={width:320,height:740,fontScale:1.7,scale:1};reset();params={findId:detail.data.id};html=render(Detail,{},true);assert.ok(html.includes('Restore to My Stash'));save(`detail-large-${theme}-${os}`,html);checks++;
  reset();html=render(Capture,{},true);assert.ok(html.includes('Find from this link'));save(`capture-large-${theme}-${os}`,html);checks++;
  for(const profileWidth of [320,360,414])for(const fontScale of [1,1.7]){
   dimensions={width:profileWidth,height:932,fontScale,scale:1};reset();
   const props={creator:{userId:'owner',username:'fixture'},collections:[],saved:[],onEditPress(){},onSharePress(){},onPressCollection(){},onPressStat(){},onCreateCollection:()=>router.push('/(tabs)/create')};
   html=render(PersonalProfile,props);
   assert.ok(html.includes('Creator Studio')&&!html.includes('Discover creators fixture'));
   const toggle=actions.find(action=>action.accessibilityLabel==='Show creator suggestions');
   assert.ok(toggle);assert.equal(toggle.accessibilityState.expanded,false);
   const toggleStyle=web.StyleSheet.flatten(toggle.style({pressed:false}));
   assert.equal(toggleStyle.width,44);assert.equal(toggleStyle.height,44);
   assert.ok(actions.some(action=>action.accessibilityLabel==='Edit profile'));
   assert.ok(actions.some(action=>action.accessibilityLabel==='Share profile'));
   assert.equal(actions.find(action=>action.accessibilityLabel==='Collections').accessibilityState.selected,true);
   assert.equal(actions.find(action=>action.accessibilityLabel==='Saved').accessibilityState.selected,false);
   actions.find(action=>action.accessibilityLabel==='Creator Studio').onPress();assert.deepEqual(navigation.at(-1),['push','/(tabs)/create']);
   reset();overrideStates=['collections',true];html=render(PersonalProfile,props);
   assert.ok(html.includes('Discover creators fixture'));
   assert.equal(actions.find(action=>action.accessibilityLabel==='Hide creator suggestions').accessibilityState.expanded,true);
   reset();overrideStates=['saved',true];html=render(PersonalProfile,props);
   assert.ok(html.includes('Discover creators fixture'));
   assert.equal(actions.find(action=>action.accessibilityLabel==='Saved').accessibilityState.selected,true);
   checks+=10;
  }
 }
 reset();tokens=getThemeTokens('titanium');overrideStates=['https://fixture.invalid/broken.jpg'];render(FindImage,{url:'https://fixture.invalid/broken.jpg',cacheKey:'broken',style:{width:80,height:80}});assert.equal(images.length,0);checks++;
 for(const theme of ['titanium','nebula'])for(const os of ['android','ios'])for(const width of [320,360,414])for(const scale of [1,1.7]){
  tokens=getThemeTokens(theme);platform=os;native.Platform.OS=os;dimensions={width,height:844,fontScale:scale,scale:1};
  reset();let html=render(PrivacyScreen);assert.ok(html.includes('draft placeholder')&&html.includes('not the Mystash Privacy Policy'));
  reset();let searchTab=null;html=render(SearchResultsTabs,{selected:'collection',onSelect:value=>{searchTab=value;}});
  assert.ok(['Collections','Creators','Products'].every(label=>html.includes(label)));
  assert.equal(actions.filter(action=>action.accessibilityRole==='tab').length,3);
  assert.ok(actions.every(action=>web.StyleSheet.flatten(action.style).minHeight>=48));
  actions.find(action=>action.accessibilityLabel==='Products').onPress();assert.equal(searchTab,'product');
  reset();html=render(CreatorAnalyticsScreen);assert.ok(html.includes('Loading creator analytics'));
  const presets=[7,30,90].map(n=>actions.find(action=>action.accessibilityLabel===`Last ${n} days`));
  assert.ok(presets.every(Boolean));assert.ok(presets.every(action=>web.StyleSheet.flatten(typeof action.style==='function'?action.style({pressed:false}):action.style).minHeight>=44));
  assert.equal(actions.find(action=>action.accessibilityLabel==='Custom date range').accessibilityState.selected,false);
  reset();overrideStates=[7,null,true,0,'collection_opens',null,null];html=render(CreatorAnalyticsScreen);
  assert.ok(html.includes('Choose dates'));assert.ok(actions.some(action=>action.accessibilityLabel==='Previous month'));
  assert.ok(actions.some(action=>action.accessibilityLabel==='Cancel'));
  checks+=10;
 }
 for(const width of [320,360,414])for(const scale of [1,1.7]){
  dimensions={width,height:844,fontScale:scale,scale:1};tokens=getThemeTokens('titanium');reset();params={sourceId:'fixture-import'};
  const products=Array.from({length:4},(_,i)=>({kind:'product',result:{id:`source-product-${i}`,identityKey:`c:catalog-${i}`,title:`Source product ${i}`,imageUrl:null,catalogProductId:`catalog-${i}`,discoveredProductId:null,matchKind:'exact',saved:true,removed:false}}));
  const places=Array.from({length:3},(_,i)=>({kind:'place',result:{id:`source-place-${i}`,name:`Source place ${i}`,placeId:`place-${i}`,resolution:'resolved',locality:'Paris',city:null,saved:true,removed:false}}));
  overrideStates=[{owner:'owner',id:'fixture-import',items:[products[0],places[0],...products.slice(1),...places.slice(1)],cursor:'next',source:{...findFixture(),id:'fixture-import',title:'Fixture URL',sourceUrl:'https://example.com/find',outcome:{...findFixture().outcome,savedProducts:4,savedPlaces:3}},places:[],loaded:true,loading:false,refreshing:false,more:false,error:false,moreError:false},null,null];
  const html=render(SourceScreen);assert.ok(html.includes('Products (4)')&&html.includes('Places (3)')&&html.includes('Fixture URL'));
  assert.ok(html.includes('Source product 0')&&html.includes('Source place 2'));
  assert.equal(lists[0].data.filter(row=>row.kind==='products').flatMap(row=>row.items).length,4);
  assert.equal(lists[0].data.filter(row=>row.kind==='places').flatMap(row=>row.items).length,3);
  assert.ok(lists[0].onRefresh&&lists[0].onEndReached&&lists[0].ListFooterComponent);
  const productAction=actions.find(action=>action.accessibilityLabel?.includes('Source product 0')&&action.accessibilityLabel?.includes('Open product details'));
  assert.ok(productAction);productAction.onPress();assert.ok(navigation.at(-1)[1].includes('/product/catalog-0'));
  assert.ok(actions.some(action=>action.accessibilityLabel==='Search on Google, Source place 0'));
  assert.equal(actions.filter(action=>action.accessibilityLabel?.startsWith('Remove ')).length,7);
  const loaded=overrideStates[0];
  assert.ok(!actions.some(action=>action.accessibilityLabel==='Back'), 'source page uses the navigator back button only');
  assert.match(fs.readFileSync(path.join(root,'app/_layout.tsx'),'utf8'), /name="stash\/source\/\[sourceId\]" options=\{\{ title: 'Saved from Find' \}\}/);
  const removeAction=actions.find(action=>action.accessibilityLabel==='Remove Source product 0 from My Stash');
  assert.equal(removeAction.hitSlop,8);
  const removeStyle=removeAction.style({pressed:false});
  assert.equal(removeStyle.width,32);assert.equal(removeStyle.height,32);
  assert.equal(removeStyle.right,6+tokens.space.xs);
  reset();params={sourceId:'fixture-import'};overrideStates=[{...loaded,refreshing:true,error:true},null,null];const cached=render(SourceScreen);
  assert.ok(cached.includes('Couldn’t refresh')&&cached.includes('Source product 0'));assert.equal(lists[0].refreshing,true);
  reset();params={sourceId:'fixture-import'};overrideStates=[{...loaded,items:[],cursor:null,source:{...loaded.source,outcome:{...loaded.source.outcome,savedProducts:0,savedPlaces:0}}},null,null];
  assert.ok(render(SourceScreen).includes('No saved items remain'));
  checks+=10;
 }
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
 console.log(JSON.stringify({passed:true,checks,themes:2,platformAdapters:2,widths:[320,360,390,414,430],largeTypeAdapter:true,nativeAbortPolyfill:true,nativeExecution:false,artifacts:output??null}));
}
main().finally(()=>{global.fetch=oldFetch;global.AbortController=oldAbort;}).catch(error=>{console.error(error);process.exitCode=1;});
