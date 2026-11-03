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
import { useFindCapture } from '@/src/hooks/useFindCapture';
import { FIND_COPY, FIND_ROUTES, findDetailPath } from '@/src/ui/find';
export default function FindCaptureScreen() {
  const router = useRouter(), { tokens } = useThemeMode(), { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const capture = useFindCapture();
  const { input: visibleInput,error,busy,ack: accepted } = capture;
  const submit = () => { Keyboard.dismiss(); void capture.submit(); };
  return <View style={{ flex: 1, backgroundColor: tokens.color.canvasSoft, paddingLeft: insets.left, paddingRight: insets.right }}>
    <TopBar mode="page" title="Capture a link" showBack onBack={() => router.canGoBack() ? router.back() : router.replace(FIND_ROUTES.home as Href)} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: tokens.space.md, paddingBottom: tokens.space.xxl, gap: tokens.space.lg }}>
        <Text style={typeStyle(tokens,'sectionTitle')}>What caught your eye?</Text>
        <Text style={typeStyle(tokens,'bodyMuted')}>Paste an Instagram Reel, YouTube Short, or supported web link.</Text>
        <Text style={typeStyle(tokens,'caption')}>{FIND_COPY.automatic} No selection step is required.</Text>
        {loading ? <Text style={typeStyle(tokens,'bodyMuted')}>Checking your account…</Text> : !user ? <><Text style={typeStyle(tokens,'body')}>Sign in before capturing a link.</Text><ActionButton wrapLabel minTouchHeight={48} label="Sign in" onPress={() => router.push(FIND_ROUTES.profile)} /></> : accepted ? <View accessibilityLiveRegion="polite" style={{ gap: tokens.space.md }}>
          <Text style={typeStyle(tokens,'sectionTitle')}>{accepted.created ? 'Link received' : 'This link is already in your Finds'}</Text>
          <Text style={typeStyle(tokens,'bodyMuted')}>You can leave this screen while we find products and places in the background.</Text>
          <ActionButton wrapLabel minTouchHeight={48} label="Open Find" onPress={() => router.replace(findDetailPath(accepted.id) as Href)} />
          <ActionButton wrapLabel minTouchHeight={48} label="Capture another link" variant="quiet" onPress={capture.clearAck} />
        </View> : <>
          <TextInput accessibilityLabel="Link to capture" placeholder="Paste a URL or shared text" placeholderTextColor={tokens.color.textMuted} value={visibleInput} editable={!busy}
            onChangeText={capture.setInput} autoCorrect={false} autoCapitalize="none" autoComplete="off" keyboardType="url" returnKeyType="go" maxLength={8192}
            onSubmitEditing={() => { void submit(); }} style={{ minHeight: 56, padding: tokens.space.md, borderRadius: tokens.radius.xl, borderWidth: tokens.stroke.thin, borderColor: error ? tokens.color.danger : tokens.color.border,
              backgroundColor: tokens.color.surface, color: tokens.color.text, fontFamily: tokens.fontFamily.regular, fontSize: tokens.fontSize.body }} />
          {error ? <Text accessibilityRole="alert" style={[typeStyle(tokens,'bodyMuted'), { color: tokens.color.danger }]}>{error}</Text> : null}
          <ActionButton wrapLabel minTouchHeight={48} label="Find from this link" leadingIcon="sparkles-outline" pending={busy} disabled={!visibleInput.trim()} onPress={() => { void submit(); }} />
          <Text style={typeStyle(tokens,'caption')}>Sending needs a connection. If receipt can’t be confirmed, your text stays here so you can try again.</Text>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}
