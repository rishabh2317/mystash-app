import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { TopBar } from '@/components/chrome/TopBar';
import { NativePendingShares } from '@/components/search/NativePendingShares';
import { FindCaptureActions } from '@/components/find/FindCaptureActions';
import { FindDashboard } from '@/components/find/FindDashboard';
import { FindNotificationButton } from '@/components/find/FindNotificationButton';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useFindHistory } from '@/src/hooks/useFindHistory';
import { FIND_ROUTES, findDetailPath, type FindViewFilter } from '@/src/ui/find';
import {useFindImageCapture} from '@/src/hooks/useFindImageCapture';
import {PendingImageCaptures} from '@/components/find/PendingImageCaptures';
import {ImageCaptureFeedback} from '@/components/find/ImageCaptureFeedback';
export default function FindScreen() {
  const router = useRouter(), { tokens } = useThemeMode(), { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter?: string }>();
  const filter: FindViewFilter = params.filter === 'all' || params.filter === 'processing' || params.filter === 'attention' ? params.filter : 'completed';
  const history = useFindHistory(filter);
  const image=useFindImageCapture();
  const captureImage=(origin:'camera'|'gallery')=>{if(!user)router.push(FIND_ROUTES.profile);else void image.capture(origin);};
  return <View style={{ flex: 1, backgroundColor: tokens.color.canvasSoft, paddingLeft: insets.left, paddingRight: insets.right }}>
    <TopBar mode="page" title="Mystash" trailing={<FindNotificationButton />} />
    <FindDashboard state={history} signedIn={Boolean(user)} authLoading={loading} onFilter={next => router.setParams({ filter: next })}
      onOpen={id => router.push(findDetailPath(id) as Href)} onCapture={() => router.push(FIND_ROUTES.capture as Href)}
      onSignIn={() => router.push(FIND_ROUTES.profile)} onRefresh={() => { void history.refresh(); }} onLoadMore={() => { void history.loadMore(); }} pending={<><ImageCaptureFeedback result={image.result} openSettings={()=>void image.openSettings()}/><NativePendingShares /><PendingImageCaptures /></>} />
    <FindCaptureActions onPaste={() => router.push(FIND_ROUTES.capture as Href)} imagesAvailable={image.supported} busy={image.busy} onGallery={()=>captureImage('gallery')} onCamera={()=>captureImage('camera')}/>
  </View>;
}
