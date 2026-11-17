import {Alert,Platform,Share} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {publicStashUrl} from '@/src/services/publicStashApi';
export async function sharePublicStash(id:string){
 const url=publicStashUrl(id);
 try{if(Platform.OS==='web'){
  if(typeof navigator!=='undefined'&&navigator.share)await navigator.share({title:'Public Stash on Mystash',url});
  else{await Clipboard.setStringAsync(url);Alert.alert('Public Stash','Link copied.');}
 }else await Share.share({message:url,url});}catch(error){if(!(error instanceof Error&&error.name==='AbortError'))Alert.alert('Public Stash','Couldn’t share the link. Please try again.');}
}
