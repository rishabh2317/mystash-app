import React from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { TopBar } from '@/components/chrome/TopBar';
import { Text } from '@/components/ui/Text';
import { ActionButton } from '@/components/ui/ActionButton';
import { useThemeMode } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { typeStyle } from '@/src/theme/typography';
import { outlineCardChrome } from '@/src/theme/tokens';
import { useFindCapture } from '@/src/hooks/useFindCapture';
import { FIND_COPY, FIND_ROUTES, findDetailPath } from '@/src/ui/find';
import {useFindImageCapture} from '@/src/hooks/useFindImageCapture';
import {ImageCaptureFeedback} from '@/components/find/ImageCaptureFeedback';
import {observeFind} from '@/src/analytics/findMeasurement';
export default function FindCaptureScreen() {
  const router = useRouter(), { tokens } = useThemeMode(), { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const capture = useFindCapture();
  const image=useFindImageCapture();
  const { input: visibleInput,error,busy,ack: accepted } = capture;
  const submit = () => { Keyboard.dismiss(); void capture.submit(); };
  return <View style={{ flex: 1, backgroundColor: tokens.color.canvasSoft, paddingLeft: insets.left, paddingRight: insets.right }}>
    <TopBar mode="page" title="Capture a Find" showBack onBack={() => {if(visibleInput.trim()&&!accepted&&!busy)observeFind(user?.id??null,'find.capture_cancelled',{origin:'url'});if(router.canGoBack())router.back();else router.replace(FIND_ROUTES.home as Href);}} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: tokens.space.md, paddingBottom: tokens.space.xxl, gap: tokens.space.md }}>
        <View style={{ gap: tokens.space.xs }}>
        <Text style={typeStyle(tokens,'sectionTitle')}>What caught your eye?</Text>
        <Text style={typeStyle(tokens,'bodyMuted')}>Paste an Instagram Reel, YouTube Short, or supported web link.</Text>
        <Text style={typeStyle(tokens,'caption')}>{FIND_COPY.automatic} No selection step is required.</Text>
        </View>
        <View style={{ ...outlineCardChrome(tokens), borderWidth: tokens.stroke.thin, borderRadius: tokens.radius.lg, padding: tokens.space.md, gap: tokens.space.md }}>
        {user?<View style={{gap:tokens.space.sm}}>
          <ActionButton wrapLabel label="Screenshot / Gallery" leadingIcon="images-outline" minTouchHeight={48} variant="secondary" disabled={!image.supported||image.busy||busy} onPress={()=>void image.capture('gallery')}/>
          <ActionButton wrapLabel label="Take a photo" leadingIcon="camera-outline" minTouchHeight={48} variant="secondary" disabled={!image.supported||image.busy||busy} onPress={()=>void image.capture('camera')}/>
          {!image.supported?<Text style={typeStyle(tokens,'caption')}>Images need an updated native Mystash installation.</Text>:null}
          <ImageCaptureFeedback result={image.result} openSettings={()=>void image.openSettings()}/>
        </View>:null}
        {loading ? <Text style={typeStyle(tokens,'bodyMuted')}>Checking your account…</Text> : !user ? <><Text style={typeStyle(tokens,'body')}>Sign in before capturing a link.</Text><ActionButton wrapLabel minTouchHeight={48} label="Sign in" onPress={() => router.push(FIND_ROUTES.profile)} /></> : accepted ? <View accessibilityLiveRegion="polite" style={{ gap: tokens.space.md }}>
          <Text style={typeStyle(tokens,'sectionTitle')}>{accepted.local?'Link securely queued':accepted.created ? 'Link received' : 'This link is already in your Finds'}</Text>
          <Text style={typeStyle(tokens,'bodyMuted')}>{accepted.local?'Saved on this device. We’ll send it when you’re connected, then find products and places automatically.':'You can leave this screen while we find products and places in the background.'}</Text>
          <ActionButton wrapLabel minTouchHeight={48} label={accepted.local?'View your Finds':'Open Find'} onPress={() => router.replace((accepted.local?FIND_ROUTES.home:findDetailPath(accepted.id)) as Href)} />
          <ActionButton wrapLabel minTouchHeight={48} label="Capture another link" variant="quiet" onPress={capture.clearAck} />
        </View> : <>
          <TextInput accessibilityLabel="Link to capture" placeholder="Paste a URL or shared text" placeholderTextColor={tokens.color.textMuted} value={visibleInput} editable={!busy}
            onChangeText={capture.setInput} autoCorrect={false} autoCapitalize="none" autoComplete="off" keyboardType="url" returnKeyType="go" maxLength={8192}
            onSubmitEditing={() => { void submit(); }} style={{ minHeight: 56, padding: tokens.space.md, borderRadius: tokens.radius.xl, borderWidth: tokens.stroke.thin, borderColor: error ? tokens.color.danger : tokens.color.border,
              backgroundColor: tokens.color.surface, color: tokens.color.text, fontFamily: tokens.fontFamily.regular, fontSize: tokens.fontSize.body }} />
          {error ? <Text accessibilityRole="alert" style={[typeStyle(tokens,'bodyMuted'), { color: tokens.color.danger }]}>{error}</Text> : null}
          <ActionButton wrapLabel minTouchHeight={48} label="Find from this link" leadingIcon="sparkles-outline" pending={busy} disabled={!visibleInput.trim()} onPress={() => { void submit(); }} />
          <Text style={typeStyle(tokens,'caption')}>Supported mobile installations queue links securely, even offline. Other installations need a connection and confirm receipt before clearing your text.</Text>
        </>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}
