import {useCallback,useRef,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {useAuth} from '@/contexts/AuthContext';
import {publicStashClientEnabled,publicStashRequest,type StashSettings} from '@/src/services/publicStashApi';
export function usePublicStashOwner(){
 const {user}=useAuth(),owner=user?.id,identity=useRef(owner);identity.current=owner;
 const [state,setState]=useState<{owner:string;settings:StashSettings}|null>(null),[error,setError]=useState<unknown>(null);
 const refresh=useCallback(async()=>{if(!owner||!publicStashClientEnabled())return;try{const settings=await publicStashRequest<StashSettings>('/public-stashes/me',{},owner);if(identity.current===owner){setState({owner,settings});setError(null);}}catch(e){if(identity.current===owner)setError(e);}},[owner]);
 useFocusEffect(useCallback(()=>{void refresh();return()=>{};},[refresh]));
 const mutate=useCallback(async(path:string,body:object)=>{if(!owner||identity.current!==owner)throw Error('Account changed.');try{const settings=await publicStashRequest<StashSettings>(path,{method:'PUT',body:JSON.stringify(body)},owner);if(identity.current===owner)setState({owner,settings});}catch(e){await refresh();throw e;}},[owner,refresh]);
 return {ownerId:owner,enabled:publicStashClientEnabled()&&!!owner,settings:state && state.owner===owner?state.settings:null,error,refresh,mutate};
}
export type PublicStashOwner=ReturnType<typeof usePublicStashOwner>;
