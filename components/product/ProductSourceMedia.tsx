import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useThemeMode } from '@/contexts/ThemeContext';
import { IMMERSIVE_TOKENS } from '@/src/theme/tokens';
import type { ProductPageSource } from '@/src/types/productPage';
import { collectionMediaFrameSize, COLLECTION_YOUTUBE_CROP_SCALE } from '@/src/ui/collectionLayout';
import { relatedMediaWatchLabel } from '@/src/ui/productPage';
import { getVideoUrlInfo } from '@/src/utils/videoUtils';
import { buildInstagramEmbedHtml } from '@/src/utils/instagramWebViewEmbed';
import {
  buildYoutubeWebHtml,
  extractYoutubeVideoIdFromUrl,
  resolveYoutubeParentOrigin,
} from '@/src/utils/youtubeWebViewEmbed';

type Props = {
  source: ProductPageSource;
};

export function ProductSourceMedia({ source }: Props) {
  const { tokens } = useThemeMode();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { width, height } = collectionMediaFrameSize({ screenWidth, screenHeight });
  const urlInfo = getVideoUrlInfo(source.url);
  const parentOrigin = useMemo(() => resolveYoutubeParentOrigin(), []);
  const youtubeId = extractYoutubeVideoIdFromUrl(source.url);
  const youtubeHtml = useMemo(
    () =>
      youtubeId
        ? buildYoutubeWebHtml(youtubeId, parentOrigin, COLLECTION_YOUTUBE_CROP_SCALE, { loop: true })
        : null,
    [youtubeId, parentOrigin],
  );
  const instagramHtml = useMemo(
    () =>
      urlInfo?.platform === 'instagram' ? buildInstagramEmbedHtml(source.url, { crop: 'collection' }) : null,
    [source.url, urlInfo?.platform],
  );
  const canEmbed =
    urlInfo?.isValid &&
    ((urlInfo.platform === 'youtube' && youtubeHtml) || (urlInfo.platform === 'instagram' && instagramHtml));

  const openSource = () => {
    void openBrowserAsync(source.url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
  };

  return (
    <View style={{ gap: tokens.space.sm }}>
      {canEmbed ? (
        <View
          style={[
            styles.frame,
            {
              width,
              height,
              borderRadius: tokens.radius.xl,
              backgroundColor: IMMERSIVE_TOKENS.stage,
              borderColor: tokens.color.border,
              alignSelf: 'center',
            },
          ]}
        >
          {urlInfo?.platform === 'youtube' && youtubeHtml ? (
            <WebView
              source={{ html: youtubeHtml, baseUrl: `${parentOrigin}/` }}
              style={styles.webView}
              originWhitelist={['*']}
              javaScriptEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              scrollEnabled={false}
            />
          ) : null}
          {urlInfo?.platform === 'instagram' && instagramHtml ? (
            <WebView
              source={{ html: instagramHtml }}
              style={styles.webView}
              originWhitelist={['*']}
              javaScriptEnabled
              scrollEnabled={false}
            />
          ) : null}
        </View>
      ) : null}
      <Pressable onPress={openSource} accessibilityRole="link" accessibilityLabel={source.label}>
        <Text
          style={{
            color: tokens.color.primary,
            fontSize: tokens.fontSize.bodyStrong,
            fontWeight: tokens.fontWeight.bold,
          }}
        >
          {relatedMediaWatchLabel(source.kind)}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  webView: {
    flex: 1,
    backgroundColor: '#000',
  },
});
