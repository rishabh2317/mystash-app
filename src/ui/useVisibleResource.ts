import { useEffect, useRef, useState } from 'react';
import { AppState, useWindowDimensions, type View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { visibleFraction } from '@/src/analytics/visibility';

type Observer = { measure():void };
const observers=new Set<Observer>();let timer:ReturnType<typeof setInterval>|null=null,offset=0;
function start() {
  if(timer)return;
  timer=setInterval(()=>{
    const all=[...observers];
    if(!all.length){if(timer)clearInterval(timer);timer=null;return;}
    for(let i=0;i<Math.min(16,all.length);i++)all[(offset+i)%all.length].measure();
    offset=(offset+16)%all.length;
  },400);
}

/** Resource demand is independent of Analytics consent; this records no events. */
export function useVisibleResource(enabled:boolean) {
  const ref=useRef<View>(null),focused=useIsFocused(),insets=useSafeAreaInsets(),{width,height}=useWindowDimensions();
  const [visible,setVisible]=useState(false),[foreground,setForeground]=useState(AppState.currentState==='active');
  const measure=useRef(()=>{});
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>sub.remove();},[]);
  const active=enabled&&focused&&foreground;
  useEffect(()=>{
    if(!active){setVisible(false);return;}
    let alive=true;
    const observer:Observer={measure(){ref.current?.measureInWindow((x,y,w,h)=>{
      if(alive)setVisible(visibleFraction(x,y,w,h,width,insets.top+48,height-insets.bottom-64)>=0.25);
    });}};
    measure.current=observer.measure;observers.add(observer);start();observer.measure();
    return()=>{alive=false;observers.delete(observer);measure.current=()=>{};};
  },[active,width,height,insets.top,insets.bottom]);
  return {ref,visible:active&&visible,onLayout:()=>measure.current()};
}
