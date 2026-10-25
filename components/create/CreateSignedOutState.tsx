import React from 'react';
import { Image, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Text } from '@/components/ui/Text';
import { useThemeTokens } from '@/src/theme/useThemeTokens';
import { typeStyle } from '@/src/theme/typography';
import { CREATE_COPY } from '@/src/ui/createCopy';

const HERO = require('../../assets/images/creator_studio_signed_out_hero.png');

type Props = {
  onGoToProfile: () => void;
};

/**
 * Creator Studio signed-out empty state. Presentation only — parents own
 * the Profile destination.
 */
export function CreateSignedOutState({ onGoToProfile }: Props) {
  const tokens = useThemeTokens();
  const { width, height } = useWindowDimensions();
  const heroHeight = Math.min(width * 0.9, height * 0.42, 380);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.content,
        {
          paddingHorizontal: tokens.space.lg,
          paddingTop: tokens.space.md,
          paddingBottom: tokens.space.xl,
          gap: tokens.space.lg,
        },
      ]}
    >
      <Image
        source={HERO}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        importantForAccessibility="no"
        style={{ width: '100%', height: heroHeight }}
      />
      <View
        style={{
          gap: tokens.space.sm,
          alignItems: 'center',
          paddingHorizontal: tokens.space.xs,
        }}
      >
        <Text
          style={{
            color: tokens.color.text,
            fontSize: tokens.fontSize.headline,
            lineHeight: tokens.lineHeight.headline,
            fontFamily: tokens.fontFamily.extraBold,
            textAlign: 'center',
          }}
        >
          {CREATE_COPY.signInTitle}
        </Text>
        <Text style={[typeStyle(tokens, 'bodyMuted'), { textAlign: 'center' }]}>
          {CREATE_COPY.signInBody}
        </Text>
      </View>
      <View style={{ alignSelf: 'stretch', marginTop: tokens.space.xs }}>
        <ActionButton variant="filled" label="Go to Profile" onPress={onGoToProfile} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
