import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { useThemeMode } from '@/contexts/ThemeContext';

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Reusable full-screen in-app merchant browser.
 * Compatible with Expo development builds and production store builds
 * via react-native-webview (already in the native dependency set).
 */
export default function MerchantBrowserScreen() {
  const router = useRouter();
  const { tokens } = useThemeMode();
  const params = useLocalSearchParams<{ url?: string | string[]; title?: string | string[] }>();
  const initialUrl = firstParam(params.url);
  const title = firstParam(params.title) ?? 'Merchant';
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(title);

  const startUrl = useMemo(() => (initialUrl && isHttpUrl(initialUrl) ? initialUrl : null), [initialUrl]);

  const onClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/search' as never);
  }, [router]);

  const onNavBack = useCallback(() => {
    if (canGoBack) {
      webRef.current?.goBack();
      return;
    }
    onClose();
  }, [canGoBack, onClose]);

  const onShouldStart = useCallback((request: { url: string }): boolean => {
    const target = request.url;
    if (!target) return false;
    if (isHttpUrl(target) || target === 'about:blank') return true;
    // External schemes (tel, mailto, payment/deep links): hand off safely.
    void Linking.openURL(target).catch(() => {
      /* ignore unsupported schemes */
    });
    return false;
  }, []);

  if (!startUrl) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: tokens.color.canvas }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.headerAction, { color: tokens.color.primary }]}>Close</Text>
          </Pressable>
        </View>
        <View style={styles.center}>
          <Text style={{ color: tokens.color.text }}>This merchant link is unavailable.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: tokens.color.canvas }]} edges={['top', 'bottom']}>
      <View
        style={[
          styles.header,
          { borderBottomColor: tokens.color.border, backgroundColor: tokens.color.surface },
        ]}
      >
        <Pressable onPress={onNavBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={[styles.headerAction, { color: tokens.color.primary }]}>Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: tokens.color.text }]} numberOfLines={1}>
          {currentTitle}
        </Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={[styles.headerAction, { color: tokens.color.primary }]}>Close</Text>
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.loadingBar} pointerEvents="none">
          <ActivityIndicator color={tokens.color.accent} />
        </View>
      ) : null}
      <WebView
        ref={webRef}
        source={{ uri: startUrl }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={(nav: WebViewNavigation) => {
          setCanGoBack(nav.canGoBack);
          if (nav.title?.trim()) setCurrentTitle(nav.title.trim());
        }}
        onShouldStartLoadWithRequest={onShouldStart}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures
        startInLoadingState
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerAction: { fontWeight: '700', fontSize: 16, minWidth: 52 },
  headerTitle: { flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 15 },
  loadingBar: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: 'center',
    paddingVertical: 6,
  },
  webview: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
