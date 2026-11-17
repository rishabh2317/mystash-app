import {sharePublicStash} from '@/src/public-stash/share';
import React,{useState,useRef,useEffect} from 'react';
import {View,Modal,Pressable,ScrollView,Alert} from 'react-native';
import {useRouter,type Href} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Text} from '@/components/ui/Text';
import {OverflowMenu} from '@/components/chrome/OverflowMenu';
import {useThemeMode} from '@/contexts/ThemeContext';
import {typeStyle} from '@/src/theme/typography';
import {publicStashRequest,type Publication} from '@/src/services/publicStashApi';
import type {PublicStashOwner} from '@/src/public-stash/usePublicStashOwner';
export function PublicationMenu({owner,publication,kind}:{owner:PublicStashOwner;publication:Publication|undefined;kind:'product'|'place'}){
 const [busy,setBusy]=useState(false);if(!owner.enabled||!publication)return null;
 const apply=async(enablePublic=false)=>{setBusy(true);try{await owner.mutate(`/public-stashes/me/${kind==='product'?'products':'places'}/${publication.membershipId}/publication`,{published:!publication.published,expectedVersion:publication.version,enablePublic});}catch(e){Alert.alert('Public Stash',e instanceof Error?e.message:'Couldn’t change publication.');}finally{setBusy(false);}};
 const act=()=>{
  if(busy)return;
  if(kind==='place'&&!publication.itemId){Alert.alert('Public Stash','This place can be published once it has been identified.');return;}
  if(!publication.published&&owner.settings?.visibility==='private')Alert.alert('Publish to Public Stash?','Anyone with your link can view items you publish. Your other saves stay private.',[{text:'Cancel',style:'cancel'},{text:'Enable Public and publish',onPress:()=>void apply(true)}]);
  else void apply();
 };
 return <View style={{flexDirection:'row',alignItems:'center',justifyContent:'flex-end',minHeight:40}}>{publication.published?<Text accessibilityLabel={owner.settings?.visibility==='private'?'Published selection, hidden while Private':'Published to Public Stash'}>Published</Text>:null}<OverflowMenu accessibilityLabel="Publication actions" items={[{id:'publication',label:busy?'Updating…':publication.published?'Unpublish':'Publish to Public Stash',icon:publication.published?'eye-off-outline':'globe-outline',onPress:act}]}/></View>;
}
export function PublicStashControls({owner}:{owner:PublicStashOwner}){
 const {tokens}=useThemeMode(),router=useRouter(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[insights,setInsights]=useState<{ownerId:string;days:number;enabled:boolean;coverage:string;refreshedAt:string;metrics:Record<string,number>}|null>(null);
 const scope=useRef(owner.ownerId);scope.current=owner.ownerId;
 useEffect(()=>{setOpen(false);setInsights(null);},[owner.ownerId]);
 if(!owner.enabled)return null;
 const settings=owner.settings;
 const toggle=()=>{if(!settings||busy)return;const next=settings.visibility==='private'?'public':'private';Alert.alert(next==='public'?'Enable Public Stash?':'Make Stash Private?',next==='public'?'Anyone with your link can view items you publish. Your other saves stay private.':'Your Public Stash will become unavailable. Your published selections will be kept.',[{text:'Cancel',style:'cancel'},{text:next==='public'?'Enable Public':'Make Private',onPress:()=>{setBusy(true);void owner.mutate('/public-stashes/me/visibility',{visibility:next,expectedVersion:settings.version}).catch(e=>Alert.alert('Public Stash',e.message)).finally(()=>setBusy(false));}}]);};
 const action=(label:string,onPress:()=>void,disabled=false)=><Pressable key={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={{minHeight:44,justifyContent:'center',opacity:disabled?0.5:1}}><Text style={typeStyle(tokens,'link')}>{label}</Text></Pressable>;
 const loadInsights=async(days:number)=>{const who=owner.ownerId;if(!who)return;try{const data=await publicStashRequest<Omit<NonNullable<typeof insights>,'ownerId'>>(`/public-stashes/me/insights?days=${days}`,{},who);if(scope.current===who)setInsights({...data,ownerId:who});}catch{Alert.alert('Insights','Couldn’t load insights. Please try again.');}};
 return <><Pressable accessibilityRole="button" accessibilityLabel={`Public Stash settings, ${settings?.visibility??'private'}`} onPress={()=>{setOpen(true);void owner.refresh();}} style={{minHeight:44,justifyContent:'center'}}><Text style={typeStyle(tokens,'link')}>{settings?.visibility==='public'?'Public':'Private'}</Text></Pressable>
  <Modal visible={open} animationType="slide" onRequestClose={()=>setOpen(false)}><SafeAreaView style={{flex:1,backgroundColor:tokens.color.canvas}}><ScrollView contentContainerStyle={{padding:20,gap:12}}><Text style={typeStyle(tokens,'sectionTitle')}>Public Stash</Text>
   <Text style={typeStyle(tokens,'bodyMuted')}>Choose which saved Products and Places appear at your link. New saves always stay private.</Text>
   {owner.error?<Text style={typeStyle(tokens,'bodyMuted')}>Couldn’t load publication settings. Please try again.</Text>:null}
   {settings?<><Text style={typeStyle(tokens,'body')}>{settings.products.filter(p=>p.published).length} Products · {settings.places.filter(p=>p.published).length} Places selected</Text>
    {settings.visibility==='private'?<Text style={typeStyle(tokens,'bodyMuted')}>Published selections are hidden while Private.</Text>:settings.products.some(p=>p.published)||settings.places.some(p=>p.published)?null:<Text style={typeStyle(tokens,'bodyMuted')}>Your link is ready. Publish a Product or Place to add it.</Text>}
    {action(busy?'Updating…':settings.visibility==='public'?'Make Private':'Enable Public',toggle,busy)}
    {action('Preview',()=>{setOpen(false);router.push(`/stash/${settings.publicId}${settings.visibility==='private'?'?preview=1':''}` as Href);})}
    {action('Share Public Stash',()=>{void sharePublicStash(settings.publicId);},settings.visibility!=='public')}
    {action('Insights · 7 days',()=>void loadInsights(7))}{action('Insights · 30 days',()=>void loadInsights(30))}
   </>:action('Retry',()=>void owner.refresh())}
   {insights&&insights.ownerId===owner.ownerId?<View style={{gap:8}}><Text style={typeStyle(tokens,'sectionTitle')}>Last {insights.days} days</Text>{Object.entries({views:'Views',product_opens:'Product opens',place_opens:'Place opens',saves:'Saves generated',shopping_clicks:'Shopping clicks'}).map(([key,label])=><Text key={key} style={typeStyle(tokens,'body')}>{label}: {insights.enabled?insights.metrics[key]??0:'Unavailable'}</Text>)}<Text style={typeStyle(tokens,'bodyMuted')}>Recorded activity from consenting visitors. Coverage may be incomplete. Updated {new Date(insights.refreshedAt).toLocaleString()}.</Text></View>:null}
   {action('Close',()=>{setOpen(false);setInsights(null);})}
  </ScrollView></SafeAreaView></Modal>
 </>;
}
