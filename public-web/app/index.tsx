import React, {useEffect} from 'react';
import {Linking, Pressable, View} from 'react-native';
import {Text} from '@/components/ui/Text';

/** Expo development/export fallback; production serves the static homepage at /. */
export default function Landing() {
  useEffect(() => { window.location.replace('/home/'); }, []);
  return <View style={{padding:32}}><Pressable accessibilityRole="link" onPress={() => void Linking.openURL('/home/')}><Text>Explore Mystash →</Text></Pressable></View>;
}
